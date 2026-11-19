import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Ordered schema migrations; each upgrades the database by one version (tracked in
 * `PRAGMA user_version`). Never edit a migration that has shipped — append a new one.
 */
export const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE folder (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE podcast (
    id              INTEGER PRIMARY KEY,
    feed_url        TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    author          TEXT,
    description     TEXT,
    artwork_url     TEXT,
    website         TEXT,
    folder_id       INTEGER REFERENCES folder(id) ON DELETE SET NULL,
    subscribed      INTEGER NOT NULL DEFAULT 1, -- 0: reached only through a playlist
    sort_order      INTEGER NOT NULL DEFAULT 0,
    added_at        INTEGER NOT NULL,           -- unix ms
    new_since       INTEGER NOT NULL DEFAULT 0, -- episodes published at or after this count as new
    etag            TEXT,
    last_modified   TEXT,
    last_refreshed  INTEGER,
    refresh_error   TEXT
  );

  -- Per-podcast overrides; NULL means "use the global setting".
  CREATE TABLE podcast_settings (
    podcast_id       INTEGER PRIMARY KEY REFERENCES podcast(id) ON DELETE CASCADE,
    speed            REAL,
    trim_silence     TEXT,
    volume_boost     INTEGER,
    skip_start_s     INTEGER,
    skip_end_s       INTEGER,
    auto_download_n  INTEGER,
    notify           INTEGER,
    ad_skip_enabled  INTEGER,
    episode_sort     TEXT
  );

  CREATE TABLE episode (
    id               INTEGER PRIMARY KEY,
    podcast_id       INTEGER NOT NULL REFERENCES podcast(id) ON DELETE CASCADE,
    guid             TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    link             TEXT,
    pub_date         INTEGER,
    duration_s       INTEGER,
    enclosure_url    TEXT NOT NULL,
    mime             TEXT,
    size_bytes       INTEGER,
    media_type       TEXT NOT NULL DEFAULT 'audio',
    artwork_url      TEXT,
    transcript_url   TEXT,
    transcript_type  TEXT,
    chapters_url     TEXT,
    season           INTEGER,
    number           INTEGER,
    episode_type     TEXT,
    UNIQUE (podcast_id, guid)
  );
  CREATE INDEX episode_podcast_date ON episode (podcast_id, pub_date DESC);
  CREATE INDEX episode_date ON episode (pub_date DESC);

  -- Listening state lives apart from episode so a feed refresh can never overwrite it.
  CREATE TABLE episode_state (
    episode_id       INTEGER PRIMARY KEY REFERENCES episode(id) ON DELETE CASCADE,
    position_s       REAL NOT NULL DEFAULT 0,
    played           INTEGER NOT NULL DEFAULT 0,
    played_at        INTEGER,
    starred          INTEGER NOT NULL DEFAULT 0,
    archived         INTEGER NOT NULL DEFAULT 0,
    download_status  TEXT,
    local_path       TEXT,
    updated_at       INTEGER NOT NULL
  );

  CREATE TABLE queue_item (
    episode_id  INTEGER PRIMARY KEY REFERENCES episode(id) ON DELETE CASCADE,
    position    REAL NOT NULL
  );

  CREATE TABLE listen_event (
    id               INTEGER PRIMARY KEY,
    episode_id       INTEGER REFERENCES episode(id) ON DELETE SET NULL,
    started_at       INTEGER NOT NULL,
    listened_s       REAL NOT NULL DEFAULT 0,
    saved_speed_s    REAL NOT NULL DEFAULT 0,
    saved_silence_s  REAL NOT NULL DEFAULT 0,
    saved_skip_s     REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE setting (
    key    TEXT PRIMARY KEY NOT NULL,
    value  TEXT NOT NULL
  );
  `,

  // 2: chapters, bookmarks, playlists, transcripts and ad segments
  `
  CREATE TABLE chapter (
    episode_id  INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
    start_s     REAL NOT NULL,
    end_s       REAL,
    title       TEXT,
    image_url   TEXT,
    url         TEXT,
    selected    INTEGER NOT NULL DEFAULT 1, -- 0: skipped during playback (Preselect Chapters)
    source      TEXT NOT NULL,              -- 'json' (Podcasting 2.0) or 'id3' (in the file)
    PRIMARY KEY (episode_id, start_s)
  );

  CREATE TABLE bookmark (
    id                  INTEGER PRIMARY KEY,
    episode_id          INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
    position_s          REAL NOT NULL,
    title               TEXT NOT NULL,
    transcript_passage  TEXT,
    created_at          INTEGER NOT NULL
  );
  CREATE INDEX bookmark_episode ON bookmark (episode_id, position_s);

  CREATE TABLE playlist (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,     -- 'manual' or 'smart'
    rules_json  TEXT,              -- smart playlists: see src/db/playlists.ts
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE playlist_item (
    playlist_id  INTEGER NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    episode_id   INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
    position     REAL NOT NULL,
    PRIMARY KEY (playlist_id, episode_id)
  );

  CREATE TABLE transcript (
    episode_id  INTEGER PRIMARY KEY REFERENCES episode(id) ON DELETE CASCADE,
    source      TEXT NOT NULL,     -- 'publisher' or 'generated'
    format      TEXT NOT NULL,
    cues_json   TEXT NOT NULL,     -- [{start, end, text, speaker?}]
    fetched_at  INTEGER NOT NULL
  );

  CREATE TABLE ad_segment (
    id            INTEGER PRIMARY KEY,
    episode_id    INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
    start_s       REAL NOT NULL,
    end_s         REAL NOT NULL,
    layer         INTEGER NOT NULL, -- 2: chapter rule, 4: transcript
    confidence    REAL NOT NULL,
    user_verdict  TEXT              -- 'ad', 'not_ad' or NULL
  );
  CREATE INDEX ad_segment_episode ON ad_segment (episode_id, start_s);
  `,
  // 3: remember which downloads auto-download made, so its limit never removes your own.
  `
  ALTER TABLE episode_state ADD COLUMN auto_downloaded INTEGER NOT NULL DEFAULT 0;
  `,
  // 4: a podcast's own auto-archive rules (hours; -1 never; null follows Settings).
  `
  ALTER TABLE podcast_settings ADD COLUMN archive_played_h INTEGER;
  ALTER TABLE podcast_settings ADD COLUMN archive_inactive_h INTEGER;
  `,
  // 5: add a podcast's new episodes to Up Next ('top', 'bottom' or null for no).
  `
  ALTER TABLE podcast_settings ADD COLUMN up_next_auto TEXT;
  `,
  // 6: for Discover, each podcast's categories and the shows it recommends (JSON arrays), and
  //    what those recommended shows are called. Saved feed caches are cleared so the next
  //    check reads every feed in full and fills them in.
  `
  ALTER TABLE podcast ADD COLUMN categories TEXT;
  ALTER TABLE podcast ADD COLUMN podroll_json TEXT;
  UPDATE podcast SET etag = NULL, last_modified = NULL;
  CREATE TABLE podroll_show (
    key          TEXT PRIMARY KEY,  -- the feed address, or 'guid:' and its Podcasting 2.0 guid
    feed_url     TEXT,
    title        TEXT,
    author       TEXT,
    artwork_url  TEXT,
    checked_at   INTEGER NOT NULL
  );
  `,
  // 7: half-played episodes now stay in Up Next instead of having a list of their own. The ones
  //    the Up Next screen listed under "In progress" (the ten most recent, bar the one in the
  //    player) join the end of it, most recent first.
  `
  INSERT INTO queue_item (episode_id, position)
  SELECT episode_id,
         (SELECT COALESCE(MAX(position), 0) FROM queue_item)
           + ROW_NUMBER() OVER (ORDER BY updated_at DESC)
  FROM (
    SELECT s.episode_id, s.updated_at
    FROM episode_state s
    WHERE s.position_s > 5 AND s.played = 0
      AND s.episode_id NOT IN (SELECT episode_id FROM queue_item)
      AND s.episode_id != COALESCE(
        (SELECT CAST(value AS INTEGER) FROM setting WHERE key = 'nowPlaying'), 0)
    ORDER BY s.updated_at DESC
    LIMIT 10
  );
  `,
];

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  // WAL lets the player save positions while a feed refresh writes episodes.
  await db.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
  );
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    version += 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${version}`);
    });
  }
}
