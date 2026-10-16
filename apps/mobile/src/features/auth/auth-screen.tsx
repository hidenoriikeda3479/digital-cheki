import { useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toAppError, type ErrorCode } from '@/core/errors';
import { useTheme } from '@/hooks/use-theme';
import { ScreenProgress } from '@/components/screen-progress';
import { IdentificationScreen } from '@/features/identification/identification-screen';
import { CaptureScreen } from '@/features/capture/capture-screen';
import type { CaptureController } from '@/features/capture/capture-controller';
import type { EditingController } from '@/features/editing/editing-controller';
import type { FinishedImageController } from '@/features/finished-image/finished-image-controller';
import type { BatchUploadController } from '@/features/upload/batch-upload-controller';
import type { DownloadController } from '@/features/download/download-controller';
import { DownloadScreen } from '@/features/download/download-screen';
import { ReceiveModal } from '@/features/download/receive-modal';
import type { EnrollmentService } from '@/services/contracts/enrollment';
import { EnrollmentScreen } from './enrollment-screen';
import { AuthTabs } from './auth-tabs';
import type { MockPasswordInbox, PasswordService } from '@/services/contracts/password';
import { PasswordScreen } from './password-screen';
import { AccountSettingsScreen } from './account-settings-screen';
import { SettingsMenuItem } from './settings-menu-item';
import { FanHomeScreen } from './fan-home-screen';
import { FanTabBar, type FanTab } from './fan-tab-bar';
import { SupportScreen } from '@/features/support/support-screen';
import { PhotoManagementScreen } from '@/features/photo-management/photo-management-screen';
import type { SupportService } from '@/services/contracts/support';
import type { LocalPhotoManagementService } from '@/services/contracts/photo-management';

import type { AuthController } from './auth-controller';
import type { IdentificationController } from '@/features/identification/identification-controller';

const errorText: Record<ErrorCode, string> = {
  Validation: '入力内容を確認してください。', Configuration: '設定を確認してください。', NotImplemented: 'この操作はまだ利用できません。',
  Storage: '端末の認証情報を保存できませんでした。', Conflict: '処理中です。', NotFound: '対象が見つかりません。',
  Cancelled: '操作を取り消しました。', UnknownOutcome: '結果を確認できません。',
  Unauthenticated: 'メールアドレスまたはパスワードを確認してください。',
  Forbidden: 'このアカウントは現在利用できません。', Expired: 'ログインの有効期限が切れました。',
  Transport: '通信できませんでした。',
};

const primaryButtonColor = '#174c8f';
const menuTileColors = [primaryButtonColor, '#205798', '#2b62a0', '#376da8'] as const;

function MenuTile({ testID, label, symbol, tone, disabled, onPress }: {
  testID: string; label: string; symbol: ComponentProps<typeof SymbolView>['name'];
  tone: 0 | 1 | 2 | 3;
  disabled?: boolean; onPress: () => void;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    style={[styles.menuTile, { backgroundColor: menuTileColors[tone] }, disabled && styles.disabled]} onPress={onPress}>
    <View testID="home-menu-tile-content" style={styles.menuTileContent}>
      <SymbolView name={symbol} size={36} tintColor="#fff" />
      <Text style={styles.menuTileText}>{label}</Text>
    </View>
  </Pressable>;
}

export function AuthScreen({ auth, identification, capture, editing, finishedImage, upload, download, enrollment, passwordService, mockPasswordInbox, support, photoManagement }: { auth: AuthController; identification: IdentificationController; capture: CaptureController; editing: EditingController; finishedImage: FinishedImageController; upload?: BatchUploadController; download?: DownloadController; enrollment?: EnrollmentService; passwordService?: PasswordService; mockPasswordInbox?: MockPasswordInbox; support?: SupportService; photoManagement?: LocalPhotoManagementService }) {
  const theme = useTheme();
  const state = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
  const identificationState = useSyncExternalStore(identification.subscribe, identification.getSnapshot, identification.getSnapshot);
  const captureState = useSyncExternalStore(capture.subscribe, capture.getSnapshot, capture.getSnapshot);
  const downloadState = useSyncExternalStore(download?.subscribe ?? (() => () => {}), download?.getSnapshot ?? (() => null), download?.getSnapshot ?? (() => null));
  const sessionCredential = state.session?.credential;
  const sessionRole = state.session?.principal.role;
  const session = state.session;
  useEffect(() => {
    if (download && sessionCredential && (sessionRole === 'fan' || sessionRole === 'guest')) {
      void download.refreshReceivables();
    }
  }, [download, sessionCredential, sessionRole]);
  const [flow, setFlow] = useState<'login' | 'register' | 'reset' | 'change' | 'settings' | 'support' | 'manage'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [localError, setLocalError] = useState<ErrorCode | null>(null);
  const [fanOperationBusy, setFanOperationBusy] = useState(false);
  const [albumVisit, setAlbumVisit] = useState(0);

  async function login() {
    if (state.busy || guestBusy) return;
    setLocalError(null);
    try { await auth.signIn({ email, password }); setPassword(''); }
    catch (cause) { if (toAppError(cause).code !== 'Cancelled') setLocalError(toAppError(cause).code); }
  }
  async function logout() {
    setLocalError(null);
    try { await auth.signOut(); setEmail(''); setPassword(''); setFlow('login'); }
    catch (cause) { setLocalError(toAppError(cause).code); }
  }
  async function enterAsGuest() {
    if (!enrollment || state.busy || guestBusy) return;
    setGuestBusy(true); setLocalError(null);
    try {
      const session = await enrollment.resumeGuest() ?? await enrollment.startGuest();
      await auth.acceptSession(session);
    } catch (cause) {
      if (toAppError(cause).code !== 'Cancelled') setLocalError(toAppError(cause).code);
    } finally { setGuestBusy(false); }
  }
  if (session && session.principal.role !== 'group') {
    const fanCredential = session.credential;
    const busy = state.busy || fanOperationBusy || identificationState.busy || !!downloadState?.busy;
    const downloadOpen = !!download && !!downloadState && downloadState.phase !== 'closed';
    const settingsOpen = flow === 'settings' || flow === 'change' || flow === 'support';
    const selectedTab: FanTab = downloadOpen ? 'album'
      : settingsOpen ? 'settings' : 'home';
    async function navigate(tab: FanTab) {
      if (busy || download?.getSnapshot().busy || download?.getSnapshot().receiveBatch || identification.getSnapshot().busy) return;
      if (tab === 'album') {
        if (!download) return;
        await download.open('list');
        if (auth.getSnapshot().session?.credential !== fanCredential) return;
        if (download.getSnapshot().phase === 'closed') return;
        setAlbumVisit((visit) => visit + 1);
      } else download?.close();
      identification.goHome();
      setLocalError(null);
      setFlow(tab === 'settings' ? 'settings' : 'login');
    }
    const footer = <FanTabBar role={session.principal.role} selected={selectedTab}
      pendingPhotos={(downloadState?.intakes ?? []).reduce((count, intake) => count + intake.photos
        .filter((photo) => photo.status === 'unreceived' || photo.status === 'failed').length, 0)}
      disabled={busy || !!downloadState?.receiveBatch} downloadsAvailable={!!download} onChange={(tab) => { void navigate(tab); }} />;
    let content: ReactNode;
    if (downloadOpen && download) content = <DownloadScreen key={`${fanCredential}:${albumVisit}`} controller={download} embedded initialDisplay="second" backgroundProvided />;
    else if (identificationState.phase !== 'home') content = <IdentificationScreen controller={identification}
      embedded principal={session.principal} onStartCapture={async () => false} />;
    else if (flow === 'support' && support) content = <SupportScreen key={session.credential} embedded
      credential={session.credential} service={support} onBusyChange={setFanOperationBusy}
      onBack={() => setFlow(session.principal.role === 'guest' ? 'login' : 'settings')} />;
    else if (flow === 'change' && passwordService && session.principal.role === 'fan') content = <PasswordScreen
      embedded mode="change" credential={session.credential} service={passwordService} onBusyChange={setFanOperationBusy}
      onBack={() => setFlow('settings')} onDone={() => setFlow('settings')} />;
    else if (flow === 'settings' && session.principal.role === 'fan') content = <AccountSettingsScreen embedded auth={auth}
      onLogout={() => { void logout(); }}
      role="fan" onBusyChange={setFanOperationBusy} onPassword={() => setFlow('change')} onSupport={() => setFlow('support')}
      onBack={() => setFlow('login')} onDeleted={() => { setFlow('login'); setEmail(''); setPassword(''); }} />;
    else if (flow === 'settings') content = <View testID="guest-settings" style={styles.guestSettings}>
      <Text style={[styles.heading, { color: theme.text }]}>設定</Text>
      {support && <SettingsMenuItem testID="open-support" label="問い合わせ" onPress={() => setFlow('support')}
        symbol={{ ios: 'envelope', android: 'mail', web: 'mail' }} />}
      <SettingsMenuItem testID="logout" label="ログアウト" onPress={() => { void logout(); }}
        symbol={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} />
      <SettingsMenuItem testID="close-profile" label="ホームへ戻る" onPress={() => setFlow('login')}
        symbol={{ ios: 'house', android: 'home', web: 'home' }} />
    </View>;
    else {
      const homeError = localError ?? state.error ?? identificationState.error;
      content = <FanHomeScreen key={session.credential} role={session.principal.role} state={downloadState}
        loadPickupIdols={identification.loadPickupIdols}
        loadTrendingIdols={identification.loadTrendingIdols}
        qrBusy={identificationState.busy} authBusy={state.busy} error={homeError ? errorText[homeError] : null}
        onReception={() => { if (!busy) void identification.showFanCode(); }}
        onReceive={() => { if (!busy) void download?.startReceive(); }}
        onRefreshReceive={() => { void download?.refreshReceivables(); }} onAlbum={() => { void navigate('album'); }}
        onPhoto={async (photoId) => {
          if (busy) return;
          await download?.open();
          if (auth.getSnapshot().session?.credential === session.credential && download?.getSnapshot().phase === 'list') {
            identification.goHome(); setFlow('login'); download.showPhoto(photoId);
          }
        }}
        onSettings={session.principal.role === 'fan' ? () => { void navigate('settings'); } : undefined}
        onSupport={support ? () => setFlow('support') : undefined} onLogout={() => { void logout(); }} />;
    }
    const fanBackground = downloadOpen || !settingsOpen && identificationState.phase === 'home' ? '#f4f9ff'
      : identificationState.phase === 'fan-code' ? '#edf6ff' : theme.background;
    return <View style={[styles.rootScreen, { backgroundColor: fanBackground }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, { backgroundColor: 'transparent' }]}>
      <View style={styles.fanContent}>{content}</View>
      {footer}
      {download && downloadState?.receiveBatch && <ReceiveModal controller={download} state={downloadState} />}
    </SafeAreaView></View>;
  }
  if (session && captureState.phase !== 'home') return <CaptureScreen controller={capture} editing={editing} finishedImage={finishedImage}
    upload={upload} onHome={() => identification.goHome()}
    onSent={() => { identification.openReception(); capture.goHome(); }} />;
  if (session && identificationState.phase !== 'home') return <IdentificationScreen controller={identification}
    onStartCapture={async (intakeId) => { await capture.openIntake(intakeId);
      return capture.getSnapshot().intakeId === intakeId && capture.getSnapshot().phase !== 'home'; }} />;
  if (session && flow === 'manage' && session.principal.role === 'group' && photoManagement) return <PhotoManagementScreen key={session.credential}
    credential={session.credential} service={photoManagement} onBack={() => setFlow('login')} />;
  if (session && flow === 'support' && support) return <SupportScreen credential={session.credential} service={support}
    onBack={() => setFlow(session.principal.role === 'guest' ? 'login' : 'settings')} />;
  if (session && flow === 'settings' && (session.principal.role === 'fan' || session.principal.role === 'group')) return <AccountSettingsScreen auth={auth}
    onLogout={() => { void logout(); }}
    role={session.principal.role}
    onPassword={() => setFlow('change')} onSupport={() => setFlow('support')} onBack={() => setFlow('login')}
    onDeleted={() => { setFlow('login'); setEmail(''); setPassword(''); }} />;
  if (passwordService && session && flow === 'change' && session.principal.role !== 'guest') return <PasswordScreen
    mode="change" credential={session.credential} service={passwordService} onBack={() => setFlow('settings')}
    onDone={() => setFlow('settings')} />;
  if (passwordService && !session && flow === 'reset') return <PasswordScreen
    mode="reset" service={passwordService} inbox={mockPasswordInbox}
    onBack={() => setFlow('login')}
    onDone={() => setFlow('login')} />;
  const screen = <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
    <ScrollView contentContainerStyle={[styles.page, session ? styles.homePage : styles.loginPage]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Digital Instax</Text>
      </View>
      {session ? <View testID="group-home" style={[styles.card, styles.homeCard, { backgroundColor: theme.background }]}>
        <View testID="home-menu-grid" style={styles.menuGrid}>
            <MenuTile testID="start-intake" label="撮影" symbol={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
              tone={0}
              disabled={identificationState.busy || captureState.busy} onPress={() => identification.openReception()} />
            {photoManagement && <MenuTile testID="open-photo-management" label="写真"
              symbol={{ ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' }}
              tone={1}
              onPress={() => setFlow('manage')} />}
          <MenuTile testID="open-settings" label="設定"
            symbol={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }} tone={2}
            onPress={() => setFlow('settings')} />
          <MenuTile testID="logout" label="ログアウト" symbol={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }}
            tone={3} onPress={logout} />
        </View>
        {download && downloadState?.phase === 'closed' && downloadState.error &&
          <Text testID="download-open-error" accessibilityRole="alert" style={[styles.error, { color: theme.text }]}>アルバムを開けませんでした。もう一度お試しください。</Text>}
      </View> : <View testID="auth-form" style={styles.loginForm}>
        <AuthTabs active={flow === 'register' ? 'register' : 'login'} showRegister={!!enrollment}
          disabled={state.busy || enrollmentBusy || guestBusy} onLogin={() => setFlow('login')} onRegister={() => setFlow('register')} />
        {flow === 'register' && enrollment ? <EnrollmentScreen embedded enrollment={enrollment}
          auth={auth} onBack={() => setFlow('login')}
          onBusyChange={setEnrollmentBusy} /> : <View testID="login-form" style={styles.loginForm}>
        <View style={styles.loginFields}>
          <View style={styles.field}>
            <View style={styles.fieldLabel}><SymbolView name={{ ios: 'envelope', android: 'mail', web: 'mail' }} size={17} tintColor={theme.textSecondary} />
              <Text testID="email-label" style={[styles.label, { color: theme.text }]}>メールアドレス</Text></View>
            <TextInput testID="email" accessibilityLabel="メールアドレス" placeholder="メールアドレスを入力" placeholderTextColor={theme.textSecondary}
              autoCapitalize="none" keyboardType="email-address" autoComplete="email"
              style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.textSecondary }]}
              value={email} onChangeText={setEmail} editable={!state.busy && !guestBusy} />
          </View>
          <View style={styles.field}>
            <View style={styles.fieldLabel}><SymbolView name={{ ios: 'lock', android: 'lock', web: 'lock' }} size={17} tintColor={theme.textSecondary} />
              <Text testID="password-label" style={[styles.label, { color: theme.text }]}>パスワード</Text></View>
            <View style={[styles.passwordField, { backgroundColor: theme.background, borderColor: theme.textSecondary }]}>
              <TextInput testID="password" accessibilityLabel="パスワード" placeholder="パスワードを入力" placeholderTextColor={theme.textSecondary}
                secureTextEntry={!passwordVisible} autoComplete="current-password" style={[styles.passwordInput, { color: theme.text }]}
                value={password} onChangeText={setPassword} editable={!state.busy && !guestBusy} />
              <Pressable testID="toggle-password-visibility" accessibilityRole="button"
                accessibilityLabel={passwordVisible ? 'パスワードを隠す' : 'パスワードを表示'} disabled={state.busy || guestBusy}
                style={styles.visibilityButton} onPress={() => setPasswordVisible((visible) => !visible)}>
                <SymbolView name={{ ios: passwordVisible ? 'eye' : 'eye.slash', android: passwordVisible ? 'visibility' : 'visibility_off',
                  web: passwordVisible ? 'visibility' : 'visibility_off' }} size={19} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
          </View>
        </View>
        {passwordService && <Pressable testID="open-password-reset" accessibilityRole="button" disabled={state.busy || guestBusy}
          style={styles.resetLink} onPress={() => setFlow('reset')}><Text style={styles.linkText}>パスワードを再設定</Text></Pressable>}
        {(state.busy || guestBusy) && <ScreenProgress testID="login-progress" label="ログイン中" />}
        <Pressable testID="login" accessibilityRole="button" disabled={state.busy || guestBusy}
          style={[styles.button, styles.loginButton, (state.busy || guestBusy) && styles.disabled]} onPress={login}>
          <Text style={styles.buttonText}>ログイン</Text></Pressable>
        {enrollment && <Pressable testID="choose-guest" accessibilityRole="button" disabled={state.busy || guestBusy}
          style={[styles.secondary, (state.busy || guestBusy) && styles.disabled]} onPress={() => { void enterAsGuest(); }}>
          <Text style={styles.linkText}>ゲストで始める</Text></Pressable>}
        </View>}
      </View>}
      {(localError ?? state.error) && <Text testID="auth-error" accessibilityRole="alert" style={[styles.error, { color: theme.text }]}>{errorText[localError ?? state.error!]}</Text>}
    </ScrollView>
  </SafeAreaView>;
  return <View style={styles.rootScreen}>{screen}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, rootScreen: { flex: 1 }, page: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  fanContent: { flex: 1 }, guestSettings: { flex: 1, padding: 24, gap: 8 },
  homePage: { justifyContent: 'flex-start' },
  loginPage: { justifyContent: 'flex-start' },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 30, fontWeight: '700', flex: 1, textAlign: 'center' }, card: { gap: 16, padding: 20, borderWidth: 1, borderColor: '#aaa', borderRadius: 16 },
  homeCard: { borderWidth: 0, paddingHorizontal: 0, paddingVertical: 8 },
  heading: { fontSize: 22, fontWeight: '600' }, body: { fontSize: 18 }, note: { fontSize: 14 },
  resumeSection: { gap: 10 },
  resumeButton: { gap: 4, padding: 10, borderWidth: 1, borderRadius: 8 },
  label: { fontSize: 15, fontWeight: '600' }, input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: primaryButtonColor, padding: 14, borderRadius: 8, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '600' },
  loginForm: { gap: 22 },
  loginFields: { gap: 22, paddingTop: 4 }, field: { gap: 8 }, fieldLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passwordField: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8 },
  passwordInput: { flex: 1, padding: 12, fontSize: 16 }, visibilityButton: { padding: 12 },
  resetLink: { alignSelf: 'flex-start', paddingVertical: 4 }, linkText: { color: primaryButtonColor, fontWeight: '600' },
  loginButton: { borderRadius: 24, minHeight: 50, justifyContent: 'center' },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  menuTile: { width: '49%', aspectRatio: 1, borderRadius: 3,
    alignItems: 'center', justifyContent: 'center', padding: 10 },
  menuTileContent: { alignItems: 'center', gap: 12, transform: [{ translateY: -14 }] },
  menuTileText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondary: { alignItems: 'center', padding: 10 }, disabled: { opacity: 0.5 }, error: { textAlign: 'center' },
});
