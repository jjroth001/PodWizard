import { useSQLiteContext } from 'expo-sqlite';
import { Alert, StyleSheet } from 'react-native';
import Reanimated, { useAnimatedRef } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sortable from 'react-native-sortables';

import { IconButton } from '@/components/controls';
import { EpisodeRow } from '@/components/episode-row';
import { DragHandle, HOLD_MS, HOLD_SLOP, HoldHint, showRowMenu } from '@/components/reorder';
import { ScreenHeader } from '@/components/screen-header';
import { useTabBarSpace } from '@/components/tab-bar';
import { Txt } from '@/components/text';
import { clearQueue, dequeue, listQueue, moveInQueue, type EpisodeItem } from '@/db/library';
import { useDbQuery } from '@/db/use-db-query';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { useSetSetting, useSettings } from '@/db/use-settings';
import { useTheme } from '@/theme/theme-provider';
import { Spacing } from '@/theme/themes';

/**
 * Up Next: one list, put in order by dragging a row's handle. An episode you leave partway
 * through goes back to the top of it (see keepInQueue), so there's no separate "In progress"
 * list; new episodes have their own smart playlist (New Releases). Pressing and holding a row
 * opens a menu to send it to either end or take it off the list, which leaves the row itself
 * free for the episode's title.
 */
export default function UpNextScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const settings = useSettings().data ?? DEFAULT_SETTINGS;
  const setSetting = useSetSetting();
  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();
  const queue =
    useDbQuery(['queue_item', 'episode', 'episode_state', 'podcast'], listQueue).data ?? [];
  const cards = theme.name !== 'paper';

  const confirmClear = () =>
    Alert.alert('Clear Up Next?', 'The episodes stay in your library.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void clearQueue(db) },
    ]);

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
    void moveInQueue(db, data[toIndex].id, data[toIndex + 1]?.id ?? null);
  };

  const rowMenu = (item: EpisodeItem) =>
    showRowMenu({
      title: item.title,
      first: queue[0]?.id === item.id,
      last: queue[queue.length - 1]?.id === item.id,
      removeLabel: 'Remove from Up Next',
      onTop: () => void moveInQueue(db, item.id, queue[0].id),
      onBottom: () => void moveInQueue(db, item.id, null),
      onRemove: () => void dequeue(db, item.id),
    });

  return (
    <Reanimated.ScrollView
      ref={scrollRef}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}>
      <ScreenHeader title="Up Next">
        <IconButton
          icon="shuffle"
          label={settings.upNextShuffle ? 'Shuffle on' : 'Shuffle off'}
          color={settings.upNextShuffle ? theme.accent : undefined}
          filled={settings.upNextShuffle}
          onPress={() => void setSetting('upNextShuffle', !settings.upNextShuffle)}
        />
        {queue.length > 0 && (
          <IconButton icon="trash" label="Clear Up Next" onPress={confirmClear} />
        )}
      </ScreenHeader>
      {queue.length === 0 ? (
        <Txt secondary style={styles.empty}>
          Nothing queued. Use “Play next” or “Play last” on an episode.
        </Txt>
      ) : (
        <>
          <Txt variant="meta" secondary style={styles.count}>
            {queue.length} episode{queue.length === 1 ? '' : 's'}
          </Txt>
          <Sortable.Grid
            data={queue}
            keyExtractor={(e) => String(e.id)}
            columns={1}
            rowGap={0}
            scrollableRef={scrollRef}
            customHandle
            dragActivationDelay={HOLD_MS}
            dragActivationFailOffset={HOLD_SLOP}
            // Rows only move up and down, and are too wide to grow much when lifted.
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
  );
}

const styles = StyleSheet.create({
  count: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  empty: { marginHorizontal: Spacing.four, marginTop: Spacing.three },
});
