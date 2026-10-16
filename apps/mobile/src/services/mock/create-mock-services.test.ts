import { AppError } from '@/core/errors';
import type { FileStore } from '@/storage/file-store';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type StorageNamespace } from '@/storage/namespace';
import type { TokenStore } from '@/storage/token-store';

import { createMockServices } from './create-mock-services';

const config = { appEnvironment: 'development', dataSource: 'mock' } as const;

function setup() {
  const records = new Map<string, string>();
  const files = new Map<string, string>();
  const tokens = new Map<string, string>();
  let activeCredential: string | null = null;
  const activeCredentials = { read: async () => activeCredential, write: async (value: string) => { activeCredential = value; }, remove: async () => { activeCredential = null; } };
  const storage: KeyValueStore = {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => { records.set(key, value); },
    remove: async (key) => { records.delete(key); },
    removePrefix: async (prefix) => {
      for (const key of records.keys()) if (key.startsWith(prefix)) records.delete(key);
    },
  };
  const fileStore: FileStore = {
    writeText: async (ns, name, contents) => { files.set(`${buildNamespacePrefix(ns)}${name}`, contents); },
    readText: async (ns, name) => files.get(`${buildNamespacePrefix(ns)}${name}`) ?? null,
    remove: async (ns, name) => { files.delete(`${buildNamespacePrefix(ns)}${name}`); },
    resetMock: async (environment) => {
      for (const key of files.keys()) if (key.startsWith(`digital-cheki/${environment}/mock/`)) files.delete(key);
    },
  };
  const tokenStore: TokenStore = {
    read: async (ns) => tokens.get(buildNamespacePrefix(ns)) ?? null,
    write: async (ns, token) => { tokens.set(buildNamespacePrefix(ns), token); },
    remove: async (ns) => { tokens.delete(buildNamespacePrefix(ns)); },
  };
  let sequence = 0;
  const deps = {
    storage, files: fileStore, tokens: tokenStore, activeCredentials,
    clock: { now: () => new Date('2026-09-25T00:00:00.000Z') },
    ids: { next: () => `test-id-${++sequence}` },
    mockPhotoTransfer: {
      inspect: async () => ({ byteSize: 4 }), copy: async () => {}, remove: async () => {},
    },
    sampleArrivalPhoto: () => ({ uri: 'file:///sample.jpg', byteSize: 4, remove: () => {} }),
  };
  return { deps, records, files, tokens };
}

describe('stage 01 save / restart / reset', () => {
  it('preserves saved ID, time, content and seed across restart while keeping five scopes separate', async () => {
    const { deps, records } = setup();
    const first = await createMockServices(config, deps);
    const saved = await first.foundationCheck.save('group-a');
    const seedKey = [...records.keys()].find((key) => key.endsWith('/fixtures'));
    expect(seedKey).toBeDefined();
    const before = new Map(records);
    const restarted = await createMockServices(config, deps);
    expect(await restarted.foundationCheck.read('group-a')).toEqual(saved);
    expect(records).toEqual(before);
    for (const target of ['group-b', 'fan-a', 'fan-b', 'mock-server']) {
      expect((await restarted.foundationCheck.read(target)).record).toBeNull();
    }
    expect(saved.seed).toEqual({ version: 3, groupCount: 2, fanCount: 2, idolCount: 8 });
    expect([...records.keys()].filter((key) => key.endsWith('fixture/arrival-v1'))).toHaveLength(1);
  });

  it('reconciles a completed file after the final DB write fails, keeping the original operation ID', async () => {
    const { deps } = setup();
    const service = await createMockServices(config, deps);
    const originalSet = deps.storage.set;
    let failOnce = true;
    deps.storage.set = async (key, value) => {
      if (failOnce && key.endsWith('/latest')) { failOnce = false; throw new Error('disk full'); }
      return originalSet(key, value);
    };
    await expect(service.foundationCheck.save('group-a')).rejects.toMatchObject({ code: 'Storage' });
    const restarted = await createMockServices(config, deps);
    const result = await restarted.foundationCheck.read('group-a');
    expect(result.record?.id).toBe('test-id-1');
    expect(result.fileContents).toContain('test-id-1');
    expect(result.record?.savedAt).toBe('2026-09-25T00:00:00.000Z');
  });

  it('keeps a previous good record when a new file cannot be saved', async () => {
    const { deps } = setup();
    const service = await createMockServices(config, deps);
    const saved = await service.foundationCheck.save('group-a');
    deps.files.writeText = async () => { throw new Error('not enough space'); };
    await expect(service.foundationCheck.save('group-a')).rejects.toMatchObject({ code: 'Storage' });
    expect(await service.foundationCheck.read('group-a')).toEqual(saved);
  });

  it('resets only the selected mock environment and requires explicit confirmation', async () => {
    const { deps, records, files } = setup();
    const protectedScope: StorageNamespace = { environment: 'production', source: 'api', owner: { kind: 'fan', id: 'fan-a' } };
    const protectedKey = `${buildNamespacePrefix(protectedScope)}keep`;
    records.set(protectedKey, 'production-record');
    files.set(protectedKey, 'production-file');
    records.set('unrelated', 'record');
    files.set('unrelated', 'file');
    const staging = await createMockServices({ ...config, appEnvironment: 'staging' }, deps);
    const stagingSaved = await staging.foundationCheck.save('group-a');
    const service = await createMockServices(config, deps);
    await service.foundationCheck.save('group-a');
    await expect(Reflect.apply(service.foundationCheck.reset, null, ['cancel'])).rejects.toBeInstanceOf(AppError);
    expect((await service.foundationCheck.read('group-a')).record).not.toBeNull();
    await service.foundationCheck.reset('RESET_MOCK_DATA');
    expect((await service.foundationCheck.read('group-a')).record).toBeNull();
    expect(await staging.foundationCheck.read('group-a')).toEqual(stagingSaved);
    expect(records.get(protectedKey)).toBe('production-record');
    expect(files.get(protectedKey)).toBe('production-file');
    expect(records.get('unrelated')).toBe('record');
    expect(files.get('unrelated')).toBe('file');
  });

  it('resumes an interrupted confirmed reset before reading data', async () => {
    const { deps } = setup();
    const service = await createMockServices(config, deps);
    await service.foundationCheck.save('fan-a');
    const reset = deps.files.resetMock;
    deps.files.resetMock = async () => { throw new Error('interrupted'); };
    await expect(service.foundationCheck.reset('RESET_MOCK_DATA')).rejects.toMatchObject({ code: 'Storage' });
    deps.files.resetMock = reset;
    const restarted = await createMockServices(config, deps);
    expect((await restarted.foundationCheck.read('fan-a')).record).toBeNull();
  });
});
