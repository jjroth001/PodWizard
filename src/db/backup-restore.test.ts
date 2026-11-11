import { BACKUP_FORMAT, restoreBackup, type Backup } from './backup';
import { addPodcast, testDb } from './testing';

const FEED = 'https://show1.example/feed.xml';

const backup: Backup = {
  app: 'Pod Wizard',
  format: BACKUP_FORMAT,
  exportedAt: 1,
  podcasts: [{ feedUrl: FEED, title: 'Show 1', subscribed: 1, folder: null, settings: {} }],
  folders: [],
  playlists: [],
  episodes: [
    {
      feedUrl: FEED,
      guid: 'e1',
      position_s: 120,
      played: 0,
      played_at: null,
      starred: 1,
      archived: 0,
      updated_at: 5,
    },
  ],
  bookmarks: [],
  queue: [],
  adVerdicts: [
    { feedUrl: FEED, guid: 'e1', start_s: 60, end_s: 95, layer: 3, user_verdict: 'ad' },
    { feedUrl: FEED, guid: 'e1', start_s: 600, end_s: 640, layer: 4, user_verdict: 'not_ad' },
  ],
  settings: {},
};

describe('restoreBackup', () => {
  it('restoring the same backup twice does not double up ads you marked', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 2 });
    const neverFetched = async () => {
      throw new Error('the podcast is already here');
    };

    await restoreBackup(db, backup, neverFetched, () => {});
    await restoreBackup(db, backup, neverFetched, () => {});

    const verdicts = raw
      .prepare('SELECT start_s, user_verdict FROM ad_segment ORDER BY start_s')
      .all();
    expect(verdicts).toEqual([
      { start_s: 60, user_verdict: 'ad' },
      { start_s: 600, user_verdict: 'not_ad' },
    ]);
    const state = raw
      .prepare('SELECT position_s, starred FROM episode_state WHERE episode_id = 101')
      .get();
    expect(state).toEqual({ position_s: 120, starred: 1 });
  });
});
