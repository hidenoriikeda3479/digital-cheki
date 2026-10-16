import { useSyncExternalStore } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AccessibilityInfo, Animated, AppState, type AppStateStatus } from 'react-native';
import { AppError } from '@/core/errors';
import { AuthController } from '@/features/auth/auth-controller';
import type { DownloadIntake } from '@/services/contracts/download';
import { DownloadController } from './download-controller';
import { ReceiveCheki, ReceiveModal, receivePresentation } from './receive-modal';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));

beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {}).mockClear();
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

function Harness({ controller }: { controller: DownloadController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return state.receiveBatch ? <ReceiveModal controller={controller} state={state} /> : null;
}

async function fixture(count: number, failed = new Set<string>(), expired = new Set<string>()) {
  const session = { credential: 'fan-a', principal: { id: 'fan-a', role: 'fan' as const, displayName: 'A' }, expiresAt: '2027-01-01T00:00:00Z' };
  const auth = new AuthController({ signIn: async () => session, restore: async () => session, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  let records: DownloadIntake[] = [{ intakeId: 'i1', createdAt: '2026-10-13T00:00:00Z', groupId: 'g1', groupName: 'グループA',
    idolIds: ['idol-a'], idolNames: ['アイドルA'], photos: Array.from({ length: count }, (_, index) => ({
      photoId: `p${index + 1}`, intakeId: 'i1', capturedAt: '2026-10-13T00:00:00Z', expiresAt: '2026-10-20T00:00:00Z',
      status: expired.has(`p${index + 1}`) ? 'expired' as const : 'unreceived' as const,
      progressPercent: 0, localUri: null, previewUri: null, favorite: false })) }];
  let wait: (() => Promise<void>) | null = null;
  let loseResponse = false;
  let omitConfirmation = false;
  const download = jest.fn(async (_credential: string, _intakeId: string, photoId: string, progress?: (percent: number) => void) => {
    progress?.(100);
    if (wait) await wait();
    if (failed.has(photoId)) {
      records = records.map((intake) => ({ ...intake, photos: intake.photos.map((photo) => photo.photoId === photoId
        ? { ...photo, status: 'failed' } : photo) }));
      throw new AppError('Transport', '受信失敗');
    }
    if (!omitConfirmation) records = records.map((intake) => ({ ...intake, photos: intake.photos.map((photo) => photo.photoId === photoId
      ? { ...photo, status: 'received', localUri: `file:///fan-a/${photoId}.jpg` } : photo) }));
    if (loseResponse) throw new AppError('UnknownOutcome', '完了応答喪失');
    return records;
  });
  const controller = new DownloadController(auth, { list: async () => records, download,
    setFavorite: async () => records, listNotifications: async () => [], markNotificationRead: async () => {} });
  await controller.refreshReceivables();
  return { controller, auth, download, failed, addPhoto() { records[0].photos.push({ ...records[0].photos[0], photoId: 'new-arrival', status: 'unreceived', localUri: null }); },
    addIntake() { records.push({ ...records[0], intakeId: 'i2', photos: [{ ...records[0].photos[0], intakeId: 'i2', photoId: 'other-intake' }] }); },
    hold(value: (() => Promise<void>) | null) { wait = value; }, responseLost() { loseResponse = true; }, unconfirmed() { omitConfirmation = true; } };
}

it.each([0, 1, 3, 10])('receives %i photos on the home phase with accurate counts and at most three visible cheki', async (count) => {
  const f = await fixture(count);
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness controller={f.controller} />); await f.controller.startReceive(); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(f.controller.getSnapshot().phase).toBe('closed');
  expect(f.download).toHaveBeenCalledTimes(count);
  if (!count) expect(f.controller.getSnapshot().receiveBatch).toBeNull();
  else {
    expect(f.controller.getSnapshot().receiveBatch?.status).toBe('complete');
    expect(renderer.root.findAllByType(ReceiveCheki)).toHaveLength(Math.min(count, 3));
    expect(find('receive-complete-check')).toHaveLength(0);
    expect(find('receive-modal-heading')[0].props.children).toBe('写真を受け取っています…');
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ accessibilityRole: 'progressbar' })[0].props.accessibilityValue.now).toBe(count);
    for (const id of ['receive-heart-soft', 'receive-heart-outline', 'receive-sparkle-small', 'receive-sparkle-soft']) expect(find(id)).toHaveLength(1);
    // Allow a frame boundary for each sequential animation to finish.
    await act(async () => { jest.advanceTimersByTime(receivePresentation.progressMs + count * 20); });
    expect(find('receive-complete-check')).toHaveLength(1);
    expect(find('receive-modal-heading')[0].props.children).toBe(`${count}枚の写真を受け取りました`);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(`${count}枚の写真を受け取りました`);
    expect(f.controller.getSnapshot().receiveBatch).not.toBeNull(); // VoiceOver waits for the user's close operation.
  }
  await act(async () => { renderer.unmount(); });
});

it('keeps partial successes, retries only failures and never automatically retries', async () => {
  const f = await fixture(3, new Set(['p2']));
  await f.controller.startReceive();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness controller={f.controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(f.controller.getSnapshot().receiveBatch?.items.map((item) => item.status)).toEqual(['saved', 'failed', 'saved']);
  expect(renderer.root.findAllByProps({ accessibilityRole: 'progressbar' })[0].props.accessibilityValue.now).toBe(2);
  expect(find('receive-complete-check')).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(f.download).toHaveBeenCalledTimes(3);
  f.failed.clear();
  await act(async () => { await f.controller.retryReceive(); });
  expect(f.download.mock.calls.map((call) => call[2])).toEqual(['p1', 'p2', 'p3', 'p2']);
  expect(f.controller.getSnapshot().receiveBatch?.status).toBe('complete');
  await act(async () => { renderer.unmount(); });
});

it('shows all failures and expiry without a success check, and never attempts an expired image', async () => {
  const f = await fixture(3, new Set(['p1', 'p2']), new Set(['p3']));
  await f.controller.startReceive();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness controller={f.controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(f.download.mock.calls.map((call) => call[2])).toEqual(['p1', 'p2']);
  expect(f.controller.getSnapshot().receiveBatch?.items.map((item) => item.status)).toEqual(['failed', 'failed', 'expired']);
  expect(find('receive-result-p3')).toHaveLength(1);
  expect(find('receive-complete-check')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ accessibilityRole: 'progressbar' })[0].props.accessibilityValue.now).toBe(0);
  await act(async () => { f.controller.dismissReceive(); });
  expect(f.controller.getSnapshot().intakes[0].photos.map((photo) => photo.status)).toEqual(['failed', 'failed', 'expired']);
  await act(async () => { renderer.unmount(); });
});

it('freezes target IDs, blocks double taps and does not count transfer 100% as a saved image', async () => {
  const f = await fixture(3);
  let finish!: () => void;
  f.hold(() => new Promise<void>((resolve) => { finish = resolve; }));
  const operation = f.controller.startReceive();
  await Promise.resolve();
  expect(f.controller.getSnapshot().progressPercent).toBe(100);
  expect(f.controller.getSnapshot().receiveBatch?.items.every((item) => item.status === 'pending')).toBe(true);
  await f.controller.startReceive();
  expect(f.download).toHaveBeenCalledTimes(1);
  f.addPhoto(); f.hold(null); finish(); await operation;
  expect(f.controller.getSnapshot().receiveBatch?.items).toHaveLength(3);
  expect(f.download.mock.calls.map((call) => call[2])).toEqual(['p1', 'p2', 'p3']);
  expect(f.controller.getSnapshot().intakes[0].photos.find((photo) => photo.photoId === 'new-arrival')?.status).toBe('unreceived');
});

it('refuses unconfirmed save results, but reconciles a lost response without transferring again', async () => {
  const f = await fixture(1); f.unconfirmed(); await f.controller.startReceive();
  expect(f.controller.getSnapshot().receiveBatch?.items[0]).toMatchObject({ status: 'failed', error: 'Storage' });
  const lost = await fixture(1); lost.responseLost(); await lost.controller.startReceive();
  expect(lost.controller.getSnapshot().receiveBatch?.status).toBe('complete');
  expect(lost.download).toHaveBeenCalledTimes(1);
});

it('can release a long wait, ignores the late UI result and manually reconciles it before retrying', async () => {
  const f = await fixture(1);
  let finish!: () => void;
  f.hold(() => new Promise<void>((resolve) => { finish = resolve; }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness controller={f.controller} />); });
  let operation!: Promise<void>;
  await act(async () => { operation = f.controller.startReceive(); await Promise.resolve(); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { jest.advanceTimersByTime(receivePresentation.waitReleaseMs); });
  expect(find('receive-stop-wait').length).toBeGreaterThan(0);
  await act(async () => { f.controller.stopReceiveWait(); });
  await act(async () => { finish(); await operation; });
  expect(f.controller.getSnapshot().receiveBatch?.status).toBe('interrupted');
  f.hold(null);
  await act(async () => { await f.controller.retryReceive(); });
  expect(f.download).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().receiveBatch?.status).toBe('complete');
  await act(async () => { renderer.unmount(); });
});

it('automatically closes a successful result after the presentation delay without navigating', async () => {
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  const timing = jest.spyOn(Animated, 'timing');
  const f = await fixture(1);
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness controller={f.controller} />); await f.controller.startReceive(); });
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 5000, useNativeDriver: false }));
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(f.controller.getSnapshot().receiveBatch?.status).toBe('complete');
  await act(async () => { jest.advanceTimersByTime(receivePresentation.completeCloseMs); });
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'closed', receiveBatch: null });
  expect(f.controller.getSnapshot().intakes[0].photos[0].status).toBe('received');
  await act(async () => { renderer.unmount(); });
});

it('preserves the selected intake boundary and does not receive another intake', async () => {
  const f = await fixture(3); f.addIntake(); await f.controller.refreshReceivables();
  await f.controller.startReceive('i1');
  expect(f.controller.getSnapshot().receiveBatch?.items).toHaveLength(3);
  expect(f.download.mock.calls.map((call) => call[2])).toEqual(['p1', 'p2', 'p3']);
  expect(f.controller.getSnapshot().intakes.find((intake) => intake.intakeId === 'i2')?.photos[0].status).toBe('unreceived');
});

it.each([2, 5])('divides five seconds equally between %i confirmed photos', async (count) => {
  const timing = jest.spyOn(Animated, 'timing');
  const f = await fixture(count);
  await f.controller.startReceive();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Harness controller={f.controller} />); });
  const steps = timing.mock.calls.map((call) => call[1]).filter((config) => config.useNativeDriver === false);
  expect(steps).toHaveLength(count);
  steps.forEach((step, index) => {
    expect(step.toValue).toBeCloseTo((index + 1) / count);
    expect(step.duration).toBeCloseTo(5000 / count);
  });
  await act(async () => { renderer.unmount(); });
});

it('stops decorative motion in the background, resumes it and cleans up without restarting receipt', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  let appChanged!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appChanged = listener; return { remove };
  });
  const start = jest.fn(), stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() });
  const f = await fixture(1);
  let release!: () => void;
  f.hold(() => new Promise<void>((resolve) => { release = resolve; }));
  let renderer!: ReactTestRenderer, operation!: Promise<void>;
  await act(async () => { renderer = create(<Harness controller={f.controller} />); operation = f.controller.startReceive(); await Promise.resolve(); });
  expect(loop).toHaveBeenCalled();
  await act(async () => { appChanged('background'); });
  expect(stop).toHaveBeenCalled();
  const started = start.mock.calls.length;
  await act(async () => { appChanged('active'); });
  expect(start.mock.calls.length).toBeGreaterThan(started);
  expect(f.download).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
  expect(remove).toHaveBeenCalledTimes(1);
  release(); await operation;
});
