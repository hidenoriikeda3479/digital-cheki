import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Animated, FlatList, PanResponder, StyleSheet } from 'react-native';
import { PhotoViewer } from './photo-viewer';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView' }));

it('opens a later tapped photo and ignores initial native positioning events until a real swipe', async () => {
  const scrollThumbnail = jest.spyOn(FlatList.prototype, 'scrollToIndex');
  const photos = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, uri: `file:///p${index}.jpg`, thumbnailUri: `file:///p${index}.jpg` }));
  const onSelect = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoViewer visible onClose={jest.fn()} onSelect={onSelect} photo={photos[6]} photos={photos}
    ids={{ modal: 'modal', safe: 'safe', close: 'close', image: 'image', filmstrip: 'filmstrip', filmPrefix: 'film-' }} />); });
  const pager = () => renderer.root.findAllByProps({ testID: 'image-pager' })[0];
  expect(pager().props.initialScrollIndex).toBe(6);
  expect(scrollThumbnail).toHaveBeenCalledWith({ index: 6, viewPosition: 0.5, animated: true });
  const strip = renderer.root.findAllByProps({ testID: 'filmstrip' })[0];
  await act(async () => { strip.props.onLayout(); });
  expect(scrollThumbnail).toHaveBeenCalledWith({ index: 6, viewPosition: 0.5, animated: false });
  const width = pager().props.getItemLayout(null, 1).length;
  await act(async () => {
    pager().props.onLayout();
    renderer.root.findAllByProps({ testID: 'modal' })[0].props.onShow();
    pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } });
  });
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => {
    pager().props.onScrollBeginDrag();
    pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: width * 7 } } });
  });
  expect(onSelect).toHaveBeenCalledWith('p7');
  await act(async () => { renderer.unmount(); });
});

it('dismisses a downward swipe while leaving horizontal, upward and short gestures alone', async () => {
  jest.useFakeTimers();
  // Run interpolation in JS in the renderer; native animation frames require a device.
  const timing = Animated.timing;
  const spring = Animated.spring;
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => timing(value, { ...config, useNativeDriver: false }));
  jest.spyOn(Animated, 'spring').mockImplementation((value, config) => spring(value, { ...config, useNativeDriver: false }));
  const createResponder = jest.spyOn(PanResponder, 'create');
  const onClose = jest.fn();
  let renderer!: ReactTestRenderer;
  const photo = { id: 'p1', uri: 'file:///p1.jpg', thumbnailUri: 'file:///p1.jpg' };
  await act(async () => { renderer = create(<PhotoViewer visible onClose={onClose} onSelect={jest.fn()} photo={photo} photos={[photo]}
    ids={{ modal: 'modal', safe: 'safe', close: 'close', image: 'image', filmstrip: 'filmstrip', filmPrefix: 'film-' }} />); });
  const callbacks = createResponder.mock.calls[0][0];
  const event = expect.anything();
  const gesture = { stateID: 1, dx: 2, dy: 120, moveX: 2, moveY: 120, x0: 0, y0: 0,
    vx: 0, vy: 1, numberActiveTouches: 1, _accountsForMovesUpTo: 0 };
  expect(callbacks.onMoveShouldSetPanResponderCapture?.(event, gesture)).toBe(true);
  expect(callbacks.onMoveShouldSetPanResponderCapture?.(event, { ...gesture, dx: 120, dy: 3 })).toBe(false);
  expect(callbacks.onMoveShouldSetPanResponderCapture?.(event, { ...gesture, dy: -120 })).toBe(false);
  expect(renderer.root.findAllByProps({ testID: 'modal' })[0].props.transparent).toBe(true);
  await act(async () => { callbacks.onPanResponderMove?.(event, gesture); });
  const surface = () => StyleSheet.flatten(renderer.root.findAllByProps({ testID: 'modal-surface' })[0].props.style);
  expect(surface().transform[0].translateY.__getValue()).toBe(120);
  expect(surface().transform[1].scale.__getValue()).toBeLessThan(1);
  await act(async () => {
    callbacks.onPanResponderRelease?.(event, { ...gesture, dy: 30 });
    callbacks.onPanResponderRelease?.(event, { ...gesture, dx: 120, dy: 3 });
  });
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(onClose).not.toHaveBeenCalled();
  expect(surface().transform[0].translateY.__getValue()).toBeCloseTo(0);
  await act(async () => { callbacks.onPanResponderRelease?.(event, gesture); });
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
  jest.useRealTimers();
});
