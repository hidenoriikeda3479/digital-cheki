/// <reference types="node" />

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFileStore } from './file-store';
import { buildNamespacePrefix, type StorageNamespace } from './namespace';
import { createNativeTestDrivers, type NativeTestDrivers } from './testing/native-test-drivers';

let mockDriver: NativeTestDrivers;

// This bridge exercises real desktop file IO through the same adapter methods.
// Expo's native implementations and iPhone persistence still need device testing.
jest.mock('expo-file-system', () => {
  const { createFileSystemTestModule } = jest.requireActual<typeof import('./testing/native-test-drivers')>('./testing/native-test-drivers');
  return createFileSystemTestModule(() => mockDriver);
});

const group: StorageNamespace = {
  environment: 'development', source: 'mock', owner: { kind: 'group', id: 'A' },
};

function pathFor(namespace: StorageNamespace, name: string): string {
  return join(mockDriver.rootPath, buildNamespacePrefix(namespace), name);
}

beforeEach(() => {
  mockDriver = createNativeTestDrivers();
});

afterEach(() => {
  mockDriver.dispose();
});

describe('FileStore with actual desktop file IO', () => {
  it('saves and reloads a file with a new adapter, separating owners and virtual server', async () => {
    const namespaces: StorageNamespace[] = [
      group,
      { ...group, owner: { kind: 'group', id: 'B' } },
      { ...group, owner: { kind: 'fan', id: 'A' } },
      { ...group, owner: { kind: 'fan', id: 'B' } },
      { ...group, owner: { kind: 'mock-server', id: 'server' } },
    ];
    for (const [index, namespace] of namespaces.entries()) {
      await createFileStore().writeText(namespace, 'test.txt', `自作テスト ${index}`);
    }
    const restarted = createFileStore();
    for (const [index, namespace] of namespaces.entries()) {
      expect(await restarted.readText(namespace, 'test.txt')).toBe(`自作テスト ${index}`);
      expect(readFileSync(pathFor(namespace, 'test.txt'), 'utf8')).toBe(`自作テスト ${index}`);
    }
    expect(await restarted.readText(group, 'absent.txt')).toBeNull();
  });

  it('resets only the selected mock environment and retains api and unrelated files', async () => {
    const store = createFileStore();
    const staging: StorageNamespace = { ...group, environment: 'staging' };
    const production: StorageNamespace = { ...group, environment: 'production', source: 'api' };
    const developmentApi: StorageNamespace = { ...group, source: 'api' };
    for (const namespace of [group, staging, production, developmentApi]) {
      await store.writeText(namespace, 'test.txt', 'keep');
    }
    writeFileSync(join(mockDriver.rootPath, 'unrelated.txt'), 'keep');
    await store.resetMock('development');
    expect(await store.readText(group, 'test.txt')).toBeNull();
    for (const namespace of [staging, production, developmentApi]) {
      expect(await store.readText(namespace, 'test.txt')).toBe('keep');
    }
    expect(readFileSync(join(mockDriver.rootPath, 'unrelated.txt'), 'utf8')).toBe('keep');
    await store.resetMock('development');
  });

  it('rejects overwrite and write/move failures without damaging an existing file', async () => {
    const store = createFileStore();
    await store.writeText(group, 'existing.txt', 'original');
    await expect(store.writeText(group, 'existing.txt', 'replacement')).rejects.toMatchObject({ code: 'Conflict' });
    jest.spyOn(mockDriver.io, 'writeText').mockImplementationOnce(() => { throw new Error('simulated full disk'); });
    await expect(store.writeText(group, 'new.txt', 'new')).rejects.toMatchObject({ code: 'Storage' });
    expect(await store.readText(group, 'new.txt')).toBeNull();
    jest.spyOn(mockDriver.io, 'move').mockImplementationOnce(() => { throw new Error('simulated rename failure'); });
    await expect(store.writeText(group, 'new.txt', 'new')).rejects.toMatchObject({ code: 'Storage' });
    expect(await store.readText(group, 'new.txt')).toBeNull();
    expect(await store.readText(group, 'existing.txt')).toBe('original');
    // A manual retry clears only its own private pending file and completes.
    await store.writeText(group, 'new.txt', 'new');
    expect(await store.readText(group, 'new.txt')).toBe('new');
    expect(existsSync(pathFor(group, '.pending-new.txt'))).toBe(false);
    await store.remove(group, 'new.txt');
    expect(await store.readText(group, 'new.txt')).toBeNull();
    expect(await store.readText(group, 'existing.txt')).toBe('original');
  });

  it('rejects directory traversal before creating any file', async () => {
    const write = jest.spyOn(mockDriver.io, 'writeText');
    await expect(createFileStore().writeText(group, '../../escaped.txt', 'x'))
      .rejects.toMatchObject({ code: 'Validation' });
    expect(write).not.toHaveBeenCalled();
  });

  it('removes only the specified final file and its pending file during recovery', async () => {
    const store = createFileStore();
    await store.writeText(group, 'keep.txt', 'keep');
    writeFileSync(pathFor(group, '.pending-recover.txt'), 'interrupted');
    writeFileSync(pathFor(group, '.pending-other.txt'), 'other operation');
    await store.remove(group, 'recover.txt');
    expect(existsSync(pathFor(group, '.pending-recover.txt'))).toBe(false);
    expect(existsSync(pathFor(group, '.pending-other.txt'))).toBe(true);
    expect(await store.readText(group, 'keep.txt')).toBe('keep');
  });
});
