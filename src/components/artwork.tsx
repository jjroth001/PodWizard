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

/** How long a cover that has to be fetched takes to fade in over its loading tile. */
const FADE_MS = 200;

/**
 * A cover whose small copy is already on the phone only has to be read, which takes a moment
 * at most: just enough of a fade that it doesn't pop, not enough to watch it arrive.
 */
const SAVED_FADE_MS = 80;

/**
 * Covers that have been on screen since the app opened. Those are in memory, or a quick read
 * away, so the next time one appears it's drawn at once instead of fading in again.
 */
const displayed = new Set<string>();

type SavedCover = { saved: boolean; color?: string };
const NOT_SAVED: SavedCover = { saved: false };

/** What's known about covers on the phone, once it can't change (saved, colour worked out). */
const savedCovers = new Map<string, SavedCover>();

/** Whether a cover's small copy is on the phone, and the colour the cover reads as. */
function savedCover(uri: string): SavedCover {
  const known = savedCovers.get(uri);
  if (known) return known;
  const cover = PlayerCore?.artworkSaved(uri) ?? NOT_SAVED;
  if (cover.saved && cover.color) savedCovers.set(uri, cover);
  return cover;
}

/**
 * A podcast or episode cover. While it loads there's a plain tile in the cover's own colour,
 * which the cover fades in over; a cover the app hasn't saved yet gets a quiet tile a shade off
 * the background instead. A cover already on the phone (every show you follow, after the first
 * time) appears straight away. The coloured tile with the show's first letter is kept for shows
 * with no cover, or one that can't be loaded.
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
  const small = !!uri && size <= THUMBNAIL_MAX && !!PlayerCore;
  const source = small ? (PlayerCore?.artworkThumbnail(uri) ?? uri) : uri;
  const showImage = !!source && failedSource !== source;
  const cover = uri ? savedCover(uri) : NOT_SAVED;
  // Decided once, as this cover first appears (opening the app, opening a show from the
  // library, a row scrolling back into view). A cover that changes later, like the player's,
  // still fades to the next.
  const [first] = useState(() => ({
    source,
    fadeMs: !source
      ? FADE_MS
      : displayed.has(source)
        ? 0
        : // Only the small copy is saved by the app; the player's big cover is fetched as before.
          small && cover.saved
          ? SAVED_FADE_MS
          : FADE_MS,
  }));
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: showImage
            ? (cover.color ?? loadingColor ?? theme.element)
            : colorFor(title),
        },
        styles.clip,
        style,
      ]}>
      {showImage ? (
        <Image
          source={{ uri: source! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={source === first.source ? first.fadeMs : FADE_MS}
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
