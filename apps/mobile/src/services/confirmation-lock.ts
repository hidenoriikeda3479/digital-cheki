import { AppError } from '@/core/errors';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type StorageEnvironment } from '@/storage/namespace';

export function confirmationKey(environment: StorageEnvironment, source: 'mock' | 'api', groupId: string, intakeId: string) {
  return `${buildNamespacePrefix({ environment, source, owner: { kind: 'group', id: groupId } })}finished-intake/${intakeId}`;
}
export async function isIntakeConfirmed(storage: KeyValueStore, key: string): Promise<boolean> {
  const raw = await storage.get(key);
  if (!raw) return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('confirmedAt' in value) ||
      (value.confirmedAt !== null && typeof value.confirmedAt !== 'string')) throw Error('invalid confirmation');
    return !!value.confirmedAt;
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError('Storage', '送信確認状態を読み取れません。', { cause });
  }
}
export async function assertUnconfirmed(storage: KeyValueStore, key: string) {
  if (await isIntakeConfirmed(storage, key)) throw new AppError('Conflict', '送信対象は確定済みです。');
}
