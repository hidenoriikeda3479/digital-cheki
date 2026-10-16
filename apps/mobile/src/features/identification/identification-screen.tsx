import { useState, useSyncExternalStore } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';

import type { IdentificationController } from './identification-controller';
import type { Principal } from '@/services/contracts/auth';
import { FanReceptionScreen } from './fan-reception-screen';
import { QrScanner } from './qr-scanner';

export function IdentificationScreen({ controller, onStartCapture, embedded = false, principal }: { controller: IdentificationController; onStartCapture: (intakeId: string) => Promise<boolean>; embedded?: boolean; principal?: Principal }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const savedIntake = state.latestIntake;
  const theme = useTheme();
  const [number, setNumber] = useState('');
  const [captureOpenFailed, setCaptureOpenFailed] = useState(false);
  async function startCapture(intakeId: string) {
    setCaptureOpenFailed(false);
    try { if (!(await onStartCapture(intakeId))) setCaptureOpenFailed(true); }
    catch { setCaptureOpenFailed(true); }
  }
  async function saveAndStart() {
    const intakeId = await controller.saveIntake();
    if (intakeId) await startCapture(intakeId);
  }
  const ink = { color: theme.text };
  const error = state.error === 'Validation' ? '入力内容またはQRの形式を確認してください。'
    : state.error === 'Forbidden' ? 'この操作は利用できません。'
      : state.error === 'Storage' ? '受付を保存できませんでした。'
        : state.error ? '処理できませんでした。もう一度お試しください。' : null;
  if (state.phase === 'fan-code' && state.ownIdentity) return <FanReceptionScreen
    identity={state.ownIdentity} principal={principal} busy={state.busy} error={error} embedded={embedded}
    onBack={() => controller.goHome()} onRefresh={() => { if (!controller.getSnapshot().busy) void controller.showFanCode(); }} />;
  const Container = embedded ? View : SafeAreaView;
  return <Container style={[styles.safe, { backgroundColor: theme.background }]}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable testID="intake-back" accessibilityRole="button" disabled={state.busy && state.phase === 'select'}
        onPress={() => controller.goHome()}><Text style={ink}>ホームへ戻る</Text></Pressable>
      {state.phase === 'scan' && <View testID="scan-screen" style={styles.section}>
        <Text style={[styles.heading, ink]}>QRを読み取る</Text>
        <QrScanner busy={state.busy} onRead={(value) => { void controller.resolveQr(value); }} onNumber={() => controller.openNumber()} />
        {state.match === 'absent' && <Text style={ink}>該当する相手が見つかりません。</Text>}
      </View>}
      {state.phase === 'number' && <View testID="number-screen" style={styles.section}>
        <Text style={[styles.heading, ink]}>番号で確認</Text>
        <Text style={ink}>会員番号またはゲスト一時番号</Text>
        <TextInput testID="recipient-number" accessibilityLabel="会員番号またはゲスト一時番号" placeholder="番号を入力" placeholderTextColor={theme.textSecondary}
          keyboardType="number-pad" autoCapitalize="none" value={number} onChangeText={setNumber} editable={!state.busy}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.textSecondary }]} />
        <Pressable testID="check-number" accessibilityRole="button" disabled={state.busy} style={[styles.button, state.busy && styles.disabled]}
          onPress={() => { void controller.resolveNumber(number); }}><Text style={styles.buttonText}>該当を確認</Text></Pressable>
        {state.match === 'absent' && <Text testID="number-absent" style={ink}>該当なし。番号を確認してください。</Text>}
      </View>}
      {state.phase === 'select' && <View testID="idol-screen" style={styles.section}>
        <Text style={[styles.heading, ink]}>参加アイドルを選択</Text>
        <Text testID="recipient-found" style={ink}>撮影相手：該当あり</Text>
        <View testID="idol-grid" style={styles.idolGrid}>{state.idols.map((idol) => {
          const selected = state.selectedIds.includes(idol.id);
          return <Pressable key={idol.id} testID={`idol-${idol.id}`} accessibilityRole="checkbox"
            accessibilityLabel={`${idol.name}を${selected ? '選択解除' : '選択'}`}
            accessibilityState={{ checked: selected }}
            style={[styles.idol, { borderColor: selected ? '#174c8f' : theme.textSecondary,
              backgroundColor: selected ? theme.backgroundSelected : theme.background }]}
            onPress={() => controller.toggleIdol(idol.id)}>
            {idol.portraitSource ? <Image testID={`idol-photo-${idol.id}`} source={idol.portraitSource}
              style={styles.idolPhoto} contentFit="cover" accessibilityLabel={`${idol.name}の写真`} />
              : <View style={[styles.idolPhoto, styles.noPortrait, { backgroundColor: theme.backgroundElement }]}>
                <Text style={ink}>写真なし</Text></View>}
            <Text style={[styles.idolName, ink]} numberOfLines={2}>{idol.name}</Text>
            <Text style={[styles.idolSelected, { color: selected ? '#174c8f' : theme.textSecondary }]}>
              {selected ? '選択済み' : '選択'}</Text>
          </Pressable>;
        })}</View>
        <Text testID="selected-idol-count" style={ink}>選択中：{state.selectedIds.length}人</Text>
        <Pressable testID="save-intake" accessibilityRole="button" disabled={state.busy || state.selectedIds.length === 0}
          style={[styles.button, (state.busy || state.selectedIds.length === 0) && styles.disabled]}
          onPress={() => { void saveAndStart(); }}><Text style={styles.buttonText}>写真を撮影</Text></Pressable>
      </View>}
      {state.phase === 'saved' && <View testID="capture-opening" style={styles.section}>
        {captureOpenFailed ? <>
          <Text accessibilityRole="alert" style={ink}>撮影画面を開けませんでした。もう一度お試しください。</Text>
          {savedIntake && <Pressable testID="retry-open-capture" accessibilityRole="button" style={styles.button}
            onPress={() => { void startCapture(savedIntake.id); }}><Text style={styles.buttonText}>写真撮影を開く</Text></Pressable>}
        </> : <Text style={ink}>写真撮影を準備中です。</Text>}
      </View>}
      {state.busy && <ScreenProgress testID="identification-progress" label="撮影相手を確認中" />}
      {error && <Text testID="identification-error" accessibilityRole="alert" style={ink}>{error}</Text>}
    </ScrollView>
  </Container>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, page: { flexGrow: 1, padding: 24, gap: 20, maxWidth: 500, width: '100%', alignSelf: 'center' },
  section: { gap: 16 }, heading: { fontSize: 22, fontWeight: '700' }, note: { fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 18 },
  button: { padding: 14, borderRadius: 8, backgroundColor: '#174c8f', alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 }, idolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  idol: { width: '47%', borderWidth: 2, padding: 8, borderRadius: 10, gap: 5 },
  idolPhoto: { width: '100%', aspectRatio: 1, borderRadius: 6 },
  noPortrait: { alignItems: 'center', justifyContent: 'center' },
  idolName: { fontSize: 16, fontWeight: '600' }, idolSelected: { fontSize: 13 },
  qr: { alignItems: 'center', padding: 16 },
  number: { fontSize: 26, letterSpacing: 3, textAlign: 'center', fontWeight: '600' },
});
