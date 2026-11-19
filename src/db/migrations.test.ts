import type { SQLiteDatabase } from 'expo-sqlite';

import { MIGRATIONS, migrateDbIfNeeded } from './migrations';

// Node's own SQLite stands in for expo-sqlite, which only runs on the phone.
type RawDb = {
  exec(sql: string): void;
  prepare(sql: string): { get(): unknown; all(): unknown[] };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => RawDb };

/** The few expo-sqlite calls the migrations use, over a real in-memory database. */
function testDb() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (sql: string) => raw.exec(sql),
    getFirstAsync: async (sql: string) => raw.prepare(sql).get(),
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await work();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as SQLiteDatabase;
  return { raw, db };
}

describe('migration 6 (Discover)', () => {
  it('keeps podcasts made at version 5 and clears their feed caches', async () => {
    const { raw, db } = testDb();
    for (const sql of MIGRATIONS.slice(0, 5)) raw.exec(sql);
    raw.exec('PRAGMA user_version = 5');
    raw.exec(
      `INSERT INTO podcast (feed_url, title, subscribed, added_at, etag, last_modified)
       VALUES ('https://lowtide.example/feed.xml', 'Low Tide Radio', 1, 1, '"abc"', 'Tue')`,
    );

    await migrateDbIfNeeded(db);

    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
    expect(
      raw.prepare('SELECT title, etag, last_modified, categories, podroll_json FROM podcast').get(),
    ).toEqual({
      title: 'Low Tide Radio',
      etag: null,
      last_modified: null,
      categories: null,
      podroll_json: null,
    });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM podroll_show').get()).toEqual({ n: 0 });
  });
});

describe('migration 7 (half-played episodes stay in Up Next)', () => {
  it('adds the episodes you had in progress at version 6 to the end of Up Next', async () => {
    const { raw, db } = testDb();
    for (const sql of MIGRATIONS.slice(0, 6)) raw.exec(sql);
    raw.exec('PRAGMA user_version = 6');
    raw.exec(
      `INSERT INTO podcast (id, feed_url, title, subscribed, added_at)
       VALUES (1, 'https://lowtide.example/feed.xml', 'Low Tide Radio', 1, 1)`,
    );
    for (let n = 1; n <= 18; n++) {
      raw.exec(
        `INSERT INTO episode (id, podcast_id, guid, title, enclosure_url)
         VALUES (${n}, 1, 'e${n}', 'Episode ${n}', 'https://lowtide.example/${n}.mp3')`,
      );
    }
    const state = (id: number, positionS: number, played: number, updatedAt: number) =>
      raw.exec(
        `INSERT INTO episode_state (episode_id, position_s, played, updated_at)
         VALUES (${id}, ${positionS}, ${played}, ${updatedAt})`,
      );
    // Already in Up Next: 1 (half-played) and 2.
    raw.exec('INSERT INTO queue_item (episode_id, position) VALUES (1, 4), (2, 9)');
    state(1, 300, 0, 5000);
    state(3, 600, 0, 3000); // in progress
    state(4, 120, 0, 4000); // in progress, listened to more recently
    state(5, 900, 0, 9000); // in the player
    state(6, 3, 0, 8000); // barely started
    state(7, 0, 1, 7000); // finished
    raw.exec(`INSERT INTO setting (key, value) VALUES ('nowPlaying', '5')`);
    // More in progress than the screen used to list: only the ten most recent come along.
    for (let n = 8; n <= 18; n++) state(n, 60, 0, 100 + n);

    await migrateDbIfNeeded(db);

    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: MIGRATIONS.length });
    const queue = raw.prepare('SELECT episode_id FROM queue_item ORDER BY position').all() as {
      episode_id: number;
    }[];
    expect(queue.map((q) => q.episode_id)).toEqual([1, 2, 4, 3, 18, 17, 16, 15, 14, 13, 12, 11]);
  });

  it('leaves Up Next alone when nothing was in progress', async () => {
    const { raw, db } = testDb();
    for (const sql of MIGRATIONS.slice(0, 6)) raw.exec(sql);
    raw.exec('PRAGMA user_version = 6');

    await migrateDbIfNeeded(db);

    expect(raw.prepare('SELECT COUNT(*) AS n FROM queue_item').get()).toEqual({ n: 0 });
  });
});
