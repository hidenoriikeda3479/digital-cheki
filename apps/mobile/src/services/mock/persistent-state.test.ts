import type { KeyValueStore } from '@/storage/key-value-store';

import { createPersistentMockState, type MockStateDefinition } from './persistent-state';

interface Counter { count: number }

function decodeCounter(value: unknown): Counter {
  if (typeof value !== 'object' || value === null || !('count' in value) ||
      typeof value.count !== 'number' || !Number.isInteger(value.count)) {
    throw new Error('Invalid counter state');
  }
  return { count: value.count };
}

function memoryStorage(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
    removePrefix: async (prefix) => {
      for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key);
    },
  };
}

const definition: MockStateDefinition<Counter> = {
  scope: ['development', 'group-a', 'capture'],
  schemaVersion: 1,
  seedVersion: 1,
  seed: () => ({ count: 0 }),
  decode: decodeCounter,
};

describe('persistent mock state', () => {
  it('runs an explicit additive seed migration once and preserves the previous state', async () => {
    const storage = memoryStorage();
    const old = createPersistentMockState(storage, definition);
    await old.update(() => ({ count: 7 }));
    const migrateSeed = jest.fn((current: Counter) => ({ count: current.count + 5 }));
    const next = { ...definition, seedVersion: 2, migrateSeed };
    expect(await createPersistentMockState(storage, next).load()).toEqual({ count: 12 });
    expect(await createPersistentMockState(storage, next).load()).toEqual({ count: 12 });
    expect(migrateSeed).toHaveBeenCalledTimes(1);
  });
  it.each(['broken-json', '{"schemaVersion":1,"seedVersion":0,"data":{"count":0}}'])('reports corrupt state as Storage and does not overwrite it', async (raw) => {
    const storage = memoryStorage();
    await storage.set('test-key', raw);
    const state = createPersistentMockState(storage, { ...definition, key: 'test-key' });
    await expect(state.load()).rejects.toMatchObject({ code: 'Storage' });
    expect(await storage.get('test-key')).toBe(raw);
  });
  it('seeds once and keeps changes after a new service instance starts', async () => {
    const storage = memoryStorage();
    const first = createPersistentMockState(storage, definition);
    expect(await first.load()).toEqual({ count: 0 });
    await first.update((value) => ({ count: value.count + 1 }));
    const restarted = createPersistentMockState(storage, {
      ...definition,
      seedVersion: 2,
      seed: () => ({ count: 99 }),
    });
    expect(await restarted.load()).toEqual({ count: 1 });
  });

  it('serializes simultaneous changes and separates owners', async () => {
    const storage = memoryStorage();
    const group = createPersistentMockState(storage, definition);
    await Promise.all([
      group.update((value) => ({ count: value.count + 1 })),
      group.update((value) => ({ count: value.count + 1 })),
    ]);
    expect(await group.load()).toEqual({ count: 2 });
    const fan = createPersistentMockState(storage, {
      ...definition,
      scope: ['development', 'fan-a', 'capture'],
    });
    expect(await fan.load()).toEqual({ count: 0 });
  });

  it('does not overwrite data with a different schema or invalid value', async () => {
    const storage = memoryStorage();
    const state = createPersistentMockState(storage, definition);
    await state.update(() => ({ count: 4 }));
    await expect(state.update(() => ({ count: 1.5 }))).rejects.toThrow('Invalid');
    expect(await state.load()).toEqual({ count: 4 });
    const incompatible = createPersistentMockState(storage, { ...definition, schemaVersion: 2 });
    await expect(incompatible.load()).rejects.toThrow('migration');
  });
});
