import type { AuthSession } from './auth';

export interface RegistrationInput { email: string; displayName: string; password: string }
export interface RegistrationChallenge { requestId: string; email: string; expiresAt: string }
/** Verification returns a session; the UI never receives a mock code from this interface. */
export interface EnrollmentService {
  requestRegistration(input: RegistrationInput): Promise<RegistrationChallenge>;
  resendCode(requestId: string): Promise<RegistrationChallenge>;
  verifyCode(requestId: string, code: string): Promise<AuthSession>;
  startGuest(): Promise<AuthSession>;
  resumeGuest(): Promise<AuthSession | null>;
  hasResumableGuest(): Promise<boolean>;
}
export interface MockEnrollmentInbox { readLatestCode(requestId: string): Promise<string | null> }
