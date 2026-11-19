import { addDatabaseChangeListener, type SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { PlayerCore } from '@modules/player-core/src';
import { AD_THRESHOLDS } from '@/ads/thresholds';
import {
  dequeue,
  getEpisode,
  getPodcastSettings,
  keepInQueue,
  popQueue,
  savePosition,
  setArchived,
  setPlayed,
  setPodcastSetting,
} from '@/db/library';
import { getSettings, setSetting } from '@/db/settings';
import { addBookmark, deleteBookmark } from '@/db/bookmarks';
import { removeDownload } from '@/downloads/downloads';
import { passageBefore } from '@/transcripts/passages';
import { ensureTranscript } from '@/transcripts/transcripts';

import { ensureChapters, saveEmbeddedChapters } from './chapters';
import { engine, type PlayerState, type TrimSilence } from './engine';
import { flushStats, trackSkip, trackState } from './stats';
import { expectPlayerState } from './use-player';

/**
 * Glue between the library and the player engine: what to load, from where, with which
 * settings; saving positions; skipping intros, outros, unticked chapters and ads; marking
 * episodes played and moving on through Up Next.
 */

let lastState: PlayerState | null = null;
let lastSavedMs = 0;
let endedFor: string | null = null;

// --- Small stores the UI reads ------------------------------------------------------------

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l());
    },
    use: () =>
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => value,
      ),
  };
}

// "End of episode" lives here; the minutes timer lives in the engine (it must run with the
// screen off, where JS timers stop).
const stopAtEnd = store(false);
export const setStopAtEndOfEpisode = (on: boolean) => stopAtEnd.set(on);
export const useStopAtEndOfEpisode = stopAtEnd.use;

/** A short notice with an optional Undo (skipped ads and chapters, new bookmarks). */
export type SkipNotice = { id: number; label: string; undo: (() => void) | null };
const skipNotice = store<SkipNotice | null>(null);
export const useSkipNotice = skipNotice.use;
export const dismissSkipNotice = () => skipNotice.set(null);

// --- Effective settings ------------------------------------------------------------------

type Options = {
  speed: number;
  trimSilence: TrimSilence;
  volumeBoost: boolean;
  skipStartS: number;
  skipEndS: number;
  adSkip: boolean;
};

export async function optionsFor(db: SQLiteDatabase, podcastId: number): Promise<Options> {
  const [s, p] = await Promise.all([getSettings(db), getPodcastSettings(db, podcastId)]);
  return {
    speed: p.speed ?? s.speed,
    trimSilence: (p.trim_silence as TrimSilence | null) ?? s.trimSilence,
    volumeBoost: p.volume_boost == null ? s.volumeBoost : !!p.volume_boost,
    skipStartS: p.skip_start_s ?? 0,
    skipEndS: p.skip_end_s ?? 0,
    adSkip: p.ad_skip_enabled == null ? s.adSkip : !!p.ad_skip_enabled,
  };
}

const PODCAST_KEY = {
  speed: 'speed',
  trimSilence: 'trim_silence',
  volumeBoost: 'volume_boost',
} as const;

/**
 * Changes speed, trim silence or volume boost from the player: for this podcast if it has its
 * own setting, otherwise everywhere.
 */
export async function setPlaybackOption<K extends 'speed' | 'trimSilence' | 'volumeBoost'>(
  db: SQLiteDatabase,
  podcastId: number | null,
  key: K,
  value: Options[K],
) {
  const own = podcastId != null ? await getPodcastSettings(db, podcastId) : null;
  const column = PODCAST_KEY[key];
  if (own && podcastId != null && own[column] != null) {
    const stored = key === 'volumeBoost' ? (value ? 1 : 0) : value;
    await setPodcastSetting(db, podcastId, column, stored as never);
  } else {
    await setSetting(db, key, value as never);
  }
  if (key === 'speed') await engine.setSpeed(value as number);
  if (key === 'trimSilence') await engine.setTrimSilence(value as TrimSilence);
  if (key === 'volumeBoost') await engine.setVolumeBoost(value as boolean);
}

export async function applyPlayerSettings(db: SQLiteDatabase) {
  const s = await getSettings(db);
  await engine.setSkipIntervals(s.skipBackS, s.skipForwardS);
  engine.setHeadsetActions(s.headsetDouble, s.headsetTriple);
  PlayerCore?.setShakeToExtend(s.shakeToExtend);
}

// --- Skip rules for the episode in the player ----------------------------------------------

type Skip = { start: number; end: number; label: string; key: string; adId?: number };
let rules: { id: number; skipEndS: number; skips: Skip[] } | null = null;
/** Ranges the user chose to hear after all (Undo), for this listening session. */
const heard = new Set<string>();

async function refreshRules(db: SQLiteDatabase, episodeId: number) {
  const episode = await getEpisode(db, episodeId);
  if (!episode) return;
  const options = await optionsFor(db, episode.podcast_id);
  const chapters = await db.getAllAsync<{
    start_s: number;
    end_s: number | null;
    title: string | null;
  }>('SELECT start_s, end_s, title FROM chapter WHERE episode_id = ? AND selected = 0', episodeId);
  const settings = await getSettings(db);
  const threshold = AD_THRESHOLDS[settings.adSensitivity];
  const adsOn = options.adSkip;
  const ads = adsOn
    ? await db.getAllAsync<{ id: number; start_s: number; end_s: number }>(
        `SELECT id, start_s, end_s FROM ad_segment WHERE episode_id = ?
           AND COALESCE(user_verdict, CASE WHEN confidence >= ? THEN 'ad' END) = 'ad'`,
        episodeId,
        threshold,
      )
    : [];
  const skips: Skip[] = [
    ...chapters
      .filter((c) => c.end_s != null)
      .map((c) => ({
        start: c.start_s,
        end: c.end_s!,
        label: c.title ? `Skipped “${c.title}”` : 'Skipped chapter',
        key: `c:${c.start_s}`,
      })),
    ...ads.map((a) => ({
      start: a.start_s,
      end: a.end_s,
      label: 'Skipped ad',
      key: `a:${a.start_s}`,
      adId: a.id,
    })),
  ];
  rules = { id: episodeId, skipEndS: options.skipEndS, skips };
}

/** Picks up new ad findings for the episode in the player (they're found in the background). */
export async function refreshSkipRules(db: SQLiteDatabase) {
  if (rules) await refreshRules(db, rules.id);
}

export function undoSkip(notice: SkipNotice) {
  skipNotice.set(null);
  notice.undo?.();
}

// --- Loading and finishing ---------------------------------------------------------------

export async function playEpisode(
  db: SQLiteDatabase,
  episodeId: number,
  { playWhenReady = true, startAtS }: { playWhenReady?: boolean; startAtS?: number } = {},
) {
  // Only what's needed to start the audio comes first; the bookkeeping happens alongside it,
  // so pressing play responds straight away.
  const previous = lastState;
  const episode = await getEpisode(db, episodeId);
  if (!episode) return;
  // Show it starting at once: the button, the episode's row and the mini player switch to it
  // now, not when the player reports back.
  expectPlayerState({
    id: String(episodeId),
    state: 'buffering',
    playing: false,
    playWhenReady,
    positionMs: (startAtS ?? (episode.played ? 0 : episode.position_s)) * 1000,
    durationMs: episode.duration_s ? episode.duration_s * 1000 : null,
    bufferedMs: 0,
  });
  const nowPlayingSaved = setSetting(db, 'nowPlaying', episodeId);
  const options = await optionsFor(db, episode.podcast_id);
  let startS = episode.played ? 0 : episode.position_s;
  // Starting within the last few seconds would end it at once; start over instead.
  if (episode.duration_s && startS > episode.duration_s - 10) startS = 0;
  // Skip the intro: never start before the podcast's "skip first N seconds".
  if (startS < options.skipStartS) {
    trackSkip(episodeId, options.skipStartS - startS);
    startS = options.skipStartS;
  }
  if (startAtS != null) startS = startAtS;
  endedFor = null;
  heard.clear();
  skipNotice.set(null);
  await engine.load({
    id: String(episodeId),
    url: episode.local_path ?? episode.enclosure_url,
    title: episode.title,
    artist: episode.podcast_title,
    album: episode.podcast_title,
    artworkUrl: episode.artwork_url ?? episode.podcast_artwork ?? undefined,
    startPositionMs: startS * 1000,
    playWhenReady,
  });
  await Promise.all([
    engine.setSpeed(options.speed),
    engine.setTrimSilence(options.trimSilence),
    engine.setVolumeBoost(options.volumeBoost),
    // Where the previous episode was, from its last report before this one replaced it. Left
    // partway through, it goes back to the top of Up Next.
    previous?.id && previous.id !== String(episodeId) && previous.state !== 'ended'
      ? savePosition(db, Number(previous.id), previous.positionMs / 1000).then(() =>
          keepInQueue(db, Number(previous.id), previous.positionMs / 1000),
        )
      : null,
    episode.played ? setPlayed(db, episodeId, false) : null,
    // Playing an archived episode brings it back.
    episode.archived ? setArchived(db, episodeId, false) : null,
    dequeue(db, episodeId),
    nowPlayingSaved,
    refreshRules(db, episodeId),
  ]);
  // Chapters and the transcript (which can be megabytes) wait until the audio is playing, so
  // they don't compete with its first seconds on a slow connection.
  void whenPlaying(episodeId).then(() => {
    void ensureChapters(db, episodeId).then(() => refreshRules(db, episodeId));
    void ensureTranscript(db, episodeId).then((cues) =>
      cues ? refreshRules(db, episodeId) : undefined,
    );
  });
}

/** Resolves once this episode is actually playing, or after a few seconds regardless. */
function whenPlaying(episodeId: number, maxMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe = () => {};
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, maxMs);
    unsubscribe = engine.subscribe((event) => {
      if (event.type === 'state' && event.state.id === String(episodeId) && event.state.playing) {
        finish();
      }
    });
  });
}

/** Plays an episode from a given moment (bookmarks, transcript lines). */
export async function playEpisodeAt(db: SQLiteDatabase, episodeId: number, positionS: number) {
  if (lastState?.id === String(episodeId) && lastState.state !== 'ended') {
    await engine.seekTo(positionS * 1000);
    await engine.play();
  } else {
    await playEpisode(db, episodeId, { startAtS: positionS });
  }
}

/** Bookmarks the current moment of the episode in the player. Returns the bookmark id. */
export async function bookmarkNow(db: SQLiteDatabase): Promise<number | null> {
  const state = lastState ?? (await engine.getState());
  if (!state.id) return null;
  const positionS = state.positionMs / 1000;
  const passage = await passageBefore(db, Number(state.id), positionS);
  const id = await addBookmark(db, Number(state.id), positionS, passage?.title, passage?.text);
  skipNotice.set({
    id: Date.now(),
    label: 'Bookmark added',
    undo: () => void deleteBookmark(db, id),
  });
  return id;
}

/** Jumps to the start of the next chapter, if there is one. */
export async function nextChapter(db: SQLiteDatabase) {
  const state = lastState;
  if (!state?.id) return;
  const next = await db.getFirstAsync<{ start_s: number }>(
    'SELECT start_s FROM chapter WHERE episode_id = ? AND start_s > ? ORDER BY start_s LIMIT 1',
    Number(state.id),
    state.positionMs / 1000 + 0.5,
  );
  if (next) await engine.seekTo(next.start_s * 1000);
}

/** Plays or pauses; with nothing loaded, starts the first Up Next episode. */
/** Moves the shown position straight away (no snapping back while the player catches up). */
function expectPosition(ms: number) {
  if (!lastState?.id) return;
  const clamped = Math.max(0, lastState.durationMs ? Math.min(ms, lastState.durationMs) : ms);
  lastState = { ...lastState, positionMs: clamped };
  expectPlayerState({ positionMs: clamped });
}

export function seekTo(ms: number) {
  expectPosition(ms);
  return engine.seekTo(ms);
}

/** Skip back or forward by the player's interval (seconds, from Settings). */
export function skipBy(seconds: number) {
  if (lastState) expectPosition(lastState.positionMs + seconds * 1000);
  return seconds < 0 ? engine.skipBack() : engine.skipForward();
}

export async function togglePlay(db: SQLiteDatabase) {
  if (lastState?.id && lastState.state !== 'ended') {
    const play = !lastState.playWhenReady;
    // The button flips at once; the player confirms a moment later.
    expectPlayerState({ playWhenReady: play });
    lastState = { ...lastState, playWhenReady: play };
    if (play) await engine.play();
    else await engine.pause();
    return;
  }
  // Resume the episode in the player; after one has finished, move on to Up Next first.
  const { nowPlaying } = await getSettings(db);
  const ended = lastState?.state === 'ended';
  const next = (ended ? null : nowPlaying) ?? (await popQueue(db)) ?? nowPlaying;
  if (next) await playEpisode(db, next);
}

async function onEnded(db: SQLiteDatabase, id: string) {
  if (endedFor === id) return; // the outro skip and the real end can both report it
  endedFor = id;
  await setPlayed(db, Number(id), true);
  const settings = await getSettings(db);
  if (settings.deletePlayedDownloads) await removeDownload(db, Number(id));
  if (stopAtEnd.get()) {
    stopAtEnd.set(false);
    await engine.pause();
    return;
  }
  const next = settings.autoPlayNext ? await popQueue(db, settings.upNextShuffle) : null;
  if (next) {
    await playEpisode(db, next);
  } else {
    await setSetting(db, 'nowPlaying', null);
    await engine.stop();
  }
}

/** Skips unticked chapters and ads, and ends early for the podcast's "skip last N seconds". */
function applyRules(db: SQLiteDatabase, state: PlayerState) {
  if (!rules || String(rules.id) !== state.id || !state.playing) return;
  const pos = state.positionMs / 1000;
  const duration = state.durationMs ? state.durationMs / 1000 : null;
  if (duration && rules.skipEndS > 0 && pos >= duration - rules.skipEndS) {
    if (endedFor !== state.id) trackSkip(rules.id, duration - pos);
    void onEnded(db, state.id);
    return;
  }
  const skip = rules.skips.find((s) => !heard.has(s.key) && pos >= s.start && pos < s.end - 0.5);
  if (!skip) return;
  heard.add(skip.key); // once per range, so seeking back into it on purpose works
  const target = duration ? Math.min(skip.end, duration) : skip.end;
  trackSkip(rules.id, target - pos);
  void engine.seekTo(target * 1000);
  skipNotice.set({
    id: Date.now(),
    label: skip.label,
    undo: () => {
      void engine.seekTo(skip.start * 1000);
      // "That wasn't an ad": remember it, so it isn't skipped next time either.
      if (skip.adId != null) {
        void db.runAsync("UPDATE ad_segment SET user_verdict = 'not_ad' WHERE id = ?", skip.adId);
      }
    },
  });
}

/**
 * Listens to the engine for the life of the app: saves positions every few seconds and on
 * pause, applies skip rules, and handles episodes finishing. Returns an unsubscribe function.
 */
export function startPlayerSync(db: SQLiteDatabase): () => void {
  const unsubscribe = engine.subscribe((event) => {
    if (event.type === 'ended') {
      void onEnded(db, event.id);
      return;
    }
    if (event.type === 'headset') {
      if (event.action === 'bookmark') void bookmarkNow(db);
      if (event.action === 'nextChapter') void nextChapter(db);
      return;
    }
    if (event.type === 'chapters') {
      void saveEmbeddedChapters(db, Number(event.id), event.chapters).then(() =>
        refreshRules(db, Number(event.id)),
      );
      return;
    }
    if (event.type !== 'state') return;
    const prev = lastState;
    const state = event.state;
    lastState = state;
    if (!state.id || state.state === 'ended') return;
    // Started from the car or the notification: show it as the episode in the player.
    if (prev?.id !== state.id) {
      void getSettings(db).then((s) =>
        s.nowPlaying === Number(state.id)
          ? undefined
          : setSetting(db, 'nowPlaying', Number(state.id)),
      );
      if (rules?.id !== Number(state.id)) void refreshRules(db, Number(state.id));
    }
    applyRules(db, state);
    trackState(state);
    const paused = prev?.playWhenReady && !state.playWhenReady;
    void flushStats(db, !!paused);
    const moved = Math.abs(state.positionMs - lastSavedMs) >= 15_000;
    // (Not on load: the first updates can report 0 before the resume position is applied.)
    if (paused || (state.playing && moved)) {
      lastSavedMs = state.positionMs;
      void savePosition(db, Number(state.id), state.positionMs / 1000);
    }
  });
  // Ticking or unticking chapters, or marking ads, changes what gets skipped.
  const changes = addDatabaseChangeListener(({ tableName }) => {
    if (rules && ['chapter', 'ad_segment', 'podcast_settings'].includes(tableName)) {
      void refreshRules(db, rules.id);
    }
  });
  void (async () => {
    await applyPlayerSettings(db);
    // Put the last episode back in the player (paused) after the app restarts.
    const settings = await getSettings(db);
    const current = await engine.getState(); // still playing from before the UI restarted?
    if (settings.nowPlaying && !current.id) {
      await playEpisode(db, settings.nowPlaying, { playWhenReady: false });
    } else if (current.id) {
      await refreshRules(db, Number(current.id));
    }
  })();
  return () => {
    unsubscribe();
    changes.remove();
  };
}
