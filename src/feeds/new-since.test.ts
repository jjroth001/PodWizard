import { addPodcast, testDb } from '@/db/testing';
import { getPodcast } from '@/db/library';

import { newestOnlyIsNew } from './sync';

describe('newestOnlyIsNew', () => {
  it('counts only the newest episode as new, whatever order the feed listed them in', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 40 });
    // As the quick start leaves it for a feed that lists its oldest episodes first.
    raw.exec('UPDATE podcast SET new_since = 15 * 86400000 WHERE id = 1');
    expect((await getPodcast(db, 1))?.new_count).toBe(26);

    await newestOnlyIsNew(db, 1);
    expect((await getPodcast(db, 1))?.new_count).toBe(1);
  });

  it('never brings back episodes already cleared as not new', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 3 });
    raw.exec('UPDATE podcast SET new_since = 99 * 86400000 WHERE id = 1');
    await newestOnlyIsNew(db, 1);
    expect((await getPodcast(db, 1))?.new_count).toBe(0);
  });

  it('copes with a show that has no episodes', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1 });
    raw.exec('UPDATE podcast SET new_since = 5 WHERE id = 1');
    await newestOnlyIsNew(db, 1);
    expect((await getPodcast(db, 1))?.new_since).toBe(5);
  });
});
