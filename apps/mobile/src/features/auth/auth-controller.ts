import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { AuthService, AuthSession, SignInInput } from '@/services/contracts/auth';
import type { ActiveCredentialStore } from '@/storage/active-credential-store';

import { validateSignIn } from './validation';

export interface AuthSnapshot { session: AuthSession | null; busy: boolean; error: ErrorCode | null }

export class AuthController {
  private snapshot: AuthSnapshot = { session: null, busy: false, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;

  constructor(private readonly service: AuthService, private readonly credentials: ActiveCredentialStore) {}

  getSnapshot = (): AuthSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: AuthSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  /** Called by composition before any route is rendered. */
  async restore(): Promise<void> {
    const credential = await this.credentials.read();
    if (!credential) return;
    try {
      const session = await this.service.restore(credential);
      this.publish({ session, busy: false, error: null });
    } catch (cause) {
      const error = toAppError(cause);
      if (['Unauthenticated', 'Expired', 'Forbidden'].includes(error.code)) {
        await this.credentials.remove();
        this.publish({ session: null, busy: false, error: error.code });
        return;
      }
      throw error;
    }
  }

  async signIn(input: SignInInput): Promise<void> {
    if (this.snapshot.busy) throw new AppError('Conflict', '処理中です。');
    if (this.snapshot.session) throw new AppError('Conflict', 'アカウントを切り替える前にログアウトしてください。');
    const valid = validateSignIn(input);
    const request = ++this.generation;
    this.publish({ session: null, busy: true, error: null });
    let issued: AuthSession | null = null;
    try {
      issued = await this.service.signIn(valid);
      if (request !== this.generation) {
        await this.service.signOut(issued.credential);
        throw new AppError('Cancelled', 'ログインが取り消されました。');
      }
      await this.credentials.write(issued.credential);
      if (request !== this.generation) {
        await this.credentials.remove();
        await this.service.signOut(issued.credential);
        throw new AppError('Cancelled', 'ログインが取り消されました。');
      }
      this.publish({ session: issued, busy: false, error: null });
    } catch (cause) {
      if (issued && toAppError(cause).code !== 'Cancelled') await this.service.signOut(issued.credential);
      if (request === this.generation) this.publish({ session: null, busy: false, error: toAppError(cause).code });
      throw cause;
    }
  }

  async acceptSession(issued: AuthSession): Promise<void> {
    if (this.snapshot.busy || this.snapshot.session) {
      await this.service.signOut(issued.credential);
      throw new AppError('Conflict', 'アカウントを切り替える前にログアウトしてください。');
    }
    const request = ++this.generation;
    this.publish({ session: null, busy: true, error: null });
    try {
      await this.credentials.write(issued.credential);
      if (request !== this.generation) {
        await this.credentials.remove();
        await this.service.signOut(issued.credential);
        throw new AppError('Cancelled', '操作が取り消されました。');
      }
      this.publish({ session: issued, busy: false, error: null });
    } catch (cause) {
      if (toAppError(cause).code !== 'Cancelled') await this.service.signOut(issued.credential);
      if (request === this.generation) this.publish({ session: null, busy: false, error: toAppError(cause).code });
      throw cause;
    }
  }

  async signOut(): Promise<void> {
    ++this.generation;
    const session = this.snapshot.session;
    this.publish({ session: null, busy: false, error: null });
    let failure: unknown;
    try { await this.credentials.remove(); } catch (cause) { failure = cause; }
    // Revoke independently: a failed local deletion must not leave a usable session.
    try { if (session) await this.service.signOut(session.credential); }
    catch (cause) { failure ??= cause; }
    if (failure) {
      this.publish({ session: null, busy: false, error: toAppError(failure).code });
      throw failure;
    }
  }

  async deleteAccount(): Promise<void> {
    const session = this.snapshot.session;
    if (!session || session.principal.role !== 'fan' || !this.service.deleteAccount) {
      throw new AppError('Forbidden', 'ファン会員のみ退会できます。');
    }
    await this.service.deleteAccount(session.credential);
    await this.signOut();
  }
}
