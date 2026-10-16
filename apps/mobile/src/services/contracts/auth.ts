import type { EntityId, Instant } from '@/core/values';

export type AuthRole = 'group' | 'fan' | 'guest';
export interface Principal { id: EntityId; role: AuthRole; displayName: string }
export interface AuthSession { principal: Principal; credential: string; expiresAt: Instant }
export interface SignInInput { email: string; password: string }

/** The credential is opaque to the UI. HTTP and mock adapters implement the same operations. */
export interface AuthService {
  signIn(input: SignInInput): Promise<AuthSession>;
  restore(credential: string): Promise<AuthSession>;
  signOut(credential: string): Promise<void>;
  deleteAccount?(credential: string): Promise<void>;
}
