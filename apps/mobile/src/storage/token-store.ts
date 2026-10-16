import * as SecureStore from 'expo-secure-store';

import { AppError } from '@/core/errors';

import { buildNamespacePrefix, type StorageNamespace } from './namespace';

/** Small authentication tokens only; never passwords or photo/editing data. */
export interface TokenStore {
  read(namespace: StorageNamespace): Promise<string | null>;
  write(namespace: StorageNamespace, token: string): Promise<void>;
  remove(namespace: StorageNamespace): Promise<void>;
}

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function keyFor(namespace: StorageNamespace): string {
  const prefix = buildNamespacePrefix(namespace);
  if (namespace.owner.kind === 'mock-server') {
    throw new AppError('Validation', '仮サーバーに端末認証情報は保存できません。');
  }
  return `${prefix.replaceAll('/', '.')}token`;
}

async function tokenOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError('Storage', '端末の認証情報を読み書きできませんでした。', { cause });
  }
}

export function createTokenStore(): TokenStore {
  return {
    async read(namespace) {
      const key = keyFor(namespace);
      return tokenOperation(() => SecureStore.getItemAsync(key, options));
    },
    async write(namespace, token) {
      const key = keyFor(namespace);
      if (typeof token !== 'string' || token.length === 0) {
        throw new AppError('Validation', '保存する認証情報が空です。');
      }
      await tokenOperation(() => SecureStore.setItemAsync(key, token, options));
    },
    async remove(namespace) {
      const key = keyFor(namespace);
      await tokenOperation(() => SecureStore.deleteItemAsync(key, options));
    },
  };
}
