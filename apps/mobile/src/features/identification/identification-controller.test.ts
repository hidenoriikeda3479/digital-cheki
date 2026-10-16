import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { IdentificationService, RecipientResolution } from '@/services/contracts/identification';

import { IdentificationController } from './identification-controller';

const group: AuthSession = { principal: { id: 'group-a', role: 'group', displayName: 'グループA' }, credential: 'group-token', expiresAt: '2026-09-26T00:00:00.000Z' };
const fan: AuthSession = { principal: { id: 'fan-a', role: 'fan', displayName: 'ファンA' }, credential: 'fan-token', expiresAt: '2026-09-26T00:00:00.000Z' };

it('drops a late QR response after logout and account switch', async () => {
  let stored: string | null = null;
  const auth = new AuthController({
    signIn: async ({ email }) => email.startsWith('group') ? group : fan,
    restore: async () => group, signOut: async () => {},
  }, { read: async () => stored, write: async (value) => { stored = value; }, remove: async () => { stored = null; } });
  let finish!: (value: RecipientResolution | null) => void;
  const resolveQr = jest.fn(() => new Promise<RecipientResolution | null>((resolve) => { finish = resolve; }));
  const service: IdentificationService = {
    getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => ({ number: '700001', qrPayload: 'dc:1:member:member-a' }),
    getOwnRecipientRef: async () => 'recipient-member-a',
    resolveQr, resolveNumber: async () => null,
    listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [{ id: 'idol-a', name: 'アイドルA' }],
    saveIntake: async () => { throw new Error('unused'); }, getLatestIntake: async () => null, listIntakes: async () => [],
  };
  const controller = new IdentificationController(auth, service);
  await auth.signIn({ email: 'group@example.test', password: 'x' });
  await controller.initialize();
  controller.openReception();
  const pending = controller.resolveQr('dc:1:member:member-a');
  expect(controller.getSnapshot().busy).toBe(true);
  await auth.signOut();
  await auth.signIn({ email: 'fan@example.test', password: 'x' });
  finish({ recipientRef: 'recipient-member-a', kind: 'member' });
  await pending;
  expect(controller.getSnapshot()).toMatchObject({ phase: 'home', recipient: null, latestIntake: null });
  expect(resolveQr).toHaveBeenCalledTimes(1);
});

it('drops a late QR response after returning home', async () => {
  const auth = new AuthController({ signIn: async () => group, restore: async () => group, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  let finish!: (value: RecipientResolution | null) => void;
  const controller = new IdentificationController(auth, {
    getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => { throw new Error('unused'); },
    getOwnRecipientRef: async () => { throw new Error('unused'); },
    resolveQr: async () => new Promise((resolve) => { finish = resolve; }),
    resolveNumber: async () => null, listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [],
    saveIntake: async () => { throw new Error('unused'); }, getLatestIntake: async () => null, listIntakes: async () => [],
  });
  await auth.signIn({ email: 'group@example.test', password: 'x' });
  await controller.initialize();
  controller.openReception();
  const pending = controller.resolveQr('dc:1:member:member-a');
  controller.goHome();
  finish({ recipientRef: 'recipient-member-a', kind: 'member' });
  await pending;
  expect(controller.getSnapshot()).toMatchObject({ phase: 'home', recipient: null, busy: false });
});
