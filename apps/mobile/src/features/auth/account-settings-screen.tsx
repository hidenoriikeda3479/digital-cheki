import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toAppError } from '@/core/errors';
import type { AuthController } from './auth-controller';
import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';
import { SettingsMenuItem } from './settings-menu-item';

export function AccountSettingsScreen({ auth, role, onPassword, onSupport, onBack, onDeleted, onLogout, embedded = false, onBusyChange }: {
  auth: AuthController; role: 'group' | 'fan'; onPassword(): void; onSupport(): void; onBack(): void; onDeleted(): void;
  embedded?: boolean; onBusyChange?(busy: boolean): void;
  onLogout(): void;
}) {
  const theme = useTheme();
  const ink = { color: theme.text };
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function removeAccount() {
    if (busy) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try { await auth.deleteAccount(); onDeleted(); }
    catch (cause) { setError(toAppError(cause).message); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  const Container = embedded ? View : SafeAreaView;
  return <Container style={{ flex: 1, backgroundColor: theme.background }}><ScrollView contentContainerStyle={{ padding: 24, gap: 8 }}>
    <Text style={{ ...ink, fontSize: 24, fontWeight: '700', marginBottom: 12 }}>設定</Text>
    <SettingsMenuItem testID="settings-password" label="パスワード変更" disabled={busy} onPress={onPassword}
      symbol={{ ios: 'lock', android: 'lock', web: 'lock' }} />
    <SettingsMenuItem testID="settings-support" label="問い合わせ" disabled={busy} onPress={onSupport}
      symbol={{ ios: 'envelope', android: 'mail', web: 'mail' }} />
    {role === 'fan' && (confirming ? <View style={{ gap: 12 }}>
      <Text style={ink}>退会すると直ちにログアウトし、このアカウントではログイン・QR・受取・アルバム・再設定を利用できなくなります。端末外の写真をすべて消す操作ではありません。</Text>
      <SettingsMenuItem testID="confirm-account-delete" label="退会を確定する" disabled={busy} onPress={() => { void removeAccount(); }}
        symbol={{ ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' }} />
      <SettingsMenuItem testID="cancel-account-delete" label="キャンセル" disabled={busy} onPress={() => setConfirming(false)}
        symbol={{ ios: 'xmark', android: 'close', web: 'close' }} />
    </View> : <SettingsMenuItem testID="open-account-delete" label="退会する" disabled={busy} onPress={() => setConfirming(true)}
      symbol={{ ios: 'person.crop.circle.badge.minus', android: 'person_remove', web: 'person_remove' }} />)}
    {busy && <ScreenProgress testID="account-delete-busy" label="退会処理中" />}
    {error ? <Text testID="account-delete-error" accessibilityRole="alert" style={ink}>{error}</Text> : null}
    <SettingsMenuItem testID="settings-logout" label="ログアウト" disabled={busy || auth.getSnapshot().busy} onPress={onLogout}
      symbol={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} />
    <SettingsMenuItem testID="settings-back" label="ホームへ戻る" disabled={busy} onPress={onBack}
      symbol={{ ios: 'house', android: 'home', web: 'home' }} />
  </ScrollView></Container>;
}
