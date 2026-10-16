import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';

import type { CaptureController } from './capture-controller';
import { CaptureCamera } from './capture-camera';
import type { EditingController } from '@/features/editing/editing-controller';
import { EditingScreen } from '@/features/editing/editing-screen';
import type { FinishedImageController } from '@/features/finished-image/finished-image-controller';
import type { BatchUploadController, BatchUploadState } from '@/features/upload/batch-upload-controller';
import { CHEKI_MINI } from '@/features/editing/cheki-format';

const closedUpload: BatchUploadState = { intakeId: null, snapshot: null, busy: false, error: null };
const noUploadSubscription = () => () => {};
const getClosedUpload = () => closedUpload;

export function CaptureScreen({ controller, editing, finishedImage, upload, onHome, onSent }: { controller: CaptureController; editing: EditingController; finishedImage: FinishedImageController; upload?: BatchUploadController; onHome?: () => void; onSent(): void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const editingState = useSyncExternalStore(editing.subscribe, editing.getSnapshot, editing.getSnapshot);
  const finishedState = useSyncExternalStore(finishedImage.subscribe, finishedImage.getSnapshot, finishedImage.getSnapshot);
  const uploadState = useSyncExternalStore(upload?.subscribe ?? noUploadSubscription, upload?.getSnapshot ?? getClosedUpload);
  const theme = useTheme();
  const sending = useRef(false);
  const [sendConfirmation, setSendConfirmation] = useState<{ intakeId: string; photoIds: string } | null>(null);
  const confirmed = state.confirmed || (!!state.intakeId && finishedState.lastConfirmedIntakeId === state.intakeId);
  const currentUpload = state.intakeId && uploadState.intakeId === state.intakeId ? uploadState : closedUpload;
  const currentFinished = state.intakeId && finishedState.intakeId === state.intakeId ? finishedState : null;
  const photoIds = state.photos.map((photo) => photo.id).join('|');
  const sendPreview = currentFinished?.preview;
  const previewReady = !!sendPreview && sendPreview.images.length === state.photos.length && state.photos.length > 0 &&
    sendPreview.images.map((image) => image.photoId).join('|') === photoIds && sendPreview.images.every((image) => !!image.uri);
  const confirmationVisible = state.phase === 'review' && !!sendConfirmation && sendConfirmation.intakeId === state.intakeId &&
    sendConfirmation.photoIds === photoIds && previewReady;
  useEffect(() => {
    if (upload && state.intakeId && confirmed && !sending.current && upload.getSnapshot().intakeId !== state.intakeId)
      void upload.open(state.intakeId);
  }, [upload, state.intakeId, confirmed]);
  useEffect(() => {
    if (state.phase !== 'review' || !state.intakeId || !state.photos.length || editingState.photo ||
        currentFinished?.busy || currentFinished?.error) return;
    const ready = currentFinished?.preview?.images.map((image) => image.photoId).join('|') === photoIds;
    if (!ready) void finishedImage.open(state.intakeId);
  }, [state.phase, state.intakeId, state.photos.length, photoIds, editingState.photo, currentFinished?.busy, currentFinished?.error,
    currentFinished?.preview, finishedImage]);
  const ink = { color: theme.text };
  async function sendIntake() {
    const current = controller.getSnapshot();
    if (sending.current || !confirmationVisible || !upload || !state.intakeId ||
      current.phase !== 'review' || current.intakeId !== sendConfirmation?.intakeId ||
      current.photos.map((photo) => photo.id).join('|') !== sendConfirmation.photoIds) return;
    sending.current = true;
    setSendConfirmation(null);
    try {
      if (!confirmed && !(await finishedImage.confirmIntake(state.intakeId))) return;
      if (upload.getSnapshot().intakeId !== state.intakeId || !upload.getSnapshot().snapshot)
        await upload.open(state.intakeId);
      if (upload.getSnapshot().intakeId === state.intakeId && upload.getSnapshot().snapshot)
        await upload.send();
      if (controller.getSnapshot().phase === 'review' && controller.getSnapshot().intakeId === state.intakeId &&
          upload.getSnapshot().intakeId === state.intakeId && upload.getSnapshot().snapshot?.status === 'uploaded') onSent();
    } catch {
      // A credential switch invalidates the pending action without showing its result to the next user.
    } finally { sending.current = false; }
  }
  const editedPhoto = editingState.photo;
  if (editedPhoto) return <EditingScreen controller={editing} photos={state.photos}
    onComplete={() => finishedImage.open(editedPhoto.intakeId)} />;
  if (state.phase === 'camera') return <SafeAreaView style={styles.cameraSafe}>
    <CaptureCamera busy={state.busy} onCapture={(source) => controller.capture(source)} onReview={() => controller.showReview()} />
    {state.busy && <ActivityIndicator testID="capture-progress" accessibilityLabel="写真を保存・確認中" style={styles.cameraProgress} color="#fff" />}
    {state.error && <Text testID="capture-error" accessibilityRole="alert" style={styles.cameraError}>
      {state.error === 'Storage' ? '写真を保存できませんでした。空き容量を確認し、ホームから新しい受付を始めてください。' : '撮影処理を完了できませんでした。'}</Text>}
  </SafeAreaView>;
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
    <View style={styles.page}>
      <Pressable testID="capture-home" accessibilityRole="button" disabled={state.busy}
        onPress={() => { controller.goHome(); onHome?.(); }}><Text style={ink}>グループホームへ戻る</Text></Pressable>
      {state.phase === 'review' && <>
        <View style={styles.headingRow}>
          <Text style={[styles.heading, ink]}>撮影した写真</Text>
          <View testID="capture-heading-actions" style={styles.headingActions}>
            {!confirmed && <Pressable testID="add-photo" accessibilityRole="button" accessibilityLabel="写真を追加撮影"
              disabled={state.busy || currentFinished?.busy || currentUpload.busy || !!state.error}
              onPress={() => controller.openCamera()} style={styles.iconButton}>
              <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={27} tintColor={theme.text} />
            </Pressable>}
            {upload && currentUpload.snapshot?.status !== 'uploaded' && currentUpload.snapshot?.status !== 'unknown' &&
              <Pressable testID="send-batch" accessibilityRole="button"
                accessibilityLabel={currentUpload.snapshot?.status === 'failed' ? '写真を再送' : '写真を送信'}
                disabled={state.busy || currentFinished?.busy || currentUpload.busy || !previewReady}
                style={[styles.iconButton, (state.busy || currentFinished?.busy || currentUpload.busy || !previewReady) && styles.disabled]}
                onPress={() => { if (state.intakeId && previewReady) setSendConfirmation({ intakeId: state.intakeId, photoIds }); }}>
                <SymbolView name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }} size={25} tintColor={theme.text} />
              </Pressable>}
          </View>
        </View>
        <Text testID="photo-count" style={ink}>採用写真：{state.photos.length}枚</Text>
        {confirmed && <Text testID="intake-send-confirmed" style={ink}>送信対象は確定済みです。</Text>}
        {currentUpload.snapshot?.status === 'failed' && <Text testID="batch-upload-failed" accessibilityRole="alert" style={ink}>送信できませんでした。通信・空き容量を確認して、受付単位で手動再送できます。</Text>}
        {currentUpload.snapshot?.status === 'unknown' && <Text testID="batch-upload-unknown" style={ink}>送信結果が不明です。再送前に結果を照会してください。</Text>}
        {currentFinished?.error && <Text testID="finished-error" accessibilityRole="alert" style={ink}>完成画像を生成・確定できませんでした（{currentFinished.error}）。</Text>}
        {currentFinished?.error && state.intakeId && <Pressable testID="retry-local-preview" accessibilityRole="button"
          onPress={() => { if (state.intakeId) void finishedImage.open(state.intakeId); }}><Text style={ink}>完成画像を再表示</Text></Pressable>}
        {currentUpload.error && <Text testID="upload-error" accessibilityRole="alert" style={ink}>送信状態を確認できませんでした（{currentUpload.error}）。</Text>}
        {currentUpload.busy || currentFinished?.busy ? <ScreenProgress testID="batch-upload-progress" label="写真をまとめて送信中" /> : null}
        {upload && currentUpload.snapshot?.status === 'unknown' && <Pressable testID="query-batch" accessibilityRole="button"
          disabled={currentUpload.busy} style={styles.button} onPress={() => { void upload.query(); }}><Text style={styles.buttonText}>送信結果を照会</Text></Pressable>}
        <FlatList testID="photo-list" data={state.photos} keyExtractor={(photo) => photo.id} numColumns={3}
          initialNumToRender={6} maxToRenderPerBatch={6} windowSize={3}
          ListEmptyComponent={<Text style={ink}>保存済み写真はありません。</Text>}
          renderItem={({ item }) => <View style={styles.tile}>
            <Pressable testID={`photo-${item.id}`} accessibilityLabel="写真を編集" accessibilityRole="button"
              style={styles.thumbnailMat}
              disabled={state.busy || currentFinished?.busy || currentUpload.busy || confirmed} onPress={() => { void editing.open(item); }}>
              <Image source={{ uri: currentFinished?.preview?.images.find((image) => image.photoId === item.id)?.uri || item.thumbnailUri }}
                style={styles.thumbnail} contentFit="cover" recyclingKey={`${item.id}-${currentFinished?.preview?.images.find((image) => image.photoId === item.id)?.editRevision ?? 'raw'}`} />
            </Pressable>
            {!confirmed && <Pressable testID={`discard-photo-${item.id}`} accessibilityRole="button" accessibilityLabel="写真を削除"
              disabled={state.busy || currentFinished?.busy || currentUpload.busy} style={[styles.photoIcon, styles.deleteIcon]}
              onPress={() => { void controller.discard(item.id); }}>
              <SymbolView name={{ ios: 'minus.circle.fill', android: 'remove_circle', web: 'remove_circle' }} size={23} tintColor="#b3261e" />
            </Pressable>}
          </View>} />
      </>}
      {state.busy && <ScreenProgress testID="capture-progress" label="写真を保存・確認中" />}
      {state.error && <Text testID="capture-error" accessibilityRole="alert" style={ink}>
        {state.error === 'Storage' ? '写真を保存できませんでした。空き容量を確認し、ホームから新しい受付を始めてください。' : '撮影処理を完了できませんでした。'}</Text>}
    </View>
    {confirmationVisible && <Modal visible transparent animationType="fade" onRequestClose={() => setSendConfirmation(null)}>
      <View style={styles.confirmBackdrop}>
        <View testID="batch-send-confirmation" style={[styles.confirmPanel, { backgroundColor: theme.background }]}>
          <Text style={[styles.heading, ink]}>{currentUpload.snapshot?.status === 'failed' ? 'まとめて再送しますか？' : 'まとめて送信しますか？'}</Text>
          <Text testID="confirm-recipient" style={ink}>送信先：{sendPreview?.recipientLabel}</Text>
          <Text testID="confirm-idols" style={ink}>アイドル：{sendPreview?.idolNames.join('、')}</Text>
          <Text style={ink}>対象写真：{sendPreview?.images.length}枚</Text>
          <FlatList data={sendPreview?.images ?? []} keyExtractor={(image) => image.photoId} horizontal
            style={styles.confirmPhotos} contentContainerStyle={styles.confirmPhotoRow}
            initialNumToRender={4} maxToRenderPerBatch={4} windowSize={3}
            renderItem={({ item, index }) => <Image testID={`confirm-photo-${index}`} source={{ uri: item.uri }}
              contentFit="contain" style={styles.confirmPhoto} />} />
          <View style={styles.confirmActions}>
            <Pressable testID="cancel-batch-send" accessibilityRole="button" style={styles.confirmCancel}
              onPress={() => setSendConfirmation(null)}><Text style={ink}>キャンセル</Text></Pressable>
            <Pressable testID="confirm-batch-send" accessibilityRole="button" style={styles.button}
              onPress={() => { void sendIntake(); }}><Text style={styles.buttonText}>{currentUpload.snapshot?.status === 'failed' ? '再送する' : '送信する'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, cameraSafe: { flex: 1, backgroundColor: '#151515' },
  cameraProgress: { position: 'absolute', bottom: 150, alignSelf: 'center' },
  cameraError: { position: 'absolute', bottom: 145, left: 24, right: 24, color: '#fff', textAlign: 'center', backgroundColor: '#8c2424', padding: 10, borderRadius: 8 },
  page: { flex: 1, padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  heading: { fontSize: 22, fontWeight: '700' }, headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headingActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  button: { backgroundColor: '#174c8f', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' }, disabled: { opacity: 0.5 }, tile: { flex: 1, padding: 3, maxWidth: '33.33%', position: 'relative' },
  thumbnailMat: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#3d4450', borderRadius: 5 },
  thumbnail: { width: '100%', aspectRatio: CHEKI_MINI.outer.width / CHEKI_MINI.outer.height, borderRadius: 5 },
  photoIcon: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  deleteIcon: { left: 6, top: 6 },
  confirmBackdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'center', padding: 24 },
  confirmPanel: { padding: 20, borderRadius: 12, gap: 14 },
  confirmPhotos: { flexGrow: 0, maxHeight: 126 },
  confirmPhotoRow: { gap: 8 },
  confirmPhoto: { width: 76, height: 122 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12 },
  confirmCancel: { padding: 12 },
});
