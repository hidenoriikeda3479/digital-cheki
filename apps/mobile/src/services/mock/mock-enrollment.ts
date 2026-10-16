import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { AppError } from '@/core/errors';
import type { Clock, IdGenerator } from '@/core/values';
import type { EnrollmentService, MockEnrollmentInbox, RegistrationInput, RegistrationChallenge } from '@/services/contracts/enrollment';
import type { KeyValueStore } from '@/storage/key-value-store';
import type { GuestAccessStore } from '@/storage/guest-access-store';
import { buildNamespacePrefix, type MockEnvironment } from '@/storage/namespace';
import type { MockAuthAdministration } from './mock-auth';
import type { MockIdentificationAdministration } from './mock-identification';
import { validateNewPassword } from '@/features/auth/validation';
import { createPersistentMockState } from './persistent-state';

interface Pending { requestId: string; fanId: string; email: string; displayName: string;
  passwordSalt: string; passwordDigest: string; code: string; expiresAt: string; verified: boolean }
interface EnrollmentData { pending: Pending[] }
const CODE_MS = 10 * 60 * 1000;
export function validateRegistration(input: RegistrationInput): RegistrationInput {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!email || !displayName || !input.password) throw new AppError('Validation', 'メールアドレス・ファン名・パスワードは必須です。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Validation', 'メールアドレスの形式を確認してください。');
  validateNewPassword(input.password);
  return { email, displayName, password: input.password };
}
function decode(value: unknown): EnrollmentData {
  if (!value || typeof value !== 'object' || !('pending' in value) || !Array.isArray(value.pending) ||
    !value.pending.every((p: unknown) => p && typeof p === 'object' &&
      ['requestId', 'fanId', 'email', 'displayName', 'passwordSalt', 'passwordDigest', 'code', 'expiresAt'].every((key) => key in p && typeof p[key as keyof typeof p] === 'string') &&
      'verified' in p && typeof p.verified === 'boolean')) throw new AppError('Storage', '仮登録情報を読み取れません。');
  return value as EnrollmentData;
}
function numericCode(id: string): string {
  let value = 0;
  for (const char of id) value = (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0;
  return String(value % 1_000_000).padStart(6, '0');
}
export function createMockEnrollment(deps: { storage: KeyValueStore; environment: MockEnvironment; clock: Clock; ids: IdGenerator;
  auth: MockAuthAdministration; identification: MockIdentificationAdministration; guestAccess: GuestAccessStore }):
  { service: EnrollmentService; inbox: MockEnrollmentInbox } {
  const server = { environment: deps.environment, source: 'mock' as const, owner: { kind: 'mock-server' as const, id: 'server' } };
  const state = createPersistentMockState(deps.storage, {
    scope: [deps.environment, 'mock-server', 'enrollment'], key: `${buildNamespacePrefix(server)}enrollment`,
    schemaVersion: 1, seedVersion: 1, seed: (): EnrollmentData => ({ pending: [] }), decode,
  });
  function nextCode(previous?: string) {
    for (let i = 0; i < 20; i++) { const code = numericCode(deps.ids.next()); if (code !== previous) return code; }
    throw new AppError('Conflict', '新しい認証コードを作れません。');
  }
  function challenge(p: Pending): RegistrationChallenge { return { requestId: p.requestId, email: p.email, expiresAt: p.expiresAt }; }
  const service: EnrollmentService = {
    async requestRegistration(input) {
      const valid = validateRegistration(input);
      if (await deps.auth.emailStatus(valid.email) !== 'available') throw new AppError('Conflict', '登録済みまたは削除済みのメールアドレスです。再利用は確認待ちです。');
      const passwordSalt = deps.ids.next();
      const passwordDigest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${passwordSalt}:${valid.password}`);
      if (!/^[a-f0-9]{64}$/.test(passwordDigest)) throw new AppError('Storage', 'モック認証情報を作成できません。');
      const record: Pending = { requestId: deps.ids.next(), fanId: deps.ids.next(), email: valid.email,
        displayName: valid.displayName, passwordSalt, passwordDigest, code: nextCode(),
        expiresAt: new Date(deps.clock.now().getTime() + CODE_MS).toISOString(), verified: false };
      await state.update((current) => ({ pending: [...current.pending.filter((p) => p.email !== valid.email || p.verified), record] }));
      return challenge(record);
    },
    async resendCode(requestId) {
      let changed: Pending | undefined;
      await state.update((current) => ({ pending: current.pending.map((p) => {
        if (p.requestId !== requestId || p.verified) return p;
        changed = { ...p, code: nextCode(p.code), expiresAt: new Date(deps.clock.now().getTime() + CODE_MS).toISOString() };
        return changed;
      }) }));
      if (!changed) throw new AppError('NotFound', '有効な仮登録がありません。');
      return challenge(changed);
    },
    async verifyCode(requestId, code) {
      if (!/^[0-9]{6}$/.test(code)) throw new AppError('Validation', '認証コードは6桁で入力してください。');
      const p = (await state.load()).pending.find((item) => item.requestId === requestId && !item.verified);
      if (!p) throw new AppError('NotFound', '有効な仮登録がありません。');
      if (deps.clock.now().getTime() >= Date.parse(p.expiresAt)) throw new AppError('Expired', '認証コードの期限が切れました。');
      if (p.code !== code) throw new AppError('Unauthenticated', '認証コードが違います。');
      // Idempotent recipient creation allows retry after a partial write across the two mock catalogs.
      await deps.identification.addRecipient(p.fanId, 'member');
      const session = await deps.auth.registerFan({ id: p.fanId, email: p.email, displayName: p.displayName,
        passwordSalt: p.passwordSalt, passwordDigest: p.passwordDigest });
      await state.update((current) => ({ pending: current.pending.map((item) => item.requestId === requestId ? { ...item, verified: true, code: '' } : item) }));
      return session;
    },
    async startGuest() {
      const id = deps.ids.next();
      const accessKey = deps.ids.next();
      await deps.identification.addRecipient(id, 'guest');
      const session = await deps.auth.createGuest(id, accessKey);
      await deps.guestAccess.write(accessKey);
      return session;
    },
    async resumeGuest() {
      const accessKey = await deps.guestAccess.read();
      return accessKey ? deps.auth.resumeGuest(accessKey) : null;
    },
    async hasResumableGuest() { return (await deps.guestAccess.read()) !== null; },
  };
  return { service, inbox: { async readLatestCode(requestId) {
    const p = (await state.load()).pending.find((item) => item.requestId === requestId && !item.verified);
    return p?.code ?? null;
  } } };
}
