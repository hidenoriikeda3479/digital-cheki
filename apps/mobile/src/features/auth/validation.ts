import { AppError } from '@/core/errors';
import type { SignInInput } from '@/services/contracts/auth';

export function validateSignIn(input: SignInInput): SignInInput {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) throw new AppError('Validation', 'メールアドレスとパスワードを入力してください。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Validation', 'メールアドレスの形式を確認してください。');
  // Login deliberately does not apply the registration password rule.
  return { email, password: input.password };
}

export function validateNewPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AppError('Validation', 'パスワードは8文字以上で英大文字・小文字・数字を含めてください。');
  }
}
