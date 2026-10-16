import { AppError } from '@/core/errors';

export type StorageEnvironment = 'development' | 'staging' | 'production';
export type MockEnvironment = Exclude<StorageEnvironment, 'production'>;

export interface StorageNamespace {
  readonly environment: StorageEnvironment;
  readonly source: 'mock' | 'api';
  readonly owner: {
    readonly kind: 'group' | 'fan' | 'guest' | 'mock-server';
    readonly id: string;
  };
}

function encodeOwnerId(id: string): string {
  if (typeof id !== 'string' || !id.trim() || id === '.' || id === '..' ||
      /[\\/\u0000-\u001f\u007f]/.test(id)) {
    throw new AppError('Validation', '保存先の利用者IDが不正です。');
  }
  // Encode every UTF-16 code unit: safe in both URI paths and SecureStore keys,
  // without treating dots, percent escapes or a Unicode ID as path syntax.
  return `id-${id.split('').map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
}

export function buildNamespacePrefix(namespace: StorageNamespace): string {
  if (!namespace || !['development', 'staging', 'production'].includes(namespace.environment) ||
      !['mock', 'api'].includes(namespace.source) || !namespace.owner ||
      !['group', 'fan', 'guest', 'mock-server'].includes(namespace.owner.kind)) {
    throw new AppError('Validation', '保存先の設定が不正です。');
  }
  if (namespace.environment === 'production' && namespace.source === 'mock') {
    throw new AppError('Configuration', '本番環境ではモック保存を利用できません。');
  }
  if (namespace.owner.kind === 'mock-server' && namespace.source !== 'mock') {
    throw new AppError('Validation', '仮サーバーはモック保存領域のみ利用できます。');
  }
  return `digital-cheki/${namespace.environment}/${namespace.source}/${namespace.owner.kind}/${encodeOwnerId(namespace.owner.id)}/`;
}

export function buildMockPrefix(environment: MockEnvironment): string {
  if (environment !== 'development' && environment !== 'staging') {
    throw new AppError('Validation', '初期化できるモック環境ではありません。');
  }
  return `digital-cheki/${environment}/mock/`;
}

export function validateFileName(name: string): void {
  // A relative file name, never a URI or a path; leading dots are reserved for staging.
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new AppError('Validation', '保存するファイル名が不正です。');
  }
}
