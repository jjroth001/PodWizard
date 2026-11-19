import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Artwork } from '@/components/artwork';
import { Icon } from '@/components/icons/icon';
import { Txt } from '@/components/text';
import type { LibraryFolder } from '@/db/folders';
import type { LibraryPodcast } from '@/db/library';
import { releaseDate } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';
import { Spacing } from '@/theme/themes';

export type Layout = 'grid' | 'large' | 'list';

const label = (title: string) => title;

/** A folder's empty spaces, and its covers while they load: a light wash over its colour. */
const EMPTY_CELL = 'rgba(255,255,255,0.18)';

/** "3 new" as quiet text beside a list row (never a bubble on a cover). */
function NewCount({ count }: { count: number }) {
  const theme = useTheme();
  if (!count) return null;
  return (
    <Txt variant="smallBold" color={theme.accent}>
      {count > 99 ? '99+' : count} new
    </Txt>
  );
}

export function PodcastTile({
  item,
  layout,
  size,
}: {
  item: LibraryPodcast;
  layout: Layout;
  size: number;
}) {
  const theme = useTheme();
  const open = () => router.push(`/podcast/${item.id}`);
  if (layout === 'list') {
    return (
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={label(item.title)}
        style={({ pressed }) => [
          styles.listRow,
          { borderBottomColor: theme.cardBorder },
          pressed && styles.pressed,
        ]}>
        <Artwork uri={item.artwork_url} title={item.title} size={56} radius={10} />
        <View style={styles.listText}>
          <Txt variant="bodyBold" numberOfLines={1} style={theme.serifTitles ? styles.serif : null}>
            {item.title}
          </Txt>
          <Txt variant="small" secondary numberOfLines={1}>
            {[releaseDate(item.latest_pub), item.latest_title].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <NewCount count={item.new_count} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={label(item.title)}
      style={({ pressed }) => [{ width: size }, pressed && styles.pressed]}>
      <Artwork
        uri={item.artwork_url}
        title={item.title}
        size={size}
        radius={layout === 'large' ? 20 : 14}
      />
      {layout === 'grid' ? null : (
        <View style={styles.largeText}>
          <Txt variant="bodyBold" numberOfLines={1}>
            {item.title}
          </Txt>
          <Txt
            variant="small"
            color={item.new_count ? theme.accent : theme.textSecondary}
            numberOfLines={1}>
            {item.new_count ? `${item.new_count} new` : 'Up to date'}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

/** A folder: its colour with up to four covers inside. */
export function FolderTile({
  item,
  layout,
  size,
  dropTarget = false,
}: {
  item: LibraryFolder;
  layout: Layout;
  size: number;
  /** A podcast is being dragged over it: it grows a little and gets an outline. */
  dropTarget?: boolean;
}) {
  const theme = useTheme();
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(dropTarget ? 1 : 0, { duration: 160 });
  }, [dropTarget, lift]);
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + lift.value * 0.08 }],
    borderColor: theme.accent,
    borderWidth: lift.value * 3,
  }));
  const open = () => router.push(`/folder/${item.id}`);
  const covers = (box: number) => {
    const gap = Math.max(3, box * 0.05);
    const cell = (box - gap * 3) / 2;
    return (
      <Reanimated.View
        style={[
          styles.folder,
          {
            width: box,
            height: box,
            borderRadius: layout === 'large' ? 20 : layout === 'list' ? 10 : 14,
            backgroundColor: item.color,
            padding: gap,
            gap,
          },
          liftStyle,
        ]}>
        {[0, 1, 2, 3].map((i) =>
          item.artworks[i] !== undefined ? (
            <Artwork
              key={i}
              uri={item.artworks[i]}
              title={item.name}
              size={cell}
              radius={Math.max(4, cell * 0.12)}
              loadingColor={EMPTY_CELL}
            />
          ) : (
            <View
              key={i}
              style={{
                width: cell,
                height: cell,
                borderRadius: Math.max(4, cell * 0.12),
                backgroundColor: EMPTY_CELL,
              }}
            />
          ),
        )}
      </Reanimated.View>
    );
  };
  const summary = `${item.podcast_count} podcast${item.podcast_count === 1 ? '' : 's'}`;
  if (layout === 'list') {
    return (
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`Folder ${label(item.name)}`}
        style={({ pressed }) => [
          styles.listRow,
          { borderBottomColor: theme.cardBorder },
          pressed && styles.pressed,
        ]}>
        {covers(56)}
        <View style={styles.listText}>
          <View style={styles.folderName}>
            <Icon name="folder" size={16} color={item.color} />
            <Txt
              variant="bodyBold"
              numberOfLines={1}
              style={theme.serifTitles ? styles.serif : null}>
              {item.name}
            </Txt>
          </View>
          <Txt variant="small" secondary>
            {summary}
          </Txt>
        </View>
        <NewCount count={item.new_count} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Folder ${label(item.name)}`}
      style={({ pressed }) => [{ width: size }, pressed && styles.pressed]}>
      {covers(size)}
      {layout === 'grid' ? (
        <Txt variant="smallBold" numberOfLines={1} style={styles.gridName}>
          {item.name}
        </Txt>
      ) : (
        <View style={styles.largeText}>
          <Txt variant="bodyBold" numberOfLines={1}>
            {item.name}
          </Txt>
          <Txt variant="small" secondary numberOfLines={1}>
            {summary}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  serif: { fontFamily: 'serif', fontWeight: '700' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.four,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listText: { flex: 1, gap: 2 },
  gridName: { marginTop: 6, paddingHorizontal: 2 },
  largeText: { paddingTop: 8, paddingHorizontal: 2 },
  folder: { flexDirection: 'row', flexWrap: 'wrap' },
  folderName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
