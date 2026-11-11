import type { SQLiteDatabase } from 'expo-sqlite';

import { MIGRATIONS } from './migrations';

/**
 * For tests only: Node's own SQLite standing in for expo-sqlite (which only runs on the phone),
 * with the app's real schema, so queries are tested against a real database.
 */

type Param = string | number | null;
type Statement = {
  all(...params: Param[]): unknown[];
  get(...params: Param[]): unknown;
  run(...params: Param[]): { changes: number | bigint; lastInsertRowid: number | bigint };
};
type RawDb = { exec(sql: string): void; prepare(sql: string): Statement };

/** expo-sqlite takes parameters one by one or as a single list. */
const flat = (params: unknown[]): Param[] =>
  (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as Param[];

export function testDb(): { db: SQLiteDatabase; raw: RawDb; writes: () => number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => RawDb };
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const sql of MIGRATIONS) raw.exec(sql);
  let writes = 0;
  const db = {
    execAsync: async (sql: string) => raw.exec(sql),
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...flat(params)),
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      raw.prepare(sql).get(...flat(params)) ?? null,
    runAsync: async (sql: string, ...params: unknown[]) => {
      writes++;
      const result = raw.prepare(sql).run(...flat(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
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
  return { db, raw, writes: () => writes };
}

/** A podcast with `episodes` episodes (guids "e1", "e2", …, a day apart, newest last). */
export function addPodcast(
  raw: RawDb,
  {
    id,
    subscribed = 1,
    episodes = 0,
    addedAt = 1,
  }: { id: number; subscribed?: number; episodes?: number; addedAt?: number },
) {
  raw
    .prepare(
      'INSERT INTO podcast (id, feed_url, title, subscribed, added_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, `https://show${id}.example/feed.xml`, `Show ${id}`, subscribed, addedAt);
  for (let n = 1; n <= episodes; n++) {
    raw
      .prepare(
        `INSERT INTO episode (id, podcast_id, guid, title, description, pub_date, enclosure_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id * 100 + n,
        id,
        `e${n}`,
        `Episode ${n}`,
        `Show notes for episode ${n}`,
        n * 86_400_000,
        `https://show${id}.example/${n}.mp3`,
      );
  }
}
