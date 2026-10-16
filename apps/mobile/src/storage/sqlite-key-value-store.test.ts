/// <reference types="node" />

import { buildMockPrefix, buildNamespacePrefix } from './namespace';
import { openSqliteKeyValueStore, SCHEMA_VERSION } from './sqlite-key-value-store';
import { createNativeTestDrivers, type NativeTestDrivers } from './testing/native-test-drivers';

let mockDriver: NativeTestDrivers;
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => mockDriver.sqlite.openDatabaseAsync(name),
}));

beforeEach(() => {
  mockDriver = createNativeTestDrivers();
});

afterEach(() => { mockDriver.dispose(); });

describe('SQLite key-value adapter using actual SQLite SQL', () => {
  it('migrates the pre-existing unversioned table without deleting records', async () => {
    const { database } = mockDriver;
    const mockExec = jest.spyOn(mockDriver.io, 'execute');
    database.exec("CREATE TABLE app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); INSERT INTO app_state VALUES ('old-record', 'keep');");
    const first = await openSqliteKeyValueStore();
    expect(await first.get('old-record')).toBe('keep');
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION);
    await first.set('new-record', 'value');
    mockDriver.reopenDatabase();
    expect(mockDriver.database).not.toBe(database);
    const reopened = await openSqliteKeyValueStore();
    expect(await reopened.get('old-record')).toBe('keep');
    expect(await reopened.get('new-record')).toBe('value');
    expect(mockExec.mock.calls.filter(([sql]) => sql.includes('CREATE TABLE'))).toHaveLength(1);
    expect(mockDriver.events.openedNames).toEqual(['digital-cheki-state.db', 'digital-cheki-state.db']);
  });

  it('rejects future schemas and closes the adapter without changing data', async () => {
    const { database } = mockDriver;
    const mockExec = jest.spyOn(mockDriver.io, 'execute');
    database.exec('PRAGMA user_version = 20');
    await expect(openSqliteKeyValueStore()).rejects.toMatchObject({ code: 'Storage' });
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(20);
    expect(mockDriver.events.closedConnections).toBe(1);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('rolls back a failed migration and can retry', async () => {
    const { database } = mockDriver;
    const mockExec = jest.spyOn(mockDriver.io, 'execute');
    mockExec.mockImplementationOnce((sql) => { database.exec(sql); });
    mockExec.mockImplementationOnce(() => { throw new Error('simulated write failure'); });
    await expect(openSqliteKeyValueStore()).rejects.toMatchObject({ code: 'Storage' });
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name='app_state'").get()).toBeUndefined();
    const store = await openSqliteKeyValueStore();
    await store.set('after-retry', 'saved');
    expect(await store.get('after-retry')).toBe('saved');
  });

  it('deletes only the exact mock prefix and treats SQL wildcard characters literally', async () => {
    const store = await openSqliteKeyValueStore();
    const mock = buildNamespacePrefix({ environment: 'development', source: 'mock', owner: { kind: 'group', id: 'A' } });
    const production = buildNamespacePrefix({ environment: 'production', source: 'api', owner: { kind: 'group', id: 'A' } });
    const staging = buildNamespacePrefix({ environment: 'staging', source: 'mock', owner: { kind: 'group', id: 'A' } });
    for (const key of [mock, production, staging, 'unrelated', 'literal_%/a', 'literal_ab/a']) {
      await store.set(key, 'keep');
    }
    await store.removePrefix(buildMockPrefix('development'));
    expect(await store.get(mock)).toBeNull();
    for (const key of [production, staging, 'unrelated']) expect(await store.get(key)).toBe('keep');
    await store.removePrefix('literal_%/');
    expect(await store.get('literal_%/a')).toBeNull();
    expect(await store.get('literal_ab/a')).toBe('keep');
    await expect(store.removePrefix('')).rejects.toMatchObject({ code: 'Validation' });
    await store.remove(production);
    expect(await store.get(production)).toBeNull();
  });

  it('uses bound SQL parameters for keys and values', async () => {
    const store = await openSqliteKeyValueStore();
    const key = "'); DROP TABLE app_state; --";
    await store.set(key, 'first');
    await store.set(key, 'updated');
    expect(await store.get(key)).toBe('updated');
    expect(await store.get('missing')).toBeNull();
  });
});
