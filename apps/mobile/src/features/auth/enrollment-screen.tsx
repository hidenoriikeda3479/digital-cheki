import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toAppError } from '@/core/errors';
import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';
import type { EnrollmentService, RegistrationChallenge } from '@/services/contracts/enrollment';
import type { AuthController } from './auth-controller';
import { AuthTabs } from './auth-tabs';

function formatExpiry(instant: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '確認できません';
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${two(date.getMonth() + 1)}/${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export function EnrollmentScreen({ enrollment, auth, onBack, embedded = false, onBusyChange }: {
  enrollment: EnrollmentService;
  auth: AuthController; onBack: () => void;
  embedded?: boolean; onBusyChange?(busy: boolean): void;
}) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<RegistrationChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try { await action(); }
    catch (cause) { setError(toAppError(cause).message); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.textSecondary }];
  const textStyle = { color: theme.text };
  const content = <>
      {challenge && <Text style={[styles.title, textStyle]}>メール認証</Text>}
      {challenge ? <View style={styles.section} testID="verification-form">
        <Text testID="verification-expiry" style={textStyle}>有効期限：{formatExpiry(challenge.expiresAt)}</Text>
        <Text style={[styles.label, textStyle]}>認証コード</Text>
        <TextInput testID="verification-code" accessibilityLabel="認証コード" keyboardType="number-pad" maxLength={6}
          value={code} onChangeText={setCode} editable={!busy} style={inputStyle} />
        <Pressable testID="verify-registration" accessibilityRole="button" disabled={busy || code.length !== 6}
          style={[styles.button, (busy || code.length !== 6) && styles.disabled]}
          onPress={() => void run(async () => { await auth.acceptSession(await enrollment.verifyCode(challenge.requestId, code)); setCode(''); })}>
          <Text style={styles.buttonText}>認証して会員利用を開始</Text></Pressable>
        <Pressable testID="resend-code" accessibilityRole="button" disabled={busy} style={styles.secondary}
          onPress={() => void run(async () => { setChallenge(await enrollment.resendCode(challenge.requestId)); setCode(''); })}>
          <Text style={textStyle}>コードを再発行</Text></Pressable>
      </View> : <View style={styles.section} testID="registration-form">
        <Text style={[styles.label, textStyle]}>メールアドレス</Text>
        <TextInput testID="registration-email" accessibilityLabel="メールアドレス" autoCapitalize="none" keyboardType="email-address"
          value={email} onChangeText={setEmail} editable={!busy} style={inputStyle} />
        <Text style={[styles.label, textStyle]}>ファン名</Text>
        <TextInput testID="registration-name" accessibilityLabel="ファン名" value={displayName} onChangeText={setDisplayName} editable={!busy} style={inputStyle} />
        <Text style={[styles.label, textStyle]}>パスワード</Text>
        <TextInput testID="registration-password" accessibilityLabel="パスワード" secureTextEntry autoComplete="new-password"
          value={password} onChangeText={setPassword} editable={!busy} style={inputStyle} />
        <Text style={textStyle}>8文字以上で英大文字・小文字・数字を含めてください。記号は任意です。</Text>
        <Pressable testID="request-registration" accessibilityRole="button" disabled={busy} style={[styles.button, busy && styles.disabled]}
          onPress={() => void run(async () => { setChallenge(await enrollment.requestRegistration({ email, displayName, password })); setPassword(''); })}>
          <Text style={styles.buttonText}>認証コードを発行</Text></Pressable>
      </View>}
      {busy && <ScreenProgress testID="enrollment-progress" label="登録処理中" />}
      {error && <Text testID="enrollment-error" accessibilityRole="alert" style={textStyle}>{error}</Text>}
    </>;
  if (embedded) return <View testID="registration-content" style={styles.embedded}>{content}</View>;
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={[styles.brandTitle, textStyle]}>Digital Instax</Text>
      <AuthTabs active="register" disabled={busy} onLogin={onBack} />
      {content}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1 }, page: { flexGrow: 1, padding: 24, gap: 20, maxWidth: 480, width: '100%', alignSelf: 'center' },
  embedded: { gap: 20 },
  brandTitle: { minHeight: 52, fontSize: 30, fontWeight: '700', textAlign: 'center' },
  title: { fontSize: 26, fontWeight: '700' }, section: { gap: 14 }, label: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  button: { padding: 14, borderRadius: 8, alignItems: 'center', backgroundColor: '#174c8f' },
  buttonText: { color: '#fff', fontWeight: '600' }, secondary: { alignItems: 'center', padding: 10 }, disabled: { opacity: 0.5 } });
