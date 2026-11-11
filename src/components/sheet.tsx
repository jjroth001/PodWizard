import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icons/icon';
import { Txt } from '@/components/text';
import { useTheme } from '@/theme/theme-provider';
import { Radius, Spacing } from '@/theme/themes';

/**
 * Bottom sheets for choices and short text entry. Android's alert dialogs show at most three
 * buttons and have no text field, so menus and prompts go through here.
 *
 *   showSheet({ title: 'Speed', options: [{ label: '1×', selected: true, onPress }] })
 *   showPrompt({ title: 'New folder', onSubmit: (name) => … })
 */

export type SheetOption = {
  label: string;
  hint?: string;
  icon?: IconName;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
};

type Request =
  | {
      kind: 'sheet';
      title?: string;
      message?: string;
      options: SheetOption[];
      /** A single choice: radio buttons on the left instead of a check on the right. */
      choice?: boolean;
    }
  | { kind: 'custom'; title?: string; message?: string; content: ReactNode }
  | {
      kind: 'prompt';
      title: string;
      message?: string;
      initial?: string;
      placeholder?: string;
      confirm?: string;
      onSubmit: (text: string) => void;
    };

let current: Request | null = null;
const listeners = new Set<() => void>();
const set = (r: Request | null) => {
  current = r;
  listeners.forEach((l) => l());
};

export const showSheet = (r: Omit<Extract<Request, { kind: 'sheet' }>, 'kind'>) =>
  set({ kind: 'sheet', ...r });
/** A sheet with your own content (e.g. the speed slider). */
export const showCustomSheet = (r: Omit<Extract<Request, { kind: 'custom' }>, 'kind'>) =>
  set({ kind: 'custom', ...r });
export const closeSheet = () => set(null);
export const showPrompt = (r: Omit<Extract<Request, { kind: 'prompt' }>, 'kind'>) =>
  set({ kind: 'prompt', ...r });
const close = () => set(null);

function useRequest() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

function PromptBody({ request }: { request: Extract<Request, { kind: 'prompt' }> }) {
  const theme = useTheme();
  const [text, setText] = useState(request.initial ?? '');
  const submit = () => {
    close();
    request.onSubmit(text.trim());
  };
  return (
    <View style={styles.promptBody}>
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus
        placeholder={request.placeholder}
        placeholderTextColor={theme.textSecondary}
        onSubmitEditing={submit}
        returnKeyType="done"
        style={[styles.input, { color: theme.text, backgroundColor: theme.element }]}
      />
      <View style={styles.promptButtons}>
        <Pressable onPress={close} accessibilityRole="button" style={styles.textButton}>
          <Txt variant="bodyBold" secondary>
            Cancel
          </Txt>
        </Pressable>
        <Pressable
          onPress={submit}
          accessibilityRole="button"
          style={[styles.confirm, { backgroundColor: theme.accent }]}>
          <Txt variant="bodyBold" color={theme.onAccent}>
            {request.confirm ?? 'Save'}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Mount once at the root, after the navigator. Drawn as a layer over the app rather than in a
 * React Native Modal: on Android (New Architecture) taps inside a Modal could go nowhere.
 */
export function SheetHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const request = useRequest();
  const panel = theme.dark ? (theme.name === 'midnight' ? '#121212' : '#22305A') : '#FFFFFF';
  // What's on screen: the open request, kept while the sheet slides away after closing.
  const [shown, setShown] = useState<Request | null>(null);
  const [progress] = useState(() => new Animated.Value(0));

  if (request && request !== shown) setShown(request);

  useEffect(() => {
    if (request) {
      Animated.timing(progress, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(
        ({ finished }) => finished && setShown(null),
      );
    }
  }, [request, progress]);

  // The back button closes the sheet instead of leaving the screen.
  useEffect(() => {
    if (!request) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [request]);

  if (!shown) return null;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={styles.fill}
      pointerEvents={request ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            backgroundColor: panel,
            paddingBottom: insets.bottom + Spacing.three,
            transform: [{ translateY }],
          },
        ]}>
        <View style={[styles.handle, { backgroundColor: theme.textSecondary }]} />
        {!!shown.title && (
          <Txt variant="heading" style={styles.title}>
            {shown.title}
          </Txt>
        )}
        {!!shown.message && (
          <Txt variant="small" secondary style={styles.message}>
            {shown.message}
          </Txt>
        )}
        {shown.kind === 'custom' ? (
          shown.content
        ) : shown.kind === 'prompt' ? (
          <PromptBody request={shown} />
        ) : (
          <ScrollView style={styles.list} bounces={false} keyboardShouldPersistTaps="handled">
            {shown.options.map((o, i) => (
              <Pressable
                // By position too: two folders or playlists can share a name.
                key={`${i}:${o.label}`}
                onPress={() => {
                  close();
                  o.onPress();
                }}
                accessibilityRole={shown.choice ? 'radio' : 'button'}
                accessibilityState={{ selected: o.selected }}
                style={({ pressed }) => [
                  styles.option,
                  pressed && { backgroundColor: theme.element },
                ]}>
                {shown.choice && (
                  <View
                    style={[
                      styles.radio,
                      { borderColor: o.selected ? theme.accent : theme.textSecondary },
                    ]}>
                    {o.selected && (
                      <View style={[styles.radioDot, { backgroundColor: theme.accent }]} />
                    )}
                  </View>
                )}
                {o.icon && (
                  <Icon name={o.icon} size={22} color={o.destructive ? theme.danger : theme.text} />
                )}
                <View style={styles.optionText}>
                  <Txt
                    variant="body"
                    color={o.destructive ? theme.danger : o.selected ? theme.accent : theme.text}>
                    {o.label}
                  </Txt>
                  {!!o.hint && (
                    <Txt variant="small" secondary>
                      {o.hint}
                    </Txt>
                  )}
                </View>
                {o.selected && !shown.choice && (
                  <Icon name="check" size={20} color={theme.accent} duotone={false} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 100,
    elevation: 100,
  },
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: Spacing.two,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
    marginBottom: Spacing.two,
  },
  title: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  message: { paddingHorizontal: Spacing.four, marginBottom: Spacing.two },
  list: { flexGrow: 0 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
  },
  optionText: { flex: 1, gap: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  promptBody: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  input: {
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  promptButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.three,
  },
  textButton: { paddingHorizontal: Spacing.two, paddingVertical: 10 },
  confirm: { paddingHorizontal: Spacing.four, paddingVertical: 10, borderRadius: Radius.pill },
});
