import type { KeyValueStore } from '@/storage/key-value-store';

import { createMockAuthService } from './mock-auth';

function setup() {
  const records = new Map<string, string>();
  const storage: KeyValueStore = {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => { records.set(key, value); },
    remove: async (key) => { records.delete(key); },
    removePrefix: async (prefix) => { for (const key of records.keys()) if (key.startsWith(prefix)) records.delete(key); },
  };
  let now = new Date('2026-09-25T00:00:00.000Z');
  let id = 0;
  const create = () => createMockAuthService(storage, 'mock-auth-test', { now: () => now }, { next: () => `credential-${++id}` });
  return { create, records, setNow: (date: string) => { now = new Date(date); } };
}

it('authenticates distinct group/fan principals and persists sessions across service re-creation', async () => {
  const { create, records } = setup();
  const first = create();
  const group = await first.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const fan = await first.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  expect([...records.values()].join('')).not.toContain('DemoPass123');
  expect(group.principal).toMatchObject({ id: 'group-a', role: 'group' });
  expect(fan.principal).toMatchObject({ id: 'fan-a', role: 'fan' });
  expect((await create().restore(group.credential)).principal.id).toBe('group-a');
  expect((await create().restore(fan.credential)).principal.id).toBe('fan-a');
  const before = new Map(records);
  await create().restore(group.credential);
  expect(records).toEqual(before);
  await first.signOut(group.credential);
  await expect(create().restore(group.credential)).rejects.toMatchObject({ code: 'Unauthenticated' });
  expect((await create().restore(fan.credential)).principal.id).toBe('fan-a');
});

it('renames legacy group labels while keeping existing credentials and account state intact', async () => {
  const { create, records } = setup();
  const group = await create().signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const stored = JSON.parse(records.get('mock-auth-test')!);
  stored.seedVersion = 1;
  stored.data.accounts.find((account: { id: string }) => account.id === 'group-a').displayName = 'テストグループA';
  stored.data.accounts.find((account: { id: string }) => account.id === 'group-b').displayName = 'Custom group';
  const sessions = JSON.stringify(stored.data.sessions);
  records.set('mock-auth-test', JSON.stringify(stored));
  expect((await create().restore(group.credential)).principal.displayName).toBe('ソラノシンフォニー');
  const after = JSON.parse(records.get('mock-auth-test')!);
  expect(JSON.stringify(after.data.sessions)).toBe(sessions);
  expect(after.data.accounts.find((account: { id: string }) => account.id === 'group-b').displayName).toBe('Custom group');
});

it('rejects bad credentials, stopped groups and deleted fans', async () => {
  const auth = setup().create();
  await expect(auth.signIn({ email: 'group@example.test', password: 'wrong' })).rejects.toMatchObject({ code: 'Unauthenticated' });
  await expect(auth.signIn({ email: 'stopped-group@example.test', password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(auth.signIn({ email: 'deleted-fan@example.test', password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Forbidden' });
});

it('expires a mock session with an injected clock', async () => {
  const { create, setNow } = setup();
  const session = await create().signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  setNow(session.expiresAt);
  await expect(create().restore(session.credential)).rejects.toMatchObject({ code: 'Expired' });
});
