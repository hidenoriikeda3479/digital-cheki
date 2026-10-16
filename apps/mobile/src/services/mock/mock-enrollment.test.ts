import type { KeyValueStore } from '@/storage/key-value-store';
import type { GuestAccessStore } from '@/storage/guest-access-store';
import { createMockAuthService } from './mock-auth';
import { createMockIdentification } from './mock-identification';
import { createMockEnrollment } from './mock-enrollment';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash('sha256').update(value).digest('hex'),
}));

function setup(idQueue: string[] = []) {
  const records = new Map<string, string>();
  const storage: KeyValueStore = {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => { records.set(key, value); },
    remove: async (key) => { records.delete(key); },
    removePrefix: async (prefix) => { for (const key of records.keys()) if (key.startsWith(prefix)) records.delete(key); },
  };
  let guestKey: string | null = null;
  const guestAccess: GuestAccessStore = { read: async () => guestKey, write: async (key) => { guestKey = key; }, remove: async () => { guestKey = null; } };
  let now = new Date('2026-09-25T00:00:00.000Z');
  let sequence = 0;
  const ids = { next: () => idQueue.shift() ?? `stage10-${++sequence}` };
  const clock = { now: () => now };
  function create() {
    const auth = createMockAuthService(storage, 'stage10-auth', clock, ids);
    const identification = createMockIdentification(storage, 'development', auth, clock, ids);
    const enrollment = createMockEnrollment({ storage, environment: 'development', clock, ids, auth, identification, guestAccess });
    return { auth, identification, ...enrollment };
  }
  return { create, records, clock, setNow: (date: string) => { now = new Date(date); }, guestAccess };
}

const input = { email: 'new-fan@example.test', displayName: '新しいファン', password: 'StrongPass123' };

it('validates registration and persists only a salted mock digest', async () => {
  const { create, records } = setup();
  const { service } = create();
  await expect(service.requestRegistration({ ...input, email: '' })).rejects.toMatchObject({ code: 'Validation' });
  await expect(service.requestRegistration({ ...input, password: 'weakpass' })).rejects.toMatchObject({ code: 'Validation' });
  const challenge = await service.requestRegistration(input);
  expect(challenge.email).toBe(input.email);
  expect([...records.values()].join('')).not.toContain(input.password);
  const code = await create().inbox.readLatestCode(challenge.requestId);
  expect(code).toMatch(/^[0-9]{6}$/);
  await expect(service.verifyCode(challenge.requestId, '999999' === code ? '888888' : '999999')).rejects.toMatchObject({ code: 'Unauthenticated' });
  const session = await service.verifyCode(challenge.requestId, code!);
  expect(session.principal).toMatchObject({ role: 'fan', displayName: input.displayName });
  const restarted = create();
  expect((await restarted.auth.signIn({ email: input.email, password: input.password })).principal.id).toBe(session.principal.id);
  await expect(restarted.auth.signIn({ email: input.email, password: 'DemoPass123' })).rejects.toMatchObject({ code: 'Unauthenticated' });
  expect((await restarted.identification.getOwnIdentity(session.credential)).qrPayload).toContain(session.principal.id);
  await expect(restarted.service.requestRegistration(input)).rejects.toMatchObject({ code: 'Conflict' });
  await expect(restarted.service.requestRegistration({ ...input, email: 'deleted-fan@example.test' })).rejects.toMatchObject({ code: 'Conflict' });
  await expect(restarted.service.requestRegistration({ ...input, email: 'group@example.test' })).rejects.toMatchObject({ code: 'Conflict' });
});

it('preserves leading zero, rejects old code and expires exactly at ten minutes', async () => {
  const { create, setNow } = setup(['salt', 'request', 'fan-new', 'a']);
  const { service, inbox } = create();
  const challenge = await service.requestRegistration(input);
  const old = await inbox.readLatestCode(challenge.requestId);
  expect(old).toBe('000097');
  const renewed = await service.resendCode(challenge.requestId);
  const fresh = await inbox.readLatestCode(challenge.requestId);
  expect(fresh).toMatch(/^[0-9]{6}$/);
  expect(fresh).not.toBe(old);
  await expect(service.verifyCode(challenge.requestId, old!)).rejects.toMatchObject({ code: 'Unauthenticated' });
  setNow(new Date(Date.parse(renewed.expiresAt) - 1).toISOString());
  await service.verifyCode(challenge.requestId, fresh!);
  const second = await service.requestRegistration({ ...input, email: 'other@example.test' });
  const secondCode = await inbox.readLatestCode(second.requestId);
  setNow(second.expiresAt);
  await expect(service.verifyCode(second.requestId, secondCode!)).rejects.toMatchObject({ code: 'Expired' });
});

it('issues guest QR and six digit number for one recipient and keeps member identity separate', async () => {
  const { create, guestAccess, records } = setup();
  const first = create();
  const guest = await first.service.startGuest();
  expect(guest.principal.role).toBe('guest');
  const identity = await first.identification.getOwnIdentity(guest.credential);
  expect(identity.number).toBe('000000');
  const group = await first.auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const qr = await first.identification.resolveQr(group.credential, identity.qrPayload);
  const number = await first.identification.resolveNumber(group.credential, identity.number);
  expect(qr).toEqual(number);
  expect(qr?.kind).toBe('guest');
  await first.auth.signOut(guest.credential);
  const restarted = create();
  const resumed = await restarted.service.resumeGuest();
  expect(resumed?.principal.id).toBe(guest.principal.id);
  expect(await restarted.identification.getOwnRecipientRef(resumed!.credential)).toBe(qr?.recipientRef);
  const memberChallenge = await restarted.service.requestRegistration(input);
  const code = await restarted.inbox.readLatestCode(memberChallenge.requestId);
  const member = await restarted.service.verifyCode(memberChallenge.requestId, code!);
  expect(member.principal.id).not.toBe(guest.principal.id);
  expect(await restarted.identification.getOwnRecipientRef(member.credential)).not.toBe(qr?.recipientRef);
  expect([...records.values()].join('')).not.toContain(input.password);
  await guestAccess.remove();
  expect(await restarted.service.resumeGuest()).toBeNull();
});

it('does not report guest start as successful when the device capability cannot be saved', async () => {
  const { create, guestAccess } = setup();
  guestAccess.write = async () => { throw new Error('secure store unavailable'); };
  await expect(create().service.startGuest()).rejects.toThrow('secure store unavailable');
  expect(await create().service.resumeGuest()).toBeNull();
});
