import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { PlayerCore } from '@modules/player-core/src';
import { getSettings } from '@/db/settings';

import { ensureTranscript } from './transcripts';
import {
  cancelTranscription,
  generateTranscript,
  isTranscribing,
  modelUri,
  SPEECH_MODELS,
  TranscriptionStopped,
} from './whisper';

/**
 * Automatic transcripts: while the phone is charging and Pod Wizard is running (open or playing),
 * downloaded episodes without a transcript get one, newest first, one at a time. A publisher's
 * transcript is used when there is one. Unplugging stops the current episode.
 */

export type AutoStatus =
  | { state: 'off' }
  | { state: 'idle' } // nothing waiting
  | { state: 'waiting'; reason: 'charging' | 'model'; pending: number }
  | { state: 'working'; episodeId: number; title: string; progress: number; pending: number };

let status: AutoStatus = { state: 'off' };
const listeners = new Set<() => void>();
const setStatus = (next: AutoStatus) => {
  status = next;
  listeners.forEach((l) => l());
};

export function useAutoTranscribeStatus(): AutoStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

/** Episodes that failed this session, so the queue doesn't retry them in a loop. */
const failed = new Set<number>();
let running = false;

const CANDIDATES = `
  SELECT e.id, e.title FROM episode e
  JOIN episode_state s ON s.episode_id = e.id
  LEFT JOIN transcript t ON t.episode_id = e.id
  WHERE s.local_path IS NOT NULL AND t.episode_id IS NULL
  ORDER BY e.pub_date DESC`;

async function candidates(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ id: number; title: string }>(CANDIDATES);
  return rows.filter((r) => !failed.has(r.id));
}

/** Works through the waiting episodes while the conditions hold. Safe to call often. */
export async function runAutoTranscribe(db: SQLiteDatabase) {
  if (running || !PlayerCore) return;
  running = true;
  try {
    for (;;) {
      const settings = await getSettings(db);
      const waiting = await candidates(db);
      // The background worker only wakes Pod Wizard when something is waiting.
      PlayerCore.setTranscribePending(settings.autoTranscribe === 'always' ? waiting.length : 0);
      if (settings.autoTranscribe === 'off') {
        setStatus({ state: 'off' });
        return;
      }
      if (waiting.length === 0) {
        setStatus({ state: 'idle' });
        return;
      }
      const model = SPEECH_MODELS.find((m) => m.id === settings.speechModel);
      if (!model || !modelUri(model.id)) {
        setStatus({ state: 'waiting', reason: 'model', pending: waiting.length });
        return;
      }
      if (!PlayerCore.isCharging()) {
        setStatus({ state: 'waiting', reason: 'charging', pending: waiting.length });
        return;
      }
      // A transcript you started yourself is being made: only one can be at a time. Wait for
      // the next nudge (plugging in, a download, coming back to the app) rather than trying
      // each waiting episode in turn and writing every one of them off as failed.
      if (isTranscribing()) {
        setStatus({ state: 'idle' });
        return;
      }
      const next = waiting[0];
      setStatus({
        state: 'working',
        episodeId: next.id,
        title: next.title,
        progress: 0,
        pending: waiting.length - 1,
      });
      try {
        // The publisher's transcript, if there is one, beats making our own.
        const published = await ensureTranscript(db, next.id);
        if (!published) {
          await generateTranscript(db, next.id, (progress) =>
            setStatus({
              state: 'working',
              episodeId: next.id,
              title: next.title,
              progress,
              pending: waiting.length - 1,
            }),
          );
        }
      } catch (e) {
        // Stopped on purpose (Stop was pressed): leave the rest for the next nudge, not straight
        // on to the next episode. Unplugging also stops it; the check at the top of the loop
        // then shows "waiting to charge". Only a real failure is skipped for this session.
        if (e instanceof TranscriptionStopped && PlayerCore.isCharging()) {
          setStatus({ state: 'idle' });
          return;
        }
        if (PlayerCore.isCharging()) failed.add(next.id);
      }
    }
  } finally {
    running = false;
  }
}

/** Turns the background worker on or off to match the setting, and updates its count. */
export async function syncBackgroundTranscribe(db: SQLiteDatabase) {
  if (!PlayerCore) return;
  const settings = await getSettings(db);
  // The charging worker also finds repeated ads, so it runs when ad skipping is on too.
  PlayerCore.configureBackgroundTranscribe(settings.autoTranscribe === 'always' || settings.adSkip);
  const waiting = await candidates(db);
  PlayerCore.setTranscribePending(settings.autoTranscribe === 'always' ? waiting.length : 0);
}

/**
 * Starts the queue now and whenever the phone is plugged in; stops the current episode when
 * it's unplugged. Returns a function that stops listening.
 */
export function startAutoTranscribe(db: SQLiteDatabase): () => void {
  void syncBackgroundTranscribe(db).then(() => runAutoTranscribe(db));
  const power = PlayerCore?.addListener('onPower', ({ charging }) => {
    if (charging) void runAutoTranscribe(db);
    else if (status.state === 'working') cancelTranscription();
  });
  const downloads = PlayerCore?.addListener('onDownload', (event) => {
    if (event.state === 'done') {
      setTimeout(() => void syncBackgroundTranscribe(db).then(() => runAutoTranscribe(db)), 2000);
    }
  });
  return () => {
    power?.remove();
    downloads?.remove();
  };
}
