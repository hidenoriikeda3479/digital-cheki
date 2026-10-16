import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Modal, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { DownloadIntake, DownloadService, LocalAlbumActions } from '@/services/contracts/download';
import { DownloadController } from './download-controller';
import { DownloadScreen } from './download-screen';

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff', background: '#000' }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: (props: object) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const React = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const { View } = require('react-native');
    return React.createElement(View, props);
  },
}));
const session: AuthSession = { credential: 'a', principal: { id: 'fan-a', role: 'fan', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const initial: DownloadIntake[] = [{ intakeId: 'i1', createdAt: '2026-09-25T01:00:00.000Z',
  groupId: 'group-a', groupName: 'Group A', idolIds: ['idol-a'], idolNames: ['Idol A'], photos: [
  { photoId: 'p1', intakeId: 'i1', capturedAt: '2026-09-25T00:00:00.000Z', expiresAt: '2026-10-02T01:00:00.000Z',
    status: 'unreceived', progressPercent: 0, localUri: null, favorite: false },
] }];
async function signedIn() {
  const auth = new AuthController({ signIn: async () => session, restore: async () => session, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  return auth;
}

it('groups photos by capture day in three-column rows and reverses the day order when sorting', async () => {
  const auth = await signedIn();
  const records: DownloadIntake[] = [{ ...initial[0], photos: Array.from({ length: 5 }, (_, index) => ({
    ...initial[0].photos[0], photoId: `grouped-${index}`, status: 'received', localUri: `file:///grouped-${index}.jpg`,
    capturedAt: index < 4 ? '2026-10-14T12:00:00Z' : '2026-10-13T12:00:00Z',
  })) }];
  const controller = new DownloadController(auth, { list: async () => records, download: async () => records,
    setFavorite: async () => records, listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const rows = () => renderer.root.findAllByProps({ testID: 'album-photo-grid' })[0].props.data;
  expect(rows().filter((row: { kind: string }) => row.kind === 'date').map((row: { date: string }) => row.date))
    .toEqual(['2026-10-14', '2026-10-13']);
  expect(rows().filter((row: { kind: string }) => row.kind === 'photos').map((row: { items: unknown[] }) => row.items.length))
    .toEqual([3, 1, 1]);
  await act(async () => { renderer.root.findAllByProps({ testID: 'album-sort' })[0].props.onPress(); });
  expect(rows().filter((row: { kind: string }) => row.kind === 'date').map((row: { date: string }) => row.date))
    .toEqual(['2026-10-13', '2026-10-14']);
  await act(async () => { renderer.unmount(); });
});

it('shows capture metadata and connects detail save, like and confirmed deletion to the selected local photo', async () => {
  const auth = await signedIn();
  let records: DownloadIntake[] = [{ ...initial[0], photos: [{ ...initial[0].photos[0], status: 'received', localUri: 'file:///p1.jpg' }] }];
  const permission = jest.fn(async () => false);
  const save = jest.fn(async () => {});
  const remove = jest.fn(async () => {
    records = records.map((intake) => ({ ...intake, photos: intake.photos.map((photo) => ({ ...photo, status: 'removed', localUri: null })) }));
    return records;
  });
  const controller = new DownloadController(auth, { list: async () => records, download: async () => records,
    setFavorite: async (_credential, _intakeId, _photoId, favorite) => {
      records = records.map((intake) => ({ ...intake, photos: intake.photos.map((photo) => ({ ...photo, favorite })) }));
      return records;
    }, listNotifications: async () => [], markNotificationRead: async () => {} }, undefined,
  { requestSavePermission: permission, saveToPhotoLibrary: save, deleteReceived: remove });
  await controller.open();
  controller.showPhoto('p1');
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAllByProps({ testID: id })[0];
  const press = async (id: string) => { await act(async () => { find(id).props.onPress(); }); };
  expect(find('album-photo-date').props.children).toBe('2026/09/25');
  expect(find('album-photo-idols').props.children).toBe('Idol A');
  await press('album-photo-large-favorite');
  expect(controller.getSnapshot().intakes[0].photos[0].favorite).toBe(true);
  await act(async () => { controller.setFilter({ favoritesOnly: true }); });
  await press('album-photo-large-favorite');
  expect(find('album-photo-large').props.source.uri).toBe('file:///p1.jpg');
  await act(async () => { controller.clearFilters(); });
  await press('album-photo-large-save');
  expect(save).not.toHaveBeenCalled();
  expect(controller.getSnapshot()).toMatchObject({ phase: 'photo', error: 'Forbidden', selecting: false });
  jest.useFakeTimers();
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(controller.getSnapshot().error).toBe('Forbidden');
  permission.mockResolvedValueOnce(true);
  await press('album-photo-large-save');
  expect(save).toHaveBeenCalledWith('a', 'i1', 'p1');
  await act(async () => { jest.advanceTimersByTime(2999); });
  expect(controller.getSnapshot().batchMessage).not.toBeNull();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(controller.getSnapshot().batchMessage).toBeNull();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press('album-photo-large-delete');
  expect(remove).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2];
  await act(async () => { buttons?.find((button) => button.style === 'destructive')?.onPress?.(); });
  expect(remove).toHaveBeenCalledWith('a', 'i1', 'p1');
  expect(controller.getSnapshot()).toMatchObject({ phase: 'list', selectedPhotoId: null, selecting: false });
  expect(controller.getSnapshot().batchMessage).not.toBeNull();
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(controller.getSnapshot().batchMessage).toBeNull();
  await act(async () => { renderer.unmount(); });
  jest.useRealTimers();
});
it('keeps the gallery separate from the receive inbox and downloads only after an intake button is pressed', async () => {
  const auth = await signedIn();
  const received: DownloadIntake[] = [{ ...initial[0], photos: [
    { ...initial[0].photos[0], status: 'received', progressPercent: 100, localUri: 'file:///fan-a/received-p1.jpg' },
    { ...initial[0].photos[0], photoId: 'p2', status: 'received', progressPercent: 100,
      localUri: 'file:///fan-a/received-p2.jpg' },
  ] }];
  const download = jest.fn(async (_credential: string, _intakeId: string, _photoId: string,
    _onProgress?: (percent: number) => void) => received);
  let records = initial;
  const service: DownloadService = { list: async () => records,
    download: async (credential, intakeId, photoId, onProgress) => {
      records = await download(credential, intakeId, photoId, onProgress); onProgress?.(100); return records;
    },
    setFavorite: async () => received, listNotifications: async () => [], markNotificationRead: async () => {} };
  const controller = new DownloadController(auth, service);
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.props.onPress === 'function');
  expect(renderer.root.findAllByType(Text).some((item) => item.props.children === '写真一覧')).toBe(false);
  expect(find('album-grid-photo-0')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'receive-intake-0')).toHaveLength(0);
  expect(find('receive-inbox-button')).toHaveLength(0);
  expect(find('notification-bell')).toHaveLength(0);
  expect(download).not.toHaveBeenCalled();
  await act(async () => { controller.close(); await controller.refreshReceivables(); await controller.receiveIntake('i1'); });
  expect(download).toHaveBeenCalledWith('a', 'i1', 'p1', expect.any(Function));
  expect(controller.getSnapshot().phase).toBe('closed');
  await act(async () => { controller.dismissReceive(); await controller.open(); });
  expect(find('album-open-0')).toHaveLength(1);
  const originalGrid = renderer.root.findAllByProps({ testID: 'album-photo-grid' })[0];
  await act(async () => { find('album-open-0')[0].props.onPress(); });
  expect(renderer.root.findAll((item) => item.props.testID === 'album-photo-large').length).toBeGreaterThan(0);
  expect(renderer.root.findAllByProps({ testID: 'album-photo-grid' })[0]).toBe(originalGrid);
  const safe = renderer.root.findAll((item) => item.props.testID === 'album-photo-safe')[0];
  expect(safe.props.edges).toEqual(['top', 'bottom']);
  expect(renderer.root.findAll((item) => item.props.testID === 'album-photo-back')[0].props.style)
    .toMatchObject({ width: 48, height: 48 });
  expect(renderer.root.findAll((item) => item.props.testID === 'album-photo-favorite')).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).some((item) => item.props.children === '2026-09-25')).toBe(false);
  expect(renderer.root.findAll((item) => item.props.testID === 'album-photo-filmstrip')[0].props.data).toHaveLength(2);
  const pager = () => renderer.root.findAllByProps({ testID: 'album-photo-large-pager' })[0];
  const pageWidth = pager().props.getItemLayout(null, 1).length;
  await act(async () => { find('album-photo-large-toggle-p1')[0].props.onPress(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
  expect(find('album-photo-back')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'album-photo-filmstrip' })).toHaveLength(0);
  await act(async () => { find('album-photo-large-toggle-p1')[0].props.onPress(); });
  expect(find('album-photo-back')).toHaveLength(1);
  await act(async () => { pager().props.onScrollBeginDrag(); });
  await act(async () => { pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pageWidth } } }); });
  expect(controller.getSnapshot().selectedPhotoId).toBe('p2');
  await act(async () => { pager().props.onScrollBeginDrag(); });
  await act(async () => { pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }); });
  expect(controller.getSnapshot().selectedPhotoId).toBe('p1');
  await act(async () => { find('album-photo-film-p2')[0].props.onPress(); });
  expect(renderer.root.findAll((item) => item.props.testID === 'album-photo-large')[0].props.source.uri)
    .toBe('file:///fan-a/received-p2.jpg');
  await act(async () => { find('album-photo-back')[0].props.onPress(); });
  expect(find('album-open-0')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('drops a delayed fan-A result when the account signs out', async () => {
  const auth = await signedIn();
  let finish!: (value: DownloadIntake[]) => void;
  const controller = new DownloadController(auth, { list: async () => initial,
    download: () => new Promise((resolve) => { finish = resolve; }),
    setFavorite: async () => initial, listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.refreshReceivables();
  const pending = controller.receiveIntake('i1');
  expect(controller.getSnapshot().busy).toBe(true);
  await Promise.resolve();
  await auth.signOut();
  finish(initial);
  await pending;
  expect(controller.getSnapshot()).toMatchObject({ phase: 'closed', intakes: [] });
});

it('keeps a back control visible if the selected local photo becomes unavailable', async () => {
  const auth = await signedIn();
  const received: DownloadIntake[] = [{ ...initial[0], photos: [{ ...initial[0].photos[0],
    status: 'received', localUri: 'file:///received.jpg' }] }];
  const missing: DownloadIntake[] = [{ ...received[0], photos: [{ ...received[0].photos[0], localUri: null }] }];
  const controller = new DownloadController(auth, { list: async () => received, download: async () => received,
    setFavorite: async () => missing, listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id);
  await act(async () => { find('album-open-0')[0].props.onPress(); });
  await act(async () => { await controller.setFavorite('p1', true); });
  expect(find('album-photo-unavailable').length).toBeGreaterThan(0);
  expect(find('album-photo-back').length).toBeGreaterThan(0);
  await act(async () => { find('album-photo-back')[0].props.onPress(); });
  expect(find('album-count').length).toBeGreaterThan(0);
  await act(async () => { renderer.unmount(); });
});

it('leaves the fan home visible when the album cannot be loaded', async () => {
  const auth = await signedIn();
  const controller = new DownloadController(auth, { list: async () => { throw Error('storage unavailable'); },
    download: async () => [], setFavorite: async () => [], listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.open();
  expect(controller.getSnapshot()).toMatchObject({ phase: 'closed', busy: false, error: 'Storage' });
});

it('keeps the empty album quiet while retaining the favorites empty message', async () => {
  const auth = await signedIn();
  const controller = new DownloadController(auth, { list: async () => [], download: async () => [],
    setFavorite: async () => [], listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('album-empty')).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('条件に合う受信済み写真はありません');
  await act(async () => { controller.showSearch(); });
  await act(async () => { find('search-favorites-only')[0].props.onPress(); });
  await act(async () => { find('search-apply')[0].props.onPress(); });
  expect(find('album-empty').length).toBeGreaterThan(0);
  await act(async () => { renderer.unmount(); });
});

it('shows a photo grid with bottom sorting and opens search conditions in a modal', async () => {
  const auth = await signedIn();
  const photos: DownloadIntake[] = [{ ...initial[0], photos: [
    { ...initial[0].photos[0], photoId: 'older', capturedAt: '2026-09-24T00:00:00.000Z',
      status: 'received', localUri: 'file:///older.jpg' },
    { ...initial[0].photos[0], photoId: 'newer', capturedAt: '2026-09-25T00:00:00.000Z',
      status: 'received', localUri: 'file:///newer.jpg', favorite: true },
  ] }];
  const controller = new DownloadController(auth, { list: async () => photos, download: async () => photos,
    setFavorite: async () => photos, listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id);
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  const firstUri = () => find('album-grid-photo-0')[0].props.source.uri;
  const pager = () => find('album-swipe-area')[0];
  expect(pager().props.horizontal).toBe(true);
  expect(pager().props.pagingEnabled).toBe(true);
  await act(async () => { controller.setFilter({ capturedDate: '2026-09-25', favoritesOnly: true }); });
  await act(async () => { pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }); });
  expect(find('album-display-second')[0].props.accessibilityState.selected).toBe(true);
  expect(controller.getSnapshot().filter).toEqual({ groupId: null, idolId: null, capturedDate: null, favoritesOnly: false });
  await act(async () => { controller.setFilter({ groupId: initial[0].groupId }); });
  await act(async () => { pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 1000 } } }); });
  expect(find('album-display-list')[0].props.accessibilityState.selected).toBe(true);
  expect(controller.getSnapshot().filter.groupId).toBeNull();
  await act(async () => { controller.toggleSelectionMode(); });
  expect(pager().props.scrollEnabled).toBe(false);
  await act(async () => { pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }); });
  expect(find('album-display-list')[0].props.accessibilityState.selected).toBe(true);
  await act(async () => { controller.toggleSelectionMode(); });
  await press('album-display-second');
  expect(find('album-calendar').length).toBeGreaterThan(0);
  expect(find('album-display-second')[0].props.accessibilityState.selected).toBe(true);
  await press('album-display-list');
  expect(find('album-calendar-page')[0].props.accessibilityElementsHidden).toBe(true);
  expect(find('album-photo-grid')[0].props.data.filter((row: { kind: string }) => row.kind === 'date')).toHaveLength(2);
  expect(find('album-date-2026-09-25')[0].props.children).toBe('2026/09/25');
  expect(find('album-date-2026-09-24')[0].props.children).toBe('2026/09/24');
  expect(find('album-grid-photo-0')[0].props.contentFit).toBe('contain');
  expect(firstUri()).toBe('file:///newer.jpg');
  await act(async () => { controller.setFilter({ groupId: initial[0].groupId, capturedDate: '2026-09-25', favoritesOnly: true }); });
  await press('album-display-list');
  expect(controller.getSnapshot().filter).toEqual({ groupId: null, idolId: null, capturedDate: null, favoritesOnly: false });
  expect(find('album-grid-photo-1')).toHaveLength(1);
  await act(async () => { controller.showFavorites(); });
  await press('album-display-second');
  expect(controller.getSnapshot().phase).toBe('list');
  expect(controller.getSnapshot().filter.favoritesOnly).toBe(false);
  await press('album-display-list');
  expect(find('album-count')[0].props.children).toEqual([2, '枚の写真']);
  await press('album-sort');
  expect(firstUri()).toBe('file:///older.jpg');
  await press('open-album-search');
  expect(renderer.root.findAllByType(Modal)[0].props.visible).toBe(true);
  await press('search-date-0');
  expect(find('search-count')[0].props.children).toEqual(['検索結果 ', 1, '枚']);
  await press('search-apply');
  expect(controller.getSnapshot().phase).toBe('list');
  expect(renderer.root.findAllByType(Modal)[0].props.visible).toBe(false);
  expect(find('album-grid-photo-0')).toHaveLength(1);
  expect(firstUri()).toBe('file:///newer.jpg');
  await press('open-album-search');
  await press('search-clear');
  await press('search-close');
  await press('open-album-search');
  await press('search-favorites-only');
  await press('search-apply');
  expect(controller.getSnapshot().filter.favoritesOnly).toBe(true);
  expect(find('album-grid-photo-0')).toHaveLength(1);
  expect(firstUri()).toBe('file:///newer.jpg');
  await press('open-album-search');
  await press('search-favorites-only');
  await press('search-apply');
  expect(controller.getSnapshot().phase).toBe('list');
  expect(find('album-grid-photo-0')).toHaveLength(1);
  expect(find('album-grid-photo-1')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('selects multiple received photos, saves them to Photos, and deletes only after confirmation', async () => {
  const auth = await signedIn();
  const received = [{ ...initial[0], photos: [
    { ...initial[0].photos[0], photoId: 'p1', status: 'received' as const, localUri: 'file:///fan/p1.jpg' },
    { ...initial[0].photos[0], photoId: 'p2', status: 'received' as const, localUri: 'file:///fan/p2.jpg' },
  ] }];
  let records: DownloadIntake[] = received;
  const saveToPhotoLibrary = jest.fn(async () => {});
  const deleteReceived = jest.fn(async (_credential: string, _intakeId: string, photoId: string) => {
    records = records.map((intake) => ({ ...intake, photos: intake.photos.map((photo) => photo.photoId === photoId
      ? { ...photo, status: 'removed' as const, localUri: null } : photo) }));
    return records;
  });
  const actions: LocalAlbumActions = { requestSavePermission: async () => true, saveToPhotoLibrary, deleteReceived };
  const controller = new DownloadController(auth, { list: async () => records, download: async () => records,
    setFavorite: async () => records, listNotifications: async () => [], markNotificationRead: async () => {} }, undefined, actions);
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id);
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  await act(async () => { find('album-open-0')[0].props.onLongPress(); });
  expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  const feedbackCount = jest.mocked(Haptics.impactAsync).mock.calls.length;
  await act(async () => { find('album-open-0')[0].props.onLongPress(); });
  expect(controller.getSnapshot()).toMatchObject({ selecting: false, selectedPhotoIds: [] });
  expect(find('album-photo-large')).toHaveLength(0);
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(feedbackCount);
  await act(async () => { find('album-open-0')[0].props.onLongPress(); });
  await press('album-open-1');
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(feedbackCount + 1);
  expect(controller.getSnapshot().selectedPhotoIds).toHaveLength(2);
  expect(find('album-photo-large')).toHaveLength(0);
  expect(find('album-save-selected')[0].findByType(Text).props.children).toBe('保存');
  await press('album-save-selected');
  expect(saveToPhotoLibrary).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().selectedPhotoIds).toEqual([]);
  expect(find('album-batch-message')[0].props.children).toContain('2枚');
  jest.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error('haptics unavailable'));
  await act(async () => { find('album-open-0')[0].props.onLongPress(); });
  await press('album-open-1');
  await press('album-delete-selected');
  expect(deleteReceived).not.toHaveBeenCalled();
  await press('album-delete-cancel');
  expect(deleteReceived).not.toHaveBeenCalled();
  await press('album-delete-selected');
  await press('album-delete-confirm-action');
  expect(deleteReceived).toHaveBeenCalledTimes(2);
  expect(deleteReceived).toHaveBeenCalledWith('a', 'i1', 'p1');
  expect(deleteReceived).toHaveBeenCalledWith('a', 'i1', 'p2');
  expect(find('album-grid-photo-0')).toHaveLength(0);
  expect(controller.getSnapshot().intakes[0].photos.map((photo) => photo.status)).toEqual(['removed', 'removed']);
  await act(async () => { controller.close(); await controller.refreshReceivables(); });
  expect(find('receive-start-0')).toHaveLength(0);
  expect(find('receive-photo-0')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('keeps unsaved selections after denied permission or a partial Photos failure', async () => {
  const auth = await signedIn();
  const received: DownloadIntake[] = [{ ...initial[0], photos: [
    { ...initial[0].photos[0], photoId: 'p1', status: 'received', localUri: 'file:///fan/p1.jpg' },
    { ...initial[0].photos[0], photoId: 'p2', status: 'received', localUri: 'file:///fan/p2.jpg' },
  ] }];
  let permitted = false;
  const saveToPhotoLibrary = jest.fn(async (_credential: string, _intakeId: string, photoId: string) => {
    if (photoId === 'p2') throw Error('Photos unavailable');
  });
  const actions: LocalAlbumActions = { requestSavePermission: async () => permitted,
    saveToPhotoLibrary, deleteReceived: async () => received };
  const controller = new DownloadController(auth, { list: async () => received, download: async () => received,
    setFavorite: async () => received, listNotifications: async () => [], markNotificationRead: async () => {} }, undefined, actions);
  await controller.open();
  controller.toggleSelectionMode(); controller.toggleSelected('p1'); controller.toggleSelected('p2');
  await controller.saveSelectedToPhotoLibrary();
  expect(controller.getSnapshot()).toMatchObject({ selectedPhotoIds: ['p1', 'p2'], error: 'Forbidden', busy: false });
  expect(saveToPhotoLibrary).not.toHaveBeenCalled();
  permitted = true;
  await controller.saveSelectedToPhotoLibrary();
  expect(controller.getSnapshot()).toMatchObject({ selectedPhotoIds: ['p2'], error: 'Storage', busy: false, batchCompleted: 1 });
  expect(saveToPhotoLibrary).toHaveBeenCalledTimes(2);
});

it('keeps the photo grid in place while a favorite is saved and if saving fails', async () => {
  const auth = await signedIn();
  const received: DownloadIntake[] = [{ ...initial[0], photos: [{ ...initial[0].photos[0],
    status: 'received', localUri: 'file:///p1.jpg' }] }];
  let complete!: (value: DownloadIntake[]) => void;
  let reject!: (reason: Error) => void;
  const setFavorite = jest.fn(() => new Promise<DownloadIntake[]>((resolve, rejectRequest) => {
    complete = resolve; reject = rejectRequest;
  }));
  const controller = new DownloadController(auth, { list: async () => received, download: async () => received,
    setFavorite, listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id);
  await act(async () => { find('album-favorite-0')[0].props.onPress(); });
  expect(controller.getSnapshot()).toMatchObject({ busy: true, favoritePhotoId: 'p1' });
  expect(find('download-progress')).toHaveLength(0);
  expect(find('album-grid-photo-0')).toHaveLength(1);
  expect(find('album-count')[0].props.children).toEqual([1, '枚の写真']);
  expect(find('album-favorite-0')[0].props.disabled).toBe(true);
  await act(async () => { find('album-favorite-0')[0].props.onPress(); });
  expect(setFavorite).toHaveBeenCalledTimes(1);
  await act(async () => { reject(Error('save failed')); });
  expect(controller.getSnapshot()).toMatchObject({ busy: false, favoritePhotoId: null });
  expect(find('download-error').length).toBeGreaterThan(0);
  expect(find('album-grid-photo-0')).toHaveLength(1);
  await act(async () => { find('album-favorite-0')[0].props.onPress(); });
  await act(async () => { complete([{ ...received[0], photos: [{ ...received[0].photos[0], favorite: true }] }]); });
  expect(find('album-favorite-0')[0].props.accessibilityLabel).toBe('お気に入りを解除');
  expect(find('download-progress')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('shows combined filters and favorites without a notification or intake screen', async () => {
  const auth = await signedIn();
  let records: DownloadIntake[] = [{ ...initial[0], photos: [
    { ...initial[0].photos[0], status: 'received', localUri: 'file:///p1.jpg' },
    { ...initial[0].photos[0], photoId: 'p2', capturedAt: '2026-09-25T00:01:00.000Z',
      status: 'received', localUri: 'file:///p2.jpg', favorite: true },
  ], idolIds: ['idol-a', 'idol-a2'], idolNames: ['Idol A', 'Idol A2'] },
  { ...initial[0], intakeId: 'i2', groupId: 'group-b', groupName: 'Group B', idolIds: ['idol-b'],
    idolNames: ['Idol B'], photos: [{ ...initial[0].photos[0], photoId: 'p3', intakeId: 'i2',
      status: 'received', localUri: 'file:///p3.jpg', favorite: true }] }];
  const listNotifications = jest.fn(async () => [
    { intakeId: 'i1', createdAt: '2026-09-25T01:00:00.000Z', message: '2枚', read: false },
  ]);
  const service: DownloadService = { list: async () => records, download: async () => records,
    setFavorite: async (_credential, _intakeId, photoId, favorite) => {
      records = records.map((intake) => ({ ...intake, photos: intake.photos.map((photo) =>
        photo.photoId === photoId ? { ...photo, favorite } : photo) }));
      return records;
    },
    listNotifications, markNotificationRead: async () => {} };
  const controller = new DownloadController(auth, service);
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  const press = async (id: string) => {
    const node = renderer.root.findAll((item) => item.props.testID === id && typeof item.props.onPress === 'function')[0];
    expect(node).toBeDefined();
    await act(async () => { node.props.onPress(); });
  };
  await press('open-album-search');
  await press('search-group-0');
  await press('search-idol-1');
  await press('search-date-0');
  await press('search-favorites-only');
  expect(filterIds()).toEqual(['p2']);
  await press('search-clear');
  expect(filterIds()).toEqual(['p2', 'p1', 'p3']);
  await press('search-close');
  await press('open-album-search');
  await press('search-favorites-only');
  await press('search-apply');
  expect(filterIds()).toEqual(['p2', 'p3']);
  await press('album-favorite-0');
  expect(filterIds()).toEqual(['p3']);
  expect(renderer.root.findAllByProps({ testID: 'download-back' })).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'notification-bell')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'notification-0')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'download-photo-0')).toHaveLength(0);
  expect(listNotifications).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });

  function filterIds() {
    const state = controller.getSnapshot();
    const { filterAlbum, emptyAlbumFilter } = jest.requireActual<typeof import('./album-filter')>('./album-filter');
    return filterAlbum(state.intakes, state.phase === 'favorites' ? { ...emptyAlbumFilter(), favoritesOnly: true } : state.filter)
      .map((entry) => entry.photo.photoId);
  }
});

it('lists failed and expired photos separately from the received gallery and never offers expired receipt', async () => {
  const auth = await signedIn();
  const records: DownloadIntake[] = [{ ...initial[0], photos: [
    initial[0].photos[0],
    { ...initial[0].photos[0], photoId: 'p2', status: 'failed' },
    { ...initial[0].photos[0], photoId: 'p3', status: 'expired' },
    { ...initial[0].photos[0], photoId: 'p4', status: 'received', localUri: 'file:///p4.jpg' },
  ] }];
  const download = jest.fn(async () => records);
  const controller = new DownloadController(auth, { list: async () => records, download,
    setFavorite: async () => records, listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.open();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<DownloadScreen controller={controller} />); });
  expect(renderer.root.findAll((item) => item.props.testID === 'album-grid-photo-0').length).toBeGreaterThan(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'album-grid-photo-1')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'receive-inbox-badge')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'receive-inbox-button')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'notification-bell')).toHaveLength(0);
  await act(async () => { controller.close(); await controller.refreshReceivables(); await controller.startReceive(); });
  expect(download).toHaveBeenCalledTimes(2);
  expect(download).not.toHaveBeenCalledWith('a', 'i1', 'p3', expect.any(Function));
  expect(controller.getSnapshot().receiveBatch?.items.find((item) => item.photoId === 'p3')?.status).toBe('expired');
  await act(async () => { renderer.unmount(); });
});

it('drops a delayed receive count when the fan changes', async () => {
  const fanB: AuthSession = { credential: 'b', principal: { id: 'fan-b', role: 'fan', displayName: 'B' }, expiresAt: session.expiresAt };
  const auth = new AuthController({ signIn: async ({ email }) => email.startsWith('b') ? fanB : session,
    restore: async (credential) => credential === 'b' ? fanB : session, signOut: async () => {} },
  { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'a@example.test', password: 'DemoPass123' });
  let finishOld!: (items: DownloadIntake[]) => void;
  const controller = new DownloadController(auth, { list: (credential) => credential === 'a'
    ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve([]),
  download: async () => [], setFavorite: async () => [], listNotifications: async () => [], markNotificationRead: async () => {} });
  const pending = controller.refreshReceivables();
  await auth.signOut();
  await auth.signIn({ email: 'b@example.test', password: 'DemoPass123' });
  await controller.refreshReceivables();
  finishOld(initial);
  await pending;
  expect(controller.getSnapshot()).toMatchObject({ phase: 'closed', intakes: [], receiveStatus: 'ready' });
});
