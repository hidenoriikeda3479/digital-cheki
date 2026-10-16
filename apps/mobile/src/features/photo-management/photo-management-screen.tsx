import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoViewer } from '@/components/photo-viewer';
import { toAppError } from '@/core/errors';
import { localCaptureDate } from '@/features/download/album-filter';
import type { LocalPhotoManagementService, ManagedIntake, ManagedPhoto } from '@/services/contracts/photo-management';
import { useTheme } from '@/hooks/use-theme';

const visiblePhotos = (intake: ManagedIntake) => intake.photos.filter((item) => !item.localDeleted || item.deletionPending);
const latestCapture = (intake: ManagedIntake) => visiblePhotos(intake).reduce((latest, item) =>
  Math.max(latest, Date.parse(item.photo.capturedAt)), 0);
const captureDateTime = (instant: string) => {
  const value = new Date(instant);
  return {
    date: value.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }),
    time: value.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
  };
};

export function PhotoManagementScreen({ credential, service, onBack }: { credential: string; service: LocalPhotoManagementService; onBack(): void }) {
  const theme = useTheme();
  const ink = { color: theme.text };
  const [intakes, setIntakes] = useState<ManagedIntake[]>([]);
  const [lowSpace, setLowSpace] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [idolId, setIdolId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIntakeIds, setSelectedIntakeIds] = useState<string[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [confirmBatch, setConfirmBatch] = useState<'send' | 'delete' | null>(null);
  const [viewerFromCover, setViewerFromCover] = useState(false);
  const batchInFlight = useRef(false);
  useEffect(() => { let active = true;
    service.list(credential).then((value) => { if (active) { setIntakes(value.intakes); setLowSpace(value.lowSpace); } })
      .catch((cause) => { if (active) setError(toAppError(cause).message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [credential, service]);
  async function refresh() {
    const next = await service.list(credential);
    setIntakes(next.intakes); setLowSpace(next.lowSpace);
  }
  async function retry(intake: ManagedIntake) {
    if (busy || intake.uploadStatus === 'uploaded') return;
    setBusy(true); setError('');
    try {
      const result = await service.retryUpload(credential, intake.intake.id);
      await refresh();
      if (result.status === 'failed') setError('送信できませんでした。受付の×から手動で再送できます。');
      if (result.status === 'unknown') setError('送信結果を確認できませんでした。再送前にもう一度照会してください。');
    } catch (cause) { setError(toAppError(cause).message); try { await refresh(); } catch { /* Retry keeps the original error. */ } }
    finally { setBusy(false); }
  }
  const available = intakes.filter((intake) => visiblePhotos(intake).length > 0);
  const idolChoices = [...new Map(available.flatMap((intake) => intake.intake.idolIds.map((id, index) =>
    [id, intake.idolNames[index] ?? id] as const))).entries()];
  const dateChoices = [...new Set(available.flatMap((intake) => visiblePhotos(intake).map((item) =>
    localCaptureDate(item.photo.capturedAt))))].filter(Boolean).sort().reverse();
  const filtered = available.filter((intake) => (!idolId || intake.intake.idolIds.includes(idolId)) &&
    (!date || visiblePhotos(intake).some((item) => localCaptureDate(item.photo.capturedAt) === date)))
    .sort((a, b) => (latestCapture(b) - latestCapture(a)) * (oldestFirst ? -1 : 1) || a.intake.id.localeCompare(b.intake.id));
  const selectedIntake = intakeId ? intakes.find((item) => item.intake.id === intakeId) : null;
  const selectedPhotos = selectedIntake ? visiblePhotos(selectedIntake).filter((item) =>
    !date || localCaptureDate(item.photo.capturedAt) === date)
    .sort((a, b) => (Date.parse(b.photo.capturedAt) - Date.parse(a.photo.capturedAt)) * (oldestFirst ? -1 : 1) ||
      a.photo.id.localeCompare(b.photo.id)) : [];
  const selectedPhoto = photoId ? selectedIntake?.photos.find((item) => item.photo.id === photoId) : null;
  const viewerPhotos = selectedPhotos.filter((item) => !item.deletionPending);
  const viewerTime = selectedPhoto ? captureDateTime(selectedPhoto.photo.capturedAt) : null;
  const selectedIntakes = filtered.filter((item) => selectedIntakeIds.includes(item.intake.id));
  const batchIntakes = selectedIntake ? [selectedIntake] : selectedIntakes;
  const batchPhotos = selectedIntake
    ? selectedPhotos.filter((item) => selectedPhotoIds.includes(item.photo.id))
    : selectedIntakes.flatMap(visiblePhotos);
  const selectedCount = selectedIntake ? selectedPhotoIds.length : selectedIntakeIds.length;
  const canSend = selectedCount > 0 && batchIntakes.every((item) => item.uploadStatus !== 'uploaded');
  const canDelete = selectedCount > 0 && batchIntakes.every((item) => item.uploadStatus === 'uploaded');
  function clearSelection() { setSelecting(false); setSelectedIntakeIds([]); setSelectedPhotoIds([]); setConfirmBatch(null); }
  function openPhoto(item: ManagedPhoto, fromCover = false) {
    setPhotoId(item.photo.id); setViewerFromCover(fromCover);
  }
  function closePhoto() {
    setPhotoId(null);
    if (viewerFromCover) setIntakeId(null);
    setViewerFromCover(false);
  }
  async function runBatch() {
    if (!confirmBatch || busy || batchInFlight.current || !selectedCount) return;
    const operation = confirmBatch;
    const intakesToSend = [...batchIntakes];
    const photosToDelete = [...batchPhotos];
    if ((operation === 'send' && !canSend) || (operation === 'delete' && !canDelete)) return;
    batchInFlight.current = true; setConfirmBatch(null); setBusy(true); setError('');
    try {
      if (operation === 'send') {
        for (const item of intakesToSend) {
          const result = await service.retryUpload(credential, item.intake.id);
          if (result.status !== 'uploaded') throw new Error(result.status === 'unknown'
            ? '送信結果を確認できませんでした。結果を照会してください。' : '送信できませんでした。残りは手動で再操作してください。');
          setSelectedIntakeIds((ids) => ids.filter((id) => id !== item.intake.id));
        }
      } else {
        if (service.deleteUploadedBatch) await service.deleteUploadedBatch(credential, photosToDelete.map((item) => ({
          intakeId: item.photo.intakeId, photoId: item.photo.id,
        })));
        else for (const item of photosToDelete) await service.deleteUploaded(credential, item.photo.intakeId, item.photo.id);
        setSelectedIntakeIds([]);
      }
      clearSelection();
    } catch (cause) { setError(toAppError(cause).message); }
    finally {
      try { await refresh(); } catch (cause) { setError(toAppError(cause).message); }
      batchInFlight.current = false; setBusy(false);
    }
  }
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
    <View style={styles.header}>
      <Pressable testID="management-back" accessibilityRole="button" disabled={busy}
        onPress={() => { if (selecting) clearSelection(); else if (intakeId) setIntakeId(null); else onBack(); }}><Text style={ink}>戻る</Text></Pressable>
      <View style={styles.headerSpacer} />
      <Pressable testID="management-select-mode" accessibilityRole="button" disabled={busy}
        style={styles.iconButton} onPress={() => selecting ? clearSelection() : setSelecting(true)}>
        <Text style={ink}>{selecting ? 'キャンセル' : '選択'}</Text>
      </Pressable>
      {!selecting && <Pressable testID="management-search" accessibilityRole="button" accessibilityLabel="写真を検索" style={styles.iconButton}
        onPress={() => setSearchOpen(true)}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={23} tintColor={theme.text} />
      </Pressable>}
    </View>
    {(!busy || intakes.length > 0) && <Text style={ink}>
      {selectedIntake ? `${selectedPhotos.length}枚の写真` : `${filtered.length}件の撮影受付`}</Text>}
    {lowSpace && <Text testID="low-space-warning" accessibilityRole="alert" style={ink}>端末の空き容量が少なくなっています。不要な送信済み写真を選んで整理してください。</Text>}
    {error ? <Text testID="management-error" accessibilityRole="alert" style={ink}>{error}</Text> : null}
    {selectedIntake ? <FlatList testID="management-photo-grid" data={selectedPhotos}
      keyExtractor={(item) => item.photo.id} numColumns={3} initialNumToRender={9} maxToRenderPerBatch={9}
      contentContainerStyle={styles.grid} ListEmptyComponent={busy ? null : <Text style={ink}>条件に合う写真はありません。</Text>}
      renderItem={({ item }) => <Pressable testID={`management-photo-${item.photo.id}`} accessibilityRole="button"
        accessibilityLabel={selecting ? '写真を選択' : '写真を全画面で開く'}
        accessibilityState={selecting ? { selected: selectedPhotoIds.includes(item.photo.id) } : undefined}
        style={styles.tile} onPress={() => selecting
          ? setSelectedPhotoIds((ids) => ids.includes(item.photo.id) ? ids.filter((id) => id !== item.photo.id) : [...ids, item.photo.id])
          : openPhoto(item)}>
        <View style={styles.square}>{item.deletionPending
          ? <View style={[styles.missing, { backgroundColor: theme.backgroundElement }]}><Text style={ink}>削除を再開</Text></View>
          : <Image source={{ uri: item.displayUri ?? item.photo.thumbnailUri }} recyclingKey={item.photo.id} contentFit="cover" style={styles.fill} />}
          {selecting && <View testID={`management-selected-${item.photo.id}`} style={[styles.selectionMark,
            selectedPhotoIds.includes(item.photo.id) && styles.selectionMarkActive]}><Text style={styles.selectionText}>
            {selectedPhotoIds.includes(item.photo.id) ? '✓' : ''}</Text></View>}</View>
      </Pressable>} />
      : <FlatList testID="management-intake-grid" data={filtered} keyExtractor={(item) => item.intake.id}
        numColumns={3} initialNumToRender={9} maxToRenderPerBatch={9} contentContainerStyle={styles.grid}
        ListEmptyComponent={busy ? null : <Text style={ink}>条件に合う端末写真はありません。</Text>}
        renderItem={({ item }) => {
          const photos = visiblePhotos(item);
          const cover = photos.find((photo) => !photo.deletionPending);
          const behind = photos.find((photo) => photo !== cover && !photo.deletionPending);
          const uploaded = item.uploadStatus === 'uploaded';
          return <Pressable testID={`management-intake-${item.intake.id}`} accessibilityRole="button"
            accessibilityLabel={`撮影受付、${photos.length}枚${selecting ? 'を選択' : ''}`}
            accessibilityState={selecting ? { selected: selectedIntakeIds.includes(item.intake.id) } : undefined}
            style={styles.tile} onPress={() => {
              if (selecting) setSelectedIntakeIds((ids) => ids.includes(item.intake.id)
                ? ids.filter((id) => id !== item.intake.id) : [...ids, item.intake.id]);
              else { setIntakeId(item.intake.id); if (photos.length === 1) openPhoto(photos[0], true); }
            }}>
            <View style={styles.square}>
              {behind && <Image source={{ uri: behind.displayUri ?? behind.photo.thumbnailUri }} recyclingKey={behind.photo.id}
                contentFit="cover" style={styles.backImage} />}
              {cover ? <Image source={{ uri: cover.displayUri ?? cover.photo.thumbnailUri }} recyclingKey={cover.photo.id}
                contentFit="cover" style={[styles.coverImage, photos.length > 1 && styles.stackedCover]} />
                : <View style={[styles.missing, { backgroundColor: theme.backgroundElement }]}><Text style={ink}>削除を再開</Text></View>}
              {photos.length > 1 && <View testID={`management-count-${item.intake.id}`} style={styles.countBadge}>
                <Text style={styles.countText}>{photos.length}枚</Text></View>}
              {selecting ? <View testID={`management-selected-${item.intake.id}`} style={[styles.selectionMark,
                selectedIntakeIds.includes(item.intake.id) && styles.selectionMarkActive]}><Text style={styles.selectionText}>
                  {selectedIntakeIds.includes(item.intake.id) ? '✓' : ''}</Text></View> : <Pressable testID={`management-status-${item.intake.id}`} accessibilityRole="button"
                accessibilityLabel={uploaded ? '送信済み' : item.uploadStatus === 'unknown' ? '送信結果を照会' : '受付を送信・再送'}
                disabled={busy || uploaded} style={styles.statusBadge} onPress={(event) => {
                  event?.stopPropagation?.(); void retry(item);
                }}>
                <SymbolView name={{ ios: uploaded ? 'checkmark.circle.fill' : 'xmark.circle.fill',
                  android: uploaded ? 'check_circle' : 'cancel', web: uploaded ? 'check_circle' : 'cancel' }}
                  size={23} tintColor={uploaded ? '#18794e' : '#b3261e'} />
              </Pressable>}
            </View>
          </Pressable>;
        }} />}
    {selecting ? <View style={[styles.toolbar, styles.selectionToolbar, { backgroundColor: theme.backgroundElement }]}>
      <Text testID="management-selected-count" style={[styles.selectedCount, ink]}>{selectedCount}{selectedIntake ? '枚' : '件'}選択</Text>
      <Pressable testID="management-send-selected" accessibilityRole="button" disabled={busy || !canSend}
        style={[styles.batchButton, (busy || !canSend) && styles.disabled]} onPress={() => setConfirmBatch('send')}>
        <Text style={ink}>送信</Text></Pressable>
      <Pressable testID="management-delete-selected" accessibilityRole="button" disabled={busy || !canDelete}
        style={[styles.batchButton, (busy || !canDelete) && styles.disabled]} onPress={() => setConfirmBatch('delete')}>
        <Text style={ink}>削除</Text></Pressable>
    </View> : <View style={[styles.toolbar, { backgroundColor: theme.backgroundElement }]}>
      <Pressable testID="management-sort" accessibilityRole="button" style={styles.sortButton}
        onPress={() => setOldestFirst((value) => !value)}><Text style={ink}>撮影日：{oldestFirst ? '古い順' : '新しい順'}</Text></Pressable>
    </View>}
    <Modal testID="management-batch-confirm" visible={!!confirmBatch} transparent animationType="fade"
      onRequestClose={() => setConfirmBatch(null)}>
      <View style={styles.confirmBackdrop}><View style={[styles.confirmPanel, { backgroundColor: theme.background }]}>
        <Text style={ink}>{confirmBatch === 'send'
          ? `選択した${batchIntakes.length}件の撮影受付を送信しますか？各受付の写真をまとめて送信します。`
          : `選択した${batchPhotos.length}枚の送信済み端末写真を削除しますか？受信済み写真と送信履歴は残ります。`}</Text>
        <View style={styles.confirmActions}>
          <Pressable testID="management-batch-cancel" accessibilityRole="button" disabled={busy}
            onPress={() => setConfirmBatch(null)}>
            <Text style={ink}>キャンセル</Text></Pressable>
          <Pressable testID="management-batch-run" accessibilityRole="button" disabled={busy}
            onPress={() => { void runBatch(); }}>
            <Text style={ink}>{confirmBatch === 'send' ? '送信する' : '削除する'}</Text></Pressable>
        </View>
      </View></View>
    </Modal>
    <Modal testID="management-search-modal" visible={searchOpen} transparent animationType="slide"
      onRequestClose={() => setSearchOpen(false)}>
      <View style={styles.searchBackdrop}><SafeAreaView style={[styles.searchPanel, { backgroundColor: theme.background }]}>
        <View style={styles.searchHeader}><Text style={[styles.title, ink]}>写真を検索</Text>
          <Pressable testID="management-search-close" accessibilityRole="button" onPress={() => setSearchOpen(false)}>
            <Text style={ink}>閉じる</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.searchContent}>
          <Text style={ink}>参加アイドル</Text>
          <View style={styles.choices}>{idolChoices.map(([id, name]) => <Pressable key={id} testID={`management-idol-${id}`}
            accessibilityRole="button" accessibilityState={{ selected: idolId === id }} style={styles.choice}
            onPress={() => setIdolId(idolId === id ? null : id)}><Text style={ink}>{name}</Text></Pressable>)}</View>
          <Text style={ink}>撮影日</Text>
          <View style={styles.choices}>{dateChoices.map((value) => <Pressable key={value} testID={`management-date-${value}`}
            accessibilityRole="button" accessibilityState={{ selected: date === value }} style={styles.choice}
            onPress={() => setDate(date === value ? null : value)}><Text style={ink}>{value}</Text></Pressable>)}</View>
          <Pressable testID="management-search-clear" accessibilityRole="button" onPress={() => { setIdolId(null); setDate(null); }}>
            <Text style={ink}>条件をすべて解除</Text></Pressable>
        </ScrollView>
        <Pressable testID="management-search-apply" accessibilityRole="button" style={styles.applyButton}
          onPress={() => { if (selectedIntake && !filtered.some((item) => item.intake.id === selectedIntake.intake.id)) setIntakeId(null);
            setSearchOpen(false); }}><Text style={styles.applyText}>結果を表示</Text></Pressable>
      </SafeAreaView></View>
    </Modal>
    <PhotoViewer visible={!!selectedPhoto} onClose={closePhoto}
      photo={selectedPhoto && !selectedPhoto.deletionPending ? { id: selectedPhoto.photo.id,
        uri: selectedPhoto.displayUri ?? selectedPhoto.photo.originalUri,
        thumbnailUri: selectedPhoto.displayUri ?? selectedPhoto.photo.thumbnailUri } : null}
      photos={viewerPhotos.map((item) => ({ id: item.photo.id,
        uri: item.displayUri ?? item.photo.originalUri,
        thumbnailUri: item.displayUri ?? item.photo.thumbnailUri,
        label: captureDateTime(item.photo.capturedAt).time }))}
      onSelect={(id) => { const item = viewerPhotos.find((entry) => entry.photo.id === id); if (item) openPhoto(item); }}
      date={viewerTime?.date} details={viewerTime && selectedIntake ? `${viewerTime.time} ・ ${selectedIntake.recipientName}` : undefined}
      placeholder="削除を再開してください。"
      ids={{ modal: 'management-photo-modal', safe: 'management-viewer-safe', close: 'management-photo-close',
        image: 'management-full-image', date: 'management-photo-date', details: 'management-photo-details',
        filmstrip: 'management-filmstrip', filmPrefix: 'management-film-' }} />
    {busy && <View testID="management-busy-overlay" pointerEvents="none" style={styles.loadingOverlay}>
      <View style={styles.loadingBadge}><ActivityIndicator testID="management-busy"
        accessibilityLabel="端末写真を確認中" color="#174c8f" /></View>
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, padding: 16, gap: 12 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  loadingOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  loadingBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', flex: 1 }, headerSpacer: { flex: 1 },
  iconButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  grid: { paddingBottom: 24 }, tile: { width: '33.33%', padding: 3 }, square: { width: '100%', aspectRatio: 1, position: 'relative' },
  fill: { width: '100%', height: '100%', borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#3d4450' },
  coverImage: { position: 'absolute', width: '100%', height: '100%', borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#3d4450' },
  stackedCover: { width: '88%', height: '88%', left: 0, bottom: 0 },
  backImage: { position: 'absolute', width: '88%', height: '88%', right: 0, top: 0, borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#3d4450' },
  missing: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', padding: 6, borderRadius: 6 },
  statusBadge: { position: 'absolute', right: 5, bottom: 5, backgroundColor: '#fff', borderRadius: 14, width: 28, height: 28,
    alignItems: 'center', justifyContent: 'center' },
  countBadge: { position: 'absolute', left: 5, bottom: 5, backgroundColor: '#202124cc', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  countText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  toolbar: { minHeight: 48, justifyContent: 'center', borderRadius: 12 }, sortButton: { padding: 12, alignItems: 'center' },
  selectionToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  selectedCount: { flex: 1, minWidth: 0, textAlign: 'center' },
  batchButton: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.4 },
  selectionMark: { position: 'absolute', right: 6, top: 6, width: 25, height: 25, borderRadius: 13,
    borderColor: '#fff', borderWidth: 2, backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center' },
  selectionMarkActive: { backgroundColor: '#174c8f' }, selectionText: { color: '#fff', fontWeight: '700' },
  confirmBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 },
  confirmPanel: { padding: 20, borderRadius: 14, gap: 18 },
  confirmActions: { flexDirection: 'row', justifyContent: 'space-between', padding: 10 },
  searchBackdrop: { flex: 1, backgroundColor: '#0007', justifyContent: 'flex-end' },
  searchPanel: { maxHeight: '78%', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, gap: 14 },
  searchHeader: { flexDirection: 'row', alignItems: 'center' }, searchContent: { gap: 14, paddingBottom: 18 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderColor: '#888', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  applyButton: { padding: 14, borderRadius: 8, backgroundColor: '#174c8f', alignItems: 'center' }, applyText: { color: '#fff', fontWeight: '600' },
});
