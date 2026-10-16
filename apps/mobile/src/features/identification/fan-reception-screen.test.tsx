import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FanReceptionScreen } from './fan-reception-screen';

it('keeps the guest number including its leading zero and exposes help without inventing member information', async () => {
  let renderer!: ReactTestRenderer;
  const onBack = jest.fn();
  const onRefresh = jest.fn();
  const props = { identity: { number: '012345', qrPayload: 'dc:1:guest:test' },
    principal: { id: 'guest-a', role: 'guest' as const, displayName: 'guest-a' },
    busy: false, error: null, embedded: true, onBack, onRefresh };
  await act(async () => { renderer = create(<FanReceptionScreen {...props} />); });
  expect(JSON.stringify(renderer.toJSON())).toContain('012345');
  expect(JSON.stringify(renderer.toJSON())).toContain('一時番号');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('好きでいてくれて');
  await act(async () => { renderer.root.findAllByProps({ testID: 'qr-reception-content' })[0].props.onLayout({ nativeEvent: { layout: { height: 500 } } }); });
  expect(renderer.root.findAllByProps({ testID: 'member-qr' })[0].props.width).toBe(150);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('ScrollView');
  expect(renderer.root.findAllByProps({ testID: 'own-name' })[0].props.children).toContain('ゲスト');
  await act(async () => { renderer.root.findAllByProps({ testID: 'qr-help' })[0].props.onPress(); });
  expect(renderer.root.findAllByProps({ testID: 'close-qr-help' }).length).toBeGreaterThan(0);
  await act(async () => { renderer.root.findAllByProps({ testID: 'close-qr-help' })[0].props.onPress(); });
  await act(async () => { renderer.update(<FanReceptionScreen {...props} busy error="更新できませんでした" />); });
  expect(renderer.root.findAllByProps({ testID: 'refresh-own-qr' })[0].props.disabled).toBe(true);
  expect(renderer.root.findAllByProps({ testID: 'identification-error' }).length).toBeGreaterThan(0);
  await act(async () => { renderer.root.findAllByProps({ testID: 'intake-back' })[0].props.onPress(); });
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onRefresh).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});
