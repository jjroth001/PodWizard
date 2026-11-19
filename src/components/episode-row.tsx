import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Artwork } from '@/components/artwork';
import { PlayButton } from '@/components/controls';
import { Icon } from '@/components/icons/icon';
import { Txt } from '@/components/text';
import type { EpisodeItem } from '@/db/library';
import { keyFor } from '@/downloads/downloads';
import { useDownloadLabel } from '@/downloads/progress';
import { duration, releaseDate, timeLeft } from '@/lib/format';
import { playEpisode, togglePlay } from '@/player/controller';
import { useEpisodePlayback } from '@/player/use-player';
import { useTheme } from '@/theme/theme-provider';
import { Radius, Spacing } from '@/theme/themes';

type Props = {
  episode: EpisodeItem;
  /** Show the podcast's cover and name (lists that mix podcasts). */
  showPodcast?: boolean;
  /** Draw as a card (Dusk, Midnight) or a plain row with a divider (Paper). */
  cards: boolean;
  /** Something before the cover, e.g. Up Next's drag handle. */
  leading?: React.ReactNode;
  /** Extra control on the right, e.g. remove from Up Next. */
  trailing?: React.ReactNode;
};

export function EpisodeRow({ episode, showPodcast, cards, leading, trailing }: Props) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const player = useEpisodePlayback(episode.id);
  const [now] = useState(Date.now);
  const downloading = useDownloadLabel(
    episode.download_status === 'downloading' ? keyFor(episode) : null,
  );
  const current = player.current;
  const positionS = current ? player.positionMs / 1000 : episode.position_s;
  const durationS =
    (current && player.durationMs ? player.durationMs / 1000 : null) ?? episode.duration_s;
  const played = !!episode.played && !current;
  const inProgress = positionS > 5 && !played;
  const isNew = !episode.played && !inProgress && (episode.pub_date ?? 0) > now - 7 * 86_400_000;

  const status = played
    ? 'Played'
    : inProgress
      ? timeLeft(positionS, durationS)
      : duration(durationS);
  const meta = [releaseDate(episode.pub_date), duration(episode.duration_s)]
    .filter(Boolean)
    .join(' · ');

  const onPlay = () => {
    if (current) void togglePlay(db);
    else void playEpisode(db, episode.id);
  };

  return (
    <Pressable
      onPress={() => router.push(`/episode/${episode.id}`)}
      accessibilityRole="button"
      accessibilityHint="Shows the episode's details"
      style={({ pressed }) => [
        styles.row,
        cards
          ? [styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]
          : [styles.flat, { borderBottomColor: theme.cardBorder }],
        pressed && { opacity: 0.7 },
      ]}>
      {leading}
      {showPodcast && (
        <Artwork
          uri={episode.artwork_url ?? episode.podcast_artwork}
          title={episode.podcast_title}
          size={52}
        />
      )}
      <View style={[styles.text, played && { opacity: 0.5 }]}>
        <Txt variant="meta" color={isNew ? theme.accent : theme.textSecondary} numberOfLines={1}>
          {showPodcast ? episode.podcast_title : meta}
        </Txt>
        <Txt
          variant="bodyBold"
          numberOfLines={2}
          style={theme.serifTitles && !cards ? styles.serif : null}>
          {episode.title}
        </Txt>
        <View style={styles.statusRow}>
          {!!episode.starred && <Icon name="star-fill" size={12} color={theme.accent} />}
          {played && <Icon name="check" size={13} color={theme.textSecondary} duotone={false} />}
          {episode.download_status === 'done' && (
            <Icon name="download-simple" size={13} color={theme.accent} duotone={false} />
          )}
          {(episode.download_status === 'downloading' || episode.download_status === 'queued') && (
            <Txt variant="small" color={theme.accent}>
              {downloading ?? 'Queued'}
            </Txt>
          )}
          <Txt variant="small" secondary numberOfLines={1}>
            {showPodcast && meta ? `${releaseDate(episode.pub_date)} · ${status}` : status}
          </Txt>
        </View>
      </View>
      {trailing}
      <PlayButton
        playing={current && player.playWhenReady}
        progress={durationS ? positionS / durationS : 0}
        onPress={onPlay}
        label={current && player.playWhenReady ? 'Pause' : `Play ${episode.title}`}
      />
    </Pressable>
  );
}

/**
 * Soft stand-ins for episode rows while a show's episodes load, shaped like the real ones and
 * gently breathing so the page looks busy rather than stuck.
 */
export function EpisodePlaceholders({ cards, count = 6 }: { cards: boolean; count?: number }) {
  const theme = useTheme();
  const glow = useSharedValue(0.55);
  useEffect(() => {
    glow.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [glow]);
  const breathe = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <Reanimated.View style={breathe} accessibilityLabel="Loading episodes">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={
            cards
              ? [styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]
              : [styles.flat, { borderBottomColor: theme.cardBorder }]
          }>
          {/* Inside a row, as in EpisodeRow: text's flex: 1 has no height to fill otherwise. */}
          <View style={styles.row}>
            <View style={styles.text}>
              <View
                style={[
                  styles.bar,
                  { width: `${70 - (i % 3) * 12}%`, backgroundColor: theme.element },
                ]}
              />
              <View style={[styles.bar, styles.barSmall, { backgroundColor: theme.element }]} />
            </View>
          </View>
        </View>
      ))}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 14, borderRadius: 7 },
  barSmall: { width: '35%', height: 10, borderRadius: 5, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  card: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flat: {
    marginHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 3 },
  serif: { fontFamily: 'serif', fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
