import { useSQLiteContext } from 'expo-sqlite';
import { Alert, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/controls';
import { EpisodeRow } from '@/components/episode-row';
import { ScreenHeader } from '@/components/screen-header';
import { useTabBarSpace } from '@/components/tab-bar';
import { Txt } from '@/components/text';
import {
  clearQueue,
  dequeue,
  listInProgress,
  listQueue,
  moveInQueue,
  queueEpisode,
  type EpisodeItem,
} from '@/db/library';
import { useDbQuery } from '@/db/use-db-query';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { useSetSetting, useSettings } from '@/db/use-settings';
import { useTheme } from '@/theme/theme-provider';
import { Spacing } from '@/theme/themes';

/** New episodes aren't listed here: they have their own smart playlist (New Releases). */
type Section = { key: 'queue' | 'progress'; title: string; data: EpisodeItem[] };

export default function UpNextScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const settings = useSettings().data ?? DEFAULT_SETTINGS;
  const setSetting = useSetSetting();
  const nowPlaying = settings.nowPlaying;
  const tables = ['queue_item', 'episode', 'episode_state', 'podcast'] as const;
  const queue = useDbQuery(tables, listQueue).data ?? [];
  const inProgress = useDbQuery(tables, (d) => listInProgress(d, 10)).data ?? [];
  const cards = theme.name !== 'paper';

  const queued = new Set(queue.map((e) => e.id));
  const progress = inProgress.filter((e) => !queued.has(e.id) && e.id !== nowPlaying);
  const sections: Section[] = [
    { key: 'queue', title: 'Up Next', data: queue },
    ...(progress.length
      ? [{ key: 'progress' as const, title: 'In progress', data: progress }]
      : []),
  ];

  const confirmClear = () =>
    Alert.alert('Clear Up Next?', 'The episodes stay in your library.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void clearQueue(db) },
    ]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(e) => String(e.id)}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}
      ListHeaderComponent={
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
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Txt variant="meta" secondary>
            {section.title}
            {section.key === 'queue' && queue.length ? ` · ${queue.length}` : ''}
          </Txt>
        </View>
      )}
      renderSectionFooter={({ section }) =>
        section.key === 'queue' && section.data.length === 0 ? (
          <Txt secondary style={styles.empty}>
            {progress.length
              ? 'Nothing queued. Use “Play next” or “Play last” on an episode, or add one from below.'
              : 'Nothing queued. Use “Play next” or “Play last” on an episode.'}
          </Txt>
        ) : null
      }
      renderItem={({ item, index, section }) => (
        <EpisodeRow
          episode={item}
          showPodcast
          cards={cards}
          trailing={
            section.key === 'queue' ? (
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
            ) : (
              <IconButton
                icon="list-plus"
                size={20}
                label="Add to Up Next"
                onPress={() => void queueEpisode(db, item.id, 'last')}
                hitSlop={4}
              />
            )
          }
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  empty: { marginHorizontal: Spacing.four, marginBottom: Spacing.two },
  trailing: { flexDirection: 'row', alignItems: 'center', marginRight: -Spacing.two },
});
