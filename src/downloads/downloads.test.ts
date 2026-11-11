import type { DownloadEvent } from '@modules/player-core/src';
import { savePosition } from '@/db/library';
import { addPodcast, testDb } from '@/db/testing';

import { runSteps } from '@/lib/steps';

import { applyDownloadEvent, downloadStateFor } from './downloads';

const event = (
  state: DownloadEvent['state'],
  extra: Partial<DownloadEvent> = {},
): DownloadEvent => ({
  key: '1:e1',
  state,
  progress: 0,
  written: 0,
  uri: null,
  bytes: 0,
  error: null,
  ...extra,
});

const row = (raw: ReturnType<typeof testDb>['raw']) =>
  raw
    .prepare(
      'SELECT download_status, local_path, updated_at FROM episode_state WHERE episode_id = 101',
    )
    .get() as { download_status: string | null; local_path: string | null; updated_at: number };

describe('downloadStateFor', () => {
  it('maps what the downloader reports to the library', () => {
    expect(downloadStateFor({ state: 'done', uri: 'file:///a.mp3' })).toEqual({
      status: 'done',
      localPath: 'file:///a.mp3',
    });
    expect(downloadStateFor({ state: 'cancelled', uri: null })).toEqual({
      status: null,
      localPath: null,
    });
    expect(downloadStateFor({ state: 'downloading', uri: null })).toEqual({
      status: 'downloading',
      localPath: null,
    });
  });
});

describe('applyDownloadEvent', () => {
  it('writes when a download changes state, not for each percent on the way', async () => {
    const { db, raw, writes } = testDb();
    addPodcast(raw, { id: 1, episodes: 1 });

    await applyDownloadEvent(db, event('downloading', { progress: 0.01 }));
    expect(row(raw).download_status).toBe('downloading');
    const afterStart = writes();

    for (let percent = 2; percent < 100; percent++) {
      await applyDownloadEvent(db, event('downloading', { progress: percent / 100 }));
    }
    expect(writes()).toBe(afterStart);

    await applyDownloadEvent(db, event('done', { progress: 1, uri: 'file:///episodes/a.mp3' }));
    expect(row(raw)).toMatchObject({
      download_status: 'done',
      local_path: 'file:///episodes/a.mp3',
    });
    expect(writes()).toBeGreaterThan(afterStart);
  });

  it('leaves "when you last listened" alone', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 1 });
    await savePosition(db, 101, 300);
    raw.exec('UPDATE episode_state SET updated_at = 1000 WHERE episode_id = 101');

    await applyDownloadEvent(db, event('downloading'));
    await applyDownloadEvent(db, event('done', { uri: 'file:///episodes/a.mp3' }));
    expect(row(raw).updated_at).toBe(1000);
  });

  it('clears a cancelled download and ignores episodes it does not know', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 1 });
    await applyDownloadEvent(db, event('queued'));
    await applyDownloadEvent(db, event('cancelled'));
    expect(row(raw)).toMatchObject({ download_status: null, local_path: null });
    await expect(applyDownloadEvent(db, event('done', { key: '9:nope' }))).resolves.toBeUndefined();
  });
});

describe('runSteps', () => {
  it('carries on after a step fails', async () => {
    const ran: string[] = [];
    await runSteps([
      async () => void ran.push('a'),
      async () => {
        throw new Error('disk full');
      },
      async () => void ran.push('c'),
    ]);
    expect(ran).toEqual(['a', 'c']);
  });
});
