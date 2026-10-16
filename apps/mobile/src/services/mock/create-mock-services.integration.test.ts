import { systemClock } from '@/core/values';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFileStore } from '@/storage/file-store';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import type { TokenStore } from '@/storage/token-store';

import { createMockServices } from './create-mock-services';

let mockDriver: NativeTestDrivers;

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => mockDriver.sqlite.openDatabaseAsync(name),
}));
jest.mock('expo-file-system', () => {
  const { createFileSystemTestModule } = jest.requireActual<typeof import('@/storage/testing/native-test-drivers')>('@/storage/testing/native-test-drivers');
  return createFileSystemTestModule(() => mockDriver);
});

beforeEach(() => { mockDriver = createNativeTestDrivers(); });
afterEach(() => { mockDriver.dispose(); });

it('seeds one real sample arrival for fan A and keeps its read state and photo across restart', async () => {
  const tokens: TokenStore = { read: async () => null, write: async () => {}, remove: async () => {} };
  let credential: string | null = null;
  const activeCredentials = { read: async () => credential, write: async (value: string) => { credential = value; },
    remove: async () => { credential = null; } };
  const config = { appEnvironment: 'development', dataSource: 'mock' } as const;
  const deps = { storage: await openSqliteKeyValueStore(), files: createFileStore(), tokens, activeCredentials,
    clock: { now: () => new Date('2026-09-25T00:00:00.000Z') }, ids: { next: () => 'unused' } };
  const first = await createMockServices(config, deps);
  await first.auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  await first.download.refreshReceivables();
  expect(first.download.getSnapshot().intakes.map((item) => item.intakeId)).toContain('sample-arrival-v1');
  await first.download.receiveIntake('sample-arrival-v1');
  const photo = first.download.getSnapshot().intakes.find((item) => item.intakeId === 'sample-arrival-v1')?.photos[0];
  expect(photo?.status).toBe('received');
  expect(fs.statSync(fileURLToPath(photo!.localUri!)).size).toBeGreaterThan(0);
  mockDriver.reopenDatabase();
  const restarted = await createMockServices(config, { ...deps, storage: await openSqliteKeyValueStore() });
  await restarted.download.refreshReceivables();
  expect(restarted.download.getSnapshot().intakes.find((item) => item.intakeId === 'sample-arrival-v1')?.photos[0].status)
    .toBe('received');
  await restarted.auth.signOut();
  await restarted.auth.signIn({ email: 'fan-b@example.test', password: 'DemoPass123' });
  await restarted.download.refreshReceivables();
  expect(restarted.download.getSnapshot().intakes).toEqual([]);
});

it('round-trips records and small files through real desktop SQLite and disk after service reinitialization', async () => {
  const tokens: TokenStore = { read: async () => null, write: async () => {}, remove: async () => {} };
  let activeCredential: string | null = null;
  const activeCredentials = { read: async () => activeCredential, write: async (value: string) => { activeCredential = value; }, remove: async () => { activeCredential = null; } };
  let sequence = 0;
  const deps = {
    storage: await openSqliteKeyValueStore(), files: createFileStore(), tokens, activeCredentials,
    clock: systemClock, ids: { next: () => `integration-${++sequence}` },
  };
  const config = { appEnvironment: 'development', dataSource: 'mock' } as const;
  const first = await createMockServices(config, deps);
  const saved = await first.foundationCheck.save('group-a');
  const serverSaved = await first.foundationCheck.save('mock-server');
  await first.auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  await first.identification.initialize();
  const groupCredential = first.auth.getSnapshot().session!.credential;
  first.identification.openReception();
  first.identification.openNumber();
  await first.identification.resolveNumber('000123');
  first.identification.toggleIdol('idol-a');
  first.identification.toggleIdol('idol-a2');
  await first.identification.saveIntake();
  const intake = first.identification.getSnapshot().latestIntake;
  expect(intake).toMatchObject({ groupId: 'group-a', idolIds: ['idol-a', 'idol-a2'] });
  if (!intake) throw new Error('Expected saved intake');
  await first.capture.initialize();
  await first.capture.openIntake(intake.id);
  expect(first.capture.getSnapshot()).toMatchObject({ phase: 'camera', intakeId: intake.id, photos: [] });
  mockDriver.reopenDatabase();
  const reopened = await createMockServices(config, {
    ...deps, storage: await openSqliteKeyValueStore(), files: createFileStore(),
  });
  expect(reopened.auth.getSnapshot().session?.principal).toMatchObject({ id: 'group-a', role: 'group' });
  expect(reopened.identification.getSnapshot().latestIntake).toBeNull();
  expect(reopened.capture.getSnapshot()).toMatchObject({ phase: 'home', intakeId: null, photos: [] });
  expect((await reopened.photoManagement.list(groupCredential)).intakes).toEqual([]);
  expect(groupCredential).toBe(reopened.auth.getSnapshot().session?.credential);
  expect(await reopened.foundationCheck.read('group-a')).toEqual(saved);
  expect(await reopened.foundationCheck.read('mock-server')).toEqual(serverSaved);
  expect((await reopened.foundationCheck.read('fan-a')).record).toBeNull();
  expect(saved.fileContents).toContain(saved.record?.id);
  await reopened.auth.signOut();
  mockDriver.reopenDatabase();
  const afterLogout = await createMockServices(config, { ...deps, storage: await openSqliteKeyValueStore() });
  expect(afterLogout.auth.getSnapshot().session).toBeNull();
  await reopened.foundationCheck.reset('RESET_MOCK_DATA');
  expect((await reopened.foundationCheck.read('group-a')).record).toBeNull();
});
