import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { PlayerCore } from '@modules/player-core/src';
import { useTheme } from '@/theme/theme-provider';

const PLACEHOLDER_COLORS = [
  '#5E8C61',
  '#3B4BA8',
  '#C9773A',
  '#3F8CA0',
  '#B8566B',
  '#6E6A64',
  '#6A52A8',
  '#9C8A3A',
];

function colorFor(title: string) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return PLACEHOLDER_COLORS[Math.abs(h) % PLACEHOLDER_COLORS.length];
}

type Props = {
  uri: string | null | undefined;
  title: string;
  size: number;
  radius?: number;
  /** The quiet tile shown while the cover loads, where the theme's own wouldn't suit what's behind. */
  loadingColor?: string;
  style?: StyleProp<ViewStyle>;
};

/** Covers drawn at most this big use the small cached copy instead of the full image. */
const THUMBNAIL_MAX = 220;

/** How long a cover takes to fade in over its loading tile. */
const FADE_MS = 200;

/**
 * Covers that have been on screen since the app opened. Those are in memory, or a quick read
 * away, so the next time one appears it's drawn at once instead of fading in again.
 */
const displayed = new Set<string>();

/**
 * A podcast or episode cover. While it loads there's only a quiet tile, a shade off the
 * background, which the cover fades in over. The coloured tile with the show's first letter is
 * kept for shows with no cover, or one that can't be loaded.
 * Feeds often supply huge covers (thousands of pixels); lists use a small copy the app keeps.
 */
export function Artwork({
  uri,
  title,
  size,
  radius = Math.round(size * 0.12),
  loadingColor,
  style,
}: Props) {
  const theme = useTheme();
  // Which image failed, not just that one did: the mini player and the player keep one of these
  // for as long as the app is open, and a single cover that wouldn't load (opened with no
  // connection, say) used to leave every later episode's cover blank until the app restarted.
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source =
    uri && size <= THUMBNAIL_MAX && PlayerCore ? (PlayerCore.artworkThumbnail(uri) ?? uri) : uri;
  const showImage = !!source && failedSource !== source;
  // Decided once, as this cover first appears (opening a show from the library, a row scrolling
  // back into view). A cover that changes later, like the player's, still fades to the next.
  const [instant] = useState(() => (source && displayed.has(source) ? source : null));
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: showImage ? (loadingColor ?? theme.element) : colorFor(title),
        },
        styles.clip,
        style,
      ]}>
      {showImage ? (
        <Image
          source={{ uri: source! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={source === instant ? 0 : FADE_MS}
          cachePolicy="memory-disk"
          recyclingKey={source}
          onDisplay={() => {
            if (source) displayed.add(source);
          }}
          onError={() => setFailedSource(source ?? null)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.letter, { fontSize: size * 0.42 }]}>
          {title.trim().charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  letter: { color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
});
