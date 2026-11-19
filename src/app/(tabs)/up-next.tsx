import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedRef } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sortable from 'react-native-sortables';

import { IconButton } from '@/components/controls';
import { EpisodeRow } from '@/components/episode-row';
import { Icon } from '@/components/icons/icon';
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
 * How long the handle is held before the row lifts, and how far the finger may move meanwhile.
 * Short enough that pressing and dragging just works; long enough that a scroll which happens
 * to start on a handle still scrolls instead of moving an episode.
 */
const HOLD_MS = 100;
const HOLD_SLOP = 12;

/**
 * Up Next: one list, put in order by dragging a row's handle. An episode you leave partway
 * through goes back to the top of it (see keepInQueue), so there's no separate "In progress"
 * list; new episodes have their own smart playlist (New Releases).
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
                leading={
                  <Sortable.Handle>
                    {/* A button of its own, so a tap on the handle doesn't open the episode. */}
                    <Pressable
                      onPress={() => {}}
                      style={styles.handle}
                      accessibilityLabel={`Move ${item.title}`}
                      accessibilityHint="Hold and drag up or down to change the order">
                      <Icon
                        name="dots-six-vertical"
                        size={22}
                        color={theme.textSecondary}
                        duotone={false}
                      />
                    </Pressable>
                  </Sortable.Handle>
                }
                trailing={
                  <View style={styles.trailing}>
                    <IconButton
                      icon="x"
                      size={18}
                      label="Remove from Up Next"
                      onPress={() => void dequeue(db, item.id)}
                      hitSlop={4}
                    />
                  </View>
                }
              />
            )}
          />
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
  // A tall, easy target for the thumb that takes little room in the row: the margins pull it
  // toward the row's edge and the cover.
  handle: {
    paddingVertical: 14,
    paddingHorizontal: 6,
    marginLeft: -Spacing.two,
    marginRight: -10,
  },
  trailing: { flexDirection: 'row', alignItems: 'center', marginRight: -Spacing.two },
});
