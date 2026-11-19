import {
  getEpisode,
  keepInQueue,
  listEpisodes,
  listInProgress,
  listQueue,
  pruneUnfollowed,
  queueEpisode,
  savePosition,
  setArchived,
  setPlayed,
  setStarred,
} from './library';
import { addToPlaylist, createPlaylist } from './playlists';
import { addPodcast, testDb } from './testing';

const updatedAt = (raw: ReturnType<typeof testDb>['raw'], episodeId: number) =>
  (
    raw.prepare('SELECT updated_at FROM episode_state WHERE episode_id = ?').get(episodeId) as {
      updated_at: number;
    }
  ).updated_at;

describe('episode lists', () => {
  it('leave the show notes out; the episode page still gets them', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 3 });
    await queueEpisode(db, 101, 'last');

    const listed = await listEpisodes(db, 1);
    expect(listed.map((e) => e.title)).toEqual(['Episode 3', 'Episode 2', 'Episode 1']);
    expect(listed.every((e) => e.description === null)).toBe(true);
    expect((await listQueue(db))[0].description).toBeNull();
    expect((await getEpisode(db, 101))?.description).toBe('Show notes for episode 1');
  });

  it('can read just the first few episodes of a show', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 5 });
    expect((await listEpisodes(db, 1, 'newest', 2)).map((e) => e.id)).toEqual([105, 104]);
    expect((await listEpisodes(db, 1, 'oldest', 2)).map((e) => e.id)).toEqual([101, 102]);
    expect(await listEpisodes(db, 1)).toHaveLength(5);
  });
});

describe('when you last listened', () => {
  it('is not changed by starring or archiving, so "In progress" keeps its order', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 2 });
    await savePosition(db, 101, 60);
    await savePosition(db, 102, 60);
    raw.exec('UPDATE episode_state SET updated_at = 1000 WHERE episode_id = 101');
    raw.exec('UPDATE episode_state SET updated_at = 2000 WHERE episode_id = 102');

    await setStarred(db, 101, true);
    await setArchived(db, 101, true);
    await setArchived(db, 101, false);

    expect(updatedAt(raw, 101)).toBe(1000);
    expect((await getEpisode(db, 101))?.starred).toBe(1);
    expect((await listInProgress(db)).map((e) => e.id)).toEqual([102, 101]);
  });

  it('starring an episode you never started works too', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 1 });
    await setStarred(db, 101, true);
    expect((await getEpisode(db, 101))?.starred).toBe(1);
    await setStarred(db, 101, false);
    expect((await getEpisode(db, 101))?.starred).toBe(0);
  });
});

describe('pruneUnfollowed', () => {
  const left = (raw: ReturnType<typeof testDb>['raw']) =>
    (raw.prepare('SELECT id FROM podcast ORDER BY id').all() as { id: number }[]).map((p) => p.id);

  it('forgets shows that were only browsed, but not followed ones or recent ones', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, subscribed: 1, episodes: 1 });
    addPodcast(raw, { id: 2, subscribed: 0, episodes: 1 });
    addPodcast(raw, { id: 3, subscribed: 0, episodes: 1, addedAt: Date.now() });
    await pruneUnfollowed(db, null);
    expect(left(raw)).toEqual([1, 3]);
  });

  it('keeps a browsed show with a download or an episode in a playlist', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 2, subscribed: 0, episodes: 1 });
    addPodcast(raw, { id: 3, subscribed: 0, episodes: 1 });
    addPodcast(raw, { id: 4, subscribed: 0, episodes: 1 });
    raw.exec(
      `INSERT INTO episode_state (episode_id, updated_at, download_status, local_path)
       VALUES (201, 1, 'done', 'file:///episodes/a.mp3')`,
    );
    await addToPlaylist(db, await createPlaylist(db, 'Road trip', 'manual'), 301);
    await pruneUnfollowed(db, null);
    expect(left(raw)).toEqual([2, 3]);
  });
});

describe('leaving an episode partway through', () => {
  const queued = async (db: ReturnType<typeof testDb>['db']) =>
    (await listQueue(db)).map((e) => e.id);

  it('puts it back at the top of Up Next', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 3 });
    await queueEpisode(db, 102, 'last');
    await queueEpisode(db, 103, 'last');
    await savePosition(db, 101, 240);

    await keepInQueue(db, 101, 240);
    expect(await queued(db)).toEqual([101, 102, 103]);

    // Already there (queued again by hand, say): it moves to the top, without a second entry.
    await keepInQueue(db, 103, 90);
    expect(await queued(db)).toEqual([103, 101, 102]);
  });

  it('works with nothing else queued, and for an episode with no saved state yet', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 1 });
    await keepInQueue(db, 101, 30);
    expect(await queued(db)).toEqual([101]);
  });

  it('does not keep one you had barely started, or one you finished', async () => {
    const { db, raw } = testDb();
    addPodcast(raw, { id: 1, episodes: 2 });
    await keepInQueue(db, 101, 4);
    await setPlayed(db, 102, true);
    await keepInQueue(db, 102, 1800);
    expect(await queued(db)).toEqual([]);
  });
});
