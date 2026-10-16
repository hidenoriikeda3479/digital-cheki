import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export function QrScanner({ busy, onRead, onNumber }: {
  busy: boolean; onRead: (value: string) => void; onNumber: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const theme = useTheme();
  const ink = { color: theme.text };
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [cameraError, setCameraError] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => { if (!busy) locked.current = false; }, [busy]);
  const enabled = focused && foreground && permission?.granted && !busy && !cameraError;
  return <View style={styles.wrapper}>
    {permission === null ? <Text style={ink}>カメラ権限を確認中…</Text> : !permission.granted ? <View>
      <Text style={ink}>カメラを利用できません。番号入力でも進めます。</Text>
      {permission.canAskAgain && <Pressable testID="request-camera" accessibilityRole="button" onPress={() => { void requestPermission().catch(() => setCameraError(true)); }}><Text style={ink}>カメラを許可する</Text></Pressable>}
    </View> : cameraError ? <Text style={ink}>カメラを開始できません。番号入力をご利用ください。</Text> : enabled ?
      <CameraView testID="qr-camera" style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (locked.current) return;
          locked.current = true;
          onRead(data);
        }} onMountError={() => setCameraError(true)} /> : <Text style={ink}>カメラを停止しています。</Text>}
    <Pressable testID="open-number" accessibilityRole="button" style={styles.button} onPress={onNumber}><Text style={styles.buttonText}>番号で確認する</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { gap: 16 }, description: { fontSize: 16 }, camera: { height: 300, width: '100%', borderRadius: 12, overflow: 'hidden' },
  button: { padding: 14, backgroundColor: '#174c8f', borderRadius: 8, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '600' },
});
