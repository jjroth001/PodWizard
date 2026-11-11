import { router } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';

import { showPrompt, showSheet } from '@/components/sheet';
import { createFolder, listFolders, movePodcastToFolder } from '@/db/folders';
import { markAllPlayed, unsubscribe } from '@/db/library';
import { addToPlaylist, createPlaylist, listPlaylists } from '@/db/playlists';
import { getSettings, setSetting } from '@/db/settings';
import { removePodcastDownloads } from '@/downloads/downloads';
import { forgetPrivateFeed } from '@/feeds/private';
import { refreshPodcast } from '@/feeds/sync';
import { sharePodcast } from '@/lib/share';
import { engine } from '@/player/engine';

/** Menus shared by several screens, built on the bottom sheet. */

export async function chooseFolder(
  db: SQLiteDatabase,
  podcastId: number,
  currentFolder: number | null,
) {
  const folders = await listFolders(db);
  showSheet({
    title: 'Move to folder',
    options: [
      ...folders.map((f) => ({
        label: f.name,
        icon: 'folder' as const,
        selected: f.id === currentFolder,
        onPress: () => void movePodcastToFolder(db, podcastId, f.id),
      })),
      {
        label: 'New folder…',
        icon: 'plus' as const,
        onPress: () =>
          showPrompt({
            title: 'New folder',
            placeholder: 'Folder name',
            confirm: 'Create',
            onSubmit: async (name) => {
              const id = await createFolder(db, name);
              await movePodcastToFolder(db, podcastId, id);
            },
          }),
      },
      ...(currentFolder != null
        ? [
            {
              label: 'Remove from folder',
              icon: 'x' as const,
              onPress: () => void movePodcastToFolder(db, podcastId, null),
            },
          ]
        : []),
    ],
  });
}

/**
 * Unfollows a podcast and removes everything of it from this phone: the episode in the player
 * if it's one of its (stopped first, so it doesn't play on with nothing on screen to pause it),
 * its downloaded files, its episodes and listening progress, and a private feed's saved sign-in.
 */
export async function unfollowPodcast(
  db: SQLiteDatabase,
  podcast: { id: number; feed_url: string },
) {
  const { nowPlaying } = await getSettings(db);
  if (nowPlaying != null) {
    const playing = await db.getFirstAsync<{ podcast_id: number }>(
      'SELECT podcast_id FROM episode WHERE id = ?',
      nowPlaying,
    );
    if (playing?.podcast_id === podcast.id) {
      await engine.stop();
      await setSetting(db, 'nowPlaying', null);
    }
  }
  // Before the episodes go: afterwards nothing would know which files were this podcast's.
  await removePodcastDownloads(db, podcast.id);
  await unsubscribe(db, podcast.id);
  await forgetPrivateFeed(db, podcast.feed_url);
}

export function podcastMenu(
  db: SQLiteDatabase,
  podcast: {
    id: number;
    title: string;
    subscribed: number;
    folder_id: number | null;
    website: string | null;
    feed_url: string;
  },
) {
  showSheet({
    title: podcast.title,
    options: [
      {
        label: 'Mark all as played',
        icon: 'check-circle',
        onPress: () => void markAllPlayed(db, podcast.id),
      },
      {
        label: 'Check for new episodes',
        icon: 'arrows-clockwise',
        onPress: () => void refreshPodcast(db, podcast.id),
      },
      { label: 'Share podcast', icon: 'share-network', onPress: () => sharePodcast(podcast) },
      ...(podcast.subscribed
        ? [
            {
              label: 'Move to folder…',
              icon: 'folder' as const,
              onPress: () => void chooseFolder(db, podcast.id, podcast.folder_id),
            },
            {
              label: 'Unfollow',
              icon: 'trash' as const,
              destructive: true,
              onPress: () =>
                Alert.alert(
                  `Unfollow ${podcast.title}?`,
                  'Its episodes, listening progress, bookmarks and Up Next entries are removed from this phone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Unfollow',
                      style: 'destructive',
                      onPress: () => {
                        router.back();
                        void unfollowPodcast(db, podcast);
                      },
                    },
                  ],
                ),
            },
          ]
        : []),
    ],
  });
}

export async function chooseManualPlaylist(db: SQLiteDatabase, episodeId: number) {
  const playlists = (await listPlaylists(db)).filter((p) => p.type === 'manual');
  showSheet({
    title: 'Add to playlist',
    options: [
      ...playlists.map((p) => ({
        label: p.name,
        hint: `${p.count} episode${p.count === 1 ? '' : 's'}`,
        icon: 'playlist' as const,
        onPress: () => void addToPlaylist(db, p.id, episodeId),
      })),
      {
        label: 'New playlist…',
        icon: 'plus' as const,
        onPress: () =>
          showPrompt({
            title: 'New playlist',
            placeholder: 'Playlist name',
            confirm: 'Create',
            onSubmit: async (name) => {
              const id = await createPlaylist(db, name, 'manual');
              await addToPlaylist(db, id, episodeId);
            },
          }),
      },
    ],
  });
}
