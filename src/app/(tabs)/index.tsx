import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import Reanimated, { useAnimatedRef } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sortable, { type DragMoveParams, type DragStartParams } from 'react-native-sortables';

import { Button, IconButton } from '@/components/controls';
import { FolderTile, PodcastTile } from '@/components/library-tiles';
import { ScreenHeader } from '@/components/screen-header';
import { showSheet } from '@/components/sheet';
import { useTabBarSpace } from '@/components/tab-bar';
import { Txt } from '@/components/text';
import {
  listFolders,
  movePodcastToFolder,
  saveLibraryOrder,
  type LibraryFolder,
} from '@/db/folders';
import { listLibrary, type LibraryPodcast } from '@/db/library';
import { DEFAULT_SETTINGS, LIBRARY_SORTS } from '@/db/settings';
import { useDbQuery } from '@/db/use-db-query';
import { useSetSetting, useSettings } from '@/db/use-settings';
import { refreshAll } from '@/feeds/sync';
import { useTheme } from '@/theme/theme-provider';
import { Spacing } from '@/theme/themes';

const LAYOUTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'large', label: 'Large grid' },
  { value: 'list', label: 'List', hint: 'With each show’s newest episode' },
] as const;

/** How long a podcast must hover over a folder before letting go drops it in. */
const HOVER_MS = 350;

type Rect = { x: number; y: number; width: number; height: number };

type Item =
  | { kind: 'folder'; key: string; order: number; folder: LibraryFolder }
  | { kind: 'podcast'; key: string; order: number; podcast: LibraryPodcast };

export default function PodcastsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const { width } = useWindowDimensions();
  const settings = useSettings().data ?? DEFAULT_SETTINGS;
  const setSetting = useSetSetting();
  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();
  // Dragging a podcast onto a folder: folders hold still while a podcast is dragged, and the
  // one under the finger for a moment becomes the drop target.
  const [draggingPodcast, setDraggingPodcast] = useState(false);
  const [dropFolder, setDropFolder] = useState<number | null>(null);
  const folderViews = useRef(new Map<number, View>());
  const folderRects = useRef(new Map<number, Rect>());
  const scrollY = useRef(0);
  const scrollAtStart = useRef(0);
  const dragging = useRef(false);
  const hover = useRef<{
    id: number | null;
    ready: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }>({ id: null, ready: false });
  const layout = settings.libraryLayout;
  const sort = settings.librarySort;
  const library = useDbQuery(
    ['podcast', 'episode', 'episode_state', 'folder'],
    async (d) => {
      const [folders, podcasts] = await Promise.all([listFolders(d), listLibrary(d, sort, null)]);
      const items: Item[] = [
        ...folders.map((f) => ({
          kind: 'folder' as const,
          key: `f${f.id}`,
          order: f.sort_order,
          folder: f,
        })),
        ...podcasts.map((p) => ({
          kind: 'podcast' as const,
          key: `p${p.id}`,
          order: p.sort_order,
          podcast: p,
        })),
      ];
      // Your own order mixes folders in among the podcasts; other orders list folders first.
      return sort === 'manual' ? items.sort((a, b) => a.order - b.order) : items;
    },
    [sort],
  );
  const [refreshing, setRefreshing] = useState(false);

  const columns = layout === 'grid' ? 3 : layout === 'large' ? 2 : 1;
  const gap = layout === 'grid' ? 12 : 14;
  const side = Spacing.four - 4;
  const tile = Math.floor((width - side * 2 - gap * (columns - 1)) / columns);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll(db);
    } finally {
      setRefreshing(false);
    }
  };

  const chooseLayout = () =>
    showSheet({
      title: 'Layout',
      choice: true,
      options: LAYOUTS.map((l) => ({
        label: l.label,
        hint: 'hint' in l ? l.hint : undefined,
        selected: l.value === layout,
        onPress: () => void setSetting('libraryLayout', l.value),
      })),
    });

  const chooseSort = () =>
    showSheet({
      title: 'Sort by',
      choice: true,
      options: LIBRARY_SORTS.map((s) => ({
        label: s.label,
        hint: s.value === 'manual' ? 'Press and hold a podcast to move it' : undefined,
        selected: s.value === sort,
        onPress: () => void setSetting('librarySort', s.value),
      })),
    });

  const folderMenu = () => {
    const folders = (library.data ?? []).filter((i) => i.kind === 'folder');
    if (folders.length === 0) {
      router.push('/folder-edit');
      return;
    }
    showSheet({
      title: 'Folders',
      options: [
        { label: 'New folder', icon: 'folder-plus', onPress: () => router.push('/folder-edit') },
        ...folders.map((f) => ({
          label: `Edit ${f.folder.name}`,
          icon: 'folder' as const,
          onPress: () => router.push(`/folder-edit?id=${f.folder.id}`),
        })),
      ],
    });
  };

  /** One button for how the page looks: its layout, its order and its folders. */
  const viewMenu = () =>
    showSheet({
      title: 'View',
      options: [
        {
          label: 'Layout',
          hint: LAYOUTS.find((l) => l.value === layout)?.label,
          icon: 'squares-four',
          onPress: chooseLayout,
        },
        {
          label: 'Sort by',
          hint: LIBRARY_SORTS.find((s) => s.value === sort)?.label,
          icon: 'sliders-horizontal',
          onPress: chooseSort,
        },
        {
          label: 'Folders',
          hint: 'Make a folder, or edit one',
          icon: 'folder',
          onPress: folderMenu,
        },
      ],
    });

  // Dropping a podcast where you want it switches to your own order and saves it.
  const onDragEnd = ({
    key,
    data,
    fromIndex,
    toIndex,
  }: {
    key: string;
    data: Item[];
    fromIndex: number;
    toIndex: number;
  }) => {
    const target = hover.current.ready ? hover.current.id : null;
    clearTimeout(hover.current.timer);
    hover.current = { id: null, ready: false };
    dragging.current = false;
    setDropFolder(null);
    setDraggingPodcast(false);
    const moved = data.find((i) => i.key === key);
    if (target != null && moved?.kind === 'podcast') {
      // Dropped on a folder: in it goes, and the rest keep the order they had.
      void (async () => {
        await movePodcastToFolder(db, moved.podcast.id, target);
        if (sort === 'manual') {
          await saveLibraryOrder(
            db,
            data
              .filter((i) => i !== moved)
              .map((i) => ({ kind: i.kind, id: i.kind === 'folder' ? i.folder.id : i.podcast.id })),
          );
        }
      })();
      return;
    }
    if (fromIndex === toIndex) return;
    void (async () => {
      await saveLibraryOrder(
        db,
        data.map((i) => ({ kind: i.kind, id: i.kind === 'folder' ? i.folder.id : i.podcast.id })),
      );
      if (sort !== 'manual') await setSetting('librarySort', 'manual');
    })();
  };

  const onDragStart = ({ key }: DragStartParams) => {
    if (!key.startsWith('p')) return;
    dragging.current = true;
    setDraggingPodcast(true);
    scrollAtStart.current = scrollY.current;
    folderRects.current.clear();
    for (const [id, view] of folderViews.current) {
      view.measureInWindow((x, y, w, h) =>
        folderRects.current.set(id, { x, y, width: w, height: h }),
      );
    }
  };

  const onDragMove = ({ touchData }: DragMoveParams) => {
    if (!dragging.current) return;
    // Folders stay put during the drag; only scrolling moves them on screen.
    const dy = scrollY.current - scrollAtStart.current;
    let over: number | null = null;
    for (const [id, r] of folderRects.current) {
      const inset = Math.min(r.width, r.height) * 0.15;
      const top = r.y - dy;
      if (
        touchData.absoluteX > r.x + inset &&
        touchData.absoluteX < r.x + r.width - inset &&
        touchData.absoluteY > top + inset &&
        touchData.absoluteY < top + r.height - inset
      ) {
        over = id;
        break;
      }
    }
    if (over === hover.current.id) return;
    clearTimeout(hover.current.timer);
    hover.current = { id: over, ready: false };
    setDropFolder(null);
    if (over != null) {
      hover.current.timer = setTimeout(() => {
        hover.current.ready = true;
        setDropFolder(over);
      }, HOVER_MS);
    }
  };

  const data = library.data ?? [];
  const empty = library.status === 'success' && data.length === 0;

  return (
    <View style={styles.flex}>
      <Reanimated.ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={insets.top}
            colors={[theme.accent]}
            progressBackgroundColor={theme.dark ? '#222' : '#fff'}
          />
        }>
        <ScreenHeader title="Podcasts">
          <IconButton
            icon="plus"
            label="Add a podcast"
            onPress={() => router.navigate('/discover')}
          />
          {!empty && (
            <IconButton
              icon="sliders-horizontal"
              label="View: layout, sort and folders"
              onPress={viewMenu}
            />
          )}
        </ScreenHeader>
        {empty ? (
          <View style={styles.empty}>
            <Txt variant="heading" style={styles.center}>
              No podcasts yet
            </Txt>
            <Txt secondary style={styles.center}>
              Search for shows, paste a feed address, or import a list from another app in Settings.
            </Txt>
            <Button
              label="Find podcasts"
              icon="magnifying-glass"
              onPress={() => router.navigate('/discover')}
            />
          </View>
        ) : (
          <View style={{ paddingHorizontal: columns > 1 ? side : 0 }}>
            <Sortable.Grid
              key={layout}
              data={data}
              keyExtractor={(item) => item.key}
              columns={columns}
              rowGap={columns > 1 ? gap : 0}
              columnGap={columns > 1 ? gap : 0}
              scrollableRef={scrollRef}
              dragActivationDelay={300}
              activeItemScale={1.06}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              customHandle
              renderItem={({ item }) =>
                item.kind === 'folder' ? (
                  <Sortable.Handle mode={draggingPodcast ? 'fixed-order' : 'draggable'}>
                    <View
                      ref={(v) => {
                        if (v) folderViews.current.set(item.folder.id, v);
                        else folderViews.current.delete(item.folder.id);
                      }}
                      collapsable={false}>
                      <FolderTile
                        item={item.folder}
                        layout={layout}
                        size={tile}
                        dropTarget={dropFolder === item.folder.id}
                      />
                    </View>
                  </Sortable.Handle>
                ) : (
                  <Sortable.Handle>
                    <PodcastTile item={item.podcast} layout={layout} size={tile} />
                  </Sortable.Handle>
                )
              }
            />
          </View>
        )}
      </Reanimated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  empty: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.six,
  },
  center: { textAlign: 'center' },
});
