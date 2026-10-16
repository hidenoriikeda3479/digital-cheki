import * as SQLite from 'expo-sqlite';

import { AppError } from '@/core/errors';

import type { KeyValueStore } from './key-value-store';

const DATABASE_NAME = 'digital-cheki-state.db';
export const SCHEMA_VERSION = 1;

export async function openSqliteKeyValueStore(): Promise<KeyValueStore> {
  const database = await storageOperation(() => SQLite.openDatabaseAsync(DATABASE_NAME));
  try {
    await storageOperation(() => database.withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if (!row || !Number.isInteger(row.user_version) || row.user_version < 0 ||
          row.user_version > SCHEMA_VERSION) {
        throw new AppError('Storage', 'この保存データのschemaVersionには対応していません。');
      }
      if (row.user_version === 0) {
        // Also adopts the existing unversioned app_state table without changing its records.
        await transaction.execAsync(
          'CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
        );
        await transaction.execAsync('PRAGMA user_version = 1');
      }
    }));
  } catch (error) {
    try {
      await database.closeAsync();
    } catch {
      // Preserve the original migration error; an unsuccessful close is not success.
    }
    throw error;
  }
  return {
    async get(key) {
      const row = await storageOperation(() => database.getFirstAsync<{ value: string }>(
        'SELECT value FROM app_state WHERE key = ?',
        key,
      ));
      return row?.value ?? null;
    },
    async set(key, value) {
      await storageOperation(() => database.runAsync(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      ));
    },
    async remove(key) {
      await storageOperation(() => database.runAsync('DELETE FROM app_state WHERE key = ?', key));
    },
    async removePrefix(prefix) {
      if (typeof prefix !== 'string' || prefix.length === 0) {
        throw new AppError('Validation', '空の保存領域は削除できません。');
      }
      await storageOperation(() => database.runAsync(
        'DELETE FROM app_state WHERE substr(key, 1, length(?)) = ?', prefix, prefix,
      ));
    },
  };
}

async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError('Storage', '端末の記録を読み書きできませんでした。', { cause });
  }
}
