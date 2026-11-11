import type { SQLiteDatabase } from 'expo-sqlite';

import type { ParsedEpisode, ParsedFeed } from '@/feeds/parse-feed';
import type { LibrarySort } from './settings';

export type PodcastRow = {
  id: number;
  feed_url: string;
  title: string;
  author: string | null;
  description: string | null;
  artwork_url: string | null;
  website: string | null;
  folder_id: number | null;
  subscribed: number;
  /** Position in your own (drag and drop) order. */
  sort_order: number;
  added_at: number;
  new_since: number;
  etag: string | null;
  last_modified: string | null;
  last_refreshed: number | null;
  refresh_error: string | null;
};

export type LibraryPodcast = PodcastRow & {
  new_count: number;
  latest_pub: number | null;
  latest_title: string | null;
};

/** An episode with its listening state and its podcast's name and cover. */
export type EpisodeItem = {
  id: number;
  podcast_id: number;
  guid: string;
  title: string;
  /** Show notes. Only filled in by getEpisode; lists leave it null (see EPISODE_LIST_SELECT). */
  description: string | null;
  link: string | null;
  pub_date: number | null;
  duration_s: number | null;
  enclosure_url: string;
  mime: string | null;
  media_type: 'audio' | 'video';
  artwork_url: string | null;
  transcript_url: string | null;
  chapters_url: string | null;
  season: number | null;
  number: number | null;
  position_s: number;
  played: number;
  starred: number;
  archived: number;
  download_status: string | null;
  local_path: string | null;
  podcast_title: string;
  podcast_author: string | null;
  podcast_artwork: string | null;
};

const episodeSelect = (description: string) => `
  SELECT e.id, e.podcast_id, e.guid, e.title, ${description} AS description, e.link, e.pub_date,
         e.duration_s,
         e.enclosure_url, e.mime, e.media_type, e.artwork_url, e.transcript_url, e.chapters_url,
         e.season, e.number,
         COALESCE(s.position_s, 0) AS position_s, COALESCE(s.played, 0) AS played,
         COALESCE(s.starred, 0) AS starred, COALESCE(s.archived, 0) AS archived,
         s.download_status, s.local_path,
         p.title AS podcast_title, p.author AS podcast_author, p.artwork_url AS podcast_artwork
  FROM episode e
  JOIN podcast p ON p.id = e.podcast_id
  LEFT JOIN episode_state s ON s.episode_id = e.id`;

/** One episode in full, show notes included (the episode page). */
export const EPISODE_SELECT = episodeSelect('e.description');

/**
 * Episodes for lists: the same, without the show notes (`description` is null). Show notes run
 * to thousands of characters an episode, and lists never draw them; reading them for every row
 * of a long show, every time anything changed, was most of the work of keeping a list current.
 */
export const EPISODE_LIST_SELECT = episodeSelect('NULL');

const NEW_COUNT = `
  (SELECT COUNT(*) FROM episode e LEFT JOIN episode_state s ON s.episode_id = e.id
   WHERE e.podcast_id = p.id AND COALESCE(e.pub_date, 0) >= p.new_since
     AND COALESCE(s.played, 0) = 0 AND COALESCE(s.archived, 0) = 0)`;

/**
 * Followed podcasts. `folder`: a folder id for that folder's podcasts, null for the ones in no
 * folder, or undefined for all.
 */
export async function listLibrary(
  db: SQLiteDatabase,
  sort: LibrarySort = 'latest',
  folder?: number | null,
): Promise<LibraryPodcast[]> {
  const inFolder =
    folder === undefined ? '' : folder === null ? 'AND p.folder_id IS NULL' : 'AND p.folder_id = ?';
  const order =
    sort === 'title'
      ? 'p.title COLLATE NOCASE'
      : sort === 'added'
        ? 'p.added_at DESC'
        : sort === 'manual'
          ? 'p.sort_order, p.title COLLATE NOCASE'
          : sort === 'played'
            ? `(SELECT MAX(s.updated_at) FROM episode e JOIN episode_state s ON s.episode_id = e.id
                WHERE e.podcast_id = p.id AND (s.position_s > 0 OR s.played = 1)) DESC NULLS LAST,
               p.title COLLATE NOCASE`
            : 'latest_pub DESC NULLS LAST, p.title COLLATE NOCASE';
  return db.getAllAsync<LibraryPodcast>(
    `SELECT p.*, ${NEW_COUNT} AS new_count,
      (SELECT MAX(pub_date) FROM episode WHERE podcast_id = p.id) AS latest_pub,
      (SELECT title FROM episode WHERE podcast_id = p.id ORDER BY pub_date DESC LIMIT 1) AS latest_title
    FROM podcast p WHERE p.subscribed = 1 ${inFolder} ORDER BY ${order}`,
    ...(typeof folder === 'number' ? [folder] : []),
  );
}

export async function getPodcast(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<LibraryPodcast>(
    `SELECT p.*, ${NEW_COUNT} AS new_count, NULL AS latest_pub, NULL AS latest_title
     FROM podcast p WHERE p.id = ?`,
    id,
  );
}

export async function findPodcastByFeed(db: SQLiteDatabase, feedUrl: string) {
  return db.getFirstAsync<PodcastRow>('SELECT * FROM podcast WHERE feed_url = ?', feedUrl);
}

export async function listEpisodes(
  db: SQLiteDatabase,
  podcastId: number,
  order: 'newest' | 'oldest' = 'newest',
  /** Only the first this many (all of them when left out). */
  limit?: number,
) {
  return db.getAllAsync<EpisodeItem>(
    `${EPISODE_LIST_SELECT} WHERE e.podcast_id = ?
     ORDER BY e.pub_date ${order === 'oldest' ? 'ASC' : 'DESC'}, e.id DESC LIMIT ?`,
    podcastId,
    limit ?? -1,
  );
}

export async function getEpisode(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<EpisodeItem>(`${EPISODE_SELECT} WHERE e.id = ?`, id);
}

/** Up Next, in order. */
export async function listQueue(db: SQLiteDatabase) {
  return db.getAllAsync<EpisodeItem>(
    `${EPISODE_LIST_SELECT} JOIN queue_item q ON q.episode_id = e.id ORDER BY q.position`,
  );
}

/** New episodes across all followed podcasts, newest first. */
export async function listNewReleases(db: SQLiteDatabase, limit = 100) {
  return db.getAllAsync<EpisodeItem>(
    `${EPISODE_LIST_SELECT}
     WHERE p.subscribed = 1 AND COALESCE(e.pub_date, 0) >= p.new_since
       AND COALESCE(s.played, 0) = 0 AND COALESCE(s.archived, 0) = 0
     ORDER BY e.pub_date DESC LIMIT ?`,
    limit,
  );
}

/** Started but not finished. */
export async function listInProgress(db: SQLiteDatabase, limit = 50) {
  return db.getAllAsync<EpisodeItem>(
    `${EPISODE_LIST_SELECT}
     WHERE s.position_s > 5 AND COALESCE(s.played, 0) = 0
     ORDER BY s.updated_at DESC LIMIT ?`,
    limit,
  );
}

/** Downloaded and downloading episodes, newest first. */
export async function listDownloads(db: SQLiteDatabase) {
  return db.getAllAsync<EpisodeItem>(
    `${EPISODE_LIST_SELECT} WHERE s.local_path IS NOT NULL OR s.download_status IN ('queued', 'downloading', 'failed')
     ORDER BY e.pub_date DESC`,
  );
}

/** Starred episodes, newest first. */
export async function listStarred(db: SQLiteDatabase) {
  return db.getAllAsync<EpisodeItem>(
    `${EPISODE_LIST_SELECT} WHERE s.starred = 1 ORDER BY e.pub_date DESC`,
  );
}

// --- Writes -------------------------------------------------------------------

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs `work` in a transaction, one at a time. expo-sqlite allows only one transaction per
 * connection, so two overlapping ones (an OPML import saves several feeds at once) would fail
 * with "cannot start a transaction within a transaction".
 */
export function inTransaction<T>(db: SQLiteDatabase, work: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await work();
    });
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Episodes saved per statement: saving them one call at a time made big feeds slow to open. */
const EPISODES_PER_SAVE = 50;
const EPISODE_ROW = `(${Array(18).fill('?').join(', ')})`;

/** Saves `rows` episodes at once. */
const episodeUpsert = (rows: number) => `
  INSERT INTO episode (podcast_id, guid, title, description, link, pub_date, duration_s,
    enclosure_url, mime, size_bytes, media_type, artwork_url, transcript_url, transcript_type,
    chapters_url, season, number, episode_type)
  VALUES ${Array(rows).fill(EPISODE_ROW).join(', ')}
  ON CONFLICT (podcast_id, guid) DO UPDATE SET
    title = excluded.title, description = excluded.description, link = excluded.link,
    pub_date = excluded.pub_date, duration_s = COALESCE(excluded.duration_s, episode.duration_s),
    enclosure_url = excluded.enclosure_url, mime = excluded.mime, size_bytes = excluded.size_bytes,
    media_type = excluded.media_type, artwork_url = excluded.artwork_url,
    transcript_url = excluded.transcript_url, transcript_type = excluded.transcript_type,
    chapters_url = excluded.chapters_url, season = excluded.season, number = excluded.number,
    episode_type = excluded.episode_type
  -- Episodes that haven't changed are left alone: a feed check that rewrote all of them made
  -- every open screen reload once per episode.
  WHERE episode.title IS NOT excluded.title OR episode.description IS NOT excluded.description
    OR episode.link IS NOT excluded.link OR episode.pub_date IS NOT excluded.pub_date
    OR episode.duration_s IS NOT COALESCE(excluded.duration_s, episode.duration_s)
    OR episode.enclosure_url IS NOT excluded.enclosure_url OR episode.mime IS NOT excluded.mime
    OR episode.size_bytes IS NOT excluded.size_bytes
    OR episode.media_type IS NOT excluded.media_type
    OR episode.artwork_url IS NOT excluded.artwork_url
    OR episode.transcript_url IS NOT excluded.transcript_url
    OR episode.transcript_type IS NOT excluded.transcript_type
    OR episode.chapters_url IS NOT excluded.chapters_url OR episode.season IS NOT excluded.season
    OR episode.number IS NOT excluded.number OR episode.episode_type IS NOT excluded.episode_type`;

async function upsertEpisodes(db: SQLiteDatabase, podcastId: number, episodes: ParsedEpisode[]) {
  for (let i = 0; i < episodes.length; i += EPISODES_PER_SAVE) {
    const batch = episodes.slice(i, i + EPISODES_PER_SAVE);
    await db.runAsync(
      episodeUpsert(batch.length),
      batch.flatMap((e) => [
        podcastId,
        e.guid,
        e.title,
        e.description,
        e.link,
        e.pubDate,
        e.durationS,
        e.enclosureUrl,
        e.mime,
        e.sizeBytes,
        e.mediaType,
        e.artworkUrl,
        e.transcriptUrl,
        e.transcriptType,
        e.chaptersUrl,
        e.season,
        e.number,
        e.episodeType,
      ]),
    );
  }
}

/** When a podcast is first followed, only its newest episode counts as new. */
export function initialNewSince(feed: ParsedFeed, now: number): number {
  const latest = feed.episodes.reduce((max, e) => Math.max(max, e.pubDate ?? 0), 0);
  return latest || now;
}

/**
 * Adds a podcast (or re-follows one reached through a playlist) with all its episodes.
 * Returns its id.
 */
export async function savePodcast(
  db: SQLiteDatabase,
  feedUrl: string,
  feed: ParsedFeed,
  cache: { etag: string | null; lastModified: string | null },
  subscribe = true,
  /**
   * Tell newEpisodeListeners about episodes newer than the ones it had. Off while a show is
   * being opened for the first time: its feed arrives in two parts, and the second part isn't
   * "new episodes".
   */
  announce = true,
): Promise<number> {
  const now = Date.now();
  let id = 0;
  // The newest episode it had before this save: anything newer afterwards is new.
  let latestBefore: number | null = null;
  await inTransaction(db, async () => {
    const existing = await findPodcastByFeed(db, feedUrl);
    if (existing) {
      id = existing.id;
      latestBefore =
        (
          await db.getFirstAsync<{ latest: number | null }>(
            'SELECT MAX(pub_date) AS latest FROM episode WHERE podcast_id = ?',
            id,
          )
        )?.latest ?? null;
      await db.runAsync(
        `UPDATE podcast SET title = ?, author = ?, description = ?, artwork_url = ?, website = ?,
           subscribed = MAX(subscribed, ?), etag = ?, last_modified = ?, last_refreshed = ?,
           refresh_error = NULL, categories = ?, podroll_json = ?
         WHERE id = ?`,
        feed.title,
        feed.author,
        feed.description,
        feed.artworkUrl,
        feed.website,
        subscribe ? 1 : 0,
        cache.etag,
        cache.lastModified,
        now,
        JSON.stringify(feed.categories),
        JSON.stringify(feed.podroll),
        id,
      );
    } else {
      const result = await db.runAsync(
        `INSERT INTO podcast (feed_url, title, author, description, artwork_url, website,
           subscribed, added_at, new_since, etag, last_modified, last_refreshed, categories,
           podroll_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        feedUrl,
        feed.title,
        feed.author,
        feed.description,
        feed.artworkUrl,
        feed.website,
        subscribe ? 1 : 0,
        now,
        initialNewSince(feed, now),
        cache.etag,
        cache.lastModified,
        now,
        JSON.stringify(feed.categories),
        JSON.stringify(feed.podroll),
      );
      id = result.lastInsertRowId;
    }
    await upsertEpisodes(db, id, feed.episodes);
  });
  const since = latestBefore;
  if (announce && since != null) newEpisodeListeners.forEach((l) => l(db, id, since));
  return id;
}

/**
 * Called after a feed check saves a podcast it had before, with the newest episode date it had
 * until then (auto-add to Up Next listens here).
 */
export const newEpisodeListeners = new Set<
  (db: SQLiteDatabase, podcastId: number, latestBefore: number) => void
>();

/** Follows a podcast that was only being browsed; its newest episode counts as new. */
export async function followPodcast(db: SQLiteDatabase, podcastId: number) {
  await db.runAsync(
    `UPDATE podcast SET subscribed = 1, added_at = ?,
       new_since = COALESCE((SELECT MAX(pub_date) FROM episode WHERE podcast_id = ?), ?)
     WHERE id = ? AND subscribed = 0`,
    Date.now(),
    podcastId,
    Date.now(),
    podcastId,
  );
}

/**
 * Forgets podcasts that were only browsed (never followed) more than a day ago, unless one of
 * their episodes is in Up Next, the player, half-listened, starred, downloaded or in a playlist.
 */
export async function pruneUnfollowed(db: SQLiteDatabase, keepEpisodeId: number | null) {
  await db.runAsync(
    `DELETE FROM podcast WHERE subscribed = 0 AND added_at < ? AND NOT EXISTS (
       SELECT 1 FROM episode e LEFT JOIN episode_state s ON s.episode_id = e.id
       LEFT JOIN queue_item q ON q.episode_id = e.id
       WHERE e.podcast_id = podcast.id
         AND (q.episode_id IS NOT NULL OR e.id = ? OR s.starred = 1 OR (s.position_s > 0 AND s.played = 0)
           OR s.local_path IS NOT NULL OR s.download_status IS NOT NULL
           OR EXISTS (SELECT 1 FROM playlist_item i WHERE i.episode_id = e.id)))`,
    Date.now() - 86_400_000,
    keepEpisodeId ?? -1,
  );
}

export async function unsubscribe(db: SQLiteDatabase, podcastId: number) {
  // Episodes go too (cascade), along with their listening state and Up Next entries.
  await db.runAsync('DELETE FROM podcast WHERE id = ?', podcastId);
}

export async function markRefreshed(
  db: SQLiteDatabase,
  podcastId: number,
  error: string | null,
  cache?: { etag: string | null; lastModified: string | null },
) {
  if (cache) {
    await db.runAsync(
      'UPDATE podcast SET last_refreshed = ?, refresh_error = ?, etag = ?, last_modified = ? WHERE id = ?',
      Date.now(),
      error,
      cache.etag,
      cache.lastModified,
      podcastId,
    );
  } else {
    await db.runAsync(
      'UPDATE podcast SET last_refreshed = ?, refresh_error = ? WHERE id = ?',
      Date.now(),
      error,
      podcastId,
    );
  }
}

async function upsertState(
  db: SQLiteDatabase,
  episodeId: number,
  set: string,
  ...values: unknown[]
) {
  await db.runAsync(
    `INSERT INTO episode_state (episode_id, updated_at) VALUES (?, ?)
     ON CONFLICT (episode_id) DO NOTHING`,
    episodeId,
    Date.now(),
  );
  await db.runAsync(
    `UPDATE episode_state SET ${set}, updated_at = ? WHERE episode_id = ?`,
    ...(values as (string | number | null)[]),
    Date.now(),
    episodeId,
  );
}

/**
 * The same, without counting as listening: `updated_at` (when you last listened, which orders
 * "In progress" and "Recently played") stays as it was.
 */
async function upsertFlag(db: SQLiteDatabase, episodeId: number, column: string, value: number) {
  await db.runAsync(
    `INSERT INTO episode_state (episode_id, updated_at, ${column}) VALUES (?, ?, ?)
     ON CONFLICT (episode_id) DO UPDATE SET ${column} = excluded.${column}`,
    episodeId,
    Date.now(),
    value,
  );
}

export function savePosition(db: SQLiteDatabase, episodeId: number, positionS: number) {
  return upsertState(db, episodeId, 'position_s = ?', positionS);
}

export function setPlayed(db: SQLiteDatabase, episodeId: number, played: boolean) {
  return upsertState(
    db,
    episodeId,
    'played = ?, played_at = ?, position_s = 0',
    played ? 1 : 0,
    played ? Date.now() : null,
  );
}

export function setStarred(db: SQLiteDatabase, episodeId: number, starred: boolean) {
  return upsertFlag(db, episodeId, 'starred', starred ? 1 : 0);
}

export function setArchived(db: SQLiteDatabase, episodeId: number, archived: boolean) {
  return upsertFlag(db, episodeId, 'archived', archived ? 1 : 0);
}

/** Marks every episode of a podcast played (the "new" badge clears). */
export async function markAllPlayed(db: SQLiteDatabase, podcastId: number) {
  await db.runAsync('UPDATE podcast SET new_since = ? WHERE id = ?', Date.now() + 1, podcastId);
}

// --- Per-podcast settings ------------------------------------------------------------

export type PodcastSettings = {
  speed: number | null;
  trim_silence: string | null;
  volume_boost: number | null;
  skip_start_s: number | null;
  skip_end_s: number | null;
  auto_download_n: number | null;
  /** Add new episodes to Up Next: at the top, at the bottom, or not (null). */
  up_next_auto: 'top' | 'bottom' | null;
  archive_played_h: number | null;
  archive_inactive_h: number | null;
  notify: number | null;
  ad_skip_enabled: number | null;
  episode_sort: string | null;
};

const EMPTY_PODCAST_SETTINGS: PodcastSettings = {
  speed: null,
  trim_silence: null,
  volume_boost: null,
  skip_start_s: null,
  skip_end_s: null,
  auto_download_n: null,
  up_next_auto: null,
  archive_played_h: null,
  archive_inactive_h: null,
  notify: null,
  ad_skip_enabled: null,
  episode_sort: null,
};

export async function getPodcastSettings(db: SQLiteDatabase, podcastId: number) {
  const row = await db.getFirstAsync<PodcastSettings>(
    'SELECT * FROM podcast_settings WHERE podcast_id = ?',
    podcastId,
  );
  return { ...EMPTY_PODCAST_SETTINGS, ...row };
}

/** The per-podcast settings there are (the only column names ever put into SQL). */
export const PODCAST_SETTING_KEYS = Object.keys(
  EMPTY_PODCAST_SETTINGS,
) as (keyof PodcastSettings)[];

/** Sets one per-podcast override; null goes back to the global setting. */
export async function setPodcastSetting<K extends keyof PodcastSettings>(
  db: SQLiteDatabase,
  podcastId: number,
  key: K,
  value: PodcastSettings[K],
) {
  // The key becomes a column name in the statement below, so only known ones get through
  // (a restored backup file could hold anything).
  if (!PODCAST_SETTING_KEYS.includes(key))
    throw new Error(`Unknown podcast setting: ${String(key)}`);
  await db.runAsync(
    'INSERT INTO podcast_settings (podcast_id) VALUES (?) ON CONFLICT (podcast_id) DO NOTHING',
    podcastId,
  );
  await db.runAsync(
    `UPDATE podcast_settings SET ${key} = ? WHERE podcast_id = ?`,
    value,
    podcastId,
  );
}

// --- Up Next ----------------------------------------------------------------------

/** Called after an episode is added to Up Next (auto-download listens here). */
export const queueListeners = new Set<(db: SQLiteDatabase, episodeId: number) => void>();

export async function queueEpisode(db: SQLiteDatabase, episodeId: number, where: 'next' | 'last') {
  const edge = await db.getFirstAsync<{ lo: number | null; hi: number | null }>(
    'SELECT MIN(position) AS lo, MAX(position) AS hi FROM queue_item',
  );
  const position = where === 'next' ? (edge?.lo ?? 1) - 1 : (edge?.hi ?? 0) + 1;
  await db.runAsync(
    `INSERT INTO queue_item (episode_id, position) VALUES (?, ?)
     ON CONFLICT (episode_id) DO UPDATE SET position = excluded.position`,
    episodeId,
    position,
  );
  queueListeners.forEach((l) => l(db, episodeId));
}

export async function dequeue(db: SQLiteDatabase, episodeId: number) {
  await db.runAsync('DELETE FROM queue_item WHERE episode_id = ?', episodeId);
}

export async function clearQueue(db: SQLiteDatabase) {
  await db.runAsync('DELETE FROM queue_item');
}

/** Moves an Up Next entry to sit just before `beforeId` (or to the end when null). */
export async function moveInQueue(db: SQLiteDatabase, episodeId: number, beforeId: number | null) {
  const rows = await db.getAllAsync<{ episode_id: number }>(
    'SELECT episode_id FROM queue_item ORDER BY position',
  );
  const ids = rows.map((r) => r.episode_id).filter((id) => id !== episodeId);
  const at = beforeId == null ? ids.length : Math.max(0, ids.indexOf(beforeId));
  ids.splice(at, 0, episodeId);
  await inTransaction(db, async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.runAsync('UPDATE queue_item SET position = ? WHERE episode_id = ?', i, ids[i]);
    }
  });
}

/** Takes the next Up Next episode (a random one with shuffle on) off the list and returns it. */
export async function popQueue(db: SQLiteDatabase, shuffle = false): Promise<number | null> {
  const row = await db.getFirstAsync<{ episode_id: number }>(
    shuffle
      ? 'SELECT episode_id FROM queue_item ORDER BY RANDOM() LIMIT 1'
      : 'SELECT episode_id FROM queue_item ORDER BY position LIMIT 1',
  );
  if (!row) return null;
  await dequeue(db, row.episode_id);
  return row.episode_id;
}

export async function feedList(db: SQLiteDatabase) {
  return db.getAllAsync<{ title: string; feedUrl: string }>(
    'SELECT title, feed_url AS feedUrl FROM podcast WHERE subscribed = 1 ORDER BY title COLLATE NOCASE',
  );
}
