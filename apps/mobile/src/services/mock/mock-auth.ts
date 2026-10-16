import { AppError, toAppError } from '@/core/errors';
import type { Clock, IdGenerator } from '@/core/values';
import type { AuthService, AuthSession, Principal, SignInInput } from '@/services/contracts/auth';
import type { KeyValueStore } from '@/storage/key-value-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { validateNewPassword } from '@/features/auth/validation';
import type { MockPasswordInbox, PasswordService, ResetChallenge } from '@/services/contracts/password';

import { createPersistentMockState } from './persistent-state';
import { demoGroupNames, renameSeedGroup } from './display-names';

interface Account extends Principal { email: string; status: 'active' | 'stopped' | 'deleted'; passwordSalt?: string; passwordDigest?: string }
interface SessionRecord { principalId: string; issuedAt: string; expiresAt: string; revoked: boolean }
interface ResetRecord { accountId: string; reference: string; expiresAt: string; used: boolean }
interface AuthData { accounts: Account[]; sessions: Record<string, SessionRecord>; guestAccess?: Record<string, string>;
  resets?: Record<string, ResetRecord> }
export interface MockAuthAdministration {
  getAccountDisplayName(accountId: string): Promise<string | null>;
  emailStatus(email: string): Promise<'available' | 'existing' | 'deleted'>;
  registerFan(input: { id: string; email: string; displayName: string; passwordSalt: string; passwordDigest: string }): Promise<AuthSession>;
  createGuest(id: string, accessKey: string): Promise<AuthSession>;
  resumeGuest(accessKey: string): Promise<AuthSession>;
}

const DEMO_PASSWORD = 'DemoPass123';
// Mock-only validity window. It is not a decision about production JWT lifetime.
const MOCK_SESSION_MS = 24 * 60 * 60 * 1000;
// Mock-only reset window; no production mail or link policy is implied.
const MOCK_RESET_MS = 10 * 60 * 1000;

function seed(): AuthData {
  return { accounts: [
    { id: 'group-a', role: 'group', displayName: demoGroupNames['group-a'], email: 'group@example.test', status: 'active' },
    { id: 'group-b', role: 'group', displayName: demoGroupNames['group-b'], email: 'group-b@example.test', status: 'active' },
    { id: 'group-stopped', role: 'group', displayName: '停止済みグループ', email: 'stopped-group@example.test', status: 'stopped' },
    { id: 'fan-a', role: 'fan', displayName: 'テストファンA', email: 'fan@example.test', status: 'active' },
    { id: 'fan-b', role: 'fan', displayName: 'テストファンB', email: 'fan-b@example.test', status: 'active' },
    { id: 'fan-deleted', role: 'fan', displayName: '削除済みファン', email: 'deleted-fan@example.test', status: 'deleted' },
  ], sessions: {} };
}

function validResets(value: unknown): value is Record<string, ResetRecord> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.values(value).every((record: unknown) => typeof record === 'object' && record !== null &&
      'accountId' in record && typeof record.accountId === 'string' &&
      'reference' in record && typeof record.reference === 'string' &&
      'expiresAt' in record && typeof record.expiresAt === 'string' &&
      'used' in record && typeof record.used === 'boolean');
}

function decode(value: unknown): AuthData {
  if (typeof value !== 'object' || value === null || !('accounts' in value) || !Array.isArray(value.accounts) ||
      !value.accounts.every((a: unknown) => typeof a === 'object' && a !== null &&
        'id' in a && typeof a.id === 'string' && 'email' in a && typeof a.email === 'string' &&
        'role' in a && (a.role === 'group' || a.role === 'fan' || a.role === 'guest') &&
        'status' in a && ['active', 'stopped', 'deleted'].includes(String(a.status)) &&
        'displayName' in a && typeof a.displayName === 'string' &&
        (!('passwordSalt' in a) || typeof a.passwordSalt === 'string') &&
        (!('passwordDigest' in a) || typeof a.passwordDigest === 'string')) ||
      !('sessions' in value) || typeof value.sessions !== 'object' || value.sessions === null || Array.isArray(value.sessions) ||
      ('resets' in value && !validResets(value.resets))) {
    throw new AppError('Storage', 'モック認証データを読み取れません。');
  }
  return value as AuthData;
}

export function createMockAuthService(
  storage: KeyValueStore, key: string, clock: Clock, ids: IdGenerator,
  environment: 'development' | 'staging' = 'development',
): AuthService & MockAuthAdministration & PasswordService & MockPasswordInbox {
  const state = createPersistentMockState(storage, {
    scope: [environment, 'mock-server', 'auth'], key, schemaVersion: 1, seedVersion: 2, seed, decode,
    migrateSeed: (current) => ({ ...current, accounts: current.accounts.map((account) => ({ ...account,
      displayName: account.role === 'group' ? renameSeedGroup(account.id, account.displayName) : account.displayName })) }),
  });
  function principal(account: Account): Principal {
    return { id: account.id, role: account.role, displayName: account.displayName };
  }
  async function issue(account: Account): Promise<AuthSession> {
    const credential = ids.next();
    const issuedAt = clock.now();
    const expiresAt = new Date(issuedAt.getTime() + MOCK_SESSION_MS).toISOString();
    await state.update((current) => ({ ...current, sessions: {
      ...current.sessions, [credential]: { principalId: account.id, issuedAt: issuedAt.toISOString(), expiresAt, revoked: false },
    } }));
    return { principal: principal(account), credential, expiresAt };
  }
  async function matches(account: Account, password: string): Promise<boolean> {
    if (account.passwordSalt !== undefined || account.passwordDigest !== undefined) {
      if (!account.passwordSalt || !account.passwordDigest || !/^[a-f0-9]{64}$/.test(account.passwordDigest)) {
        throw new AppError('Storage', '登録済み認証情報を確認できません。');
      }
      return await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${account.passwordSalt}:${password}`) === account.passwordDigest;
    }
    return password === DEMO_PASSWORD;
  }
  async function digestNew(password: string): Promise<{ passwordSalt: string; passwordDigest: string }> {
    validateNewPassword(password);
    const passwordSalt = ids.next();
    const passwordDigest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${passwordSalt}:${password}`);
    if (!/^[a-f0-9]{64}$/.test(passwordDigest)) throw new AppError('Storage', 'モック認証情報を作成できません。');
    return { passwordSalt, passwordDigest };
  }
  function resetChallenge(requestId: string, account: Account, record: ResetRecord): ResetChallenge {
    return { requestId, email: account.email, expiresAt: record.expiresAt };
  }
  return {
    async getAccountDisplayName(accountId) {
      return (await state.load()).accounts.find((account) => account.id === accountId)?.displayName ?? null;
    },
    async signIn(input: SignInInput): Promise<AuthSession> {
      const data = await state.load();
      const account = data.accounts.find((item) => item.email === input.email && item.role !== 'guest');
      const valid = account ? await matches(account, input.password) : false;
      if (!account || !valid) throw new AppError('Unauthenticated', 'メールアドレスまたはパスワードが違います。');
      if (account.status !== 'active') throw new AppError('Forbidden', account.status === 'stopped' ? '停止済みのアカウントです。' : '削除済みのアカウントです。');
      return issue(account);
    },
    async restore(credential: string): Promise<AuthSession> {
      const data = await state.load();
      const session = data.sessions[credential];
      if (!session || session.revoked) throw new AppError('Unauthenticated', 'ログイン状態が無効です。');
      if (clock.now().getTime() >= Date.parse(session.expiresAt)) throw new AppError('Expired', 'ログインの有効期限が切れました。');
      const account = data.accounts.find((item) => item.id === session.principalId);
      if (!account || account.status !== 'active') throw new AppError('Forbidden', 'このアカウントは利用できません。');
      return { principal: principal(account), credential, expiresAt: session.expiresAt };
    },
    async signOut(credential: string): Promise<void> {
      await state.update((current) => {
        const session = current.sessions[credential];
        if (!session) return current;
        return { ...current, sessions: { ...current.sessions, [credential]: { ...session, revoked: true } } };
      });
    },
    async deleteAccount(credential: string): Promise<void> {
      const session = await this.restore(credential);
      if (session.principal.role !== 'fan') throw new AppError('Forbidden', 'ファン会員のみ退会できます。');
      await state.update((current) => ({ ...current,
        accounts: current.accounts.map((account) => account.id === session.principal.id
          ? { ...account, status: 'deleted' as const } : account),
        sessions: Object.fromEntries(Object.entries(current.sessions).map(([id, record]) =>
          [id, record.principalId === session.principal.id ? { ...record, revoked: true } : record])),
        resets: Object.fromEntries(Object.entries(current.resets ?? {}).map(([id, record]) =>
          [id, record.accountId === session.principal.id ? { ...record, used: true } : record])),
      }));
    },
    async emailStatus(email) {
      const match = (await state.load()).accounts.find((account) => account.email === email && account.role !== 'guest');
      return !match ? 'available' : match.status === 'deleted' ? 'deleted' : 'existing';
    },
    async registerFan(input) {
      const account: Account = { id: input.id, role: 'fan', email: input.email, displayName: input.displayName,
        status: 'active', passwordSalt: input.passwordSalt, passwordDigest: input.passwordDigest };
      await state.update((current) => {
        const existing = current.accounts.find((item) => item.email === input.email || item.id === input.id);
        if (existing) {
          if (existing.id === input.id && existing.email === input.email && existing.role === 'fan') return current;
          throw new AppError('Conflict', 'このメールアドレスは登録できません。');
        }
        return { ...current, accounts: [...current.accounts, account] };
      });
      return issue(account);
    },
    async createGuest(id, accessKey) {
      const account: Account = { id, role: 'guest', email: '', displayName: 'ゲスト', status: 'active' };
      await state.update((current) => {
        if (current.accounts.some((item) => item.id === id) || current.guestAccess?.[accessKey]) {
          throw new AppError('Conflict', 'ゲストIDが重複しました。');
        }
        return { ...current, accounts: [...current.accounts, account], guestAccess: { ...current.guestAccess, [accessKey]: id } };
      });
      return issue(account);
    },
    async resumeGuest(accessKey) {
      const data = await state.load();
      const id = data.guestAccess?.[accessKey];
      const account = data.accounts.find((item) => item.id === id && item.role === 'guest' && item.status === 'active');
      if (!account) throw new AppError('Unauthenticated', 'ゲスト情報を復元できません。');
      return issue(account);
    },
    async changePassword(credential, currentPassword, newPassword) {
      const session = await this.restore(credential);
      if (session.principal.role === 'guest') throw new AppError('Forbidden', 'ゲストにはパスワードがありません。');
      const account = (await state.load()).accounts.find((item) => item.id === session.principal.id);
      if (!account || account.status !== 'active') throw new AppError('Forbidden', 'このアカウントは利用できません。');
      if (!currentPassword || !await matches(account, currentPassword)) throw new AppError('Unauthenticated', '現在のパスワードが違います。');
      const next = await digestNew(newPassword);
      try { await state.update((current) => ({ ...current, accounts: current.accounts.map((item) => {
        if (item.id !== account.id) return item;
        if (item.status !== 'active' || item.passwordSalt !== account.passwordSalt || item.passwordDigest !== account.passwordDigest) {
          throw new AppError('Conflict', '認証情報が変更されています。');
        }
        return { ...item, ...next };
      }) })); }
      catch (cause) { throw toAppError(cause, 'Storage'); }
    },
    async requestReset(email) {
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new AppError('Validation', 'メールアドレスの形式を確認してください。');
      const account = (await state.load()).accounts.find((item) => item.email === normalized && item.role !== 'guest');
      if (!account) throw new AppError('NotFound', '登録済みアカウントが見つかりません。');
      if (account.status !== 'active') throw new AppError('Forbidden', 'このアカウントは再設定できません。');
      const requestId = ids.next();
      const record: ResetRecord = { accountId: account.id, reference: ids.next(),
        expiresAt: new Date(clock.now().getTime() + MOCK_RESET_MS).toISOString(), used: false };
      try { await state.update((current) => {
        const target = current.accounts.find((item) => item.id === account.id);
        if (!target || target.status !== 'active') throw new AppError('Forbidden', 'このアカウントは再設定できません。');
        const resets = Object.fromEntries(Object.entries(current.resets ?? {}).map(([key, value]) =>
          [key, value.accountId === account.id ? { ...value, used: true } : value]));
        return { ...current, resets: { ...resets, [requestId]: record } };
      }); }
      catch (cause) { throw toAppError(cause, 'Storage'); }
      return resetChallenge(requestId, account, record);
    },
    async completeReset(requestId, reference, newPassword) {
      if (!requestId || !reference) throw new AppError('Validation', '再設定コードを入力してください。');
      const next = await digestNew(newPassword);
      try { await state.update((current) => {
        const reset = current.resets?.[requestId];
        if (!reset || reset.reference !== reference) throw new AppError('Unauthenticated', '再設定コードが正しくありません。');
        if (reset.used) throw new AppError('Conflict', 'この再設定コードは使用済みです。');
        if (clock.now().getTime() >= Date.parse(reset.expiresAt)) throw new AppError('Expired', '再設定コードの期限が切れました。');
        const account = current.accounts.find((item) => item.id === reset.accountId);
        if (!account || account.status !== 'active' || account.role === 'guest') throw new AppError('Forbidden', 'このアカウントは再設定できません。');
        return { ...current,
          accounts: current.accounts.map((item) => item.id === account.id ? { ...item, ...next } : item),
          resets: { ...current.resets, [requestId]: { ...reset, used: true } } };
      }); }
      catch (cause) { throw toAppError(cause, 'Storage'); }
    },
    async readReference(requestId) {
      const reset = (await state.load()).resets?.[requestId];
      return reset && !reset.used ? reset.reference : null;
    },
  };
}
