import { useRef, useState } from 'react';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import type { DownloadController, DownloadScreenState } from './download-controller';
import { emptyAlbumFilter, filterAlbum, localCaptureDate, type AlbumEntry } from './album-filter';
import { AlbumCalendar } from './album-calendar';


type AlbumRow = { kind: 'date'; key: string; date: string }
  | { kind: 'photos'; key: string; items: { entry: AlbumEntry; index: number }[] };

export function AlbumGallery({ controller, state, embedded = false, initialDisplay = 'list', backgroundProvided = false }: {
  controller: DownloadController; state: DownloadScreenState; embedded?: boolean; initialDisplay?: 'list' | 'second'; backgroundProvided?: boolean;
}) {
  const theme = useTheme();
  const [oldestFirst, setOldestFirst] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [displayTab, setDisplayTab] = useState<'list' | 'second'>(initialDisplay);
  const pager = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(width);
  const changeDisplay = (tab: 'list' | 'second') => {
    setDisplayTab(tab);
    pager.current?.scrollTo({ x: tab === 'list' ? pageWidth : 0, animated: true });
  };
  const clearDisplayFilters = () => {
    if (controller.getSnapshot().phase === 'favorites') controller.showFavorites();
    controller.clearFilters();
  };
  const searchOpen = state.phase === 'search';
  const favoritesOnly = state.phase === 'favorites' || (searchOpen && state.searchBackPhase === 'favorites') || state.filter.favoritesOnly;
  const allPhotos = filterAlbum(state.intakes, emptyAlbumFilter());
  const filtered = filterAlbum(state.intakes, { ...state.filter, favoritesOnly: favoritesOnly || state.filter.favoritesOnly });
  const photos = oldestFirst ? [...filtered].reverse() : filtered;
  const grouped = new Map<string, { entry: AlbumEntry; index: number }[]>();
  photos.forEach((entry, index) => {
    const date = localCaptureDate(entry.photo.capturedAt);
    const group = grouped.get(date) ?? [];
    group.push({ entry, index });
    grouped.set(date, group);
  });
  const rows: AlbumRow[] = [];
  for (const [date, items] of grouped) {
    rows.push({ kind: 'date', key: `date-${date}`, date });
    for (let index = 0; index < items.length; index += 3) {
      rows.push({ kind: 'photos', key: `${date}-${index}`, items: items.slice(index, index + 3) });
    }
  }
  const groups = [...new Map(allPhotos.map(({ intake }) => [intake.groupId, intake.groupName])).entries()];
  const idols = [...new Map(allPhotos.flatMap(({ intake }) => intake.idolIds.map((id, index) =>
    [id, intake.idolNames[index] ?? id] as const))).entries()];
  const dates = [...new Set(allPhotos.map(({ photo }) => localCaptureDate(photo.capturedAt)))].filter(Boolean);
  const ink = { color: theme.text };
  const chip = (selected: boolean) => [styles.chip, { borderColor: selected ? '#2f80d8' : theme.textSecondary,
    backgroundColor: selected ? theme.backgroundElement : theme.background }];
  const Container = embedded ? View : SafeAreaView;
  const startSelection = (photoId: string) => {
    if (controller.getSnapshot().busy || controller.getSnapshot().selecting) return;
    controller.toggleSelectionMode();
    controller.toggleSelected(photoId);
    if (Platform.OS === 'ios' && controller.getSnapshot().selectedPhotoIds.includes(photoId)) {
      // Optional tactile feedback must not block or undo a successful selection.
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };
  const renderPhoto = (item: AlbumEntry, index: number) => <Pressable key={item.photo.photoId} testID={`album-open-${index}`} accessibilityRole="button"
        accessibilityHint={state.selecting ? '長押しで選択モードを解除' : '長押しで複数選択'}
        accessibilityActions={[{ name: 'select', label: '写真を選択' }]}
        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'select') startSelection(item.photo.photoId); }}
        onLongPress={() => controller.getSnapshot().selecting ? controller.toggleSelectionMode() : startSelection(item.photo.photoId)}
        accessibilityLabel={state.selecting ? `写真 ${index + 1} を選択` : `写真 ${index + 1} を開く`}
        accessibilityState={state.selecting ? { selected: state.selectedPhotoIds.includes(item.photo.photoId) } : undefined}
        style={styles.tile} onPress={() => state.selecting ? controller.toggleSelected(item.photo.photoId) : controller.showPhoto(item.photo.photoId)}>
        <View style={styles.photoCard}>
          <View style={styles.photoShadow}>
            <Image testID={`album-grid-photo-${index}`} source={{ uri: item.photo.localUri! }} recyclingKey={item.photo.photoId}
              contentFit="contain" style={styles.tileImage} accessibilityLabel={`受信済み写真 ${index + 1}`} />
          </View>
        {state.selecting ? <View testID={`album-selection-${index}`} style={[styles.selectionMark,
          state.selectedPhotoIds.includes(item.photo.photoId) && styles.selectionMarkActive]}>
          <Text style={styles.selectionMarkText}>{state.selectedPhotoIds.includes(item.photo.photoId) ? '✓' : ''}</Text>
        </View> : <Pressable testID={`album-favorite-${index}`} accessibilityRole="button"
          accessibilityLabel={item.photo.favorite ? 'お気に入りを解除' : 'お気に入りに登録'}
          disabled={state.busy} style={styles.favorite} onPress={(event) => {
            event?.stopPropagation?.(); void controller.setFavorite(item.photo.photoId, !item.photo.favorite);
          }}>
          <SymbolView name={{ ios: item.photo.favorite ? 'heart.fill' : 'heart',
            android: item.photo.favorite ? 'favorite' : 'favorite_border',
            web: item.photo.favorite ? 'favorite' : 'favorite_border' }} size={21} tintColor="#fff" />
        </Pressable>}
        </View>
      </Pressable>;
  return <Container style={[styles.safe, backgroundProvided && styles.transparent]}>
    <View testID="album-display-tabs" style={styles.displayTabs}>
      {([{ id: 'second', label: 'Calendar', accessibilityLabel: '撮影カレンダー' },
        { id: 'list', label: 'Photos', accessibilityLabel: '写真一覧' }] as const).map((tab) =>
        <Pressable key={tab.id} testID={`album-display-${tab.id}`} accessibilityRole="tab"
          accessibilityLabel={tab.accessibilityLabel}
          accessibilityState={{ selected: displayTab === tab.id, disabled: state.busy || state.selecting }}
          disabled={state.busy || state.selecting} onPress={() => {
            clearDisplayFilters();
            changeDisplay(tab.id);
          }}
          style={[styles.displayTab, displayTab === tab.id && styles.displayTabActive]}>
          <Text style={[styles.displayTabLabel, displayTab === tab.id && styles.displayTabLabelActive]}>{tab.label}</Text>
        </Pressable>)}
    </View>
    <ScrollView ref={pager} testID="album-swipe-area" horizontal pagingEnabled directionalLockEnabled
      bounces={false} showsHorizontalScrollIndicator={false} style={styles.gridArea}
      contentContainerStyle={styles.pagerContent}
      scrollEnabled={!state.busy && !state.selecting && !searchOpen}
      contentOffset={{ x: initialDisplay === 'list' ? pageWidth : 0, y: 0 }}
      onLayout={(event) => { const nextWidth = event.nativeEvent.layout.width; if (nextWidth > 0 && nextWidth !== pageWidth) setPageWidth(nextWidth); }}
      onContentSizeChange={() => pager.current?.scrollTo({ x: displayTab === 'list' ? pageWidth : 0, animated: false })}
      onMomentumScrollEnd={(event) => {
        if (controller.getSnapshot().busy || controller.getSnapshot().selecting) return;
        const nextTab = event.nativeEvent.contentOffset.x >= pageWidth / 2 ? 'list' : 'second';
        if (nextTab !== displayTab) clearDisplayFilters();
        setDisplayTab(nextTab);
      }}>
      <View testID="album-calendar-page" style={[styles.pagerPage, { width: pageWidth }]}
        accessibilityElementsHidden={displayTab !== 'second'} importantForAccessibility={displayTab !== 'second' ? 'no-hide-descendants' : 'auto'}>
        <AlbumCalendar entries={filterAlbum(state.intakes, { ...state.filter, capturedDate: null, favoritesOnly })}
          onDate={(date) => { controller.setFilter({ capturedDate: date }); changeDisplay('list'); }} />
      </View>
      <View testID="album-photos-page" style={[styles.pagerPage, { width: pageWidth }]}
        accessibilityElementsHidden={displayTab !== 'list'} importantForAccessibility={displayTab !== 'list' ? 'no-hide-descendants' : 'auto'}>
      <FlatList testID="album-photo-grid" data={rows} keyExtractor={(row) => row.key} style={styles.grid}
      contentContainerStyle={styles.gridContent}
      ListEmptyComponent={!state.busy && favoritesOnly
        ? <Text testID="album-empty" style={ink}>お気に入りの受信済み写真はありません。</Text> : null}
      renderItem={({ item }) => item.kind === 'date'
        ? <Text testID={`album-date-${item.date}`} accessibilityRole="header" style={styles.dateHeading}>{item.date.replaceAll('-', '/')}</Text>
        : <View testID={`album-date-row-${item.key}`} style={styles.dateRow}>
          {item.items.map(({ entry, index }) => renderPhoto(entry, index))}
        </View>}
      />
      {state.busy && !state.favoritePhotoId && <ActivityIndicator testID="download-progress" accessibilityLabel="受取状況を確認中" style={styles.progressOverlay} />}
      {state.error && <Text testID="download-error" accessibilityRole="alert"
        style={[styles.errorOverlay, { color: theme.text, backgroundColor: theme.backgroundElement }]}>
        {state.selecting && state.error === 'Forbidden' ? '写真アプリへの保存が許可されていません。端末の設定から写真の追加を許可してください。'
          : state.selecting ? `選択した写真を処理できませんでした（${state.error}）。`
            : `受取状況を確認できませんでした（${state.error}）。`}
      </Text>}
      {state.batchMessage && <Text testID="album-batch-message" accessibilityRole="alert"
        style={[styles.batchMessage, { color: theme.text, backgroundColor: theme.backgroundElement }]}>{state.batchMessage}</Text>}
      {!state.selecting && <View testID="album-floating-controls" style={styles.floatingControls}>
        <Pressable testID="open-album-search" accessibilityRole="button" accessibilityLabel="写真を絞り込む"
          disabled={state.busy} style={styles.floatingIcon} onPress={() => controller.showSearch()}>
          <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={24} tintColor="#3185e5" />
        </Pressable>
        <Text testID="album-count" style={styles.floatingCount}>{photos.length}枚の写真</Text>
        <Pressable testID="album-sort" accessibilityRole="button"
          accessibilityLabel={oldestFirst ? '古い順、タップで新しい順に変更' : '新しい順、タップで古い順に変更'}
          style={styles.floatingIcon} onPress={() => setOldestFirst((value) => !value)}>
          <SymbolView name={{ ios: 'arrow.up.arrow.down', android: 'swap_vert', web: 'swap_vert' }} size={24} tintColor="#174d94" />
        </Pressable>
      </View>}
    </View>
    </ScrollView>
    {state.selecting ? <View style={[styles.toolbar, { backgroundColor: theme.backgroundElement }]}>
      <Pressable testID="album-selection-cancel" accessibilityRole="button" accessibilityLabel="写真の選択を終了"
        disabled={state.busy} style={styles.cancelSelection} onPress={() => controller.toggleSelectionMode()}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={theme.text} />
      </Pressable>
      <Text testID="album-selected-count" style={[styles.selectedCount, ink]}>{state.selectedPhotoIds.length}枚選択</Text>
      <Pressable testID="album-save-selected" accessibilityRole="button" disabled={state.busy || !state.selectedPhotoIds.length}
        style={[styles.batchButton, (state.busy || !state.selectedPhotoIds.length) && styles.disabled]}
        onPress={() => { void controller.saveSelectedToPhotoLibrary(); }}>
        <Text style={ink}>保存</Text>
      </Pressable>
      <Pressable testID="album-delete-selected" accessibilityRole="button" disabled={state.busy || !state.selectedPhotoIds.length}
        style={[styles.batchButton, (state.busy || !state.selectedPhotoIds.length) && styles.disabled]}
        onPress={() => setConfirmDelete(true)}><Text style={ink}>削除</Text></Pressable>
    </View> : null}
    <Modal testID="album-search-modal" visible={searchOpen} transparent animationType="slide"
      onRequestClose={() => controller.closeSearch()}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalPanel, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.subheading, ink]}>写真を検索</Text>
            <Pressable testID="search-close" accessibilityRole="button" accessibilityLabel="検索条件を閉じる"
              onPress={() => controller.closeSearch()}><Text style={ink}>閉じる</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={ink}>グループ</Text>
            <View style={styles.chips}>{groups.map(([id, name], index) => <Pressable key={id} testID={`search-group-${index}`}
              accessibilityRole="button" accessibilityState={{ selected: state.filter.groupId === id }} style={chip(state.filter.groupId === id)}
              onPress={() => controller.setFilter({ groupId: state.filter.groupId === id ? null : id })}>
              <Text style={ink}>{name}</Text></Pressable>)}</View>
            <Text style={ink}>参加アイドル</Text>
            <View style={styles.chips}>{idols.map(([id, name], index) => <Pressable key={id} testID={`search-idol-${index}`}
              accessibilityRole="button" accessibilityState={{ selected: state.filter.idolId === id }} style={chip(state.filter.idolId === id)}
              onPress={() => controller.setFilter({ idolId: state.filter.idolId === id ? null : id })}>
              <Text style={ink}>{name}</Text></Pressable>)}</View>
            <Text style={ink}>撮影日</Text>
            <View style={styles.chips}>{dates.map((date, index) => <Pressable key={date} testID={`search-date-${index}`}
              accessibilityRole="button" accessibilityState={{ selected: state.filter.capturedDate === date }} style={chip(state.filter.capturedDate === date)}
              onPress={() => controller.setFilter({ capturedDate: state.filter.capturedDate === date ? null : date })}>
              <Text style={ink}>{date}</Text></Pressable>)}</View>
            <Pressable testID="search-favorites-only" accessibilityRole="button" accessibilityState={{ selected: state.filter.favoritesOnly }}
              style={chip(state.filter.favoritesOnly)} onPress={() => controller.setFilter({ favoritesOnly: !state.filter.favoritesOnly })}>
              <Text style={ink}>お気に入りのみ</Text></Pressable>
            <Pressable testID="search-clear" accessibilityRole="button" onPress={() => controller.clearFilters()}>
              <Text style={ink}>条件をすべて解除</Text></Pressable>
            <Text testID="search-count" style={ink}>検索結果 {filtered.length}枚</Text>
          </ScrollView>
          <Pressable testID="search-apply" accessibilityRole="button" style={styles.apply}
            onPress={() => controller.closeSearch()}><Text style={styles.applyText}>写真を見る</Text></Pressable>
        </View>
      </View>
    </Modal>
    <Modal testID="album-delete-confirm" visible={confirmDelete} transparent animationType="fade"
      onRequestClose={() => setConfirmDelete(false)}>
      <View style={styles.confirmBackdrop}><View style={[styles.confirmPanel, { backgroundColor: theme.background }]}>
        <Text style={[styles.subheading, ink]}>選択した{state.selectedPhotoIds.length}枚をアプリ内から削除しますか？</Text>
        <Text style={ink}>削除後は再受信できません。写真アプリに保存済みのコピーは削除されません。</Text>
        <View style={styles.confirmActions}>
          <Pressable testID="album-delete-cancel" accessibilityRole="button" onPress={() => setConfirmDelete(false)}>
            <Text style={ink}>キャンセル</Text></Pressable>
          <Pressable testID="album-delete-confirm-action" accessibilityRole="button" onPress={() => {
            setConfirmDelete(false); void controller.deleteSelected();
          }}><Text style={styles.deleteText}>削除する</Text></Pressable>
        </View>
      </View></View>
    </Modal>
  </Container>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f9ff' },
  transparent: { backgroundColor: 'transparent' },
  displayTabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce9f7' },
  displayTab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  displayTabActive: { borderBottomColor: '#3185e5' },
  displayTabLabel: { color: '#8ba2bd', fontSize: 18, lineHeight: 28, letterSpacing: 0.3,
    fontFamily: Platform.select({ ios: 'AvenirNext-MediumItalic', android: 'sans-serif', default: 'sans-serif' }),
    fontStyle: Platform.OS === 'ios' ? 'normal' : 'italic',
    fontWeight: '400' }, displayTabLabelActive: { color: '#3185e5' },
  gridArea: { flex: 1 }, grid: { flex: 1 },
  pagerContent: { height: '100%' }, pagerPage: { height: '100%', flexShrink: 0 },
  progressOverlay: { position: 'absolute', top: 12, alignSelf: 'center' },
  errorOverlay: { position: 'absolute', top: 8, left: 12, right: 12, padding: 10, borderRadius: 8, zIndex: 1 },
  batchMessage: { position: 'absolute', bottom: 8, left: 12, right: 12, padding: 10, borderRadius: 8, zIndex: 1 },
  floatingControls: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    gap: 12, padding: 7, borderRadius: 40, backgroundColor: '#fff', maxWidth: '94%',
    shadowColor: '#244b6c', shadowOpacity: 0.13, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  floatingIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#eff8fc', alignItems: 'center', justifyContent: 'center' },
  floatingCount: { color: '#174d94', fontSize: 16, fontWeight: '600', flexShrink: 1, textAlign: 'center', minWidth: 86 },
  dateHeading: { color: '#174d94', fontSize: 16, fontWeight: '600', paddingHorizontal: 8, paddingTop: 14, paddingBottom: 6 },
  dateRow: { flexDirection: 'row' },
  gridContent: { paddingHorizontal: 6, paddingTop: 6, paddingBottom: 100 },
  tile: { width: '33.333333%', padding: 6 },
  photoCard: { width: '100%', aspectRatio: 1, borderRadius: 20, backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#dbe7f3',
    alignItems: 'center', justifyContent: 'center', position: 'relative' },
  photoShadow: { height: '82%', aspectRatio: 54 / 86, backgroundColor: '#fff',
    shadowColor: '#172330', shadowOpacity: 0.23, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  tileImage: { width: '100%', height: '100%', borderWidth: StyleSheet.hairlineWidth, borderColor: '#d9dde3' },
  favorite: { position: 'absolute', right: 5, bottom: 5,
    backgroundColor: '#0008', borderRadius: 18, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  selectionMark: { position: 'absolute', right: 6, top: 6, width: 25, height: 25, borderRadius: 13,
    borderWidth: 2, borderColor: '#fff', backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center' },
  selectionMarkActive: { backgroundColor: '#174c8f' }, selectionMarkText: { color: '#fff', fontWeight: '700' },
  subheading: { fontSize: 18, fontWeight: '700' }, toolbar: { flexDirection: 'row', gap: 12, padding: 12 },
  selectedCount: { alignSelf: 'center' }, batchButton: { flex: 1, alignItems: 'center', justifyContent: 'center',
    minHeight: 44, borderRadius: 22, backgroundColor: '#7774', paddingHorizontal: 8 }, disabled: { opacity: 0.5 },
  cancelSelection: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  confirmBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 },
  confirmPanel: { padding: 20, borderRadius: 14, gap: 18 },
  confirmActions: { flexDirection: 'row', justifyContent: 'space-between', padding: 10 }, deleteText: { color: '#b42318', fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  modalPanel: { maxHeight: '85%', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalContent: { gap: 14, paddingBottom: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderRadius: 20 },
  apply: { backgroundColor: '#174c8f', padding: 14, alignItems: 'center', borderRadius: 9 },
  applyText: { color: '#fff', fontWeight: '700' },
});
