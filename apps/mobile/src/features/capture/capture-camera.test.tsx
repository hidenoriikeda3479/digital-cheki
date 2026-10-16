import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import { CaptureCamera } from './capture-camera';

let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
let mockFocused = true;
let mockResolve!: (picture: { uri: string; width: number; height: number; format: 'jpg' | 'png' }) => void;
const mockTakePicture = jest.fn(() => new Promise<{ uri: string; width: number; height: number; format: 'jpg' | 'png' }>((resolve) => { mockResolve = resolve; }));
const mockRequestPermission = jest.fn(async () => ({ granted: true }));
const mockGetPermission = jest.fn(async () => ({ granted: true }));
const mockCrop = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: () => ({
    crop: (rect: { width: number; height: number }) => { mockCrop(rect); },
    renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///cache/cropped.jpg',
      width: mockCrop.mock.lastCall[0].width, height: mockCrop.mock.lastCall[0].height }) }),
  }) },
}));
jest.mock('expo-camera', () => ({
  CameraView: (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const React = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const { View } = require('react-native');
    return React.forwardRef(function MockCameraView(props: object, ref: object) {
      React.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePicture }));
      return React.createElement(View, props);
    });
  })(),
  useCameraPermissions: () => [mockPermission, mockRequestPermission, mockGetPermission],
}));
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff' }) }));

beforeEach(() => {
  mockPermission = { granted: true, canAskAgain: true };
  mockFocused = true;
  mockTakePicture.mockClear();
  mockCrop.mockClear();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

it('waits for camera readiness, blocks rapid duplicate capture and unmounts on focus loss', async () => {
  const onCapture = jest.fn(async () => {});
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<CaptureCamera busy={false} onCapture={onCapture} onReview={() => {}} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('take-photo')[0].props.disabled).toBe(true);
  await act(async () => { find('photo-camera')[0].props.onCameraReady(); });
  expect(find('take-photo')[0].props.disabled).toBe(false);
  expect(find('take-photo')[0].props.accessibilityLabel).toBe('撮影して保存');
  expect(find('take-photo')[0].props.style[0]).toMatchObject({ width: 86, height: 86, borderRadius: 43, bottom: 28 });
  expect(find('photo-camera')[0].props.style).toMatchObject({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 });
  expect(find('show-photo-review')[0].props.style[0]).toMatchObject({ position: 'absolute', top: 14 });
  expect(find('cheki-camera-guide')).toHaveLength(0);
  await act(async () => { find('take-photo')[0].props.onPress(); find('take-photo')[0].props.onPress(); });
  expect(mockTakePicture).toHaveBeenCalledTimes(1);
  await act(async () => { mockResolve({ uri: 'file:///cache/photo.jpg', width: 800, height: 1200, format: 'jpg' }); });
  expect(mockCrop).toHaveBeenCalledWith({ originX: 9, originY: 73, width: 782, height: 1054 });
  expect(onCapture).toHaveBeenCalledWith({ uri: 'file:///cache/cropped.jpg', width: 782, height: 1054, format: 'jpg' });
  mockFocused = false;
  await act(async () => { renderer.update(<CaptureCamera busy={false} onCapture={onCapture} onReview={() => {}} />); });
  expect(find('photo-camera')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('keeps a route out when permission is denied', async () => {
  mockPermission = { granted: false, canAskAgain: false };
  const onReview = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<CaptureCamera busy={false} onCapture={async () => {}} onReview={onReview} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('photo-camera')).toHaveLength(0);
  expect(find('take-photo')[0].props.disabled).toBe(true);
  await act(async () => { find('show-photo-review')[0].props.onPress(); });
  expect(onReview).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});
