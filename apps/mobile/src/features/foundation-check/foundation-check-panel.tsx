import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toAppError } from '@/core/errors';
import type { CheckSnapshot, FoundationCheckService } from '@/services/contracts/foundation-check';

type Props = {
  service: FoundationCheckService;
  onClose: () => void;
};

type Result = {
  service: FoundationCheckService;
  targetId: string;
  snapshot: CheckSnapshot | null;
  errorCode: string | null;
};

export function FoundationCheckPanel({ service, onClose }: Props) {
  const [targetId, setTargetId] = useState(service.targets[0]?.id ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);
  const activeOperation = useRef<object>({});
  const activeRequest = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const operation = {};
    activeOperation.current = operation;
    activeRequest.current = true;
    void service.read(targetId).then(
      (next) => {
        if (operation === activeOperation.current) {
          setResult({ service, targetId, snapshot: next, errorCode: null });
        }
      },
      (error: unknown) => {
        if (operation === activeOperation.current) {
          setResult({ service, targetId, snapshot: null, errorCode: toAppError(error).code });
        }
      },
    ).finally(() => {
      if (operation === activeOperation.current) {
        activeRequest.current = false;
      }
    });
    return () => {
      activeOperation.current = {};
    };
  }, [service, targetId]);

  async function runAction(action: 'read' | 'save' | 'reset') {
    if (!mounted.current || activeRequest.current) return;
    activeRequest.current = true;
    const operation = {};
    activeOperation.current = operation;
    setResult(null);
    try {
      if (action === 'reset') await service.reset('RESET_MOCK_DATA');
      const next = action === 'save' ? await service.save(targetId) : await service.read(targetId);
      if (operation === activeOperation.current && mounted.current) {
        setResult({ service, targetId, snapshot: next, errorCode: null });
      }
    } catch (error) {
      if (operation === activeOperation.current && mounted.current) {
        setResult({ service, targetId, snapshot: null, errorCode: toAppError(error).code });
      }
    } finally {
      if (operation === activeOperation.current && mounted.current) {
        activeRequest.current = false;
      }
    }
  }

  function confirmReset() {
    if (activeRequest.current || confirming) return;
    setConfirming(true);
    Alert.alert(
      'モック領域を初期化しますか？',
      '全テスト利用者の確認用データと仮サーバーを初期状態に戻します。',
      [
        { text: 'キャンセル', style: 'cancel', onPress: () => setConfirming(false) },
        {
          text: 'モック領域を初期化',
          style: 'destructive',
          onPress: () => {
            setConfirming(false);
            void runAction('reset');
          },
        },
      ],
      { cancelable: true, onDismiss: () => setConfirming(false) },
    );
  }

  const currentResult = result?.service === service && result.targetId === targetId ? result : null;
  const busy = currentResult === null;
  const errorCode = currentResult?.errorCode;
  const disabled = busy || confirming;
  const target = service.targets.find((item) => item.id === targetId);
  // A previous owner's data is never rendered under a newly selected target.
  const visibleSnapshot = currentResult?.snapshot?.target.id === targetId ? currentResult.snapshot : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>端末保存の確認</Text>
        <Text style={styles.body}>モック専用の小さなテキストファイルと確認用レコードを保存します。</Text>
        <Text style={styles.body}>保存後にアプリを終了し、再び開いて同じ対象のID・時刻・内容を確認してください。</Text>

        <Text style={styles.heading}>確認する対象</Text>
        <View style={styles.targets}>
          {service.targets.map((item) => (
            <Pressable
              key={item.id}
              testID={`target-${item.id}`}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected: item.id === targetId }}
              disabled={disabled}
              onPress={() => {
                if (item.id === targetId) return;
                setResult(null);
                setTargetId(item.id);
              }}
              style={[styles.target, item.id === targetId && styles.selected, disabled && styles.disabled]}>
              <Text style={styles.buttonText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.heading}>{target?.label ?? '対象がありません'}</Text>
        {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>処理中です…</Text>}
        {errorCode && (
          <Text accessibilityRole="alert" style={styles.error}>
            確認できませんでした。もう一度お試しください。（{errorCode}）
          </Text>
        )}
        {visibleSnapshot && (
          <View testID="check-result" style={styles.result}>
            {visibleSnapshot.record ? (
              <>
                <Text selectable style={styles.body}>保存ID: {visibleSnapshot.record.id}</Text>
                <Text selectable style={styles.body}>保存時刻: {visibleSnapshot.record.savedAt}</Text>
                <Text selectable style={styles.body}>ファイル: {visibleSnapshot.record.fileName}</Text>
                <Text selectable style={styles.body}>内容: {visibleSnapshot.fileContents ?? 'ファイルが見つかりません'}</Text>
              </>
            ) : <Text style={styles.body}>まだ確認用データはありません。</Text>}
            <Text style={styles.body}>
              初期データ版: {visibleSnapshot.seed.version} / グループ: {visibleSnapshot.seed.groupCount} / ファン: {visibleSnapshot.seed.fanCount} / アイドル: {visibleSnapshot.seed.idolCount}
            </Text>
            <Text style={styles.note}>この人数は分離確認用の仮データで、利用上限ではありません。</Text>
          </View>
        )}

        <Action testID="save-check" label="確認用データを保存" disabled={disabled || !target} onPress={() => void runAction('save')} />
        <Action testID="read-check" label="読み戻す" disabled={disabled || !target} onPress={() => void runAction('read')} />
        <Action testID="reset-check" label="モック領域を初期化…" disabled={disabled} onPress={confirmReset} />
        <Action testID="close-check" label="閉じる" disabled={disabled} onPress={onClose} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({ testID, label, disabled, onPress }: {
  testID: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f7f7fb' },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  title: { color: '#181827', fontSize: 24, fontWeight: '700' },
  heading: { color: '#181827', fontSize: 18, fontWeight: '600' },
  body: { color: '#28283a', fontSize: 16, lineHeight: 25 },
  note: { color: '#45455a', fontSize: 14, lineHeight: 22 },
  targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  target: { minHeight: 48, padding: 12, backgroundColor: '#e5e5ef', borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  selected: { borderColor: '#4b3cad', backgroundColor: '#ded9ff' },
  buttonText: { color: '#282047', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  action: { minHeight: 48, justifyContent: 'center', padding: 12, backgroundColor: '#e5e0ff', borderRadius: 8 },
  disabled: { opacity: 0.5 },
  result: { backgroundColor: '#fff', padding: 16, gap: 8, borderRadius: 8 },
  error: { color: '#9d1830', fontSize: 16, lineHeight: 25 },
});
