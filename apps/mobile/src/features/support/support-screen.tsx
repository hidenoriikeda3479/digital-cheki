import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toAppError } from '@/core/errors';
import type { SupportReceipt, SupportService } from '@/services/contracts/support';
import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';

export function SupportScreen({ credential, service, onBack, embedded = false, onBusyChange }: {
  credential: string; service: SupportService; onBack(): void; embedded?: boolean; onBusyChange?(busy: boolean): void;
}) {
  const theme = useTheme();
  const ink = { color: theme.text };
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<SupportReceipt | null>(null);
  async function submit() {
    if (busy) return;
    if (!subject.trim() || !content.trim()) { setError('件名と内容を入力してください。'); return; }
    setBusy(true); onBusyChange?.(true); setError('');
    try { setReceipt(await service.submit(credential, subject, content)); }
    catch (cause) { setError(toAppError(cause).message); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  const Container = embedded ? View : SafeAreaView;
  return <Container style={{ flex: 1, backgroundColor: theme.background }}><ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
    <Text style={{ ...ink, fontSize: 24, fontWeight: '700' }}>問い合わせ</Text>
    {receipt ? <><Text testID="support-complete" style={ink}>問い合わせを受け付けました。受付番号: {receipt.id}</Text>
      <Pressable testID="support-back" accessibilityRole="button" onPress={onBack}><Text style={ink}>ホームへ戻る</Text></Pressable></> : <>
      <Text style={ink}>件名</Text><TextInput testID="support-subject" accessibilityLabel="件名" value={subject} onChangeText={setSubject} editable={!busy} style={{ borderWidth: 1, borderColor: theme.textSecondary, color: theme.text, padding: 12 }} />
      <Text style={ink}>内容</Text><TextInput testID="support-content" accessibilityLabel="内容" value={content} onChangeText={setContent} editable={!busy} multiline style={{ borderWidth: 1, borderColor: theme.textSecondary, color: theme.text, minHeight: 120, padding: 12 }} />
      {error ? <Text testID="support-error" accessibilityRole="alert" style={ink}>{error}</Text> : null}
      {busy && <ScreenProgress testID="support-busy" label="問い合わせ送信中" />}
      <Pressable testID="support-submit" accessibilityRole="button" disabled={busy} onPress={() => { void submit(); }}><Text style={ink}>送信する</Text></Pressable>
      <Pressable testID="support-cancel" accessibilityRole="button" disabled={busy} onPress={onBack}><Text style={ink}>戻る</Text></Pressable>
    </>}
  </ScrollView></Container>;
}
