import type { KeyValueStore } from '@/storage/key-value-store';
import { AuthController } from '@/features/auth/auth-controller';
import { createMockAuthService } from './mock-auth';
import { createMockSupport } from './mock-support';
import { createMockIdentification } from './mock-identification';

jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash('sha256').update(value).digest('hex'),
}));

function setup() {
  const data = new Map<string, string>();
  let failSupport = false;
  let credential: string | null = null;
  const storage: KeyValueStore = { get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { if (failSupport && key.endsWith('/support')) { failSupport = false; throw Error('disk full'); } data.set(key, value); },
    remove: async (key) => { data.delete(key); }, removePrefix: async (prefix) => { for (const key of data.keys()) if (key.startsWith(prefix)) data.delete(key); } };
  let sequence = 0;
  const clock = { now: () => new Date('2026-09-25T00:00:00.000Z') };
  const ids = { next: () => `id-${++sequence}` };
  const createAuth = () => createMockAuthService(storage, 'mock-stage12-auth', clock, ids);
  const credentials = { read: async () => credential, write: async (value: string) => { credential = value; },
    remove: async () => { credential = null; } };
  return { data, storage, createAuth, credentials, clock, ids, failNextSupport: () => { failSupport = true; } };
}

it('logically deletes only the fan, revokes all sessions and reset references, and retains unrelated state', async () => {
  const env = setup();
  const service = env.createAuth();
  const auth = new AuthController(service, env.credentials);
  await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  const first = auth.getSnapshot().session!.credential;
  const second = await service.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  const group = await service.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const reset = await service.requestReset('fan@example.test');
  const reference = await service.readReference(reset.requestId);
  env.data.set('unrelated-file-record', 'kept');
  await auth.deleteAccount();
  expect(auth.getSnapshot().session).toBeNull();
  expect(await env.credentials.read()).toBeNull();
  const restarted = env.createAuth();
  const identification = createMockIdentification(env.storage, 'development', restarted, env.clock, env.ids);
  await expect(restarted.restore(first)).rejects.toMatchObject({ code: 'Unauthenticated' });
  await expect(restarted.restore(second.credential)).rejects.toMatchObject({ code: 'Unauthenticated' });
  await expect(restarted.signIn({ email: 'fan@example.test', password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(restarted.requestReset('fan@example.test')).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(identification.getOwnIdentity(second.credential)).rejects.toMatchObject({ code: 'Unauthenticated' });
  await expect(restarted.completeReset(reset.requestId, reference!, 'NewFanPass123')).rejects.toMatchObject({ code: 'Conflict' });
  expect((await restarted.restore(group.credential)).principal.id).toBe('group-a');
  expect(await restarted.emailStatus('fan@example.test')).toBe('deleted');
  expect(env.data.get('unrelated-file-record')).toBe('kept');
  expect(env.data.get('mock-stage12-auth')).toContain('"status":"deleted"');
});

it('validates and persists support receipts without external sending, while storage failure leaves no acceptance', async () => {
  const env = setup();
  const auth = env.createAuth();
  const group = await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const fan = await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  const make = () => createMockSupport({ storage: env.storage, environment: 'development', auth: env.createAuth(), clock: env.clock, ids: env.ids });
  const support = make();
  await expect(support.service.submit(group.credential, '', '本文')).rejects.toMatchObject({ code: 'Validation' });
  await expect(support.service.submit('invalid', '件名', '本文')).rejects.toMatchObject({ code: 'Unauthenticated' });
  env.failNextSupport();
  await expect(support.service.submit(group.credential, '件名', '本文')).rejects.toMatchObject({ code: 'Storage' });
  expect(await make().inbox.list()).toEqual([]);
  const receipt = await support.service.submit(group.credential, '  件名  ', '  本文  ');
  await support.service.submit(fan.credential, 'ファン件名', 'ファン本文');
  expect(await make().inbox.list()).toEqual([
    { ...receipt, principalId: 'group-a', role: 'group', subject: '件名', content: '本文' },
    expect.objectContaining({ principalId: 'fan-a', role: 'fan', subject: 'ファン件名' }),
  ]);
  if (!auth.deleteAccount) throw Error('Missing account deletion');
  await auth.deleteAccount(fan.credential);
  await expect(support.service.submit(fan.credential, '再送', '本文')).rejects.toMatchObject({ code: 'Unauthenticated' });
  expect(await make().inbox.list()).toHaveLength(2);
});
