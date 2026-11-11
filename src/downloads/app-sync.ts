import { addDatabaseChangeListener, type SQLiteDatabase } from 'expo-sqlite';
import { AppState } from 'react-native';

import { PlayerCore } from '@modules/player-core/src';
import { detectRepeatedAds } from '@/ads/repeats';
import { applyPendingState, writeAutoLibrary } from '@/auto/snapshot';
import { runAutoTranscribe, startAutoTranscribe } from '@/transcripts/auto';
import { runAutoArchive } from '@/db/archive';
import { autoQueueNew } from '@/db/auto-queue';
import { newEpisodeListeners, pruneUnfollowed, queueListeners } from '@/db/library';
import { getSettings } from '@/db/settings';
import { syncPrivateLogins } from '@/feeds/private';
import { refreshAll } from '@/feeds/sync';
import { runAutoBackupIfDue } from '@/lib/auto-backup';
import { runSteps } from '@/lib/steps';
import { redetectTranscriptAds } from '@/transcripts/transcripts';

import { processInbox, writeBackgroundConfig } from './background';
import { autoDownloadQueued, runAutoDownloads } from './auto-download';
import { applyDownloadEvent, enforceStorageCap, reconcileDownloads } from './downloads';

const STALE_MS = 15 * 60_000;
const OPENING_DELAY_MS = 1200;

let catchingUp: Promise<void> | null = null;

/**
 * Everything the app does to catch up with the outside world when it opens or returns. One at
 * a time: coming back to the app while a catch-up is still going joins that one instead of
 * starting a second alongside it.
 */
function catchUp(db: SQLiteDatabase, { force }: { force: boolean }): Promise<void> {
  catchingUp ??= runSteps([
    () => applyPendingState(db),
    () => syncPrivateLogins(db),
    () => processInbox(db),
    () => reconcileDownloads(db),
    async () => {
      const settings = await getSettings(db);
      if (force || !settings.lastRefreshAt || Date.now() - settings.lastRefreshAt > STALE_MS) {
        await refreshAll(db);
      }
    },
    () => syncPrivateLogins(db),
    () => runAutoArchive(db),
    () => runAutoDownloads(db),
    () => enforceStorageCap(db),
    () => writeBackgroundConfig(db),
    () => writeAutoLibrary(db),
    () => runAutoBackupIfDue(db),
    // Slow (decoding audio), so it carries on in the background.
    async () => void detectRepeatedAds(db).catch(() => {}),
  ]).finally(() => {
    catchingUp = null;
  });
  return catchingUp;
}

/**
 * Starts the app's background housekeeping: catch up on open and whenever the app comes back
 * to the front, keep download progress in the library, and refresh the background snapshot
 * when the app goes away. Returns a function that stops it.
 */
export function startAppSync(db: SQLiteDatabase): () => void {
  // Catch up a moment after opening, so the first taps and scrolls don't compete with it.
  const opening = setTimeout(() => {
    void runSteps([
      async () => pruneUnfollowed(db, (await getSettings(db)).nowPlaying),
      // Feeds checked in the last 15 minutes aren't checked again: reading every feed at once
      // made the first minute after opening slow.
      () => catchUp(db, { force: false }),
      () => redetectTranscriptAds(db),
    ]);
  }, OPENING_DELAY_MS);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void runSteps([() => catchUp(db, { force: false }), () => runAutoTranscribe(db)]);
    }
    if (state === 'background') {
      void runSteps([
        () => runAutoBackupIfDue(db),
        () => writeBackgroundConfig(db),
        () => writeAutoLibrary(db),
      ]);
    }
  });
  // Keep Android Auto's lists current while the app is open (a burst of changes writes once).
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  const AUTO_TABLES = ['queue_item', 'episode_state', 'playlist', 'playlist_item', 'podcast'];
  const changes = addDatabaseChangeListener(({ tableName }) => {
    if (!AUTO_TABLES.includes(tableName)) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => void runSteps([() => writeAutoLibrary(db)]), 5000);
  });
  const downloads = PlayerCore?.addListener('onDownload', (event) => {
    void runSteps([
      () => applyDownloadEvent(db, event),
      async () => {
        if (event.state !== 'done') return;
        await enforceStorageCap(db);
        await detectRepeatedAds(db);
      },
    ]);
  });
  const transcribe = startAutoTranscribe(db);
  const onQueued = (d: SQLiteDatabase, episodeId: number) => void autoDownloadQueued(d, episodeId);
  queueListeners.add(onQueued);
  const onNew = (d: SQLiteDatabase, podcastId: number, latestBefore: number) =>
    void autoQueueNew(d, podcastId, latestBefore);
  newEpisodeListeners.add(onNew);
  return () => {
    newEpisodeListeners.delete(onNew);
    clearTimeout(opening);
    queueListeners.delete(onQueued);
    transcribe();
    appState.remove();
    downloads?.remove();
    changes.remove();
    clearTimeout(autoTimer);
  };
}
