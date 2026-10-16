import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import type { AuthService, AuthSession } from '@/services/contracts/auth';
import type { EnrollmentService } from '@/services/contracts/enrollment';
import type { PasswordService } from '@/services/contracts/password';
import type { LocalPhotoManagementService } from '@/services/contracts/photo-management';
import { IdentificationController } from '@/features/identification/identification-controller';
import { CaptureController } from '@/features/capture/capture-controller';
import { CaptureScreen } from '@/features/capture/capture-screen';
import { EditingController } from '@/features/editing/editing-controller';
import { FinishedImageController } from '@/features/finished-image/finished-image-controller';
import { DownloadController } from '@/features/download/download-controller';
import type { DownloadIntake, DownloadService } from '@/services/contracts/download';

import { AuthController } from './auth-controller';
import { AuthScreen } from './auth-screen';
import { fanBubbleLayout, fanBubbleMotion, fanBubbleSize } from './fan-bubble-menu';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({ ...jest.requireActual('react-native-reanimated/mock'),
  useFrameCallback: () => ({ setActive: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/features/editing/editing-screen', () => ({ EditingScreen: () => null }));
jest.mock('@/features/identification/qr-scanner', () => ({ QrScanner: () => null }));
jest.mock('@/features/capture/capture-camera', () => ({ CaptureCamera: () => null }));

const mockTheme = { text: '#ffffff', background: '#000000', backgroundElement: '#212225', textSecondary: '#B0B4BA' };
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => mockTheme }));

it('keeps floating circles apart while fitting the largest size in a regular viewport', () => {
  const { size, rowStep } = fanBubbleLayout(390, 844, 1, 4, 93);
  expect(size).toBeGreaterThan(190);
  expect(rowStep).toBeLessThan(size);
  expect(size + 3 * rowStep).toBeLessThanOrEqual(844 - 93 - 88);
  const sizes = [0, 1, 2, 3].map((index) => fanBubbleSize(size, index));
  expect(new Set(sizes).size).toBe(4);
  expect(Math.max(...sizes)).toBe(size);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(size * 0.88);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(size * 0.1);
  expect(sizes[3]).toBeGreaterThan(sizes[2]);
  for (let first = 0; first < sizes.length; first++) {
    for (let next = first + 1; next < sizes.length; next++) {
      const firstRadius = sizes[first] / 2;
      const nextRadius = sizes[next] / 2;
      const horizontal = (next - first) % 2 === 0
        ? Math.abs(firstRadius - nextRadius) : 390 - 72 - firstRadius - nextRadius;
      const safeHorizontal = Math.max(0, horizontal - fanBubbleMotion.horizontalMotionBuffer);
      const safeVertical = (next - first) * rowStep - fanBubbleMotion.verticalMotionBuffer;
      expect(Math.hypot(safeHorizontal, safeVertical)).toBeGreaterThanOrEqual(
        firstRadius + nextRadius + fanBubbleMotion.visibleGap - 0.01);
    }
  }
  expect(fanBubbleLayout(430, 956, 1, 4, 93).size).toBeGreaterThan(size);
  const enlarged = fanBubbleLayout(390, 844, 1.5, 4, 93);
  expect(enlarged.size).toBeGreaterThan(size);
  expect(enlarged.rowStep).toBeGreaterThan(0);
});

const group: AuthSession = { principal: { id: 'group-a', role: 'group', displayName: 'グループA' }, credential: 'group-token', expiresAt: '2026-09-26T00:00:00.000Z' };
const fan: AuthSession = { principal: { id: 'fan-a', role: 'fan', displayName: 'ファンA' }, credential: 'fan-token', expiresAt: '2026-09-26T00:00:00.000Z' };
function identificationFor(auth: AuthController) {
  return new IdentificationController(auth, {
    getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => ({ number: '700001', qrPayload: 'dc:1:member:member-a' }),
    getOwnRecipientRef: async () => 'recipient-member-a',
    resolveQr: async () => null, resolveNumber: async () => null, listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [],
    saveIntake: async () => { throw new Error('unused'); }, getLatestIntake: async () => null, listIntakes: async () => [],
  });
}
function captureFor(auth: AuthController) {
  return new CaptureController(auth, {
    listSessions: async () => [], listPhotos: async () => [],
    savePhoto: async () => { throw new Error('unused'); }, discardPhoto: async () => {},
  });
}
function editingFor(auth: AuthController) {
  return new EditingController(auth, {
    load: async () => { throw new Error('unused'); }, append: async () => { throw new Error('unused'); },
    undo: async () => { throw new Error('unused'); }, setFrame: async () => { throw new Error('unused'); },
    setQuality: async () => { throw new Error('unused'); },
    saveDraft: async () => { throw new Error('unused'); },
  }, { next: () => 'unused' });
}
function finishedFor(auth: AuthController) {
  return new FinishedImageController(auth, {
    prepare: async () => { throw new Error('unused'); }, confirm: async () => { throw new Error('unused'); },
    getSaved: async () => [], isConfirmed: async () => false,
  });
}

it('routes group management and support, then fan settings without exposing the prior role', async () => {
  let credential: string | null = null;
  let next = group;
  const auth = new AuthController({ signIn: async () => next, restore: async (value) => value === fan.credential ? fan : group,
    signOut: async () => {}, deleteAccount: async () => {} },
  { read: async () => credential, write: async (value) => { credential = value; }, remove: async () => { credential = null; } });
  const photoManagement: LocalPhotoManagementService = { list: async () => ({ intakes: [], lowSpace: false }),
    retryUpload: async () => { throw new Error('unused'); },
    deleteUploaded: async () => {} };
  const support = { submit: async () => ({ id: 'ticket-1', acceptedAt: '2026-09-25T00:00:00.000Z' }) };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} photoManagement={photoManagement} support={support} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  const fill = async (id: string, value: string) => { await act(async () => { find(id)[0].props.onChangeText(value); }); };
  await fill('email', 'group@example.test'); await fill('password', 'DemoPass123'); await press('login');
  expect(find('principal-name')).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).filter((item) => item.props.children === 'Digital Instax')).toHaveLength(1);
  expect(renderer.root.findAllByType(Text).some((item) =>
    ['グループホーム', 'ファンホーム', 'ゲストホーム', 'グループA'].includes(item.props.children))).toBe(false);
  expect(StyleSheet.flatten(renderer.root.findByType(ScrollView).props.contentContainerStyle).justifyContent).toBe('flex-start');
  expect(find('start-intake')[0].findByType(Text).props.children).toBe('撮影');
  expect(find('open-photo-management')[0].findByType(Text).props.children).toBe('写真');
  await press('open-photo-management');
  expect(find('management-back').length).toBeGreaterThan(0);
  await press('management-back');
  expect(find('open-password-change')).toHaveLength(0);
  expect(find('open-support')).toHaveLength(0);
  expect(StyleSheet.flatten(find('home-menu-grid')[0].props.style)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
  expect(StyleSheet.flatten(find('home-menu-tile-content')[0].props.style)).toMatchObject({ transform: [{ translateY: -14 }] });
  expect(StyleSheet.flatten(find('start-intake').find((item) => item.props.style)?.props.style)).toMatchObject({ width: '49%', aspectRatio: 1 });
  expect(StyleSheet.flatten(find('start-intake')[0].find((item) => item.props.style).props.style).backgroundColor).toBe('#174c8f');
  expect(StyleSheet.flatten(find('open-photo-management')[0].find((item) => item.props.style).props.style).backgroundColor).toBe('#205798');
  expect(StyleSheet.flatten(find('open-settings')[0].find((item) => item.props.style).props.style).backgroundColor).toBe('#2b62a0');
  expect(StyleSheet.flatten(find('logout')[0].find((item) => item.props.style).props.style).backgroundColor).toBe('#376da8');
  expect(StyleSheet.flatten(find('open-settings').find((item) => item.props.style)?.props.style)).toMatchObject({ width: '49%', aspectRatio: 1 });
  await press('open-settings');
  expect(find('settings-password').length).toBeGreaterThan(0);
  expect(find('settings-support').length).toBeGreaterThan(0);
  expect(find('settings-logout').length).toBeGreaterThan(0);
  expect(find('open-account-delete')).toHaveLength(0);
  await press('settings-support');
  expect(find('support-subject').length).toBeGreaterThan(0);
  await press('support-cancel');
  expect(find('settings-back').length).toBeGreaterThan(0);
  await press('settings-logout');
  next = fan;
  await fill('email', 'fan@example.test'); await fill('password', 'DemoPass123'); await press('login');
  expect(find('principal-name')).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).filter((item) => item.props.children === 'Digital Instax')).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).some((item) =>
    ['グループホーム', 'ファンホーム', 'ゲストホーム', 'ファンA'].includes(item.props.children))).toBe(false);
  expect(find('open-photo-management')).toHaveLength(0);
  expect(find('fan-home-reception-card')).toHaveLength(1);
  expect(find('fan-home-tabs')).toHaveLength(1);
  expect(find('fan-bubble-menu')).toHaveLength(0);
  expect(find('home-menu-grid')).toHaveLength(0);
  await press('open-settings');
  expect(find('open-account-delete').length).toBeGreaterThan(0);
  await press('settings-support');
  expect(find('support-subject').length).toBeGreaterThan(0);
  await act(async () => { renderer.unmount(); });
});

it('does not offer a pre-send intake for resumption on the group home', async () => {
  const auth = new AuthController({ signIn: async () => group, restore: async () => group, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const capture = new CaptureController(auth, {
    listSessions: async () => [
      { intake: { id: 'older', groupId: 'group-a', recipientRef: 'private-a', idolIds: ['idol-a'],
        acceptedAt: '2026-09-24T10:00:00.000Z' }, photoCount: 1, needsAttention: false },
      { intake: { id: 'newer', groupId: 'group-a', recipientRef: 'private-b', idolIds: ['idol-a', 'idol-a2'],
        acceptedAt: '2026-09-25T10:00:00.000Z' }, photoCount: 3, needsAttention: false, confirmed: true },
    ], listPhotos: async () => [], savePhoto: async () => { throw new Error('unused'); }, discardPhoto: async () => {},
  });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={capture}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('email')[0].props.onChangeText('group@example.test');
    find('password')[0].props.onChangeText('DemoPass123'); });
  await act(async () => { await find('login')[0].props.onPress(); });
  expect(find('open-intake-list')).toHaveLength(0);
  expect(find('group-intake-list')).toHaveLength(0);
  expect(find('group-resume-intakes')).toHaveLength(0);
  expect(find('resume-newer')).toHaveLength(0);
  expect(find('resume-older')).toHaveLength(0);
  expect(find('show-latest-intake')).toHaveLength(0);
  expect(capture.getSnapshot().intakeId).toBeNull();
  expect(JSON.stringify(renderer.toJSON())).not.toMatch(/private-a|private-b/);
  await act(async () => { renderer.unmount(); });
});

it('opens the camera directly after saving a new intake, without a saved screen', async () => {
  const auth = new AuthController({ signIn: async () => group, restore: async () => group, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const intake = { id: 'new-intake', groupId: 'group-a', recipientRef: 'recipient-a', idolIds: ['idol-a'],
    acceptedAt: '2026-09-25T00:00:00.000Z' };
  const identification = new IdentificationController(auth, {
    getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => { throw new Error('unused'); }, getOwnRecipientRef: async () => { throw new Error('unused'); },
    resolveQr: async () => null, resolveNumber: async () => ({ recipientRef: 'recipient-a', kind: 'member' }),
    listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [{ id: 'idol-a', name: 'アイドルA' }],
    saveIntake: async () => intake, getLatestIntake: async () => null, listIntakes: async () => [],
  });
  const capture = new CaptureController(auth, {
    listSessions: async () => [{ intake, photoCount: 0, needsAttention: false }], listPhotos: async () => [],
    savePhoto: async () => { throw new Error('unused'); }, discardPhoto: async () => {},
  });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identification} capture={capture}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('email')[0].props.onChangeText('group@example.test');
    find('password')[0].props.onChangeText('DemoPass123'); });
  await act(async () => { find('login')[0].props.onPress(); });
  await act(async () => { find('start-intake')[0].props.onPress(); });
  await act(async () => { identification.openNumber(); });
  await act(async () => { find('recipient-number')[0].props.onChangeText('700001');
    find('check-number')[0].props.onPress(); });
  await act(async () => { find('idol-idol-a')[0].props.onPress(); });
  await act(async () => { find('save-intake')[0].props.onPress(); });
  expect(capture.getSnapshot()).toMatchObject({ phase: 'camera', intakeId: 'new-intake' });
  expect(find('intake-saved')).toHaveLength(0);
  expect(find('start-capture')).toHaveLength(0);
  expect(find('capture-home')).toHaveLength(0);
  await act(async () => { capture.showReview(); });
  await act(async () => { renderer.root.findByType(CaptureScreen).props.onSent(); });
  expect(capture.getSnapshot().phase).toBe('home');
  expect(identification.getSnapshot()).toMatchObject({ phase: 'scan', recipient: null, selectedIds: [] });
  expect(find('scan-screen')).toHaveLength(1);
  expect(find('capture-home')).toHaveLength(0);
  await act(async () => { find('intake-back')[0].props.onPress(); });
  expect(find('group-home')).toHaveLength(1);
  await act(async () => { find('start-intake')[0].props.onPress(); });
  expect(identification.getSnapshot()).toMatchObject({ phase: 'scan', recipient: null, latestIntake: null });
  await act(async () => { renderer.unmount(); });
});

it('keeps the fan home shortcuts and receive inbox without notification screens', async () => {
  const fanB: AuthSession = { credential: 'fan-b-token', principal: { id: 'fan-b', role: 'fan', displayName: 'ファンB' }, expiresAt: fan.expiresAt };
  let stored: string | null = null;
  const auth = new AuthController({ signIn: async ({ email }) => email === 'fan-b@example.test' ? fanB : fan,
    restore: async (value) => value === fanB.credential ? fanB : fan, signOut: async () => {} },
  { read: async () => stored, write: async (value) => { stored = value; }, remove: async () => { stored = null; } });
  const notices = [{ intakeId: 'i1', createdAt: '2026-09-25T01:00:00.000Z', message: '到着1', read: false },
    { intakeId: 'i2', createdAt: '2026-09-25T02:00:00.000Z', message: '到着2', read: false },
    { intakeId: 'i3', createdAt: '2026-09-25T03:00:00.000Z', message: '既読', read: true }];
  const listNotifications = jest.fn(async (credential: string) => credential === fan.credential ? notices : []);
  const service: DownloadService = { list: async () => [], download: async () => [], setFavorite: async () => [],
    listNotifications, markNotificationRead: async () => {} };
  const download = new DownloadController(auth, service);
  const passwordService: PasswordService = { changePassword: async () => {}, requestReset: async () => ({
    requestId: 'r1', email: 'fan@example.test', expiresAt: fan.expiresAt }), completeReset: async () => {} };
  const support = { submit: async () => ({ id: 'ticket-1', acceptedAt: fan.expiresAt }) };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} download={download} passwordService={passwordService}
    support={support} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  const fill = async (id: string, value: string) => { await act(async () => { find(id)[0].props.onChangeText(value); }); };
  await fill('email', 'fan@example.test'); await fill('password', 'DemoPass123'); await press('login');
  expect(find('notification-bell')).toHaveLength(0);
  expect(listNotifications).not.toHaveBeenCalled();
  expect(find('show-fan-code')[0].findByType(Text).props.children).toBe('QRコードを表示');
  expect(find('show-downloads')[0].findByType(Text).props.children).toBe('アルバム');
  expect(find('show-album-search')).toHaveLength(0);
  expect(find('show-favorites')).toHaveLength(0);
  expect(find('show-notifications')).toHaveLength(0);
  expect(find('open-password-change')).toHaveLength(0);
  expect(find('open-support')).toHaveLength(0);
  expect(find('fan-home-reception-background')).toHaveLength(1);
  expect(find('fan-home-reception-background')[0].props.resizeMode).toBe('cover');
  expect(StyleSheet.flatten(find('fan-home-reception-background')[0].props.style)).toMatchObject({ width: '100%', height: '100%' });
  expect(find('fan-home-receive-card')).toHaveLength(1);
  expect(find('fan-home-recent-album')).toHaveLength(1);
  expect(find('fan-home-tabs')).toHaveLength(1);
  expect(renderer.root.findByType(ScrollView).findAll((item) => item.props.testID === 'fan-home-tabs')).toHaveLength(0);
  expect(find('fan-bubble-menu')).toHaveLength(0);
  expect(find('home-menu-grid')).toHaveLength(0);
  expect(find('open-settings')[0].findByType(Text).props.children).toBe('設定');
  expect(find('receive-inbox-button').length).toBeGreaterThan(0);
  expect(find('receive-inbox-button')[0].findByType(Text).props.children).toBe('写真を受け取る');
  expect(find('logout')).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).filter((item) => item.props.children === 'Digital Instax')).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).filter((item) => item.props.children === 'Poyo Photo')).toHaveLength(1);
  await press('open-settings');
  expect(JSON.stringify(renderer.toJSON())).toContain('設定');
  expect(find('settings-password').length).toBeGreaterThan(0);
  expect(find('settings-support').length).toBeGreaterThan(0);
  await press('settings-back');
  await press('receive-inbox-button');
  expect(find('receive-modal')).toHaveLength(0);
  expect(find('fan-home')).toHaveLength(1);
  await press('open-profile');
  await press('logout');
  expect(find('notification-bell')).toHaveLength(0);
  await fill('email', 'fan-b@example.test'); await fill('password', 'DemoPass123'); await press('login');
  expect(find('notification-bell')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('keeps the fan home visible until the album is ready instead of flashing an old or empty grid', async () => {
  const auth = new AuthController({ signIn: async () => fan, restore: async () => fan, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  let deferred = false;
  let finish!: (items: DownloadIntake[]) => void;
  const album: DownloadIntake[] = [{ intakeId: 'intake-a', createdAt: '2026-09-25T00:00:00.000Z',
    groupId: 'group-a', groupName: 'グループA', idolIds: ['idol-a'], idolNames: ['アイドルA'],
    photos: [{ photoId: 'photo-a', intakeId: 'intake-a', capturedAt: '2026-09-25T00:00:00.000Z',
      expiresAt: '2026-10-02T00:00:00.000Z', status: 'received', progressPercent: 100,
      localUri: 'file:///fan-a/photo-a.jpg', favorite: false }] }];
  const service: DownloadService = { list: async () => deferred ? new Promise((resolve) => { finish = resolve; }) : album,
    download: async () => album, setFavorite: async () => album, listNotifications: async () => [], markNotificationRead: async () => {} };
  const download = new DownloadController(auth, service);
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} download={download} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  deferred = true;
  const safeArea = renderer.root.findByType(SafeAreaView);
  await act(async () => { find('show-downloads')[0].props.onPress(); });
  expect(find('fan-home')).toHaveLength(1);
  expect(find('show-downloads')[0].props.disabled).toBe(true);
  expect(find('album-grid-photo-0')).toHaveLength(0);
  await act(async () => { finish(album); });
  expect(find('fan-home')).toHaveLength(0);
  expect(find('album-grid-photo-0').length).toBeGreaterThan(0);
  expect(find('download-progress')).toHaveLength(0);
  expect(renderer.root.findAllByType(SafeAreaView)).toHaveLength(1);
  expect(renderer.root.findByType(SafeAreaView)).toBe(safeArea);
  await act(async () => { find('fan-home-tab')[0].props.onPress(); });
  expect(renderer.root.findByType(SafeAreaView)).toBe(safeArea);
  await act(async () => { find('show-downloads')[0].props.onPress(); });
  expect(find('fan-home')).toHaveLength(1);
  expect(find('album-grid-photo-0')).toHaveLength(0);
  await act(async () => { finish(album); });
  expect(find('album-grid-photo-0').length).toBeGreaterThan(0);
  await act(async () => { renderer.unmount(); });
});

it('uses current recipient data for the receive count and recent album, then opens the chosen local photo', async () => {
  const auth = new AuthController({ signIn: async () => fan, restore: async () => fan, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const intakes: DownloadIntake[] = [{ intakeId: 'recent-intake', createdAt: '2026-09-25T00:00:00.000Z',
    groupId: 'group-a', groupName: 'グループA', idolIds: ['idol-a'], idolNames: ['アイドルA'], photos: [
      { photoId: 'recent-old', intakeId: 'recent-intake', capturedAt: '2026-09-23T12:00:00.000Z',
        expiresAt: fan.expiresAt, status: 'received', progressPercent: 100,
        localUri: 'file:///fan-a/recent-old.jpg', favorite: false },
      { photoId: 'recent-new', intakeId: 'recent-intake', capturedAt: '2026-09-25T12:00:00.000Z',
        expiresAt: fan.expiresAt, status: 'received', progressPercent: 100,
        localUri: 'file:///fan-a/recent-new.jpg', favorite: false },
      { photoId: 'recent-middle', intakeId: 'recent-intake', capturedAt: '2026-09-24T12:00:00.000Z',
        expiresAt: fan.expiresAt, status: 'received', progressPercent: 100,
        localUri: 'file:///fan-a/recent-middle.jpg', favorite: true },
      { photoId: 'receive-waiting', intakeId: 'recent-intake', capturedAt: '2026-09-26T12:00:00.000Z',
        expiresAt: fan.expiresAt, status: 'unreceived', progressPercent: 0,
        localUri: null, previewUri: 'file:///authorized-preview/waiting.jpg', favorite: false },
      { photoId: 'receive-failed', intakeId: 'recent-intake', capturedAt: '2026-09-26T13:00:00.000Z',
        expiresAt: fan.expiresAt, status: 'failed', progressPercent: 0,
        localUri: null, previewUri: 'file:///authorized-preview/failed.jpg', favorite: false },
      { photoId: 'removed-photo', intakeId: 'recent-intake', capturedAt: '2026-09-27T12:00:00.000Z',
        expiresAt: fan.expiresAt, status: 'removed', progressPercent: 100, localUri: null, favorite: false },
      { photoId: 'expired-photo', intakeId: 'recent-intake', capturedAt: '2026-09-27T13:00:00.000Z',
        expiresAt: fan.expiresAt, status: 'expired', progressPercent: 0, localUri: null, favorite: false },
    ] }];
  const downloadPhoto = jest.fn(async () => intakes);
  const listNotifications = jest.fn(async () => []);
  const download = new DownloadController(auth, { list: async () => intakes, download: downloadPhoto,
    setFavorite: async () => intakes, listNotifications, markNotificationRead: async () => {} });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)}
    capture={captureFor(auth)} editing={editingFor(auth)} finishedImage={finishedFor(auth)} download={download} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { await find(id)[0].props.onPress(); }); };
  await act(async () => { find('email')[0].props.onChangeText('fan@example.test');
    find('password')[0].props.onChangeText('DemoPass123'); });
  await press('login');
  expect(find('fan-home-receive-count')[0].props.children).toBe('2');
  expect(find('fan-home-pending-badge')[0].props.children).toBe(2);
  expect(find('fan-home-tab')[0].props.accessibilityLabel).toBe('ホーム、未受信2枚');
  expect(find('receive-inbox-button')[0].props.accessibilityLabel).toBe('写真を受け取る、未受信2枚');
  const recentPhotoIds = [...new Set(renderer.root.findAll((item) => typeof item.type !== 'string' &&
    typeof item.props.testID === 'string' && item.props.testID.startsWith('home-album-photo-'))
    .map((item) => item.props.testID))];
  expect(recentPhotoIds).toEqual(['home-album-photo-recent-new', 'home-album-photo-recent-middle', 'home-album-photo-recent-old']);
  expect(find('home-album-photo-receive-waiting')).toHaveLength(0);
  expect(find('home-album-photo-removed-photo')).toHaveLength(0);
  expect(find('home-album-photo-expired-photo')).toHaveLength(0);
  expect(downloadPhoto).not.toHaveBeenCalled();
  expect(listNotifications).not.toHaveBeenCalled();
  await press('home-album-photo-recent-middle');
  expect(download.getSnapshot()).toMatchObject({ phase: 'photo', selectedPhotoId: 'recent-middle', selectedIntakeId: 'recent-intake' });
  expect(find('fan-home')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('opens reset from login and change from group settings without replacing G-002', async () => {
  let credential: string | null = null;
  const auth = new AuthController({ signIn: async () => group, restore: async () => group, signOut: async () => {} },
    { read: async () => credential, write: async (value) => { credential = value; }, remove: async () => { credential = null; } });
  const changePassword = jest.fn(async () => {});
  const completeReset = jest.fn(async () => {});
  const passwordService: PasswordService = { changePassword, completeReset,
    requestReset: async () => ({ requestId: 'reset-1', email: 'group@example.test', expiresAt: '2026-09-25T00:10:00.000Z' }) };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} passwordService={passwordService}
    mockPasswordInbox={{ readReference: async () => 'mock-reference' }} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  const fill = async (id: string, value: string) => { await act(async () => { find(id)[0].props.onChangeText(value); }); };
  await press('open-password-reset');
  expect(find('password-reset-form')).toHaveLength(1);
  await fill('reset-email', 'group@example.test');
  await press('request-reset');
  expect(find('show-reset-inbox')[0].findByType(Text).props.children).toBe('再設定コードを表示');
  expect(find('reset-reference')[0].props.accessibilityLabel).toBe('再設定コード');
  expect(find('reset-reference')[0].props.placeholder).toBe('上に表示されたコードを入力');
  await press('show-reset-inbox');
  expect(find('reset-inbox-reference')[0].props.children).toEqual(['再設定コード：', 'mock-reference']);
  await fill('reset-reference', 'mock-reference');
  await fill('new-password', 'NewGroup123');
  await fill('confirm-password', 'NewGroup123');
  await press('submit-password');
  expect(completeReset).toHaveBeenCalledWith('reset-1', 'mock-reference', 'NewGroup123');
  await press('password-done');
  expect(find('login-form')).toHaveLength(1);
  await fill('email', 'group@example.test');
  await fill('password', 'NewGroup123');
  await press('login');
  expect(find('group-home')).toHaveLength(1);
  await press('open-settings');
  await press('settings-password');
  expect(find('password-change-form')).toHaveLength(1);
  await fill('current-password', 'NewGroup123');
  await fill('new-password', 'AnotherGroup123');
  await fill('confirm-password', 'AnotherGroup123');
  await press('submit-password');
  expect(changePassword).toHaveBeenCalledWith(group.credential, 'NewGroup123', 'AnotherGroup123');
  await press('password-done');
  expect(find('settings-back').length).toBeGreaterThan(0);
  await press('settings-back');
  expect(find('group-home')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('opens the guest home directly and resumes the same guest on the next entry', async () => {
  const guest: AuthSession = { principal: { id: 'guest-new', role: 'guest', displayName: 'ゲスト' },
    credential: 'guest-token', expiresAt: fan.expiresAt };
  let credential: string | null = null;
  const auth = new AuthController({ signIn: async () => fan, restore: async (value) => value === 'guest-token' ? guest : fan,
    signOut: async () => {} }, { read: async () => credential, write: async (value) => { credential = value; }, remove: async () => { credential = null; } });
  let savedGuest = false;
  const startGuest = jest.fn(async () => { savedGuest = true; return guest; });
  const resumeGuest = jest.fn(async () => savedGuest ? guest : null);
  const requestRegistration = jest.fn(async () => ({ requestId: 'request-1', email: 'new@example.test', expiresAt: '2026-09-25T00:10:00.000Z' }));
  const enrollment: EnrollmentService = {
    requestRegistration,
    resendCode: async () => ({ requestId: 'request-1', email: 'new@example.test', expiresAt: '2026-09-25T00:11:00.000Z' }),
    verifyCode: async (_id, code) => { if (code !== '000097') throw Error('wrong code'); return fan; },
    startGuest, resumeGuest, hasResumableGuest: async () => savedGuest,
  };
  const identification = identificationFor(auth);
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identification} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} enrollment={enrollment}
    support={{ submit: async () => ({ id: 'guest-ticket', acceptedAt: fan.expiresAt }) }} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  const fill = async (id: string, value: string) => { await act(async () => { find(id)[0].props.onChangeText(value); }); };
  expect(find('login-tabs')).toHaveLength(1);
  expect(find('choose-register')[0].findByType(Text).props.children).toBe('新規作成');
  expect(find('choose-guest')[0].findByType(Text).props.children).toBe('ゲストで始める');
  const sharedScroll = renderer.root.findByType(ScrollView);
  const sharedHeader = renderer.root.findAllByType(Text).find((item) => item.props.children === 'Digital Instax');
  await press('choose-register');
  expect(renderer.root.findByType(ScrollView)).toBe(sharedScroll);
  expect(renderer.root.findAllByType(Text).filter((item) => item.props.children === 'Digital Instax')).toHaveLength(1);
  expect(renderer.root.findAllByType(Text).find((item) => item.props.children === 'Digital Instax')).toBe(sharedHeader);
  expect(find('login-tabs')).toHaveLength(1);
  expect(find('choose-login').length).toBeGreaterThan(0);
  expect(find('choose-register')).toHaveLength(0);
  expect(find('registration-form')).toHaveLength(1);
  await press('choose-login');
  expect(renderer.root.findByType(ScrollView)).toBe(sharedScroll);
  expect(find('login-form')).toHaveLength(1);
  await press('choose-register');
  expect(find('registration-form')).toHaveLength(1);
  await fill('registration-email', 'new@example.test');
  await fill('registration-name', '新規ファン');
  expect(find('registration-password')[0].props.value).toBe('');
  expect(find('registration-password')[0].props.secureTextEntry).toBe(true);
  await fill('registration-password', 'MyOwnPass456!');
  expect(find('registration-password')[0].props.value).toBe('MyOwnPass456!');
  expect(find('toggle-registration-password')).toHaveLength(0);
  await press('request-registration');
  expect(requestRegistration).toHaveBeenCalledWith({ email: 'new@example.test', displayName: '新規ファン', password: 'MyOwnPass456!' });
  expect(find('login-tabs')).toHaveLength(1);
  expect(find('verification-form')).toHaveLength(1);
  expect(find('show-mock-inbox')).toHaveLength(0);
  expect(find('mock-inbox-code')).toHaveLength(0);
  expect(find('verification-expiry')[0].props.children[1]).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('2026-09-25T00:10:00.000Z');
  await fill('verification-code', '000097');
  await press('verify-registration');
  expect(find('fan-home')).toHaveLength(1);
  await press('open-profile');
  await press('logout');
  await press('choose-guest');
  expect(find('guest-start')).toHaveLength(0);
  expect(find('guest-home')).toHaveLength(1);
  expect(renderer.root.findAllByType(Text).filter((item) => item.props.children === 'Digital Instax')).toHaveLength(0);
  expect(find('principal-name')).toHaveLength(0);
  expect(find('fan-code-screen')).toHaveLength(0);
  expect(resumeGuest).toHaveBeenCalledTimes(1);
  expect(startGuest).toHaveBeenCalledTimes(1);
  expect(auth.getSnapshot().session?.principal.role).toBe('guest');
  expect(find('show-fan-code')[0].findByType(Text).props.children).toBe('QRコードを表示');
  expect(find('open-settings')).toHaveLength(0);
  expect(find('guest-profile-settings').length).toBeGreaterThan(0);
  await press('guest-profile-settings');
  expect(find('logout').length).toBeGreaterThan(0);
  await press('logout');
  await press('choose-guest');
  expect(find('guest-home')).toHaveLength(1);
  expect(auth.getSnapshot().session?.principal.id).toBe(guest.principal.id);
  expect(resumeGuest).toHaveBeenCalledTimes(2);
  expect(startGuest).toHaveBeenCalledTimes(1);
  await press('open-profile');
  expect(find('profile-settings')).toHaveLength(0);
  await press('open-support');
  expect(find('support-subject').length).toBeGreaterThan(0);
  await press('support-cancel');
  expect(find('guest-home')).toHaveLength(1);
  expect(find('settings-password')).toHaveLength(0);
  expect(find('open-account-delete')).toHaveLength(0);
  await press('show-fan-code');
  expect(find('fan-code-screen')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('does not issue a replacement guest if saved guest recovery fails', async () => {
  const auth = new AuthController({ signIn: async () => fan, restore: async () => fan, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const startGuest = jest.fn(async () => { throw Error('must not create a new guest'); });
  const enrollment: EnrollmentService = {
    requestRegistration: async () => { throw Error('unused'); },
    resendCode: async () => { throw Error('unused'); },
    verifyCode: async () => { throw Error('unused'); },
    resumeGuest: async () => { throw Error('saved guest unavailable'); },
    startGuest, hasResumableGuest: async () => true,
  };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} enrollment={enrollment} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('choose-guest')[0].props.onPress(); });
  expect(find('login-form')).toHaveLength(1);
  expect(find('guest-home')).toHaveLength(0);
  expect(find('auth-error').length).toBeGreaterThan(0);
  expect(startGuest).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});

it('uses one login form and switches protected homes by the returned principal', async () => {
  let credential: string | null = null;
  const service: AuthService = {
    signIn: async ({ email }) => email === 'group@example.test' ? group : fan,
    restore: async (value) => value === 'group-token' ? group : fan,
    signOut: async () => {},
  };
  const auth = new AuthController(service, {
    read: async () => credential,
    write: async (value) => { credential = value; },
    remove: async () => { credential = null; },
  });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)} editing={editingFor(auth)} finishedImage={finishedFor(auth)} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { await find(id)[0].props.onPress(); }); };
  const fill = async (id: string, value: string) => { await act(async () => { find(id)[0].props.onChangeText(value); }); };
  expect(find('login-form')).toHaveLength(1);
  expect(find('login-tabs')).toHaveLength(1);
  expect(StyleSheet.flatten(renderer.root.findByType(ScrollView).props.contentContainerStyle).justifyContent).toBe('flex-start');
  expect(find('choose-group')).toHaveLength(0);
  expect(find('choose-fan')).toHaveLength(0);
  expect(find('clear-login')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('グループ共通アカウント・ファン会員共通');
  expect(find('group-home')).toHaveLength(0);
  expect(find('email-label')[0].props.children).toBe('メールアドレス');
  expect(find('password-label')[0].props.children).toBe('パスワード');
  expect(StyleSheet.flatten(find('email-label')[0].props.style).color).toBe('#ffffff');
  expect(StyleSheet.flatten(find('password-label')[0].props.style).color).toBe('#ffffff');
  expect(find('email')[0].props.placeholder).toBe('メールアドレスを入力');
  expect(find('password')[0].props.placeholder).toBe('パスワードを入力');
  expect(find('password')[0].props.secureTextEntry).toBe(true);
  await press('toggle-password-visibility');
  expect(find('password')[0].props.secureTextEntry).toBe(false);
  await press('toggle-password-visibility');
  expect(find('password')[0].props.secureTextEntry).toBe(true);
  expect(StyleSheet.flatten(find('email')[0].props.style)).toMatchObject({ color: '#ffffff', backgroundColor: '#000000' });
  await press('login');
  expect(find('auth-error')).toHaveLength(1);
  await fill('email', 'fan@example.test');
  await fill('password', 'DemoPass123');
  await press('login');
  // The server principal determines authorization without an input-side role choice.
  expect(find('fan-home')).toHaveLength(1);
  expect(find('group-home')).toHaveLength(0);
  expect(find('fan-home-reception-card')).toHaveLength(1);
  await press('open-profile');
  await press('logout');
  expect(find('fan-home')).toHaveLength(0);
  expect(find('fan-home-reception-card')).toHaveLength(0);
  expect(find('login-form')).toHaveLength(1);
  await fill('email', 'group@example.test');
  await fill('password', 'DemoPass123');
  await press('login');
  expect(find('group-home')).toHaveLength(1);
  expect(find('fan-home-reception-card')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('ファンA');
  await act(async () => { renderer.unmount(); });
});

it('shows progress and blocks a second submit while the common login is pending', async () => {
  let finish!: (value: AuthSession) => void;
  const signIn = jest.fn(() => new Promise<AuthSession>((resolve) => { finish = resolve; }));
  const auth = new AuthController({ signIn, restore: async () => group, signOut: async () => {} }, {
    read: async () => null, write: async () => {}, remove: async () => {},
  });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)} editing={editingFor(auth)} finishedImage={finishedFor(auth)} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('email')[0].props.onChangeText('group@example.test'); find('password')[0].props.onChangeText('DemoPass123'); });
  await act(async () => { find('login')[0].props.onPress(); });
  expect(find('login-progress').length).toBeGreaterThan(0);
  expect(find('login')[0].props.disabled).toBe(true);
  await act(async () => { find('login')[0].props.onPress(); });
  expect(signIn).toHaveBeenCalledTimes(1);
  await act(async () => { finish(group); });
  expect(find('group-home')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('shares fan tabs across QR, album and settings, hides them in full-screen photos, and blocks switching during a save', async () => {
  const auth = new AuthController({ signIn: async () => fan, restore: async () => fan, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const intakes: DownloadIntake[] = [{ intakeId: 'i1', createdAt: fan.expiresAt, groupId: 'g1', groupName: 'グループA',
    idolIds: ['idol-a'], idolNames: ['アイドルA'], photos: [{ photoId: 'p1', intakeId: 'i1', capturedAt: fan.expiresAt,
      expiresAt: fan.expiresAt, status: 'received', progressPercent: 100, localUri: 'file:///fan-a/p1.jpg', favorite: false }] }];
  const download = new DownloadController(auth, { list: async () => intakes, download: async () => intakes,
    setFavorite: async () => intakes, listNotifications: async () => [], markNotificationRead: async () => {} });
  let finishPassword!: () => void;
  const passwordService: PasswordService = { changePassword: () => new Promise<void>((resolve) => { finishPassword = resolve; }),
    requestReset: async () => ({ requestId: 'r1', email: 'fan@example.test', expiresAt: fan.expiresAt }), completeReset: async () => {} };
  const support = { submit: async () => ({ id: 'ticket-1', acceptedAt: fan.expiresAt }) };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} download={download} passwordService={passwordService} support={support} />); });
  await act(async () => { await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' }); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  const fill = async (id: string, value: string) => { await act(async () => { find(id)[0].props.onChangeText(value); }); };
  const expectSelected = (id: string) => {
    expect(find('fan-home-tabs')).toHaveLength(1);
    expect(find(id)[0].props.accessibilityState.selected).toBe(true);
  };
  expectSelected('fan-home-tab');
  expect(find('fan-home-tab')[0].findByType(SymbolView).props.size).toBe(26);
  await press('show-fan-code');
  expect(find('fan-code-screen')).toHaveLength(1);
  expectSelected('fan-home-tab');
  expect(find('fan-receive-tab')).toHaveLength(0);
  await press('show-downloads');
  expectSelected('show-downloads');
  expect(find('album-display-second')[0].props.accessibilityState.selected).toBe(true);
  await press('album-display-list');
  await press('show-downloads');
  expect(find('album-display-second')[0].props.accessibilityState.selected).toBe(true);
  await press('album-display-list');
  await press('album-open-0');
  expect(find('album-photo-modal').length).toBeGreaterThan(0);
  // The opaque detail surface covers these tabs; dragging reveals the unchanged album behind it.
  expect(find('fan-home-tabs')).toHaveLength(1);
  await press('album-photo-back');
  expectSelected('show-downloads');
  await press('open-settings');
  expect(find('album-photo-modal')).toHaveLength(0);
  expect(find('settings-password').length).toBeGreaterThan(0);
  expectSelected('open-settings');
  await press('settings-support');
  expect(find('support-subject').length).toBeGreaterThan(0);
  expectSelected('open-settings');
  await press('fan-home-tab');
  expect(find('fan-home')).toHaveLength(1);
  await press('open-settings');
  await press('settings-password');
  expectSelected('open-settings');
  await fill('current-password', 'DemoPass123'); await fill('new-password', 'NewDemo456'); await fill('confirm-password', 'NewDemo456');
  await press('submit-password');
  expect(find('fan-home-tab')[0].props.disabled).toBe(true);
  await press('fan-home-tab');
  expect(find('password-change-form').length).toBeGreaterThan(0);
  await act(async () => { finishPassword(); });
  expect(find('fan-home-tab')[0].props.disabled).toBe(false);
  await press('fan-home-tab');
  await press('open-profile'); await press('logout');
  expect(find('fan-home-tabs')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('receives ten photos in a modal over the unchanged home and exposes all targets without a receive tab', async () => {
  const auth = new AuthController({ signIn: async () => fan, restore: async () => fan, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  let records: DownloadIntake[] = [{ intakeId: 'home-intake', createdAt: fan.expiresAt, groupId: 'g1', groupName: 'グループA',
    idolIds: ['idol-a'], idolNames: ['アイドルA'], photos: Array.from({ length: 10 }, (_, index) => ({
      photoId: `home-p${index}`, intakeId: 'home-intake', capturedAt: fan.expiresAt, expiresAt: fan.expiresAt,
      status: 'unreceived', progressPercent: 0, localUri: null, previewUri: null, favorite: false })) }];
  const downloadPhoto = jest.fn(async (_credential: string, _intakeId: string, photoId: string) => {
    records = records.map((intake) => ({ ...intake, photos: intake.photos.map((photo) => photo.photoId === photoId
      ? { ...photo, status: 'received', localUri: `file:///fan-a/${photoId}.jpg` } : photo) }));
    return records;
  });
  const download = new DownloadController(auth, { list: async () => records, download: downloadPhoto,
    setFavorite: async () => records, listNotifications: async () => [], markNotificationRead: async () => {} });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identificationFor(auth)} capture={captureFor(auth)}
    editing={editingFor(auth)} finishedImage={finishedFor(auth)} download={download} />); });
  await act(async () => { await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' }); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  expect(find('fan-home-pending-badge')[0].props.children).toBe(10);
  await press('open-settings');
  expect(find('fan-home-pending-badge')[0].props.children).toBe(10);
  await press('fan-home-tab');
  const home = find('fan-home')[0];
  expect(find('fan-receive-tab')).toHaveLength(0);
  expect(find('home-receive-link')).toHaveLength(0);
  expect(find('home-receive-targets')).toHaveLength(0);
  expect(downloadPhoto).not.toHaveBeenCalled();
  await press('receive-inbox-button');
  expect(download.getSnapshot().phase).toBe('closed');
  expect(find('fan-home')[0]).toBe(home);
  expect(find('receive-modal').length).toBeGreaterThan(0);
  expect(downloadPhoto).toHaveBeenCalledTimes(10);
  expect(find('fan-home-pending-badge')).toHaveLength(0);
  expect(find('fan-home-tab')[0].props.accessibilityLabel).toBe('ホーム');
  expect(download.getSnapshot().receiveBatch?.items.filter((item) => item.status === 'saved')).toHaveLength(10);
  expect(find('home-album-photo-home-p0').length).toBeGreaterThan(0);
  expect(find('home-pending-photo-home-p0')).toHaveLength(0);
  await press('receive-modal-close');
  expect(find('receive-modal')).toHaveLength(0);
  expect(find('fan-home')[0]).toBe(home);
  await act(async () => { renderer.unmount(); });
});

it('does not read an old intake when opening the group home', async () => {
  const readOldIntake = jest.fn(async () => { throw new Error('old intake unavailable'); });
  const auth = new AuthController({
    signIn: async () => group, restore: async () => group, signOut: async () => {},
  }, { read: async () => null, write: async () => {}, remove: async () => {} });
  const identification = new IdentificationController(auth, {
    getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => { throw new Error('unused'); },
    getOwnRecipientRef: async () => { throw new Error('unused'); },
    resolveQr: async () => null, resolveNumber: async () => null, listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [],
    saveIntake: async () => { throw new Error('unused'); },
    getLatestIntake: readOldIntake,
    listIntakes: async () => [],
  });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthScreen auth={auth} identification={identification} capture={captureFor(auth)} editing={editingFor(auth)} finishedImage={finishedFor(auth)} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('email')[0].props.onChangeText('group@example.test'); find('password')[0].props.onChangeText('DemoPass123'); });
  await act(async () => { find('login')[0].props.onPress(); });
  expect(find('intake-restore-progress')).toHaveLength(0);
  expect(find('intake-restore-error')).toHaveLength(0);
  expect(find('start-intake')[0].props.disabled).toBe(false);
  expect(readOldIntake).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});
