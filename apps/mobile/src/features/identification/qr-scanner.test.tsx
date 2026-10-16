import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import { QrScanner } from './qr-scanner';

let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
let mockFocused = true;
const mockRequest = jest.fn(async () => ({ granted: true }));
jest.mock('expo-camera', () => ({
  CameraView: (props: object) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const React = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const { View } = require('react-native');
    return React.createElement(View, props);
  },
  useCameraPermissions: () => [mockPermission, mockRequest],
}));
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff' }) }));

beforeEach(() => {
  mockPermission = { granted: true, canAskAgain: true };
  mockFocused = true;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});

it('reads a QR only once, stops during processing, and unmounts when tab loses focus', async () => {
  const onRead = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<QrScanner busy={false} onRead={onRead} onNumber={() => {}} />); });
  const camera = () => renderer.root.findAll((item) => item.props.testID === 'qr-camera' && typeof item.type !== 'string')[0];
  expect(camera()).toBeDefined();
  await act(async () => {
    camera().props.onBarcodeScanned({ data: 'dc:1:member:member-a' });
    camera().props.onBarcodeScanned({ data: 'dc:1:member:member-a' });
  });
  expect(onRead).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.update(<QrScanner busy onRead={onRead} onNumber={() => {}} />); });
  expect(camera()).toBeUndefined();
  mockFocused = false;
  await act(async () => { renderer.update(<QrScanner busy={false} onRead={onRead} onNumber={() => {}} />); });
  expect(camera()).toBeUndefined();
  await act(async () => { renderer.unmount(); });
});

it('keeps number entry available after camera denial', async () => {
  mockPermission = { granted: false, canAskAgain: false };
  const onNumber = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<QrScanner busy={false} onRead={() => {}} onNumber={onNumber} />); });
  expect(JSON.stringify(renderer.toJSON())).toContain('番号入力でも進めます');
  expect(renderer.root.findAllByProps({ testID: 'qr-camera' })).toHaveLength(0);
  await act(async () => { renderer.root.findAll((item) => item.props.testID === 'open-number' && typeof item.type !== 'string')[0].props.onPress(); });
  expect(onNumber).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});
