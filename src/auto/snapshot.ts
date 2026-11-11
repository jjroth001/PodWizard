import type { SQLiteDatabase } from 'expo-sqlite';

import { PlayerCore } from '@modules/player-core/src';
import { addBookmark } from '@/db/bookmarks';
import {
  listDownloads,
  listInProgress,
  listLibrary,
  listNewReleases,
  listQueue,
  listEpisodes,
  savePosition,
  setPlayed,
  type EpisodeItem,
} from '@/db/library';
import { listPlaylists, playlistEpisodes } from '@/db/playlists';
import { setSetting } from '@/db/settings';

/**
 * Android Auto browses a snapshot of the library the app writes for it (the native side never
 * reads the database). Rewritten whenever the lists change and when the app goes away.
 */

const PER_LIST = 50;
/** Episodes listed under each podcast (only these are read, not the show's whole history). */
const PER_PODCAST = 30;

const episode = (e: EpisodeItem) => ({
  id: e.id,
  title: e.title,
  podcast: e.podcast_title,
  artwork: e.artwork_url ?? e.podcast_artwork,
  uri: e.local_path ?? e.enclosure_url,
  positionMs: e.played ? 0 : Math.round(e.position_s * 1000),
});

export async function writeAutoLibrary(db: SQLiteDatabase) {
  if (!PlayerCore) return;
  const [queue, progress, fresh, downloads, playlists, podcasts] = await Promise.all([
    listQueue(db),
    listInProgress(db, PER_LIST),
    listNewReleases(db, PER_LIST),
    listDownloads(db),
    listPlaylists(db),
    listLibrary(db, 'latest'),
  ]);
  const playlistNodes = [];
  for (const p of playlists) {
    const items = (await playlistEpisodes(db, p)).slice(0, PER_LIST);
    playlistNodes.push({ id: `pl:${p.id}`, title: p.name, episodes: items.map(episode) });
  }
  const podcastNodes = [];
  for (const p of podcasts) {
    const items = await listEpisodes(db, p.id, 'newest', PER_PODCAST);
    podcastNodes.push({
      id: `pod:${p.id}`,
      title: p.title,
      artwork: p.artwork_url,
      episodes: items.map(episode),
    });
  }
  const sections = [
    { id: 'upnext', title: 'Up Next', episodes: queue.map(episode) },
    { id: 'progress', title: 'In progress', episodes: progress.map(episode) },
    { id: 'new', title: 'New episodes', episodes: fresh.map(episode) },
    {
      id: 'downloads',
      title: 'Downloads',
      episodes: downloads.filter((e) => e.local_path).map(episode),
    },
    { id: 'playlists', title: 'Playlists', children: playlistNodes },
    { id: 'podcasts', title: 'Podcasts', children: podcastNodes },
  ];
  PlayerCore.setAutoLibrary(JSON.stringify({ sections }));
}

/** Saves what happened while the app wasn't running (car or headset playback). */
export async function applyPendingState(db: SQLiteDatabase) {
  if (!PlayerCore) return;
  const pending = PlayerCore.takePendingState();
  for (const p of pending.positions) {
    const id = Number(p.id);
    const row = await db.getFirstAsync<{ updated_at: number }>(
      'SELECT updated_at FROM episode_state WHERE episode_id = ?',
      id,
    );
    if (row && row.updated_at > p.at) continue; // the app has newer progress
    if (p.ended) await setPlayed(db, id, true);
    else await savePosition(db, id, p.positionMs / 1000);
  }
  for (const b of pending.bookmarks) await addBookmark(db, Number(b.id), b.positionMs / 1000);
  if (pending.nowPlaying) await setSetting(db, 'nowPlaying', Number(pending.nowPlaying));
}
