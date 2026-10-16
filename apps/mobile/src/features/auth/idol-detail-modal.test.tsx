import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking } from 'react-native';
import { IdolDetailModal } from './idol-detail-modal';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
const idol = { id: 'a', name: '朝比奈みお', groupName: 'ソラノシンフォニー', portraitSource: 1,
  socialLinks: { x: 'https://x.com/', instagram: 'https://www.instagram.com/' } };
afterEach(() => jest.restoreAllMocks());

it('opens only the selected social destination on a button press', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined).mockClear();
  const close = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<IdolDetailModal idol={idol} onClose={close} />); });
  expect(open).not.toHaveBeenCalled();
  await act(async () => { renderer.root.findAllByProps({ testID: 'idol-social-x' })[0].props.onPress(); });
  expect(open).toHaveBeenLastCalledWith('https://x.com/');
  await act(async () => { renderer.root.findAllByProps({ testID: 'idol-social-instagram' })[0].props.onPress(); });
  expect(open).toHaveBeenLastCalledWith('https://www.instagram.com/');
  await act(async () => { renderer.root.findAllByProps({ testID: 'close-idol-detail' })[0].props.onPress(); });
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});

it('blocks duplicate opens and reports an OS link failure while allowing close', async () => {
  let reject!: (error: Error) => void;
  const open = jest.spyOn(Linking, 'openURL').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; })).mockClear();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<IdolDetailModal idol={idol} onClose={() => {}} />); });
  await act(async () => {
    const button = renderer.root.findAllByProps({ testID: 'idol-social-x' })[0];
    button.props.onPress(); button.props.onPress();
  });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { reject(Error('unavailable')); });
  expect(renderer.root.findAllByProps({ testID: 'idol-link-error' }).length).toBeGreaterThan(0);
  expect(renderer.root.findAllByProps({ testID: 'idol-social-x' })[0].props.disabled).toBe(false);
  await act(async () => { renderer.unmount(); });
});
