import * as SecureStore from 'expo-secure-store';

import { AppError } from '@/core/errors';
import type { RuntimeConfig } from '@/config/runtime';

/** One active credential per app environment/source. No password or principal data is stored here. */
export interface ActiveCredentialStore {
  read(): Promise<string | null>;
  write(credential: string): Promise<void>;
  remove(): Promise<void>;
}

export function createActiveCredentialStore(config: RuntimeConfig): ActiveCredentialStore {
  if (config.appEnvironment === 'production' && config.dataSource === 'mock') {
    throw new AppError('Configuration', '本番環境でモック認証情報は利用できません。');
  }
  const key = `digital-cheki.${config.appEnvironment}.${config.dataSource}.active-credential`;
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  async function operate<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (cause) { throw new AppError('Storage', '端末の認証情報を保存または読み取りできません。', { cause }); }
  }
  return {
    read: () => operate(() => SecureStore.getItemAsync(key, options)),
    write: (credential) => {
      if (!credential) throw new AppError('Validation', '認証情報が空です。');
      return operate(() => SecureStore.setItemAsync(key, credential, options));
    },
    remove: () => operate(() => SecureStore.deleteItemAsync(key, options)),
  };
}
