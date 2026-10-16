import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toAppError } from '@/core/errors';
import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';
import type { MockPasswordInbox, PasswordService, ResetChallenge } from '@/services/contracts/password';

export function PasswordScreen({ mode, credential, service, inbox, onBack, onDone, embedded = false, onBusyChange }: {
  mode: 'change' | 'reset'; credential?: string; service: PasswordService; inbox?: MockPasswordInbox;
  onBack: () => void; onDone: () => void;
  embedded?: boolean; onBusyChange?(busy: boolean): void;
}) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reference, setReference] = useState('');
  const [challenge, setChallenge] = useState<ResetChallenge | null>(null);
  const [inboxReference, setInboxReference] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ink = { color: theme.text };
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.textSecondary }];
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try { await action(); }
    catch (cause) { setError(toAppError(cause).message); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  function checkConfirmation(): boolean {
    if (newPassword !== confirmation) { setError('新しいパスワードと確認用が一致しません。'); return false; }
    return true;
  }
  const Container = embedded ? View : SafeAreaView;
  return <Container style={[styles.safe, { backgroundColor: theme.background }]}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, ink]}>{mode === 'change' ? 'パスワード変更' : 'パスワード再設定'}</Text>
      {complete ? <View style={styles.section} testID="password-complete">
        <Text style={ink}>パスワードを更新しました。新しいパスワードでログインできます。</Text>
        <Pressable testID="password-done" accessibilityRole="button" style={styles.button} onPress={onDone}>
          <Text style={styles.buttonText}>{mode === 'reset' ? 'ログインへ戻る' : 'ホームへ戻る'}</Text></Pressable>
      </View> : <View style={styles.section} testID={mode === 'change' ? 'password-change-form' : 'password-reset-form'}>
        {mode === 'reset' && !challenge && <>
          <Text style={[styles.label, ink]}>メールアドレス</Text>
          <TextInput testID="reset-email" accessibilityLabel="メールアドレス" keyboardType="email-address" autoCapitalize="none"
            value={email} onChangeText={setEmail} editable={!busy} style={inputStyle} />
          <Pressable testID="request-reset" accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.disabled]}
            onPress={() => void run(async () => { setChallenge(await service.requestReset(email)); setReference(''); setInboxReference(null); })}>
            <Text style={styles.buttonText}>再設定を申請</Text></Pressable>
        </>}
        {mode === 'reset' && challenge && <>
          <Text style={ink}>有効期限：{challenge.expiresAt}</Text>
          {inbox && <Pressable testID="show-reset-inbox" accessibilityRole="button" disabled={busy} style={styles.secondary}
            onPress={() => void run(async () => { setInboxReference(await inbox.readReference(challenge.requestId)); })}>
            <Text style={ink}>再設定コードを表示</Text></Pressable>}
          {inboxReference && <Text testID="reset-inbox-reference" style={ink}>再設定コード：{inboxReference}</Text>}
          <Text style={[styles.label, ink]}>再設定コード</Text>
          <TextInput testID="reset-reference" accessibilityLabel="再設定コード"
            placeholder={inbox ? '上に表示されたコードを入力' : 'メールで届いたコードを入力'}
            placeholderTextColor={theme.textSecondary} autoCapitalize="none"
            value={reference} onChangeText={setReference} editable={!busy} style={inputStyle} />
          <Pressable testID="resend-reset" accessibilityRole="button" disabled={busy} style={styles.secondary}
            onPress={() => void run(async () => { setChallenge(await service.requestReset(challenge.email)); setReference(''); setInboxReference(null); })}>
            <Text style={ink}>再設定コードを再発行</Text></Pressable>
        </>}
        {mode === 'change' && <>
          <Text style={[styles.label, ink]}>現在のパスワード</Text>
          <TextInput testID="current-password" accessibilityLabel="現在のパスワード" secureTextEntry autoComplete="current-password"
            value={currentPassword} onChangeText={setCurrentPassword} editable={!busy} style={inputStyle} />
        </>}
        {(mode === 'change' || challenge) && <>
          <Text style={[styles.label, ink]}>新しいパスワード</Text>
          <TextInput testID="new-password" accessibilityLabel="新しいパスワード" secureTextEntry autoComplete="new-password"
            value={newPassword} onChangeText={setNewPassword} editable={!busy} style={inputStyle} />
          <Text style={[styles.label, ink]}>新しいパスワード（確認）</Text>
          <TextInput testID="confirm-password" accessibilityLabel="新しいパスワード（確認）" secureTextEntry autoComplete="new-password"
            value={confirmation} onChangeText={setConfirmation} editable={!busy} style={inputStyle} />
          <Text style={ink}>8文字以上で英大文字・小文字・数字を含めてください。記号は任意です。</Text>
          <Pressable testID="submit-password" accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.disabled]}
            onPress={() => { if (!checkConfirmation()) return; void run(async () => {
              if (mode === 'change') {
                if (!credential) throw Error('ログイン状態を確認できません。');
                await service.changePassword(credential, currentPassword, newPassword);
              } else if (challenge) await service.completeReset(challenge.requestId, reference, newPassword);
              setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setReference(''); setInboxReference(null); setComplete(true);
            }); }}><Text style={styles.buttonText}>新しいパスワードを保存</Text></Pressable>
        </>}
      </View>}
      {busy && <ScreenProgress testID="password-progress" label="パスワード処理中" />}
      {error && <Text testID="password-error" accessibilityRole="alert" style={ink}>{error}</Text>}
      {!complete && <Pressable testID="password-back" accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={onBack}>
        <Text style={ink}>戻る</Text></Pressable>}
    </ScrollView>
  </Container>;
}
const styles = StyleSheet.create({ safe: { flex: 1 }, page: { flexGrow: 1, padding: 24, gap: 18, maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '700' }, section: { gap: 14 }, label: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  button: { padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#174c8f' },
  buttonText: { color: '#fff', fontWeight: '600' }, secondary: { alignItems: 'center', padding: 10 }, disabled: { opacity: 0.5 } });
