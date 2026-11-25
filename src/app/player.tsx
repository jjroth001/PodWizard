import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VideoSurface } from '@modules/player-core/src/VideoSurface';
import { MARK_CHOICES, markAdBefore } from '@/ads/mark';
import { showAdsSheet } from '@/components/ads-sheet';
import { Artwork } from '@/components/artwork';
import { Background } from '@/components/background';
import { useArtworkTint } from '@/theme/artwork-tint';
import { StatusBarScrim } from '@/components/status-bar-scrim';
import { IconButton } from '@/components/controls';
import { Icon, type IconName } from '@/components/icons/icon';
import { Scrubber } from '@/components/scrubber';
import { showCustomSheet, showSheet } from '@/components/sheet';
import { SpeedSlider } from '@/components/speed-slider';
import { SkipButton } from '@/components/skip-button';
import { Txt } from '@/components/text';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { useDbQuery } from '@/db/use-db-query';
import { useSettings } from '@/db/use-settings';
import { clock, speedLabel } from '@/lib/format';
import { chooseManualPlaylist } from '@/lib/library-actions';
import { shareEpisode, shareEpisodeAt } from '@/lib/share';
import { chapterAt, listChapters } from '@/player/chapters';
import {
  bookmarkNow,
  setPlaybackOption,
  setStopAtEndOfEpisode,
  seekTo,
  skipBy,
  togglePlay,
  useStopAtEndOfEpisode,
} from '@/player/controller';
import { engine, type TrimSilence } from '@/player/engine';
import { useNowPlaying } from '@/player/use-now-playing';
import { usePlayerState } from '@/player/use-player';
import { useTheme } from '@/theme/theme-provider';
import { Radius, Spacing } from '@/theme/themes';

const TRIM_LABELS: Record<TrimSilence, string> = { off: 'Off', mild: 'Mild', aggressive: 'Strong' };
const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60];

/** The speed slider in its sheet; follows the player, saves for this podcast or everywhere. */
function SpeedSheet({ podcastId, max }: { podcastId: number; max: number }) {
  const db = useSQLiteContext();
  const player = usePlayerState();
  return (
    <SpeedSlider
      value={player.speed}
      max={max}
      onChange={(speed) => void setPlaybackOption(db, podcastId, 'speed', speed)}
    />
  );
}

function Control({
  icon,
  label,
  value,
  active,
  onPress,
  text,
}: {
  icon?: IconName;
  label: string;
  value?: string;
  active?: boolean;
  onPress: () => void;
  text?: string;
}) {
  const theme = useTheme();
  const color = active ? theme.accent : theme.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      style={({ pressed }) => [styles.control, pressed && { opacity: 0.6 }]}>
      <View style={[styles.controlCircle, { backgroundColor: theme.element }]}>
        {text ? (
          <Txt variant="smallBold" color={color} style={styles.controlText}>
            {text}
          </Txt>
        ) : (
          icon && <Icon name={icon} size={22} color={color} />
        )}
      </View>
      {/* Its name while off; what it's set to, in the accent colour, while on. */}
      <Txt
        variant="small"
        color={active && value ? theme.accent : theme.textSecondary}
        numberOfLines={1}
        style={styles.controlLabel}>
        {value ?? label}
      </Txt>
    </Pressable>
  );
}

export default function PlayerScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Swipe down anywhere to minimise the player (the scrubber and buttons keep their own touches).
  const drag = useSharedValue(0);
  const close = () => router.back();
  const swipeDown = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > height * 0.18 || e.velocityY > 900) {
        drag.value = withTiming(height, { duration: 200 }, () => scheduleOnRN(close));
      } else {
        drag.value = withSpring(0, { damping: 22, stiffness: 220 });
      }
    });
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  const episode = useNowPlaying();
  const tint = useArtworkTint(episode?.artwork_url ?? episode?.podcast_artwork);
  const player = usePlayerState();
  const settingsQuery = useSettings();
  const settings = settingsQuery.data ?? DEFAULT_SETTINGS;
  const stopAtEnd = useStopAtEndOfEpisode();
  const queued =
    useDbQuery(['queue_item'], (d) =>
      d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM queue_item'),
    ).data?.n ?? 0;
  // The room left for the cover once everything else has taken its place (measured, so the
  // controls below can never be pushed off a short screen).
  const [artRoom, setArtRoom] = useState<number | null>(null);

  // Nothing left to play (Up Next ran out): close.
  const finished = settingsQuery.status === 'success' && settings.nowPlaying === null;
  useEffect(() => {
    if (finished && router.canGoBack()) router.back();
  }, [finished]);

  const chapters =
    useDbQuery(['chapter'], async (d) => (episode ? listChapters(d, episode.id) : []), [
      episode?.id,
    ]).data ?? [];

  const ads =
    useDbQuery(
      ['ad_segment'],
      async (d) =>
        episode
          ? d.getAllAsync<{ start_s: number; end_s: number }>(
              `SELECT start_s, end_s FROM ad_segment WHERE episode_id = ?
                 AND COALESCE(user_verdict, 'ad') = 'ad'`,
              episode.id,
            )
          : [],
      [episode?.id],
    ).data ?? [];

  if (!episode) return <Background />;

  const current = player.id === String(episode.id);
  const playing = current && player.playWhenReady;
  const positionMs = current ? player.positionMs : episode.position_s * 1000;
  const durationMs =
    (current ? player.durationMs : null) ?? (episode.duration_s ? episode.duration_s * 1000 : null);
  const basic = engine.kind === 'basic';
  const artWidest = width - Spacing.five * 2;
  const art = artRoom == null ? 0 : Math.max(0, Math.min(artWidest, artRoom));
  const videoWidth = artRoom == null ? 0 : Math.max(0, Math.min(artWidest, (artRoom * 16) / 9));
  const sleepLeft = player.sleepRemainingMs;
  const currentChapter = chapterAt(chapters, positionMs / 1000);
  // A video episode shows its picture instead of the cover; tap it for full screen.
  const showVideo = current && episode.media_type === 'video' && !!VideoSurface;

  const openMenu = () =>
    showSheet({
      title: episode.title,
      options: [
        {
          label: 'Episode details',
          icon: 'info',
          onPress: () => router.push(`/episode/${episode.id}`),
        },
        { label: 'Chapters', icon: 'list', onPress: () => router.push('/chapters') },
        { label: 'Transcript', icon: 'file-text', onPress: () => router.push('/transcript') },
        {
          label: 'Ads in this episode',
          hint: 'When they are, how they were found, and which are skipped',
          icon: 'scissors' as const,
          onPress: () => showAdsSheet(episode),
        },
        ...(current
          ? [
              {
                label: 'That was an ad',
                hint: 'Skip it from now on, here and in other episodes',
                icon: 'warning' as const,
                onPress: () =>
                  showSheet({
                    title: 'Which part was an ad?',
                    message: 'It snaps to anything Pod Wizard already found there.',
                    options: MARK_CHOICES.map((c) => ({
                      label: c.label,
                      onPress: () => void markAdBefore(db, episode, positionMs / 1000, c.seconds),
                    })),
                  }),
              },
            ]
          : []),
        { label: 'Share episode', icon: 'share-network', onPress: () => shareEpisode(episode) },
        {
          label: `Share from ${clock(positionMs)}`,
          icon: 'link',
          onPress: () => shareEpisodeAt(episode, positionMs / 1000, clock(positionMs)),
        },
        { label: 'Make a clip', icon: 'scissors', onPress: () => router.push('/clip') },
        {
          label: 'Add to playlist',
          icon: 'playlist',
          onPress: () => void chooseManualPlaylist(db, episode.id),
        },
        {
          label: 'Go to podcast',
          icon: 'squares-four',
          onPress: () => router.push(`/podcast/${episode.podcast_id}`),
        },
      ],
    });

  const chooseSpeed = () =>
    showCustomSheet({
      title: 'Playback speed',
      message: basic ? 'Up to 2× in Expo Go.' : undefined,
      content: <SpeedSheet podcastId={episode.podcast_id} max={basic ? 2 : 3} />,
    });

  const cycleTrim = () => {
    const order: TrimSilence[] = ['off', 'mild', 'aggressive'];
    const next = order[(order.indexOf(player.trimSilence) + 1) % order.length];
    void setPlaybackOption(db, episode.podcast_id, 'trimSilence', next);
  };

  const toggleBoost = () =>
    void setPlaybackOption(db, episode.podcast_id, 'volumeBoost', !player.volumeBoost);

  const chooseSleep = () => {
    const on = sleepLeft != null || stopAtEnd;
    showSheet({
      title: 'Sleep timer',
      message: on
        ? 'Playback will pause on its own, fading out at the end.'
        : 'Pause playback after…',
      options: [
        ...(on
          ? [
              {
                label: 'Turn off',
                icon: 'x' as const,
                destructive: true,
                onPress: () => {
                  void engine.setSleepTimer(0);
                  setStopAtEndOfEpisode(false);
                },
              },
            ]
          : []),
        ...SLEEP_MINUTES.map((m) => ({
          label: `${m} minutes`,
          onPress: () => {
            setStopAtEndOfEpisode(false);
            void engine.setSleepTimer(m * 60_000);
          },
        })),
        {
          label: 'End of episode',
          selected: stopAtEnd,
          onPress: () => {
            void engine.setSleepTimer(0);
            setStopAtEndOfEpisode(true);
          },
        },
      ],
    });
  };

  return (
    <GestureDetector gesture={swipeDown}>
      <Reanimated.View style={[styles.flex, dragStyle]}>
        <Background tint={tint} />
        <View
          style={[
            styles.content,
            { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.three },
          ]}>
          <View style={styles.topBar}>
            <IconButton icon="caret-down" label="Close player" onPress={() => router.back()} />
            <View pointerEvents="none" style={styles.topTitle}>
              <Txt variant="meta" secondary>
                Now playing
              </Txt>
            </View>
            <View style={styles.flex} />
            <IconButton
              label={queued ? `Up Next, ${queued} episode${queued === 1 ? '' : 's'}` : 'Up Next'}
              onPress={() => {
                router.back();
                router.navigate('/up-next');
              }}>
              <Icon name="queue" size={24} color={theme.text} />
              {queued > 0 && (
                <View style={[styles.queueCount, { backgroundColor: theme.accent }]}>
                  <Txt variant="smallBold" color={theme.onAccent} style={styles.queueCountText}>
                    {queued > 99 ? '99+' : queued}
                  </Txt>
                </View>
              )}
            </IconButton>
            <IconButton icon="dots-three-vertical" label="More" onPress={openMenu} />
          </View>

          <View
            style={styles.artRoom}
            onLayout={(e) => setArtRoom(Math.floor(e.nativeEvent.layout.height))}>
            {artRoom == null ? null : showVideo && VideoSurface ? (
              <Pressable
                onPress={() => router.push('/video')}
                accessibilityRole="button"
                accessibilityLabel="Watch full screen"
                style={[styles.video, { width: videoWidth, height: (videoWidth * 9) / 16 }]}>
                <VideoSurface style={StyleSheet.absoluteFill} />
                <View style={styles.videoBadge}>
                  <Icon name="corners-out" size={18} color="#fff" duotone={false} />
                </View>
              </Pressable>
            ) : (
              <Artwork
                uri={
                  currentChapter?.chapter.image_url ??
                  episode.artwork_url ??
                  episode.podcast_artwork
                }
                title={episode.podcast_title}
                size={art}
                radius={22}
              />
            )}
          </View>

          {currentChapter ? (
            <Pressable
              onPress={() => router.push('/chapters')}
              accessibilityRole="button"
              accessibilityHint="Shows all chapters"
              style={[styles.chapterChip, { backgroundColor: theme.element }]}>
              <Txt variant="smallBold" numberOfLines={1}>
                {`Chapter ${currentChapter.index + 1} of ${chapters.length}`}
                {currentChapter.chapter.title ? ` · ${currentChapter.chapter.title}` : ''}
              </Txt>
            </Pressable>
          ) : (
            // Before an episode's first chapter: the chip's place is kept, so the cover doesn't
            // change size when the chip arrives.
            chapters.length > 0 && <View style={styles.chapterGap} />
          )}

          <View style={styles.titles}>
            <Txt variant="heading" style={styles.center} numberOfLines={2}>
              {episode.title}
            </Txt>
            <Pressable
              onPress={() => router.push(`/podcast/${episode.podcast_id}`)}
              accessibilityRole="link">
              <Txt secondary style={styles.center} numberOfLines={1}>
                {episode.podcast_title}
              </Txt>
            </Pressable>
          </View>

          <Scrubber
            positionMs={positionMs}
            durationMs={durationMs}
            bufferedMs={current ? player.bufferedMs : 0}
            marks={chapters.map((c) => c.start_s * 1000)}
            bands={[
              ...chapters
                .filter((c) => !c.selected && c.end_s != null)
                .map((c) => ({ startMs: c.start_s * 1000, endMs: c.end_s! * 1000 })),
              ...ads.map((a) => ({ startMs: a.start_s * 1000, endMs: a.end_s * 1000 })),
            ]}
            onSeek={(ms) => void seekTo(ms)}
          />

          <View style={styles.transport}>
            <SkipButton
              seconds={settings.skipBackS}
              onPress={() => void skipBy(-settings.skipBackS)}
            />
            <Pressable
              onPress={() => void togglePlay(db)}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : 'Play'}
              style={({ pressed }) => [
                styles.play,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.8 },
              ]}>
              <View style={!playing && { marginLeft: 4 }}>
                <Icon
                  name={playing ? 'pause-fill' : 'play-fill'}
                  size={36}
                  color={theme.onAccent}
                />
              </View>
            </Pressable>
            <SkipButton
              seconds={settings.skipForwardS}
              forward
              onPress={() => void skipBy(settings.skipForwardS)}
            />
            {/* Sits in the gap under the buttons, so appearing doesn't move anything. */}
            {current && player.playWhenReady && player.state === 'buffering' && (
              <Txt variant="small" secondary style={styles.loading}>
                Loading…
              </Txt>
            )}
          </View>

          <View style={styles.controls}>
            <Control
              label="Speed"
              text={speedLabel(player.speed)}
              active={player.speed !== 1}
              onPress={chooseSpeed}
            />
            {!basic && (
              <Control
                icon="waveform"
                label="Trim silence"
                value={player.trimSilence === 'off' ? 'Trim' : TRIM_LABELS[player.trimSilence]}
                active={player.trimSilence !== 'off'}
                onPress={cycleTrim}
              />
            )}
            {!basic && (
              <Control
                icon="speaker-high"
                label="Volume boost"
                value={player.volumeBoost ? 'Boost on' : 'Boost'}
                active={player.volumeBoost}
                onPress={toggleBoost}
              />
            )}
            <Control
              icon="moon"
              label="Sleep timer"
              value={stopAtEnd ? 'End of ep.' : sleepLeft != null ? clock(sleepLeft) : 'Sleep'}
              active={stopAtEnd || sleepLeft != null}
              onPress={chooseSleep}
            />
            <Control icon="bookmark-simple" label="Bookmark" onPress={() => void bookmarkNow(db)} />
          </View>
        </View>
        <StatusBarScrim />
      </Reanimated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, paddingHorizontal: Spacing.four, gap: Spacing.three },
  topBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -Spacing.three },
  // Centred on the screen whatever sits either side of it.
  topTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueCount: {
    position: 'absolute',
    top: 3,
    right: 1,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueCountText: { fontSize: 11, lineHeight: 14 },
  // Everything else on the screen has a fixed height; the cover gets what's left.
  artRoom: { flex: 1, minHeight: 96, alignItems: 'center', justifyContent: 'center' },
  video: { borderRadius: Radius.large, overflow: 'hidden', backgroundColor: '#000' },
  videoBadge: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    padding: 6,
    borderRadius: Radius.small,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  // Tall enough for a two-line title, so a long title doesn't shrink the cover.
  titles: { gap: 4, minHeight: 78, justifyContent: 'center' },
  center: { textAlign: 'center' },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.five + 4,
  },
  play: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'space-around' },
  control: { alignItems: 'center', gap: 6, width: 62 },
  controlCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: { fontSize: 14 },
  controlLabel: { textAlign: 'center' },
  chapterChip: {
    alignSelf: 'center',
    maxWidth: '100%',
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  chapterGap: { height: 30 },
  loading: { position: 'absolute', left: 0, right: 0, bottom: -17, textAlign: 'center' },
});
