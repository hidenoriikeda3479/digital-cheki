export interface ResetChallenge { requestId: string; email: string; expiresAt: string }

/** Passwords and reset references are supplied only for this call, never kept in UI storage. */
export interface PasswordService {
  changePassword(credential: string, currentPassword: string, newPassword: string): Promise<void>;
  requestReset(email: string): Promise<ResetChallenge>;
  completeReset(requestId: string, reference: string, newPassword: string): Promise<void>;
}

/** Only the mock development surface can inspect the in-app replacement for mail. */
export interface MockPasswordInbox { readReference(requestId: string): Promise<string | null> }
