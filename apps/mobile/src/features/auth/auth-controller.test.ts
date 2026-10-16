import { AppError } from '@/core/errors';
import type { AuthService, AuthSession } from '@/services/contracts/auth';

import { AuthController } from './auth-controller';

const group: AuthSession = { principal: { id: 'group-a', role: 'group', displayName: 'グループA' }, credential: 'group-token', expiresAt: '2026-09-26T00:00:00.000Z' };
const fan: AuthSession = { principal: { id: 'fan-a', role: 'fan', displayName: 'ファンA' }, credential: 'fan-token', expiresAt: '2026-09-26T00:00:00.000Z' };

function setup() {
  let stored: string | null = null;
  const credentials = {
    read: jest.fn(async () => stored),
    write: jest.fn(async (value: string) => { stored = value; }),
    remove: jest.fn(async () => { stored = null; }),
  };
  const service: jest.Mocked<AuthService> = {
    signIn: jest.fn(async ({ email }) => email.startsWith('group') ? group : fan),
    restore: jest.fn(async (credential) => credential === 'group-token' ? group : fan),
    signOut: jest.fn(async (_credential: string) => {}),
  };
  return { credentials, service, getStored: () => stored, controller: new AuthController(service, credentials) };
}

it('validates input without applying registration password rules or contacting service', async () => {
  const { controller, service } = setup();
  await expect(controller.signIn({ email: '', password: '' })).rejects.toMatchObject({ code: 'Validation' });
  await expect(controller.signIn({ email: 'wrong', password: 'x' })).rejects.toMatchObject({ code: 'Validation' });
  expect(service.signIn).not.toHaveBeenCalled();
  await controller.signIn({ email: ' GROUP@example.test ', password: 'x' });
  expect(service.signIn).toHaveBeenCalledWith({ email: 'group@example.test', password: 'x' });
});

it('restores a group after restart and returns to logged-out state after switching to fan', async () => {
  const { controller, service, credentials, getStored } = setup();
  await controller.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  expect(controller.getSnapshot().session?.principal.role).toBe('group');
  const restarted = new AuthController(service, credentials);
  expect(restarted.getSnapshot().session).toBeNull();
  await restarted.restore();
  expect(restarted.getSnapshot().session?.principal.id).toBe('group-a');
  await restarted.signOut();
  expect(getStored()).toBeNull();
  expect(service.signOut).toHaveBeenCalledWith('group-token');
  const afterLogout = new AuthController(service, credentials);
  await afterLogout.restore();
  expect(afterLogout.getSnapshot().session).toBeNull();
  await afterLogout.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  expect(afterLogout.getSnapshot().session?.principal).toEqual(fan.principal);
});

it('does not expose a session or persist a token when SecureStore write fails', async () => {
  const { controller, credentials, service, getStored } = setup();
  credentials.write.mockRejectedValueOnce(new AppError('Storage', 'secure store unavailable'));
  await expect(controller.signIn({ email: 'group@example.test', password: 'x' })).rejects.toMatchObject({ code: 'Storage' });
  expect(controller.getSnapshot()).toMatchObject({ session: null, busy: false, error: 'Storage' });
  expect(getStored()).toBeNull();
  expect(service.signOut).toHaveBeenCalledWith('group-token');
});

it('keeps a verified or guest session hidden when SecureStore cannot persist it', async () => {
  const { controller, credentials, service } = setup();
  credentials.write.mockRejectedValueOnce(new AppError('Storage', 'secure store unavailable'));
  await expect(controller.acceptSession(fan)).rejects.toMatchObject({ code: 'Storage' });
  expect(controller.getSnapshot()).toMatchObject({ session: null, busy: false, error: 'Storage' });
  expect(service.signOut).toHaveBeenCalledWith(fan.credential);
});

it('discards and revokes a delayed response after leaving login', async () => {
  const { controller, service, credentials } = setup();
  let finish!: (value: AuthSession) => void;
  service.signIn.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = controller.signIn({ email: 'group@example.test', password: 'x' });
  expect(controller.getSnapshot().busy).toBe(true);
  await controller.signOut();
  finish(group);
  await expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
  expect(controller.getSnapshot().session).toBeNull();
  expect(credentials.write).not.toHaveBeenCalled();
  expect(service.signOut).toHaveBeenCalledWith('group-token');
});

it('removes invalid restored credentials before route presentation', async () => {
  const { controller, credentials, service } = setup();
  await credentials.write('expired');
  service.restore.mockRejectedValueOnce(new AppError('Expired', 'expired'));
  await controller.restore();
  expect(controller.getSnapshot()).toMatchObject({ session: null, error: 'Expired' });
  expect(credentials.remove).toHaveBeenCalled();
});

it('hides and revokes a session even if secure deletion fails', async () => {
  const { controller, credentials, service } = setup();
  await controller.signIn({ email: 'group@example.test', password: 'x' });
  credentials.remove.mockRejectedValueOnce(new AppError('Storage', 'delete failed'));
  await expect(controller.signOut()).rejects.toMatchObject({ code: 'Storage' });
  expect(controller.getSnapshot().session).toBeNull();
  expect(service.signOut).toHaveBeenCalledWith('group-token');
});
