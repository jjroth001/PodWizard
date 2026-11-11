import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { PlayerCore } from '@modules/player-core/src';

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
  style?: StyleProp<ViewStyle>;
};

/** Covers drawn at most this big use the small cached copy instead of the full image. */
const THUMBNAIL_MAX = 220;

/**
 * A podcast or episode cover; a coloured tile with the first letter while loading or if missing.
 * Feeds often supply huge covers (thousands of pixels); lists use a small copy the app keeps.
 */
export function Artwork({ uri, title, size, radius = Math.round(size * 0.12), style }: Props) {
  // Which image failed, not just that one did: the mini player and the player keep one of these
  // for as long as the app is open, and a single cover that wouldn't load (opened with no
  // connection, say) used to leave every later episode's cover blank until the app restarted.
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source =
    uri && size <= THUMBNAIL_MAX && PlayerCore ? (PlayerCore.artworkThumbnail(uri) ?? uri) : uri;
  const showImage = !!source && failedSource !== source;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: radius, backgroundColor: colorFor(title) },
        styles.clip,
        style,
      ]}>
      <Text style={[styles.letter, { fontSize: size * 0.42 }]}>
        {title.trim().charAt(0).toUpperCase()}
      </Text>
      {showImage && (
        <Image
          source={{ uri: source! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={source}
          onError={() => setFailedSource(source ?? null)}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  letter: { color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
});
