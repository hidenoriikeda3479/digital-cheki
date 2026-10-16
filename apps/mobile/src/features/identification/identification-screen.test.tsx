import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { IdentificationService } from '@/services/contracts/identification';

import { IdentificationController } from './identification-controller';
import { IdentificationScreen } from './identification-screen';

const group: AuthSession = { principal: { id: 'group-a', role: 'group', displayName: 'グループA' }, credential: 'group-token', expiresAt: '2026-09-26T00:00:00.000Z' };
const fan: AuthSession = { principal: { id: 'fan-a', role: 'fan', displayName: 'ファンA' }, credential: 'fan-token', expiresAt: '2026-09-26T00:00:00.000Z' };
const mockTheme = { text: '#ffffff', background: '#000000', backgroundElement: '#212225', textSecondary: '#B0B4BA' };
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => mockTheme }));

function setup() {
  let stored: string | null = null;
  const auth = new AuthController({
    signIn: async ({ email }) => email === 'group@example.test' ? group : fan,
    restore: async (credential) => credential === 'group-token' ? group : fan,
    signOut: async () => {},
  }, {
    read: async () => stored,
    write: async (credential) => { stored = credential; },
    remove: async () => { stored = null; },
  });
  const service: jest.Mocked<IdentificationService> = {
    getIntakeRecipientName: jest.fn(async (_credential: string, _intakeId: string) => 'テストファンA'), getOwnIdentity: jest.fn(async (_credential: string) => ({ number: '700001', qrPayload: 'dc:1:member:member-a' })),
    getOwnRecipientRef: jest.fn(async (_credential: string) => 'recipient-member-a'),
    resolveQr: jest.fn(async (_credential: string, _payload: string) => ({ recipientRef: 'recipient-member-a', kind: 'member' as const })),
    resolveNumber: jest.fn(async (_credential: string, _number: string) => ({ recipientRef: 'recipient-member-a', kind: 'member' as const })),
    listTrendingIdols: jest.fn(async (_credential: string) => []), listPickupIdols: jest.fn(async (_credential: string) => []), listSelectableIdols: jest.fn(async (_credential: string) => [
      { id: 'idol-a', name: 'アイドルA', portraitSource: { uri: 'file:///idol-a.png' } },
      { id: 'idol-a2', name: 'アイドルA2', portraitSource: { uri: 'file:///idol-a2.png' } },
    ]),
    saveIntake: jest.fn(async (_credential: string, recipientRef: string, idolIds: string[]) => ({
      id: 'intake-1', groupId: 'group-a', recipientRef, idolIds, acceptedAt: '2026-09-25T00:00:00.000Z',
    })),
    getLatestIntake: jest.fn(async (_credential: string) => null),
    listIntakes: jest.fn(async (_credential: string) => []),
  };
  return { auth, service, controller: new IdentificationController(auth, service) };
}

it('shows only existence, requires one idol, and saves multiple approved selections', async () => {
  const { auth, service, controller } = setup();
  const onStartCapture = jest.fn(async () => true);
  await auth.signIn({ email: 'group@example.test', password: 'x' });
  await controller.initialize();
  controller.openReception();
  controller.openNumber();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<IdentificationScreen controller={controller} onStartCapture={onStartCapture} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('recipient-number')[0].props.onChangeText('700001'); });
  await act(async () => { find('check-number')[0].props.onPress(); });
  expect(find('idol-screen')).toHaveLength(1);
  expect(find('idol-grid')).toHaveLength(1);
  expect(find('idol-photo-idol-a').length).toBeGreaterThan(0);
  expect(find('idol-photo-idol-a2').length).toBeGreaterThan(0);
  expect(find('recipient-found')).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).not.toMatch(/700001|fan@example|ファンA|recipient-member-a/);
  expect(find('save-intake')[0].props.disabled).toBe(true);
  await act(async () => { find('idol-idol-a')[0].props.onPress(); find('idol-idol-a2')[0].props.onPress(); });
  expect(find('save-intake')[0].props.disabled).toBe(false);
  await act(async () => { find('save-intake')[0].props.onPress(); });
  expect(service.saveIntake).toHaveBeenCalledWith('group-token', 'recipient-member-a', ['idol-a', 'idol-a2']);
  expect(onStartCapture).toHaveBeenCalledWith('intake-1');
  expect(find('intake-saved')).toHaveLength(0);
  expect(find('start-capture')).toHaveLength(0);
  expect(find('capture-opening')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('shows the signed-in fan QR and number, then clears them on logout', async () => {
  const { auth, service, controller } = setup();
  await auth.signIn({ email: 'fan@example.test', password: 'x' });
  await controller.initialize();
  await controller.showFanCode();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<IdentificationScreen controller={controller} principal={fan.principal} onStartCapture={async () => true} />); });
  expect(renderer.root.findAllByProps({ testID: 'fan-code-screen' }).length).toBeGreaterThan(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('700001');
  expect(JSON.stringify(renderer.toJSON())).toContain(fan.principal.displayName);
  await act(async () => { renderer.root.findAllByProps({ testID: 'refresh-own-qr' })[0].props.onPress(); });
  expect(service.getOwnIdentity).toHaveBeenCalledTimes(2);
  expect(service.getOwnIdentity).toHaveBeenLastCalledWith('fan-token');
  await act(async () => { await auth.signOut(); });
  expect(controller.getSnapshot().ownIdentity).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it('stays on idol selection when intake storage fails and does not open capture', async () => {
  const { auth, service, controller } = setup();
  service.saveIntake.mockRejectedValueOnce(new Error('storage unavailable'));
  const onStartCapture = jest.fn(async () => true);
  await auth.signIn({ email: 'group@example.test', password: 'x' });
  await controller.initialize();
  controller.openReception();
  controller.openNumber();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<IdentificationScreen controller={controller} onStartCapture={onStartCapture} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('recipient-number')[0].props.onChangeText('700001'); find('check-number')[0].props.onPress(); });
  await act(async () => { find('idol-idol-a')[0].props.onPress(); });
  await act(async () => { find('save-intake')[0].props.onPress(); });
  expect(find('idol-screen')).toHaveLength(1);
  expect(find('identification-error')).toHaveLength(1);
  expect(onStartCapture).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});
