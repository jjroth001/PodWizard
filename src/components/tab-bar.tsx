import { router, usePathname } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/artwork';
import { Icon, type IconName } from '@/components/icons/icon';
import { Txt } from '@/components/text';
import { useDbQuery } from '@/db/use-db-query';
import { Motion } from '@/theme/motion';
import { timeLeft } from '@/lib/format';
import { togglePlay } from '@/player/controller';
import { useNowPlaying } from '@/player/use-now-playing';
import { usePlayerState } from '@/player/use-player';
import { useTheme } from '@/theme/theme-provider';
import { Radius, Spacing } from '@/theme/themes';

export const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Podcasts', icon: 'squares-four' },
  { name: 'up-next', title: 'Up Next', icon: 'queue' },
  { name: 'playlists', title: 'Playlists', icon: 'playlist' },
  { name: 'discover', title: 'Discover', icon: 'compass' },
  { name: 'settings', title: 'Settings', icon: 'gear' },
];

const BAR_HEIGHT = 62;
const MINI_HEIGHT = 58;

/** Room to leave at the bottom of any screen so its last row scrolls clear of the bar. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  const nowPlaying = useNowPlaying();
  return insets.bottom + BAR_HEIGHT + Spacing.three + (nowPlaying ? MINI_HEIGHT + Spacing.two : 0);
}

export type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (e: object) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
  position: Animated.AnimatedInterpolation<number>;
};

function MiniPlayer() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const episode = useNowPlaying();
  const player = usePlayerState();
  const queued =
    useDbQuery(['queue_item'], (d) =>
      d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM queue_item'),
    ).data?.n ?? 0;
  if (!episode) return null;
  const current = player.id === String(episode.id);
  const positionS = current ? player.positionMs / 1000 : episode.position_s;
  const durationS =
    (current && player.durationMs ? player.durationMs / 1000 : null) ?? episode.duration_s;
  const progress = durationS ? Math.min(1, positionS / durationS) : 0;
  const playing = current && player.playWhenReady;
  return (
    <Reanimated.View entering={Motion.rise} exiting={Motion.sink}>
      <Pressable
        onPress={() => router.push('/player')}
        accessibilityRole="button"
        accessibilityLabel={`Now playing: ${episode.title}. Opens the player.`}
        style={[
          styles.mini,
          {
            backgroundColor: theme.miniPlayer,
            borderColor: theme.dark ? theme.cardBorder : 'transparent',
          },
        ]}>
        <Artwork
          uri={episode.artwork_url ?? episode.podcast_artwork}
          title={episode.podcast_title}
          size={40}
          radius={8}
          // The bar is dark in every theme, Paper included.
          loadingColor="rgba(255,255,255,0.12)"
        />
        <View style={styles.miniText}>
          <Txt variant="bodyBold" color={theme.miniPlayerText} numberOfLines={1}>
            {episode.title}
          </Txt>
          <Txt
            variant="small"
            color={theme.miniPlayerText}
            style={{ opacity: 0.65 }}
            numberOfLines={1}>
            {[episode.podcast_title, timeLeft(positionS, durationS)].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <Pressable
          onPress={() => void togglePlay(db)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          style={styles.miniButton}>
          <Icon
            name={playing ? 'pause-fill' : 'play-fill'}
            size={26}
            color={theme.miniPlayerText}
          />
        </Pressable>
        <Pressable
          onPress={() => router.navigate('/up-next')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={queued ? `Up Next, ${queued} episodes` : 'Up Next'}
          style={styles.queueButton}>
          {queued > 0 && (
            <View style={[styles.queueCount, { backgroundColor: theme.miniPlayerText }]}>
              <Txt variant="smallBold" color={theme.miniPlayer} style={styles.queueCountText}>
                {queued > 99 ? '99+' : queued}
              </Txt>
            </View>
          )}
          <Icon name="queue" size={24} color={theme.miniPlayerText} duotone={false} />
        </Pressable>
        <View style={[styles.miniTrack, { backgroundColor: theme.miniPlayerText }]} />
        <View
          style={[styles.miniFill, { width: `${progress * 92}%`, backgroundColor: theme.accent }]}
        />
      </Pressable>
    </Reanimated.View>
  );
}

// --- The tabs' state, shared with the bar drawn at the root ---------------------------------

type TabsLink = {
  index: number;
  position: Animated.AnimatedInterpolation<number> | null;
  select: ((name: string) => void) | null;
};

let link: TabsLink = { index: 0, position: null, select: null };
const linkListeners = new Set<() => void>();
function setLink(next: Partial<TabsLink>) {
  link = { ...link, ...next };
  linkListeners.forEach((l) => l());
}
function useTabsLink() {
  return useSyncExternalStore(
    (l) => {
      linkListeners.add(l);
      return () => linkListeners.delete(l);
    },
    () => link,
  );
}

/**
 * Rendered by the pager in place of its own tab bar: hands the selected tab, the swipe position
 * and a way to switch tabs to the bar at the root, then draws nothing itself.
 */
export function TabsBridge({ state, navigation, position }: TabBarProps) {
  useEffect(() => {
    setLink({
      index: state.index,
      position,
      select: (name) => {
        const route = state.routes.find((r) => r.name === name);
        if (!route) return;
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (!event.defaultPrevented) navigation.navigate(name);
      },
    });
  }, [state, navigation, position]);
  return null;
}

/** Screens that cover the bar: the full player slides up over it, as in Pocket Casts. */
const COVERING = ['/player', '/video'];
const TAB_PATHS = ['/', '/up-next', '/playlists', '/discover', '/settings'];

/**
 * The mini player and tab bar, drawn once over the whole app so they stay put while podcast
 * pages, episodes and other screens open and close above the tabs. The selected pill follows
 * the pager while you swipe between tabs.
 */
export function GlobalTabBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const tabs = useTabsLink();
  const [width, setWidth] = useState(0);
  const slot = width / TABS.length;
  const floating = theme.floatingTabBar;
  const onTab = TAB_PATHS.includes(pathname);
  if (COVERING.includes(pathname)) return null;

  const translateX = tabs.position
    ? tabs.position.interpolate({
        inputRange: TABS.map((_, i) => i),
        outputRange: TABS.map((_, i) => i * slot),
      })
    : tabs.index * slot;

  const press = (name: string, focused: boolean) => {
    // From a page opened on top of the tabs, go back down to the tabs first.
    if (!onTab && router.canDismiss()) router.dismissAll();
    if (!focused || !onTab) tabs.select?.(name);
  };

  return (
    <Reanimated.View
      entering={Motion.fadeIn}
      exiting={Motion.exit}
      pointerEvents="box-none"
      style={styles.wrap}>
      <View style={styles.miniWrap}>
        <MiniPlayer />
      </View>
      {/* Rebuilt when the theme changes: switching between the floating and flat bar in place
          left Android drawing an empty bar. */}
      <View
        key={theme.name}
        style={[
          floating
            ? [
                styles.floating,
                { marginBottom: insets.bottom + Spacing.two, borderColor: theme.tabBarBorder },
              ]
            : [styles.flat, { paddingBottom: insets.bottom, borderTopColor: theme.tabBarBorder }],
          { backgroundColor: theme.tabBar },
        ]}>
        <View style={styles.bar} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && theme.tabSelected !== 'transparent' && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bubble,
                {
                  width: slot - 12,
                  backgroundColor: theme.tabSelected,
                  transform: [{ translateX }],
                },
              ]}
            />
          )}
          {TABS.map((tab, index) => {
            const focused = tabs.index === index;
            const color = focused ? theme.tabActive : theme.textSecondary;
            return (
              <Pressable
                key={tab.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.title}
                style={styles.item}
                onPress={() => press(tab.name, focused)}>
                <Icon name={tab.icon} size={22} color={color} />
                <Txt variant="meta" color={color} style={styles.label}>
                  {tab.title}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  miniWrap: { paddingHorizontal: Spacing.two + 4, paddingBottom: Spacing.two },
  mini: {
    height: MINI_HEIGHT,
    borderRadius: Radius.medium + 2,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    gap: 11,
    overflow: 'hidden',
  },
  miniText: { flex: 1 },
  miniButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  queueButton: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 40, paddingLeft: 2 },
  queueCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueCountText: { fontSize: 12, lineHeight: 15 },
  miniTrack: {
    position: 'absolute',
    left: '4%',
    right: '4%',
    bottom: 2,
    height: 2,
    borderRadius: 1,
    opacity: 0.18,
  },
  miniFill: { position: 'absolute', left: '4%', bottom: 2, height: 2, borderRadius: 1 },
  floating: {
    marginHorizontal: Spacing.three,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flat: { borderTopWidth: StyleSheet.hairlineWidth },
  bar: { height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'center' },
  bubble: { position: 'absolute', left: 6, top: 6, bottom: 6, borderRadius: (BAR_HEIGHT - 12) / 2 },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { textTransform: 'none', letterSpacing: 0, fontSize: 11 },
});
