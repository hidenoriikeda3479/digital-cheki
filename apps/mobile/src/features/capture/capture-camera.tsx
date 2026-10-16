import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { centeredImageCrop } from '@/features/editing/cheki-format';

export function CaptureCamera({ busy, onCapture, onReview }: {
  busy: boolean;
  onCapture: (source: { uri: string; width: number; height: number; format: 'jpg' | 'png' }) => Promise<void>;
  onReview: () => void;
}) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [error, setError] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') void getPermission().catch(() => setError(true));
    });
    return () => subscription.remove();
  }, [getPermission]);
  const active = focused && foreground && permission?.granted && !error;
  return <View style={styles.screen}>
    {active ? <ActiveCamera busy={busy} onCapture={onCapture} onError={() => setError(true)} />
      : <View style={styles.messageArea}>
        {permission === null ? <Text style={styles.message}>カメラ権限を確認中…</Text>
          : !permission.granted ? <>
            <Text style={styles.message}>撮影にはカメラの許可が必要です。</Text>
            {permission.canAskAgain
              ? <Pressable testID="request-photo-camera" accessibilityRole="button" onPress={() => { void requestPermission().catch(() => setError(true)); }}><Text style={styles.actionText}>カメラを許可する</Text></Pressable>
              : <><Text style={styles.message}>端末の設定からカメラを再許可してください。</Text>
                <Pressable testID="recheck-photo-camera" accessibilityRole="button" onPress={() => { void getPermission().catch(() => setError(true)); }}><Text style={styles.actionText}>許可状態を再確認</Text></Pressable></>}
          </> : error ? <><Text testID="photo-camera-error" accessibilityRole="alert" style={styles.message}>撮影または保存を完了できませんでした。空き容量とカメラの状態を確認してください。</Text>
            <Pressable testID="retry-photo-camera" accessibilityRole="button" onPress={() => setError(false)}><Text style={styles.actionText}>カメラを再試行</Text></Pressable></>
            : <Text style={styles.message}>カメラを停止しています。</Text>}
      </View>}
    <Pressable testID="show-photo-review" accessibilityRole="button" disabled={busy} onPress={onReview}
      style={[styles.reviewButton, busy && styles.disabled]}><Text style={styles.reviewText}>‹ 写真一覧</Text></Pressable>
    {!active && <Pressable testID="take-photo" accessibilityRole="button" accessibilityLabel="撮影して保存" disabled
      style={[styles.shutter, styles.disabled]}><View style={styles.shutterCenter} /></Pressable>}
  </View>;
}

function ActiveCamera({ busy, onCapture, onError }: {
  busy: boolean; onCapture: (source: { uri: string; width: number; height: number; format: 'jpg' | 'png' }) => Promise<void>; onError: () => void;
}) {
  const camera = useRef<CameraView>(null);
  const locked = useRef(false);
  const [ready, setReady] = useState(false);
  async function takePicture() {
    if (locked.current || busy || !ready || !camera.current) return;
    locked.current = true;
    try {
      const picture = await camera.current.takePictureAsync({ skipProcessing: false, base64: false, exif: false });
      if (!picture?.uri) throw new Error('Camera returned no picture');
      const crop = centeredImageCrop(picture.width, picture.height);
      const context = ImageManipulator.manipulate(picture.uri);
      context.crop(crop);
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
      await onCapture({ uri: saved.uri, width: saved.width, height: saved.height, format: 'jpg' });
    } catch { onError(); }
    finally { locked.current = false; }
  }
  return <View style={styles.cameraStage}>
    <CameraView ref={camera} testID="photo-camera" style={StyleSheet.absoluteFill} facing="back" mode="picture"
      onCameraReady={() => setReady(true)} onMountError={onError} />
    <Pressable testID="take-photo" accessibilityRole="button" accessibilityLabel="撮影して保存" disabled={!ready || busy}
      style={[styles.shutter, (!ready || busy) && styles.disabled]} onPress={() => { void takePicture(); }}>
      <View style={styles.shutterCenter} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#151515' },
  cameraStage: { flex: 1, backgroundColor: '#151515' },
  reviewButton: { position: 'absolute', top: 14, left: 18, minHeight: 44, justifyContent: 'center',
    paddingHorizontal: 16, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.62)' },
  reviewText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  shutter: { position: 'absolute', bottom: 28, alignSelf: 'center', width: 86, height: 86, borderRadius: 43,
    borderWidth: 4, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  shutterCenter: { width: 69, height: 69, borderRadius: 35, backgroundColor: '#fff' },
  messageArea: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 20 },
  message: { color: '#fff', fontSize: 16, textAlign: 'center' },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '700', textDecorationLine: 'underline' },
  disabled: { opacity: 0.45 },
});
