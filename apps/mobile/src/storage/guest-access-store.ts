import * as SecureStore from 'expo-secure-store';
import { AppError } from '@/core/errors';
import type { RuntimeConfig } from '@/config/runtime';

export interface GuestAccessStore { read(): Promise<string | null>; write(key: string): Promise<void>; remove(): Promise<void> }

/** Mock-only, device-bound capability. The six-digit display number is never used to resume access. */
export function createGuestAccessStore(config: RuntimeConfig): GuestAccessStore {
  if (config.dataSource !== 'mock' || config.appEnvironment === 'production') throw new AppError('Configuration', 'ゲスト用モック保存は利用できません。');
  const key = `digital-cheki.${config.appEnvironment}.mock.guest-access`;
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (cause) { throw new AppError('Storage', 'ゲスト情報を端末に保存できません。', { cause }); }
  }
  return {
    read: () => safe(() => SecureStore.getItemAsync(key, options)),
    write: (value) => safe(() => SecureStore.setItemAsync(key, value, options)),
    remove: () => safe(() => SecureStore.deleteItemAsync(key, options)),
  };
}
