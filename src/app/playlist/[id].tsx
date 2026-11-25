import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable from 'react-native-sortables';

import { Button, IconButton } from '@/components/controls';
import { EpisodeRow } from '@/components/episode-row';
import { DragHandle, HOLD_MS, HOLD_SLOP, HoldHint, showRowMenu } from '@/components/reorder';
import { showPrompt, showSheet } from '@/components/sheet';
import { SubScreen } from '@/components/sub-screen';
import { useTabBarSpace } from '@/components/tab-bar';
import { Txt } from '@/components/text';
import { queueEpisode, type EpisodeItem } from '@/db/library';
import {
  deletePlaylist,
  getPlaylist,
  moveInPlaylist,
  playlistEpisodes,
  removeFromPlaylist,
  updatePlaylist,
} from '@/db/playlists';
import { useDbQuery } from '@/db/use-db-query';
import { playEpisode } from '@/player/controller';
import { useTheme } from '@/theme/theme-provider';
import { Spacing } from '@/theme/themes';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = Number(id);
  const db = useSQLiteContext();
  const theme = useTheme();
  const tabSpace = useTabBarSpace();
  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();
  const playlist = useDbQuery(['playlist'], (d) => getPlaylist(d, playlistId), [playlistId]).data;
  const episodes =
    useDbQuery(
      ['playlist', 'playlist_item', 'episode', 'episode_state', 'podcast'],
      async (d) => {
        const p = await getPlaylist(d, playlistId);
        return p ? playlistEpisodes(d, p) : [];
      },
      [playlistId],
    ).data ?? [];
  const manual = playlist?.type === 'manual';
  const cards = theme.name !== 'paper';

  /** Plays the first episode and lines the rest up after it in Up Next. */
  const playAll = async () => {
    if (!episodes.length) return;
    for (const e of [...episodes.slice(1)].reverse()) await queueEpisode(db, e.id, 'next');
    await playEpisode(db, episodes[0].id);
  };

  const menu = () =>
    showSheet({
      title: playlist?.name,
      options: [
        manual
          ? {
              label: 'Rename',
              icon: 'pencil-simple',
              onPress: () =>
                showPrompt({
                  title: 'Rename playlist',
                  initial: playlist?.name,
                  onSubmit: (name) => void updatePlaylist(db, playlistId, name),
                }),
            }
          : {
              label: 'Edit rules',
              icon: 'sliders-horizontal',
              onPress: () => router.push(`/playlist-edit?id=${playlistId}`),
            },
        {
          label: 'Add all to Up Next',
          icon: 'queue',
          onPress: async () => {
            for (const e of episodes) await queueEpisode(db, e.id, 'last');
          },
        },
        {
          label: 'Delete playlist',
          icon: 'trash',
          destructive: true,
          onPress: () =>
            Alert.alert('Delete this playlist?', 'The episodes stay in your library.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  router.back();
                  void deletePlaylist(db, playlistId);
                },
              },
            ]),
        },
      ],
    });

  /** Dropped somewhere new: it now sits just before whatever follows it there. */
  const onDragEnd = ({
    data,
    fromIndex,
    toIndex,
  }: {
    data: EpisodeItem[];
    fromIndex: number;
    toIndex: number;
  }) => {
    if (fromIndex === toIndex) return;
    void moveInPlaylist(db, playlistId, data[toIndex].id, data[toIndex + 1]?.id ?? null);
  };

  const rowMenu = (item: EpisodeItem) =>
    showRowMenu({
      title: item.title,
      first: episodes[0]?.id === item.id,
      last: episodes[episodes.length - 1]?.id === item.id,
      removeLabel: 'Remove from playlist',
      onTop: () => void moveInPlaylist(db, playlistId, item.id, episodes[0].id),
      onBottom: () => void moveInPlaylist(db, playlistId, item.id, null),
      onRemove: () => void removeFromPlaylist(db, playlistId, item.id),
    });

  const header = episodes.length ? (
    <View style={styles.header}>
      <Txt variant="small" secondary style={styles.flex}>
        {episodes.length} episode{episodes.length === 1 ? '' : 's'}
      </Txt>
      <Button label="Play all" icon="play-fill" onPress={() => void playAll()} />
    </View>
  ) : null;
  const bottom = { paddingBottom: tabSpace + Spacing.two };

  return (
    <SubScreen
      title={playlist?.name ?? 'Playlist'}
      actions={<IconButton icon="dots-three-vertical" label="Playlist options" onPress={menu} />}>
      {manual ? (
        // Your own playlist: put in order by dragging, like Up Next.
        <Reanimated.ScrollView ref={scrollRef} contentContainerStyle={bottom}>
          {header}
          {episodes.length === 0 ? (
            <Txt secondary style={styles.empty}>
              Nothing here yet. Open any episode and choose “Add to playlist”.
            </Txt>
          ) : (
            <>
              <Sortable.Grid
                data={episodes}
                keyExtractor={(e) => String(e.id)}
                columns={1}
                rowGap={0}
                scrollableRef={scrollRef}
                customHandle
                dragActivationDelay={HOLD_MS}
                dragActivationFailOffset={HOLD_SLOP}
                overDrag="vertical"
                activeItemScale={1.02}
                onDragEnd={onDragEnd}
                renderItem={({ item }) => (
                  <EpisodeRow
                    episode={item}
                    showPodcast
                    cards={cards}
                    leading={<DragHandle title={item.title} />}
                    onLongPress={() => rowMenu(item)}
                  />
                )}
              />
              <HoldHint />
            </>
          )}
        </Reanimated.ScrollView>
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={bottom}
          ListHeaderComponent={header}
          renderItem={({ item }) => <EpisodeRow episode={item} showPodcast cards={cards} />}
          ListEmptyComponent={
            playlist ? (
              <Txt secondary style={styles.empty}>
                No episodes match these rules right now.
              </Txt>
            ) : null
          }
        />
      )}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.three,
  },
  empty: { marginHorizontal: Spacing.four, marginTop: Spacing.three },
});
