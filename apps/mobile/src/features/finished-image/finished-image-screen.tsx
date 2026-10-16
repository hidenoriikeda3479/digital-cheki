import { Image } from 'expo-image';
import { useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';
import type { FinishedImageController } from './finished-image-controller';

export function FinishedImageScreen({ controller, onSend, onOpenUpload }: {
  controller: FinishedImageController; onSend?: () => Promise<void>; onOpenUpload?: (intakeId: string) => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const theme = useTheme();
  const preview = state.preview;
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
    <FlatList
      data={preview?.images ?? []}
      keyExtractor={(item) => item.photoId}
      initialNumToRender={1}
      maxToRenderPerBatch={1}
      windowSize={3}
      contentContainerStyle={styles.page}
      ListHeaderComponent={<View style={styles.section}>
        <Pressable testID="leave-send-preview" accessibilityRole="button" disabled={state.busy} onPress={() => controller.close()}>
          <Text style={{ color: theme.text }}>写真確認へ戻る</Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>送信前確認</Text>
        {state.busy && <ScreenProgress testID="finished-progress" label="完成画像を生成・確認中" />}
        {state.error && <View><Text testID="finished-error" accessibilityRole="alert" style={{ color: theme.text }}>
          完成画像を確認できませんでした。写真・空き容量を確認し、再生成してください。({state.error})</Text>
          <Pressable testID="retry-finished" accessibilityRole="button" disabled={state.busy || !state.intakeId}
            onPress={() => { if (state.intakeId) void controller.open(state.intakeId); }}><Text style={{ color: theme.text }}>再生成する</Text></Pressable></View>}
        {preview && <>
          <Text testID="send-photo-count" style={{ color: theme.text }}>完成画像：{preview.images.length}枚</Text>
          <Text testID="send-recipient" style={{ color: theme.text }}>受取人：{preview.recipientLabel}</Text>
          <Text testID="send-idols" style={{ color: theme.text }}>参加アイドル：{preview.idolNames.join('、')}</Text>
        </>}
      </View>}
      renderItem={({ item, index }) => <View testID={`finished-${index}`} style={styles.card}>
        <Text style={{ color: theme.text }}>{index + 1}枚目・{item.quality === 'cheki' ? 'チェキ相当' : '高画質'}</Text>
        {item.uri ? <Image source={{ uri: item.uri }} style={[styles.image, { aspectRatio: item.width / item.height }]} contentFit="contain" />
          : <Text style={{ color: theme.text }}>この写真の完成画像は端末から削除済みです。送信記録は維持されています。</Text>}
        <Text style={{ color: theme.text }}>{item.width} × {item.height} px・{(item.byteSize / 1024 / 1024).toFixed(2)} MB</Text>
      </View>}
      ListFooterComponent={preview ? <View style={styles.section}>
        {preview.confirmedAt ? <>
          <Text testID="send-confirmed" style={{ color: theme.text }}>送信対象は確定済みです。</Text>
          {onOpenUpload && <Pressable testID="go-upload-status" accessibilityRole="button" style={styles.button}
            onPress={() => onOpenUpload(preview.intake.id)}><Text style={styles.buttonText}>アップロード状況へ</Text></Pressable>}
        </> : <Pressable testID="confirm-and-send" accessibilityRole="button"
          disabled={state.busy || !onSend || !preview.images.length || preview.images.some((image) => !image.uri)}
          style={[styles.button, (state.busy || !onSend || !preview.images.length) && styles.disabled]}
          onPress={() => { void onSend?.(); }}><Text style={styles.buttonText}>確定して送信する</Text></Pressable>}
      </View> : null}
    />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1 }, page: { padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  section: { gap: 16 }, title: { fontSize: 22, fontWeight: '700' }, card: { gap: 8 },
  image: { width: '100%', maxHeight: 440, backgroundColor: '#333' },
  button: { backgroundColor: '#174c8f', padding: 14, borderRadius: 8, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
