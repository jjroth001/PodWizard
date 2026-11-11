import type { SQLiteDatabase } from 'expo-sqlite';

import { inTransaction } from '@/db/library';
import { getSettings, setSetting } from '@/db/settings';
import { fetchWithTimeout } from '@/lib/http';

import { AD_DETECTION_VERSION, brandsInSegments, COMMON_SPONSORS, findAdSegments } from './ads';
import { parseTranscript } from './parse';
import type { Cue } from './passages';

export async function getTranscript(db: SQLiteDatabase, episodeId: number): Promise<Cue[] | null> {
  const row = await db.getFirstAsync<{ cues_json: string }>(
    'SELECT cues_json FROM transcript WHERE episode_id = ?',
    episodeId,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.cues_json) as Cue[];
  } catch {
    return null;
  }
}

/** Marks ad reads found in the transcript (layer 4); the user's own verdicts are kept. */
export async function detectTranscriptAds(db: SQLiteDatabase, episodeId: number, cues: Cue[]) {
  const settings = await getSettings(db);
  const segments = findAdSegments(
    cues,
    [...COMMON_SPONSORS, ...settings.adBrands],
    settings.adPhrases,
  );
  // Remember the brands found, so their reads are recognised even without a web address.
  const learned = brandsInSegments(cues, segments).filter(
    (b) => !settings.adBrands.includes(b) && !COMMON_SPONSORS.includes(b),
  );
  if (learned.length > 0) {
    await setSetting(db, 'adBrands', [...settings.adBrands, ...learned].slice(-300));
  }
  await inTransaction(db, async () => {
    await db.runAsync(
      'DELETE FROM ad_segment WHERE episode_id = ? AND layer = 4 AND user_verdict IS NULL',
      episodeId,
    );
    for (const s of segments) {
      await db.runAsync(
        `INSERT INTO ad_segment (episode_id, start_s, end_s, layer, confidence)
         SELECT ?, ?, ?, 4, ? WHERE NOT EXISTS (
           SELECT 1 FROM ad_segment WHERE episode_id = ? AND layer = 4 AND ABS(start_s - ?) < 5)`,
        episodeId,
        s.start,
        s.end,
        s.confidence,
        episodeId,
        s.start,
      );
    }
  });
}

/**
 * Checks transcripts already on the phone again after ad detection improves (once per
 * version) or your ad phrases change (`force`), keeping any ad you marked yourself.
 */
export async function redetectTranscriptAds(db: SQLiteDatabase, force = false) {
  const settings = await getSettings(db);
  if (!force && settings.adDetectionVersion >= AD_DETECTION_VERSION) return;
  if (settings.adSkip) {
    // One transcript at a time: each can be a megabyte, and reading them all in one go held
    // every one of them in memory together.
    const rows = await db.getAllAsync<{ episode_id: number }>('SELECT episode_id FROM transcript');
    for (const row of rows) {
      const cues = await getTranscript(db, row.episode_id); // null when damaged: skipped
      if (!cues) continue;
      try {
        await detectTranscriptAds(db, row.episode_id, cues);
      } catch {
        // one that can't be checked is skipped
      }
    }
  }
  await setSetting(db, 'adDetectionVersion', AD_DETECTION_VERSION);
}

/** Saves your ad phrases and checks the transcripts on the phone again with them. */
export async function setAdPhrases(db: SQLiteDatabase, phrases: string[]) {
  await setSetting(db, 'adPhrases', phrases);
  await redetectTranscriptAds(db, true);
}

/** Fetches the publisher's transcript once and keeps it; returns the cues, or null if none. */
export async function ensureTranscript(
  db: SQLiteDatabase,
  episodeId: number,
): Promise<Cue[] | null> {
  const existing = await getTranscript(db, episodeId);
  if (existing) return existing;
  const episode = await db.getFirstAsync<{
    transcript_url: string | null;
    transcript_type: string | null;
  }>('SELECT transcript_url, transcript_type FROM episode WHERE id = ?', episodeId);
  if (!episode?.transcript_url) return null;
  try {
    const response = await fetchWithTimeout(episode.transcript_url, {}, 30_000);
    if (!response.ok) return null;
    const cues = parseTranscript(
      await response.text(),
      episode.transcript_type ?? response.headers.get('content-type'),
    );
    if (cues.length === 0) return null;
    await db.runAsync(
      `INSERT OR REPLACE INTO transcript (episode_id, source, format, cues_json, fetched_at)
       VALUES (?, 'publisher', ?, ?, ?)`,
      episodeId,
      episode.transcript_type ?? 'unknown',
      JSON.stringify(cues),
      Date.now(),
    );
    const settings = await getSettings(db);
    if (settings.adSkip) await detectTranscriptAds(db, episodeId, cues);
    return cues;
  } catch {
    return null;
  }
}

/** Index of the cue playing at `positionS` (timed transcripts only), or -1. */
export function cueAt(cues: Cue[], positionS: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= positionS) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && cues[found].start >= 0 ? found : -1;
}
