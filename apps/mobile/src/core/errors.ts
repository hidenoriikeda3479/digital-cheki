export type ErrorCode =
  | 'Validation' | 'Configuration' | 'NotImplemented' | 'Storage'
  | 'Conflict' | 'NotFound' | 'Cancelled' | 'UnknownOutcome'
  | 'Unauthenticated' | 'Forbidden' | 'Expired' | 'Transport';

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
  }
}

export function toAppError(error: unknown, fallbackCode: ErrorCode = 'Storage'): AppError {
  return error instanceof AppError
    ? error
    : new AppError(fallbackCode, '処理を完了できませんでした。', { cause: error });
}
