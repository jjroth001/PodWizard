import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { PlayerCore } from '@modules/player-core/src';
import { getSettings } from '@/db/settings';

import { mergeSameSpeaker } from './parse';
import type { Cue } from './passages';
import { detectTranscriptAds } from './transcripts';

/**
 * Generated transcripts with whisper.cpp (whisper.rn, MIT), entirely on the phone. Models are
 * an opt-in download from the whisper.cpp project on Hugging Face; nothing else leaves the phone.
 */

export type SpeechModel = { id: string; label: string; hint: string; sizeMb: number };

export const SPEECH_MODELS: SpeechModel[] = [
  { id: 'tiny.en', label: 'Tiny', hint: 'English · fastest', sizeMb: 75 },
  { id: 'base.en', label: 'Base', hint: 'English · more accurate', sizeMb: 142 },
  { id: 'small.en', label: 'Small', hint: 'English · most accurate, slow', sizeMb: 466 },
  { id: 'base', label: 'Base (all languages)', hint: 'Any language', sizeMb: 142 },
];

export const speechAvailable = !!PlayerCore;

const modelKey = (id: string) => `model:${id}`;
const modelUrl = (id: string) =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`;

/** File URI of a downloaded model, or null. */
export function modelUri(id: string): string | null {
  return PlayerCore?.listDownloads().find((d) => d.key === modelKey(id))?.uri ?? null;
}

export function downloadModel(model: SpeechModel) {
  PlayerCore?.download({
    key: modelKey(model.id),
    url: modelUrl(model.id),
    mime: 'application/octet-stream',
    title: `Speech model (${model.label}, ${model.sizeMb} MB)`,
    wifiOnly: false,
    chargingOnly: false,
  });
}

export function deleteModel(id: string) {
  PlayerCore?.deleteDownload(modelKey(id));
}

type WhisperContext = {
  transcribe: (
    path: string,
    options: { language?: string; onProgress?: (p: number) => void; maxLen?: number },
  ) => {
    stop: () => Promise<void>;
    promise: Promise<{
      segments: { text: string; t0: number; t1: number }[];
      /** Stopped part-way: `segments` then only cover the start of the episode. */
      isAborted?: boolean;
    }>;
  };
  release: () => Promise<void>;
};

let loaded: { uri: string; context: WhisperContext } | null = null;

/**
 * A speech model takes its whole size in memory (75 to 466 MB) for as long as it's loaded, so
 * it's let go a minute after the last transcript finishes: long enough that a run of episodes
 * shares one load, short enough that it isn't still there while you listen later, when Android
 * would sooner close Pod Wizard than keep it.
 */
const UNLOAD_AFTER_MS = 60_000;
let unloadTimer: ReturnType<typeof setTimeout> | undefined;

function unloadWhenIdle() {
  clearTimeout(unloadTimer);
  unloadTimer = setTimeout(() => {
    if (state.job || !loaded) return;
    const { context } = loaded;
    loaded = null;
    void context.release().catch(() => {});
  }, UNLOAD_AFTER_MS);
}

async function contextFor(uri: string): Promise<WhisperContext> {
  clearTimeout(unloadTimer);
  if (loaded?.uri === uri) return loaded.context;
  const previous = loaded;
  loaded = null;
  await previous?.context.release().catch(() => {});
  // Loaded on demand: whisper.rn's native code isn't in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initWhisper } = require('whisper.rn') as {
    initWhisper: (o: { filePath: string }) => Promise<WhisperContext>;
  };
  const context = await initWhisper({ filePath: uri.replace(/^file:\/\//, '') });
  loaded = { uri, context };
  return context;
}

/** whisper.cpp segment times are in hundredths of a second. */
export function cuesFromSegments(segments: { text: string; t0: number; t1: number }[]): Cue[] {
  return mergeSameSpeaker(
    segments
      .map((s) => ({ start: s.t0 / 100, end: s.t1 / 100, text: s.text.trim(), speaker: null }))
      .filter((c) => c.text && !/^\[(music|blank_audio|silence)\]$/i.test(c.text)),
  );
}

let running: { episodeId: number; stop: () => Promise<void> } | null = null;
let cancelled = false;

/**
 * The transcript being made right now (one at a time), and the last failure per episode. Kept
 * here, not in a screen, so leaving the transcript and coming back still shows the progress.
 */
export type TranscriptionState = {
  job: { episodeId: number; title: string; progress: number; step: string } | null;
  errors: Record<number, string>;
};
let state: TranscriptionState = { job: null, errors: {} };
const stateListeners = new Set<() => void>();
function setState(next: Partial<TranscriptionState>) {
  state = { ...state, ...next };
  stateListeners.forEach((l) => l());
}
export function useTranscriptionState(): TranscriptionState {
  return useSyncExternalStore(
    (l) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => state,
  );
}

export function cancelTranscription() {
  cancelled = true;
  void running?.stop();
}

/** Whether a transcript is being made right now (only one can be at a time). */
export function isTranscribing(): boolean {
  return state.job != null;
}

/** Thrown when a transcript was stopped on purpose (Stop, or unplugging the phone). */
export class TranscriptionStopped extends Error {
  constructor() {
    super('The transcript was stopped.');
  }
}

/**
 * Transcribes a downloaded episode. Progress runs 0–1 (converting the audio, then recognising
 * speech). Keeps the app awake only while it runs; a publisher transcript is never replaced.
 */
export async function generateTranscript(
  db: SQLiteDatabase,
  episodeId: number,
  onProgress: (p: number, step: string) => void = () => {},
): Promise<Cue[]> {
  if (!PlayerCore) throw new Error('Generated transcripts need the installed app.');
  if (state.job) {
    throw new Error('Another transcript is being made right now. Try again when it finishes.');
  }
  const titleRow = await db.getFirstAsync<{ title: string }>(
    'SELECT title FROM episode WHERE id = ?',
    episodeId,
  );
  const title = titleRow?.title ?? 'Episode';
  const { [episodeId]: _previous, ...otherErrors } = state.errors;
  void _previous;
  cancelled = false;
  setState({ job: { episodeId, title, progress: 0, step: 'Starting…' }, errors: otherErrors });
  const report = (progress: number, step: string) => {
    setState({ job: { episodeId, title, progress, step } });
    onProgress(progress, step);
  };
  try {
    return await transcribe(db, episodeId, report);
  } catch (e) {
    if (!cancelled) {
      const message = e instanceof Error ? e.message : 'Couldn’t make a transcript.';
      setState({ errors: { ...state.errors, [episodeId]: message } });
    }
    throw e;
  } finally {
    setState({ job: null });
    unloadWhenIdle();
  }
}

async function transcribe(
  db: SQLiteDatabase,
  episodeId: number,
  onProgress: (p: number, step: string) => void,
): Promise<Cue[]> {
  if (!PlayerCore) throw new Error('Generated transcripts need the installed app.');
  const settings = await getSettings(db);
  const model = SPEECH_MODELS.find((m) => m.id === settings.speechModel) ?? null;
  const uri = model ? modelUri(model.id) : null;
  if (!model || !uri) throw new Error('Download a speech model in Settings first.');
  const row = await db.getFirstAsync<{ local_path: string | null }>(
    'SELECT local_path FROM episode_state WHERE episode_id = ?',
    episodeId,
  );
  if (!row?.local_path)
    throw new Error('Download the episode first; transcripts are made from the file.');

  onProgress(0, 'Preparing the audio…');
  const sub = PlayerCore.addListener('onSpeechProgress', ({ progress }) =>
    onProgress(progress * 0.2, 'Preparing the audio…'),
  );
  let wav: string;
  try {
    wav = await PlayerCore.decodeForSpeech(row.local_path);
  } finally {
    sub.remove();
  }
  try {
    // Stopped while the audio was being prepared: don't start listening at all.
    if (cancelled) throw new TranscriptionStopped();
    const context = await contextFor(uri);
    onProgress(0.2, 'Listening…');
    const job = context.transcribe(wav, {
      language: model.id.endsWith('.en') ? 'en' : 'auto',
      maxLen: 0,
      onProgress: (p) => onProgress(0.2 + (p / 100) * 0.8, 'Listening…'),
    });
    running = { episodeId, stop: job.stop };
    const { segments, isAborted } = await job.promise;
    // Stopped part-way (Stop, or the phone was unplugged): what there is only covers the start
    // of the episode. Saving it would pass for the whole transcript, and the episode would
    // never be finished, so it's dropped and the episode stays waiting.
    if (isAborted || cancelled) throw new TranscriptionStopped();
    const cues = cuesFromSegments(segments);
    if (cues.length === 0) throw new Error('No speech was found in this episode.');
    await db.runAsync(
      `INSERT INTO transcript (episode_id, source, format, cues_json, fetched_at)
       SELECT ?, 'generated', ?, ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM transcript WHERE episode_id = ? AND source = 'publisher')`,
      episodeId,
      `whisper-${model.id}`,
      JSON.stringify(cues),
      Date.now(),
      episodeId,
    );
    if (settings.adSkip) await detectTranscriptAds(db, episodeId, cues);
    return cues;
  } finally {
    running = null;
    try {
      new File(`file://${wav}`).delete();
    } catch {
      // the cache is cleared by Android eventually
    }
  }
}
