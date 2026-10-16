import type { KeyValueStore } from '@/storage/key-value-store';

import { createMockAuthService } from './mock-auth';
import { createMockIdentification } from './mock-identification';

function setup() {
  const records = new Map<string, string>();
  const storage: KeyValueStore = {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => { records.set(key, value); },
    remove: async (key) => { records.delete(key); },
    removePrefix: async (prefix) => { for (const key of records.keys()) if (key.startsWith(prefix)) records.delete(key); },
  };
  let nextId = 0;
  const ids = { next: () => `id-${++nextId}` };
  const clock = { now: () => new Date('2026-09-25T00:00:00.000Z') };
  const auth = createMockAuthService(storage, 'server/auth', clock, ids);
  const create = () => createMockIdentification(storage, 'development', auth, clock, ids, async () => []);
  return { records, auth, create };
}

it('exposes only approved portrait catalog entries across groups to authenticated fans and guests', async () => {
  const { auth, create } = setup();
  const service = create();
  const fan = await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  const first = await service.listPickupIdols(fan.credential);
  expect(first.map((idol) => idol.id).sort()).toEqual(['idol-a', 'idol-a2', 'idol-a3', 'idol-a4', 'idol-a5', 'idol-b', 'idol-b2', 'idol-b3']);
  expect(new Set(first.map((idol) => idol.id)).size).toBe(first.length);
  expect(first.length).toBeLessThanOrEqual(10);
  expect(first.every((idol) => idol.portraitSource && idol.groupName)).toBe(true);
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const shuffled = await service.listPickupIdols(fan.credential);
  random.mockReturnValue(0.999);
  const original = await service.listPickupIdols(fan.credential);
  random.mockRestore();
  expect(shuffled.map((idol) => idol.id)).not.toEqual(original.map((idol) => idol.id));
  const guest = await auth.createGuest('pickup-guest', 'pickup-access');
  expect(await service.listPickupIdols(guest.credential)).toHaveLength(8);
  const group = await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  await expect(service.listPickupIdols(group.credential)).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(service.listPickupIdols('invalid')).rejects.toMatchObject({ code: 'Unauthenticated' });
  await expect(service.listTrendingIdols(group.credential)).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(service.listTrendingIdols('invalid')).rejects.toMatchObject({ code: 'Unauthenticated' });
  expect(await service.listTrendingIdols(fan.credential)).toEqual([]);
});

it('adds five portraits to an old catalog once without overwriting names or recipients', async () => {
  const { auth, create, records } = setup();
  const fan = await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  await create().listPickupIdols(fan.credential);
  const key = [...records.keys()].find((key) => key.endsWith('/identification'))!;
  const stored = JSON.parse(records.get(key)!);
  const additions = new Set(['idol-a3', 'idol-a4', 'idol-a5', 'idol-b2', 'idol-b3']);
  stored.seedVersion = 1;
  stored.data.idols = stored.data.idols.filter((idol: { id: string }) => !additions.has(idol.id));
  stored.data.idols[0].name = 'Existing custom name';
  stored.data.idols[1].name = 'テストアイドルA2';
  stored.data.recipients[0].number = '123456';
  const recipients = JSON.stringify(stored.data.recipients);
  records.set(key, JSON.stringify(stored));
  expect(await create().listPickupIdols(fan.credential)).toHaveLength(8);
  const updated = JSON.parse(records.get(key)!);
  expect(updated.seedVersion).toBe(3);
  expect(updated.data.idols[0].name).toBe('Existing custom name');
  expect(updated.data.idols[1].name).toBe('白瀬りん');
  expect(JSON.stringify(updated.data.recipients)).toBe(recipients);
  const after = new Map(records);
  expect(await create().listPickupIdols(fan.credential)).toHaveLength(8);
  expect(records).toEqual(after);
});

it('resolves QR and number via authenticated group without exposing fan details', async () => {
  const { auth, create } = setup();
  const group = await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const fan = await auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  const service = create();
  const own = await service.getOwnIdentity(fan.credential);
  expect(await service.getOwnRecipientRef(fan.credential)).toBe('recipient-member-a');
  expect(own).toEqual({ number: '700001', qrPayload: 'dc:1:member:member-a' });
  const byQr = await service.resolveQr(group.credential, own.qrPayload);
  expect(byQr).toEqual({ recipientRef: 'recipient-member-a', kind: 'member' });
  expect(await service.resolveNumber(group.credential, own.number)).toEqual(byQr);
  const memberIntake = await service.saveIntake(group.credential, byQr!.recipientRef, ['idol-a']);
  expect(await service.getIntakeRecipientName(group.credential, memberIntake.id)).toBe('テストファンA');
  await expect(service.getIntakeRecipientName(fan.credential, memberIntake.id)).rejects.toMatchObject({ code: 'Forbidden' });
  expect(JSON.stringify(byQr)).not.toMatch(/fan@example|テストファン|700001/);
  expect(await service.resolveQr(group.credential, 'dc:1:member:unknown')).toBeNull();
  expect(await service.resolveNumber(group.credential, '999999')).toBeNull();
  await expect(service.resolveQr(group.credential, 'https://example.test')).rejects.toMatchObject({ code: 'Validation' });
  await expect(service.resolveNumber(group.credential, 'abc')).rejects.toMatchObject({ code: 'Validation' });
  await expect(service.resolveQr(fan.credential, own.qrPayload)).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(service.getOwnIdentity(group.credential)).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(service.getOwnRecipientRef(group.credential)).rejects.toMatchObject({ code: 'Forbidden' });
});

it('keeps the guest six-digit leading zero and allows exactly one recipient with several approved own idols', async () => {
  const { auth, create, records } = setup();
  const group = await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const groupB = await auth.signIn({ email: 'group-b@example.test', password: 'DemoPass123' });
  const service = create();
  const guest = await service.resolveNumber(group.credential, '000123');
  expect(guest).toEqual({ recipientRef: 'recipient-guest-1', kind: 'guest' });
  expect(await service.resolveQr(group.credential, 'dc:1:guest:guest-1')).toEqual(guest);
  expect(await service.resolveNumber(group.credential, '123')).toBeNull();
  expect(await service.listSelectableIdols(group.credential)).toEqual(expect.arrayContaining([
    { id: 'idol-a', name: '朝比奈みお' }, { id: 'idol-a2', name: '白瀬りん' },
  ].map((idol) => expect.objectContaining(idol))));
  expect(await service.listSelectableIdols(group.credential)).toHaveLength(5);
  expect((await service.listSelectableIdols(group.credential)).every((idol) => !!idol.portraitSource)).toBe(true);
  await expect(service.saveIntake(group.credential, guest!.recipientRef, [])).rejects.toMatchObject({ code: 'Validation' });
  await expect(service.saveIntake(group.credential, guest!.recipientRef, ['idol-a', 'idol-a'])).rejects.toMatchObject({ code: 'Validation' });
  await expect(service.saveIntake(group.credential, guest!.recipientRef, ['idol-b'])).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(service.saveIntake(group.credential, guest!.recipientRef, ['idol-a-pending'])).rejects.toMatchObject({ code: 'Forbidden' });
  const saved = await service.saveIntake(group.credential, guest!.recipientRef, ['idol-a', 'idol-a2']);
  expect(await service.getIntakeRecipientName(group.credential, saved.id)).toBe('ゲスト');
  await expect(service.getIntakeRecipientName(groupB.credential, saved.id)).rejects.toMatchObject({ code: 'NotFound' });
  expect(saved).toMatchObject({ groupId: 'group-a', recipientRef: 'recipient-guest-1', idolIds: ['idol-a', 'idol-a2'] });
  expect(saved.acceptedAt).toBe('2026-09-25T00:00:00.000Z');
  const beforeRestart = new Map(records);
  expect(await create().getLatestIntake(group.credential)).toEqual(saved);
  expect(await create().listIntakes(group.credential)).toEqual([saved]);
  expect(records).toEqual(beforeRestart);
  expect(await create().getLatestIntake(groupB.credential)).toBeNull();
  expect(await create().listIntakes(groupB.credential)).toEqual([]);
  expect([...records.keys()].some((key) => key.includes('/group/') && key.endsWith('/capture-intakes'))).toBe(true);
});
