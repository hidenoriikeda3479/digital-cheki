import { useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';
import type { UploadPhotoState } from '@/services/contracts/upload';
import type { UploadController } from './upload-controller';

const MockControls = __DEV__
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- development-only diagnostic UI
  ? (require('./mock-upload-controls') as typeof import('./mock-upload-controls')).MockUploadControlsPanel
  : null;
const statusText: Record<UploadPhotoState['status'], string> = {
  unsent: '未送信', transferring: '送信中', failed: '送信失敗',
  'needs-attention': '要対応', uploaded: 'アップロード済み', unknown: '結果不明',
};
const retentionText = { stored: '保管中', expired: '期限切れ', deleted: '削除済み' };

export function UploadScreen({ controller }: { controller: UploadController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const theme = useTheme();
  const photos = state.snapshot?.photos ?? [];
  const uploaded = photos.filter((item) => item.status === 'uploaded').length;
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
    <FlatList data={photos} keyExtractor={(item) => item.photoId} contentContainerStyle={styles.page}
      ListHeaderComponent={<View style={styles.section}>
        <Pressable testID="upload-back" accessibilityRole="button" disabled={state.busy} onPress={() => controller.close()}><Text style={{ color: theme.text }}>写真確認へ戻る</Text></Pressable>
        <Text style={[styles.heading, { color: theme.text }]}>アップロード状況</Text>
        <Text testID="upload-summary" style={{ color: theme.text }}>{photos.length}枚中 {uploaded}枚完了</Text>
        {state.busy && <ScreenProgress testID="upload-progress" label="送信処理中" />}
        {state.error && <Text testID="upload-error" accessibilityRole="alert" style={{ color: theme.text }}>処理を確認できませんでした（{state.error}）。状態を照会してください。</Text>}
        {photos.some((item) => item.status === 'unsent') && <Pressable testID="upload-start-unsent" accessibilityRole="button" disabled={state.busy} style={styles.button}
          onPress={() => { void controller.startUnsent(); }}><Text style={styles.buttonText}>未送信写真の送信を開始</Text></Pressable>}
      </View>}
      renderItem={({ item, index }) => <View testID={`upload-photo-${index}`} style={styles.card}>
        <Text style={{ color: theme.text }}>写真 {index + 1}：{statusText[item.status]}</Text>
        <Text style={{ color: theme.text }}>失敗回数 {item.failureCount}回</Text>
        {state.activePhotoId === item.photoId && <Text testID="upload-byte-progress" style={{ color: theme.text }}>転送進捗 {state.progressPercent}%（保存確定前）</Text>}
        {item.status === 'needs-attention' && <Text testID="upload-attention" style={{ color: theme.text }}>3回失敗しました。通信状況を確認し、手動でアップロードしてください。</Text>}
        {item.uploadedAt && <Text style={{ color: theme.text }}>完了 {item.uploadedAt}・期限 {item.expiresAt}・{item.retention ? retentionText[item.retention] : ''}</Text>}
        {(item.status === 'failed' || item.status === 'needs-attention') && <Pressable testID={`upload-retry-${index}`} accessibilityRole="button" disabled={state.busy} style={styles.button}
          onPress={() => { void controller.start(item.photoId); }}><Text style={styles.buttonText}>手動再送</Text></Pressable>}
        {item.status === 'unknown' && <Pressable testID={`upload-query-${index}`} accessibilityRole="button" disabled={state.busy} style={styles.button}
          onPress={() => { void controller.query(item.photoId); }}><Text style={styles.buttonText}>同じ写真IDの結果を照会</Text></Pressable>}
        {MockControls && controller.controls && <MockControls controller={controller} photoId={item.photoId}
          selected={state.selectedScenarios[item.photoId]} disabled={state.busy} />}
      </View>}
      ListFooterComponent={MockControls && controller.controls ? <Pressable testID="mock-advance-seven-days" accessibilityRole="button" disabled={state.busy}
        onPress={() => { void controller.advanceDays(7); }}><Text style={{ color: theme.text }}>仮サーバー時計を7日進める（開発用）</Text></Pressable> : null}
    />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1 }, page: { padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  section: { gap: 14 }, heading: { fontSize: 22, fontWeight: '700' }, card: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#888', borderRadius: 8 },
  button: { backgroundColor: '#174c8f', padding: 12, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
