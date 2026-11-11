import {
  getEpisode,
  listEpisodes,
  listInProgress,
  listQueue,
  pruneUnfollowed,
  queueEpisode,
  savePosition,
  setArchived,
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
