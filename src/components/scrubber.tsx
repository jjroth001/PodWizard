import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Txt } from '@/components/text';
import { clock } from '@/lib/format';
import { useTheme } from '@/theme/theme-provider';

type Props = {
  positionMs: number;
  durationMs: number | null;
  bufferedMs: number;
  onSeek: (ms: number) => void;
  /** Chapter starts, drawn as small gaps in the bar. */
  marks?: number[];
  /** Ranges that will be skipped (unticked chapters, ads), drawn as shaded bands. */
  bands?: { startMs: number; endMs: number }[];
};

/** The position bar: drag or tap to seek; the thumb follows the finger until it lets go. */
export function Scrubber({
  positionMs,
  durationMs,
  bufferedMs,
  onSeek,
  marks = [],
  bands = [],
}: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(1);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const toMs = (x: number) =>
    durationMs ? Math.min(durationMs, Math.max(0, (x / width) * durationMs)) : 0;
  // minDistance 0: a tap seeks too. Callbacks run on the JS thread (they only set state).
  const pan = Gesture.Pan()
    .enabled(!!durationMs)
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => setDragMs(toMs(e.x)))
    .onUpdate((e) => setDragMs(toMs(e.x)))
    .onEnd((e) => onSeek(toMs(e.x)))
    .onFinalize(() => setDragMs(null));

  const shown = dragMs ?? positionMs;
  const fraction = durationMs ? Math.min(1, shown / durationMs) : 0;
  const buffered = durationMs ? Math.min(1, bufferedMs / durationMs) : 0;

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={styles.hit}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Position"
          accessibilityValue={{ text: `${clock(shown)} of ${clock(durationMs)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const step = e.nativeEvent.actionName === 'increment' ? 30_000 : -30_000;
            onSeek(Math.max(0, positionMs + step));
          }}>
          <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.track }]}>
            <View
              style={[styles.fill, { width: `${buffered * 100}%`, backgroundColor: theme.track }]}
            />
            <View
              style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: theme.accent }]}
            />
            {!!durationMs &&
              marks
                .filter((m) => m > 0 && m < durationMs)
                .map((m) => (
                  <View
                    key={m}
                    style={[
                      styles.mark,
                      { left: `${(m / durationMs) * 100}%`, backgroundColor: theme.background },
                    ]}
                  />
                ))}
          </View>
          {!!durationMs &&
            bands.map((b, i) => (
              <View
                // By position too: a skipped chapter and an ad can start at the same moment.
                key={`${i}:${b.startMs}`}
                pointerEvents="none"
                style={[
                  styles.band,
                  {
                    left: `${(b.startMs / durationMs) * 100}%`,
                    width: `${(Math.max(0, b.endMs - b.startMs) / durationMs) * 100}%`,
                    backgroundColor: theme.text,
                  },
                ]}
              />
            ))}
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              { left: fraction * width - (dragMs != null ? 11 : 8), backgroundColor: theme.accent },
              dragMs != null && styles.thumbActive,
            ]}
          />
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Txt variant="small" secondary style={styles.tabular}>
          {clock(shown)}
        </Txt>
        <Txt variant="small" secondary style={styles.tabular}>
          {durationMs ? `−${clock(Math.max(0, durationMs - shown))}` : '--:--'}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 32, justifyContent: 'center' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1 },
  band: { position: 'absolute', top: 11, height: 10, borderRadius: 3, opacity: 0.22 },
  thumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, top: 8 },
  thumbActive: { width: 22, height: 22, borderRadius: 11, top: 5 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  tabular: { fontVariant: ['tabular-nums'] },
});
