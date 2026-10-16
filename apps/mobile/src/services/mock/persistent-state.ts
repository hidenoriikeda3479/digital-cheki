import type { KeyValueStore } from '@/storage/key-value-store';
import { AppError } from '@/core/errors';

export interface MockStateDefinition<T> {
  scope: readonly [environment: 'development' | 'staging', owner: string, domain: string];
  schemaVersion: number;
  seedVersion: number;
  key?: string;
  seed: () => T;
  decode: (value: unknown) => T;
  /** Explicit additive seed migrations only; never replace saved data with the initial seed. */
  migrateSeed?: (current: T, previousVersion: number) => T;
}

interface StoredState {
  schemaVersion: number;
  seedVersion: number;
  data: unknown;
}

function isStoredState(value: unknown): value is StoredState {
  if (typeof value !== 'object' || value === null) return false;
  return 'schemaVersion' in value && typeof value.schemaVersion === 'number' &&
    Number.isInteger(value.schemaVersion) && value.schemaVersion >= 1 &&
    'seedVersion' in value && typeof value.seedVersion === 'number' &&
    Number.isInteger(value.seedVersion) && value.seedVersion >= 1 && 'data' in value;
}

export function createPersistentMockState<T>(
  storage: KeyValueStore,
  definition: MockStateDefinition<T>,
) {
  if (definition.scope.some((part) => !part.trim())) throw new Error('Mock state scope is incomplete');
  const key = definition.key ?? `mock:${definition.scope.map(encodeURIComponent).join(':')}`;
  if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1 ||
      !Number.isInteger(definition.seedVersion) || definition.seedVersion < 1) {
    throw new AppError('Validation', 'スキーマ・シードの版が不正です。');
  }
  let pending: Promise<unknown> = Promise.resolve();

  async function read(): Promise<{ data: T; seedVersion: number }> {
    const raw = await storage.get(key);
    if (raw === null) {
      const seed = definition.decode(definition.seed());
      await storage.set(key, JSON.stringify({
        schemaVersion: definition.schemaVersion,
        seedVersion: definition.seedVersion,
        data: seed,
      }));
      return { data: seed, seedVersion: definition.seedVersion };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isStoredState(parsed) || parsed.schemaVersion !== definition.schemaVersion) {
        throw new AppError('Storage', 'Mock state migration is required');
      }
      const data = definition.decode(parsed.data);
      if (parsed.seedVersion < definition.seedVersion && definition.migrateSeed) {
        const next = definition.decode(definition.migrateSeed(data, parsed.seedVersion));
        await storage.set(key, JSON.stringify({ schemaVersion: definition.schemaVersion,
          seedVersion: definition.seedVersion, data: next }));
        return { data: next, seedVersion: definition.seedVersion };
      }
      return { data, seedVersion: parsed.seedVersion };
    } catch (cause) {
      if (cause instanceof AppError && cause.code === 'Storage') throw cause;
      throw new AppError('Storage', '保存済みモックデータを読み取れません。', { cause });
    }
  }

  function serialize<R>(operation: () => Promise<R>): Promise<R> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }

  return {
    load: () => serialize(async () => (await read()).data),
    inspect: () => serialize(read),
    update: (change: (current: T) => T) => serialize(async () => {
      const current = await read();
      const next = definition.decode(change(current.data));
      await storage.set(key, JSON.stringify({
        schemaVersion: definition.schemaVersion,
        seedVersion: current.seedVersion,
        data: next,
      }));
      return next;
    }),
  };
}
