import type { KeyValueStore } from '@/storage/key-value-store';
import { createMockAuthService } from './mock-auth';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash('sha256').update(value).digest('hex'),
}));

function setup() {
  const records = new Map<string, string>();
  let failWrite = false;
  const storage: KeyValueStore = {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => { if (failWrite && key === 'password-test-auth') { failWrite = false; throw Error('disk unavailable'); } records.set(key, value); },
    remove: async (key) => { records.delete(key); },
    removePrefix: async (prefix) => { for (const key of records.keys()) if (key.startsWith(prefix)) records.delete(key); },
  };
  let now = new Date('2026-09-25T00:00:00.000Z');
  let id = 0;
  const create = () => createMockAuthService(storage, 'password-test-auth', { now: () => now }, { next: () => `password-id-${++id}` });
  return { create, records, failNextWrite: () => { failWrite = true; }, setNow: (value: string) => { now = new Date(value); } };
}

it('changes group and fan passwords independently and keeps the result after recreation', async () => {
  const { create, records } = setup();
  const service = create();
  const group = await service.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const fan = await service.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  await expect(service.changePassword(group.credential, 'wrong', 'NewGroup123')).rejects.toMatchObject({ code: 'Unauthenticated' });
  await expect(service.changePassword(group.credential, 'DemoPass123', 'weak')).rejects.toMatchObject({ code: 'Validation' });
  await service.changePassword(group.credential, 'DemoPass123', 'NewGroup123');
  await expect(create().signIn({ email: 'group@example.test', password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Unauthenticated' });
  expect((await create().signIn({ email: 'group@example.test', password: 'NewGroup123' })).principal.id).toBe('group-a');
  expect((await service.signIn({ email: 'fan@example.test', password: 'DemoPass123' })).principal.id).toBe('fan-a');
  await service.changePassword(fan.credential, 'DemoPass123', 'NewFanPass123');
  await expect(create().signIn({ email: 'fan@example.test', password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Unauthenticated' });
  expect((await create().signIn({ email: 'fan@example.test', password: 'NewFanPass123' })).principal.id).toBe('fan-a');
  expect([...records.values()].join('')).not.toContain('NewGroup123');
  expect([...records.values()].join('')).not.toContain('NewFanPass123');
});

it('binds latest reset reference to one account and refuses invalid, used, deleted and expired requests', async () => {
  const { create, setNow } = setup();
  const service = create();
  await expect(service.requestReset('deleted-fan@example.test')).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(service.requestReset('stopped-group@example.test')).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(service.requestReset('absent@example.test')).rejects.toMatchObject({ code: 'NotFound' });
  const group = await service.requestReset('group@example.test');
  const groupRef = await service.readReference(group.requestId);
  const fanOld = await service.requestReset('fan@example.test');
  const fanOldRef = await service.readReference(fanOld.requestId);
  const fan = await service.requestReset('fan@example.test');
  const fanRef = await service.readReference(fan.requestId);
  expect(fanRef).not.toBe(fanOldRef);
  await expect(service.completeReset(fanOld.requestId, fanOldRef!, 'NewFanPass123')).rejects.toMatchObject({ code: 'Conflict' });
  await expect(service.completeReset(fan.requestId, groupRef!, 'NewFanPass123')).rejects.toMatchObject({ code: 'Unauthenticated' });
  await expect(service.completeReset('invalid', fanRef!, 'NewFanPass123')).rejects.toMatchObject({ code: 'Unauthenticated' });
  await service.completeReset(fan.requestId, fanRef!, 'NewFanPass123');
  await expect(service.completeReset(fan.requestId, fanRef!, 'OtherFan123')).rejects.toMatchObject({ code: 'Conflict' });
  expect(await service.readReference(fan.requestId)).toBeNull();
  await expect(create().signIn({ email: 'fan@example.test', password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Unauthenticated' });
  expect((await create().signIn({ email: 'fan@example.test', password: 'NewFanPass123' })).principal.id).toBe('fan-a');
  expect((await create().signIn({ email: 'group@example.test', password: 'DemoPass123' })).principal.id).toBe('group-a');
  setNow(group.expiresAt);
  await expect(service.completeReset(group.requestId, groupRef!, 'NewGroup123')).rejects.toMatchObject({ code: 'Expired' });
});

it('does not consume a reset reference or change the password after storage failure', async () => {
  const { create, failNextWrite } = setup();
  const service = create();
  const challenge = await service.requestReset('fan@example.test');
  const reference = await service.readReference(challenge.requestId);
  failNextWrite();
  await expect(service.completeReset(challenge.requestId, reference!, 'NewFanPass123')).rejects.toMatchObject({ code: 'Storage' });
  expect((await create().signIn({ email: 'fan@example.test', password: 'DemoPass123' })).principal.id).toBe('fan-a');
  expect(await service.readReference(challenge.requestId)).toBe(reference);
  await service.completeReset(challenge.requestId, reference!, 'NewFanPass123');
  expect((await create().signIn({ email: 'fan@example.test', password: 'NewFanPass123' })).principal.id).toBe('fan-a');
});

it('does not reactivate a deleted account even with a previously issued reference', async () => {
  const { create, records } = setup();
  const service = create();
  const challenge = await service.requestReset('fan@example.test');
  const reference = await service.readReference(challenge.requestId);
  const saved = JSON.parse(records.get('password-test-auth')!);
  saved.data.accounts = saved.data.accounts.map((account: { id: string; status: string }) =>
    account.id === 'fan-a' ? { ...account, status: 'deleted' } : account);
  records.set('password-test-auth', JSON.stringify(saved));
  await expect(service.completeReset(challenge.requestId, reference!, 'NewFanPass123')).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(create().signIn({ email: 'fan@example.test', password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Forbidden' });
});

it('keeps the old password after a failed change write', async () => {
  const { create, failNextWrite } = setup();
  const service = create();
  const group = await service.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  failNextWrite();
  await expect(service.changePassword(group.credential, 'DemoPass123', 'NewGroup123')).rejects.toMatchObject({ code: 'Storage' });
  expect((await create().signIn({ email: 'group@example.test', password: 'DemoPass123' })).principal.id).toBe('group-a');
  await expect(create().signIn({ email: 'group@example.test', password: 'NewGroup123' })).rejects.toMatchObject({ code: 'Unauthenticated' });
});
