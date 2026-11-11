import type { SQLiteDatabase } from 'expo-sqlite';

import { addBookmark } from './bookmarks';
import { createFolder, listFolders, movePodcastToFolder } from './folders';
import {
  findPodcastByFeed,
  followPodcast,
  inTransaction,
  PODCAST_SETTING_KEYS,
  queueEpisode,
  setPodcastSetting,
  type PodcastSettings,
} from './library';
import { addToPlaylist, createPlaylist, listPlaylists, parseRules } from './playlists';
import { DEFAULT_SETTINGS, getSettings, setSetting, type Settings } from './settings';

/**
 * A full backup as JSON: subscriptions, folders, playlists, settings, listening progress,
 * bookmarks, Up Next and ad verdicts. Episodes are identified by feed address + guid, so a
 * backup restores onto any phone. Restoring merges: it never loses progress already here.
 */

export const BACKUP_FORMAT = 1;

type EpisodeRef = { feedUrl: string; guid: string };
type EpisodeStateEntry = EpisodeRef & {
  position_s: number;
  played: number;
  played_at: number | null;
  starred: number;
  archived: number;
  updated_at: number;
};

export type Backup = {
  /** 'Caster' in backups made before the app was renamed. */
  app: 'Pod Wizard' | 'Caster';
  format: number;
  exportedAt: number;
  podcasts: {
    feedUrl: string;
    title: string;
    subscribed: number;
    folder: string | null;
    settings: Partial<PodcastSettings>;
  }[];
  folders: { name: string; color: string; sort_order: number }[];
  playlists: {
    name: string;
    type: 'manual' | 'smart';
    rules_json: string | null;
    items: EpisodeRef[];
  }[];
  episodes: EpisodeStateEntry[];
  bookmarks: (EpisodeRef & {
    position_s: number;
    title: string;
    transcript_passage: string | null;
    created_at: number;
  })[];
  queue: EpisodeRef[];
  adVerdicts: (EpisodeRef & {
    start_s: number;
    end_s: number;
    layer: number;
    user_verdict: string;
  })[];
  settings: Partial<Settings>;
};

/** Settings that describe this phone's moment, not a preference. */
/** Settings that only mean something on this phone, so backups leave them out. */
const LOCAL_SETTINGS: (keyof Settings)[] = [
  'nowPlaying',
  'lastRefreshAt',
  'autoBackupFolder',
  'autoBackupFolderName',
  'lastAutoBackupAt',
  'autoBackupError',
  'adDetectionVersion',
  'privateFeeds',
];

export async function createBackup(db: SQLiteDatabase): Promise<Backup> {
  const ref = `p.feed_url AS feedUrl, e.guid AS guid`;
  const join = `JOIN episode e ON e.id = x.episode_id JOIN podcast p ON p.id = e.podcast_id`;
  const [podcasts, folders, playlists, episodes, bookmarks, queue, adVerdicts, settings] =
    await Promise.all([
      db.getAllAsync<{
        feedUrl: string;
        title: string;
        subscribed: number;
        folder: string | null;
        id: number;
      }>(
        `SELECT p.id, p.feed_url AS feedUrl, p.title, p.subscribed, f.name AS folder
       FROM podcast p LEFT JOIN folder f ON f.id = p.folder_id`,
      ),
      db.getAllAsync<{ name: string; color: string; sort_order: number }>(
        'SELECT name, color, sort_order FROM folder',
      ),
      db.getAllAsync<{
        id: number;
        name: string;
        type: 'manual' | 'smart';
        rules_json: string | null;
      }>('SELECT id, name, type, rules_json FROM playlist ORDER BY sort_order'),
      db.getAllAsync<EpisodeStateEntry>(
        `SELECT ${ref}, x.position_s, x.played, x.played_at, x.starred, x.archived, x.updated_at
       FROM episode_state x ${join}
       WHERE x.position_s > 0 OR x.played = 1 OR x.starred = 1 OR x.archived = 1`,
      ),
      db.getAllAsync<Backup['bookmarks'][number]>(
        `SELECT ${ref}, x.position_s, x.title, x.transcript_passage, x.created_at FROM bookmark x ${join}`,
      ),
      db.getAllAsync<EpisodeRef>(`SELECT ${ref} FROM queue_item x ${join} ORDER BY x.position`),
      db.getAllAsync<Backup['adVerdicts'][number]>(
        `SELECT ${ref}, x.start_s, x.end_s, x.layer, x.user_verdict FROM ad_segment x ${join}
       WHERE x.user_verdict IS NOT NULL`,
      ),
      getSettings(db),
    ]);
  const podcastEntries = [];
  for (const p of podcasts) {
    const s = await db.getFirstAsync<PodcastSettings>(
      'SELECT * FROM podcast_settings WHERE podcast_id = ?',
      p.id,
    );
    const own = s
      ? Object.fromEntries(Object.entries(s).filter(([k, v]) => k !== 'podcast_id' && v != null))
      : {};
    podcastEntries.push({
      feedUrl: p.feedUrl,
      title: p.title,
      subscribed: p.subscribed,
      folder: p.folder,
      settings: own,
    });
  }
  const playlistEntries = [];
  for (const pl of playlists) {
    const items =
      pl.type === 'manual'
        ? await db.getAllAsync<EpisodeRef>(
            `SELECT ${ref} FROM playlist_item x ${join} WHERE x.playlist_id = ? ORDER BY x.position`,
            pl.id,
          )
        : [];
    playlistEntries.push({ name: pl.name, type: pl.type, rules_json: pl.rules_json, items });
  }
  const shared = Object.fromEntries(
    Object.entries(settings).filter(([k]) => !LOCAL_SETTINGS.includes(k as keyof Settings)),
  ) as Partial<Settings>;
  return {
    app: 'Pod Wizard',
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    podcasts: podcastEntries,
    folders,
    playlists: playlistEntries,
    episodes,
    bookmarks,
    queue,
    adVerdicts,
    settings: shared,
  };
}

// --- Validation ---------------------------------------------------------------------------

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t valid JSON.');
  }
  const b = data as Partial<Backup>;
  if (!b || (b.app !== 'Pod Wizard' && b.app !== 'Caster'))
    throw new Error('This file isn’t a Pod Wizard backup.');
  if (typeof b.format !== 'number' || b.format > BACKUP_FORMAT) {
    throw new Error('This backup was made by a newer version of Pod Wizard. Update the app first.');
  }
  const arrays = [
    'podcasts',
    'folders',
    'playlists',
    'episodes',
    'bookmarks',
    'queue',
    'adVerdicts',
  ] as const;
  for (const key of arrays) {
    if (!Array.isArray(b[key])) throw new Error('This backup looks damaged (missing data).');
  }
  if (b.podcasts!.some((p) => typeof p?.feedUrl !== 'string')) {
    throw new Error('This backup looks damaged (bad podcast entry).');
  }
  return { settings: {}, ...b } as Backup;
}

/**
 * Merges one episode's state: keeps the furthest position, and played, starred or archived
 * if either side says so. Returns null when nothing would change.
 */
export function mergeState(
  here: Omit<EpisodeStateEntry, 'feedUrl' | 'guid'> | null,
  incoming: Omit<EpisodeStateEntry, 'feedUrl' | 'guid'>,
): Omit<EpisodeStateEntry, 'feedUrl' | 'guid'> | null {
  if (!here) return incoming;
  const merged = {
    position_s: Math.max(here.position_s, incoming.position_s),
    played: here.played || incoming.played ? 1 : 0,
    played_at: here.played_at ?? incoming.played_at,
    starred: here.starred || incoming.starred ? 1 : 0,
    archived: here.archived || incoming.archived ? 1 : 0,
    updated_at: Math.max(here.updated_at, incoming.updated_at),
  };
  const same =
    merged.position_s === here.position_s &&
    merged.played === here.played &&
    merged.starred === here.starred &&
    merged.archived === here.archived;
  return same ? null : merged;
}

// --- Restore ----------------------------------------------------------------------------------

/**
 * Whether a restored setting has the same kind of value as the app's default (a list of plain
 * values, a number, text, true/false), so a damaged or crafted backup can't break the app.
 */
export function sameKind(fallback: unknown, value: unknown): boolean {
  if (Array.isArray(fallback)) {
    return (
      Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')
    );
  }
  if (fallback === null) return value === null || ['string', 'number'].includes(typeof value);
  return typeof value === typeof fallback;
}

export type RestoreProgress = { step: string; done: number; total: number };

export async function restoreBackup(
  db: SQLiteDatabase,
  backup: Backup,
  openFeed: (url: string) => Promise<number>,
  onProgress: (p: RestoreProgress) => void,
): Promise<{ podcasts: number; failed: string[] }> {
  const failed: string[] = [];
  // Folders first, matched by name.
  const folders = new Map((await listFolders(db)).map((f) => [f.name, f.id]));
  for (const f of backup.folders) {
    if (!folders.has(f.name)) folders.set(f.name, await createFolder(db, f.name));
  }
  // Podcasts: fetch any that aren't here yet (a few at a time).
  const ids = new Map<string, number>();
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < backup.podcasts.length) {
      const p = backup.podcasts[next++];
      try {
        const existing = await findPodcastByFeed(db, p.feedUrl);
        const id = existing?.id ?? (await openFeed(p.feedUrl));
        if (p.subscribed) await followPodcast(db, id);
        if (p.folder && folders.has(p.folder))
          await movePodcastToFolder(db, id, folders.get(p.folder)!);
        for (const [key, value] of Object.entries(p.settings ?? {})) {
          // Only settings that exist, with plain values: a backup file is untrusted input.
          if (!PODCAST_SETTING_KEYS.includes(key as keyof PodcastSettings)) continue;
          if (value !== null && typeof value !== 'string' && typeof value !== 'number') continue;
          await setPodcastSetting(db, id, key as keyof PodcastSettings, value as never);
        }
        ids.set(p.feedUrl, id);
      } catch {
        failed.push(p.title || p.feedUrl);
      }
      onProgress({ step: 'Podcasts', done: ++done, total: backup.podcasts.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, backup.podcasts.length) }, worker));

  const episodeId = async (r: EpisodeRef) => {
    const podcastId = ids.get(r.feedUrl) ?? (await findPodcastByFeed(db, r.feedUrl))?.id;
    if (podcastId == null) return null;
    return (
      (
        await db.getFirstAsync<{ id: number }>(
          'SELECT id FROM episode WHERE podcast_id = ? AND guid = ?',
          podcastId,
          r.guid,
        )
      )?.id ?? null
    );
  };

  onProgress({ step: 'Listening progress', done: 0, total: backup.episodes.length });
  await inTransaction(db, async () => {
    for (const e of backup.episodes) {
      const id = await episodeId(e);
      if (id == null) continue;
      const here = await db.getFirstAsync<Omit<EpisodeStateEntry, 'feedUrl' | 'guid'>>(
        'SELECT position_s, played, played_at, starred, archived, updated_at FROM episode_state WHERE episode_id = ?',
        id,
      );
      const merged = mergeState(here, e);
      if (!merged) continue;
      await db.runAsync(
        `INSERT INTO episode_state (episode_id, position_s, played, played_at, starred, archived, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (episode_id) DO UPDATE SET position_s = excluded.position_s, played = excluded.played,
           played_at = excluded.played_at, starred = excluded.starred, archived = excluded.archived,
           updated_at = excluded.updated_at`,
        id,
        merged.position_s,
        merged.played,
        merged.played_at,
        merged.starred,
        merged.archived,
        merged.updated_at,
      );
    }
  });

  for (const b of backup.bookmarks) {
    const id = await episodeId(b);
    if (id == null) continue;
    const dupe = await db.getFirstAsync(
      'SELECT 1 FROM bookmark WHERE episode_id = ? AND ABS(position_s - ?) < 1',
      id,
      b.position_s,
    );
    if (!dupe) await addBookmark(db, id, b.position_s, b.title, b.transcript_passage);
  }

  const playlistNames = new Set((await listPlaylists(db)).map((p) => p.name));
  for (const pl of backup.playlists) {
    if (playlistNames.has(pl.name)) continue;
    const id = await createPlaylist(
      db,
      pl.name,
      pl.type,
      pl.type === 'smart' ? parseRules(pl.rules_json) : undefined,
    );
    for (const item of pl.items) {
      const e = await episodeId(item);
      if (e != null) await addToPlaylist(db, id, e);
    }
  }

  for (const q of backup.queue) {
    const id = await episodeId(q);
    if (id != null) await queueEpisode(db, id, 'last');
  }

  for (const v of backup.adVerdicts) {
    const id = await episodeId(v);
    if (id == null) continue;
    await db.runAsync(
      // Not one that's here already: restoring the same backup twice mustn't double them up.
      `INSERT INTO ad_segment (episode_id, start_s, end_s, layer, confidence, user_verdict)
       SELECT ?, ?, ?, ?, 1, ? WHERE NOT EXISTS (
         SELECT 1 FROM ad_segment WHERE episode_id = ? AND user_verdict IS NOT NULL
           AND ABS(start_s - ?) < 1 AND ABS(end_s - ?) < 1)`,
      id,
      v.start_s,
      v.end_s,
      v.layer,
      v.user_verdict,
      id,
      v.start_s,
      v.end_s,
    );
  }

  for (const [key, value] of Object.entries(backup.settings ?? {})) {
    if (
      key in DEFAULT_SETTINGS &&
      !LOCAL_SETTINGS.includes(key as keyof Settings) &&
      sameKind(DEFAULT_SETTINGS[key as keyof Settings], value)
    ) {
      await setSetting(db, key as keyof Settings, value as never);
    }
  }
  return { podcasts: ids.size, failed };
}
