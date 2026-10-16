import { AppError } from './errors';

// IDには役割・連番・ファイルの場所などの業務的意味を持たせない。
export type EntityId = string;
export type Instant = string;
export interface IdGenerator { next(): EntityId }
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };

export function parseId(value: unknown): EntityId {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new AppError('Validation', 'IDが不正です。');
  }
  return value;
}

export function parseInstant(value: unknown): Instant {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw new AppError('Validation', '日時はUTCのISO形式で指定してください。');
  }
  return value;
}

export function currentInstant(clock: Clock): Instant {
  const date = clock.now();
  if (!Number.isFinite(date.getTime())) throw new AppError('Validation', '時計の値が不正です。');
  return date.toISOString();
}
