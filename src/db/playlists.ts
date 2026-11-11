import type { SQLiteDatabase } from 'expo-sqlite';

import { EPISODE_LIST_SELECT, inTransaction, type EpisodeItem } from './library';

/**
 * Playlists. Manual ones hold a hand-picked list (any episode, even from podcasts you don't
 * follow). Smart ones are rules compiled to SQL, so they're always up to date.
 */

export type SmartRules = {
  /** Podcast ids, or every followed podcast. */
  podcasts: number[] | 'all';
  unplayed: boolean;
  inProgress: boolean;
  played: boolean;
  downloaded: 'any' | 'yes' | 'no';
  starredOnly: boolean;
  /** Only episodes released in the last N days (null: any time). */
  releasedWithinDays: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  mediaType: 'any' | 'audio' | 'video';
  sort: 'newest' | 'oldest' | 'shortest' | 'longest';
  limit: number;
};

export const DEFAULT_RULES: SmartRules = {
  podcasts: 'all',
  unplayed: true,
  inProgress: true,
  played: false,
  downloaded: 'any',
  starredOnly: false,
  releasedWithinDays: null,
  minMinutes: null,
  maxMinutes: null,
  mediaType: 'any',
  sort: 'newest',
  limit: 100,
};

export type PlaylistRow = {
  id: number;
  name: string;
  type: 'manual' | 'smart';
  rules_json: string | null;
  sort_order: number;
  created_at: number;
};

export function parseRules(json: string | null): SmartRules {
  if (!json) return DEFAULT_RULES;
  try {
    return { ...DEFAULT_RULES, ...JSON.parse(json) };
  } catch {
    return DEFAULT_RULES;
  }
}

/** Turns rules into a WHERE clause (for EPISODE_LIST_SELECT's aliases e, s, p) plus order and limit. */
export function compileRules(rules: SmartRules, now = Date.now()) {
  const where: string[] = ['COALESCE(s.archived, 0) = 0'];
  const params: (string | number)[] = [];
  if (rules.podcasts === 'all') {
    where.push('p.subscribed = 1');
  } else if (rules.podcasts.length > 0) {
    where.push(`e.podcast_id IN (${rules.podcasts.map(() => '?').join(', ')})`);
    params.push(...rules.podcasts);
  } else {
    where.push('0'); // no podcasts chosen
  }
  const status: string[] = [];
  if (rules.unplayed) status.push('(COALESCE(s.played, 0) = 0 AND COALESCE(s.position_s, 0) <= 5)');
  if (rules.inProgress) status.push('(COALESCE(s.played, 0) = 0 AND s.position_s > 5)');
  if (rules.played) status.push('COALESCE(s.played, 0) = 1');
  where.push(status.length ? `(${status.join(' OR ')})` : '0');
  if (rules.downloaded === 'yes') where.push('s.local_path IS NOT NULL');
  if (rules.downloaded === 'no') where.push('s.local_path IS NULL');
  if (rules.starredOnly) where.push('s.starred = 1');
  if (rules.releasedWithinDays != null) {
    where.push('e.pub_date >= ?');
    params.push(now - rules.releasedWithinDays * 86_400_000);
  }
  if (rules.minMinutes != null) {
    where.push('e.duration_s >= ?');
    params.push(rules.minMinutes * 60);
  }
  if (rules.maxMinutes != null) {
    where.push('e.duration_s IS NOT NULL AND e.duration_s <= ?');
    params.push(rules.maxMinutes * 60);
  }
  if (rules.mediaType !== 'any') {
    where.push('e.media_type = ?');
    params.push(rules.mediaType);
  }
  const order = {
    newest: 'e.pub_date DESC',
    oldest: 'e.pub_date ASC',
    shortest: 'e.duration_s ASC',
    longest: 'e.duration_s DESC',
  }[rules.sort];
  return {
    where: where.join(' AND '),
    params,
    order,
    limit: Math.max(1, Math.min(500, rules.limit)),
  };
}

export function listPlaylists(db: SQLiteDatabase) {
  return db.getAllAsync<PlaylistRow & { count: number }>(
    `SELECT pl.*, (SELECT COUNT(*) FROM playlist_item i WHERE i.playlist_id = pl.id) AS count
     FROM playlist pl ORDER BY pl.sort_order, pl.created_at`,
  );
}

export function getPlaylist(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<PlaylistRow>('SELECT * FROM playlist WHERE id = ?', id);
}

export async function playlistEpisodes(
  db: SQLiteDatabase,
  playlist: PlaylistRow,
): Promise<EpisodeItem[]> {
  if (playlist.type === 'manual') {
    return db.getAllAsync<EpisodeItem>(
      `${EPISODE_LIST_SELECT} JOIN playlist_item i ON i.episode_id = e.id WHERE i.playlist_id = ? ORDER BY i.position`,
      playlist.id,
    );
  }
  const { where, params, order, limit } = compileRules(parseRules(playlist.rules_json));
  return db.getAllAsync<EpisodeItem>(
    `${EPISODE_LIST_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`,
    ...params,
  );
}

export async function createPlaylist(
  db: SQLiteDatabase,
  name: string,
  type: 'manual' | 'smart',
  rules?: SmartRules,
): Promise<number> {
  const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM playlist');
  const result = await db.runAsync(
    'INSERT INTO playlist (name, type, rules_json, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
    name.trim() || 'Playlist',
    type,
    type === 'smart' ? JSON.stringify(rules ?? DEFAULT_RULES) : null,
    count?.n ?? 0,
    Date.now(),
  );
  return result.lastInsertRowId;
}

export async function updatePlaylist(
  db: SQLiteDatabase,
  id: number,
  name: string,
  rules?: SmartRules,
) {
  if (rules) {
    await db.runAsync(
      'UPDATE playlist SET name = ?, rules_json = ? WHERE id = ?',
      name.trim() || 'Playlist',
      JSON.stringify(rules),
      id,
    );
  } else {
    await db.runAsync('UPDATE playlist SET name = ? WHERE id = ?', name.trim() || 'Playlist', id);
  }
}

export async function deletePlaylist(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM playlist WHERE id = ?', id);
}

export async function addToPlaylist(db: SQLiteDatabase, playlistId: number, episodeId: number) {
  const last = await db.getFirstAsync<{ hi: number | null }>(
    'SELECT MAX(position) AS hi FROM playlist_item WHERE playlist_id = ?',
    playlistId,
  );
  await db.runAsync(
    'INSERT OR IGNORE INTO playlist_item (playlist_id, episode_id, position) VALUES (?, ?, ?)',
    playlistId,
    episodeId,
    (last?.hi ?? 0) + 1,
  );
}

export async function removeFromPlaylist(
  db: SQLiteDatabase,
  playlistId: number,
  episodeId: number,
) {
  await db.runAsync(
    'DELETE FROM playlist_item WHERE playlist_id = ? AND episode_id = ?',
    playlistId,
    episodeId,
  );
}

export async function moveInPlaylist(
  db: SQLiteDatabase,
  playlistId: number,
  episodeId: number,
  beforeId: number | null,
) {
  const rows = await db.getAllAsync<{ episode_id: number }>(
    'SELECT episode_id FROM playlist_item WHERE playlist_id = ? ORDER BY position',
    playlistId,
  );
  const ids = rows.map((r) => r.episode_id).filter((id) => id !== episodeId);
  ids.splice(beforeId == null ? ids.length : Math.max(0, ids.indexOf(beforeId)), 0, episodeId);
  await inTransaction(db, async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.runAsync(
        'UPDATE playlist_item SET position = ? WHERE playlist_id = ? AND episode_id = ?',
        i,
        playlistId,
        ids[i],
      );
    }
  });
}

/** The starting set, created once: the same smart lists Pocket Casts ships with, plus Downloaded. */
export async function seedPlaylists(db: SQLiteDatabase) {
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM playlist');
  const seeded = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM setting WHERE key = 'playlistsSeeded'",
  );
  if (existing?.n || seeded) return;
  const lists: [string, Partial<SmartRules>][] = [
    ['New Releases', { releasedWithinDays: 14 }],
    ['In Progress', { unplayed: false, inProgress: true, sort: 'newest' }],
    ['Starred', { starredOnly: true, played: true }],
    ['Quick Listens', { unplayed: true, inProgress: false, maxMinutes: 25 }],
    ['Downloaded', { downloaded: 'yes', played: true }],
  ];
  for (const [name, rules] of lists)
    await createPlaylist(db, name, 'smart', { ...DEFAULT_RULES, ...rules });
  await db.runAsync(
    "INSERT OR REPLACE INTO setting (key, value) VALUES ('playlistsSeeded', 'true')",
  );
}
