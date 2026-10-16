import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { PickupIdol } from '@/services/contracts/identification';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { scrollTo, useAnimatedScrollHandler, useFrameCallback } from 'react-native-reanimated';
import { PickupIdols, pickupLoopOffset } from './pickup-idols';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('react-native-reanimated', () => ({ ...jest.requireActual('react-native-reanimated/mock'),
  useFrameCallback: jest.fn(() => ({ setActive: jest.fn() })), scrollTo: jest.fn(),
  useAnimatedScrollHandler: jest.fn((handlers: { onScroll(event: unknown): void }) => handlers.onScroll) }));

const idols: PickupIdol[] = [1, 2, 3].map((id) => ({ id: String(id), name: `Idol ${id}`,
  groupName: `Group ${id}`, portraitSource: { uri: `file:///idol-${id}.png` } }));

it('opens the tapped idol in a modal and updates carousel position', async () => {
  const load = jest.fn(async () => idols);
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PickupIdols load={load} width={340} />); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(new Set(renderer.root.findAll((node) => node.props.testID?.startsWith('pickup-idol-'))
    .map((node) => node.props.testID)).size).toBe(3);
  const card = renderer.root.findAllByProps({ testID: 'pickup-idol-2' })[0];
  expect(card.props.accessibilityLabel).toBe('Idol 2、Group 2');
  await act(async () => { card.props.onPress(); });
  expect(renderer.root.findAllByProps({ testID: 'idol-detail-name' })[0].props.children).toBe('Idol 2');
  await act(async () => { renderer.root.findAllByProps({ testID: 'close-idol-detail' })[0].props.onPress(); });
  expect(renderer.root.findAllByProps({ testID: 'idol-detail-modal' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'pickup-count' })).toHaveLength(0);
  await act(async () => { renderer.root.findAllByProps({ testID: 'pickup-carousel' })[0].props.onScroll(
    { contentOffset: { x: 4 * (340 * 0.29 * 1.3 + 12) } }); });
  expect(renderer.root.findAllByProps({ testID: 'pickup-pagination' })[0].props.accessibilityLabel).toBe('3名中2人目');
  await act(async () => { renderer.unmount(); });
});

it('wraps both ends to the identical position in the middle copy without losing the fractional offset', () => {
  expect(pickupLoopOffset(900.5, 300)).toBe(300.5);
  expect(pickupLoopOffset(299.5, 300)).toBe(599.5);
  expect(pickupLoopOffset(-0.5, 300)).toBe(599.5);
  expect(pickupLoopOffset(10, 0)).toBe(0);
});

it('handles an unavailable catalog without inventing idols', async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PickupIdols width={320} load={async () => { throw Error('unavailable'); }} />); });
  expect(renderer.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
  expect(renderer.root.findAllByProps({ testID: 'pickup-count' })).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('moves slowly on the UI frame callback, pauses for gestures and background, and cleans up', async () => {
  AppState.currentState = 'active';
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  let appChanged!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appChanged = listener; return { remove };
  });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PickupIdols load={async () => idols} width={340} />); });
  const frameMock = jest.mocked(useFrameCallback);
  const frameIndex = frameMock.mock.calls.length - 1;
  expect(frameMock.mock.results[frameIndex].value.setActive).toHaveBeenCalledWith(true);
  const callback = frameMock.mock.calls[frameIndex][0];
  const carousel = renderer.root.findAllByProps({ testID: 'pickup-carousel' })[0];
  const tick = () => callback({ timestamp: 1000, timeSincePreviousFrame: 50, timeSinceFirstFrame: 50 });
  await act(async () => { carousel.props.onContentSizeChange(); });
  jest.mocked(scrollTo).mockClear();
  tick();
  const initial = 3 * (340 * 0.29 * 1.3 + 12);
  expect(scrollTo).toHaveBeenLastCalledWith(expect.anything(), initial + 0.6, 0, false);
  const handlers = jest.mocked(useAnimatedScrollHandler).mock.calls.at(-1)![0];
  if (typeof handlers === 'function') throw Error('Expected gesture handlers');
  handlers.onBeginDrag!({} as never, {});
  tick();
  expect(scrollTo).toHaveBeenCalledTimes(1);
  await act(async () => { appChanged('background'); });
  expect(frameMock.mock.results.at(-1)!.value.setActive).toHaveBeenCalledWith(false);
  await act(async () => { renderer.unmount(); });
  expect(frameMock.mock.results.at(-1)!.value.setActive).toHaveBeenLastCalledWith(false);
  expect(remove).toHaveBeenCalled();
  jest.restoreAllMocks();
});
