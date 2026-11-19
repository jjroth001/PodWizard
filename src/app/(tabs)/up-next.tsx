import { useSQLiteContext } from 'expo-sqlite';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/controls';
import { EpisodeRow } from '@/components/episode-row';
import { ScreenHeader } from '@/components/screen-header';
import { useTabBarSpace } from '@/components/tab-bar';
import { Txt } from '@/components/text';
import { clearQueue, dequeue, listQueue, moveInQueue } from '@/db/library';
import { useDbQuery } from '@/db/use-db-query';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { useSetSetting, useSettings } from '@/db/use-settings';
import { useTheme } from '@/theme/theme-provider';
import { Spacing } from '@/theme/themes';

/**
 * Up Next: one list. An episode you leave partway through goes back to the top of it (see
 * keepInQueue), so there's no separate "In progress" list; new episodes have their own smart
 * playlist (New Releases).
 */
export default function UpNextScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const settings = useSettings().data ?? DEFAULT_SETTINGS;
  const setSetting = useSetSetting();
  const queue =
    useDbQuery(['queue_item', 'episode', 'episode_state', 'podcast'], listQueue).data ?? [];
  const cards = theme.name !== 'paper';

  const confirmClear = () =>
    Alert.alert('Clear Up Next?', 'The episodes stay in your library.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void clearQueue(db) },
    ]);

  return (
    <FlatList
      data={queue}
      keyExtractor={(e) => String(e.id)}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}
      ListHeaderComponent={
        <View>
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
          {queue.length > 0 && (
            <Txt variant="meta" secondary style={styles.count}>
              {queue.length} episode{queue.length === 1 ? '' : 's'}
            </Txt>
          )}
        </View>
      }
      ListEmptyComponent={
        <Txt secondary style={styles.empty}>
          Nothing queued. Use “Play next” or “Play last” on an episode.
        </Txt>
      }
      renderItem={({ item, index }) => (
        <EpisodeRow
          episode={item}
          showPodcast
          cards={cards}
          trailing={
            <View style={styles.trailing}>
              {index > 0 && (
                <IconButton
                  icon="caret-up"
                  size={18}
                  label="Move up"
                  onPress={() => void moveInQueue(db, item.id, queue[index - 1].id)}
                  hitSlop={4}
                />
              )}
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
  );
}

const styles = StyleSheet.create({
  count: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  empty: { marginHorizontal: Spacing.four, marginTop: Spacing.three },
  trailing: { flexDirection: 'row', alignItems: 'center', marginRight: -Spacing.two },
});
