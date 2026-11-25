import { Pressable, StyleSheet } from 'react-native';
import Sortable from 'react-native-sortables';

import { Icon } from '@/components/icons/icon';
import { showSheet } from '@/components/sheet';
import { Txt } from '@/components/text';
import { useTheme } from '@/theme/theme-provider';
import { Spacing } from '@/theme/themes';

/**
 * What Up Next and playlists share: a list you put in order by dragging a row's handle, and a
 * press-and-hold menu on each row for moving it to either end or taking it off the list.
 */

/**
 * How long the handle is held before the row lifts, and how far the finger may move meanwhile.
 * Short enough that pressing and dragging just works; long enough that a scroll which happens
 * to start on a handle still scrolls instead of moving an episode.
 */
export const HOLD_MS = 100;
export const HOLD_SLOP = 12;

/** The six dots at the start of a row. Goes in a row inside a Sortable.Grid with customHandle. */
export function DragHandle({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Sortable.Handle>
      {/* A button of its own, so a tap on the handle doesn't open the episode. */}
      <Pressable
        onPress={() => {}}
        style={styles.handle}
        accessibilityLabel={`Move ${title}`}
        accessibilityHint="Hold and drag up or down to change the order">
        <Icon name="dots-six-vertical" size={22} color={theme.textSecondary} />
      </Pressable>
    </Sortable.Handle>
  );
}

/** The menu a row opens when pressed and held. */
export function showRowMenu({
  title,
  first,
  last,
  removeLabel,
  onTop,
  onBottom,
  onRemove,
}: {
  title: string;
  /** Already first or last: that move is left out. */
  first: boolean;
  last: boolean;
  removeLabel: string;
  onTop: () => void;
  onBottom: () => void;
  onRemove: () => void;
}) {
  showSheet({
    title,
    options: [
      ...(first ? [] : [{ label: 'Move to top', icon: 'caret-up' as const, onPress: onTop }]),
      ...(last
        ? []
        : [{ label: 'Move to bottom', icon: 'caret-down' as const, onPress: onBottom }]),
      { label: removeLabel, icon: 'x' as const, destructive: true, onPress: onRemove },
    ],
  });
}

/** A quiet line under the list, so the press-and-hold menu can be found. */
export function HoldHint() {
  return (
    <Txt variant="small" secondary style={styles.hint}>
      Press and hold an episode to move or remove it.
    </Txt>
  );
}

const styles = StyleSheet.create({
  // A tall, easy target for the thumb that takes little room in the row: the margins pull it
  // toward the row's edge and the cover.
  handle: {
    paddingVertical: 14,
    paddingHorizontal: 6,
    marginLeft: -Spacing.two,
    marginRight: -6,
  },
  hint: { textAlign: 'center', marginHorizontal: Spacing.four, marginTop: Spacing.three },
});
