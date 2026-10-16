/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Skia, ImageFormat } from '@shopify/react-native-skia';
import type { AuthService, AuthSession } from '@/services/contracts/auth';
import type { CaptureService } from '@/services/contracts/capture';
import type { FinishedImageService, SendPreview } from '@/services/contracts/finished-image';
import { LocalOperationGate } from '@/services/local-operation-gate';
import { createMockPhotoTransfer } from '@/storage/mock-photo-transfer';
import { buildNamespacePrefix } from '@/storage/namespace';
import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import type { KeyValueStore } from '@/storage/key-value-store';
import { MockUploadServer } from './mock-upload-server';
import { createMockUploadService } from './mock-upload-service';
import { createMockBatchUpload } from './mock-batch-upload';

let mockDriver: NativeTestDrivers;
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (name: string) => mockDriver.sqlite.openDatabaseAsync(name) }));
jest.mock('expo-file-system', () => {
  const { createFileSystemTestModule } = jest.requireActual<typeof import('@/storage/testing/native-test-drivers')>('@/storage/testing/native-test-drivers');
  return createFileSystemTestModule(() => mockDriver);
});
jest.mock('@shopify/react-native-skia', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Skia's Jest build is CommonJS.
  const { Mock } = require('@shopify/react-native-skia/lib/commonjs/mock');
  return Mock((globalThis as unknown as { CanvasKit: unknown }).CanvasKit);
});

const session: AuthSession = { credential: 'a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const auth: AuthService = { signIn: async () => session, restore: async (credential) => {
  if (credential !== 'a') throw Error('unauthorized');
  return session;
}, signOut: async () => {} };
let now: Date;
let preview: SendPreview;
const capture: CaptureService = {
  listPhotos: async () => preview.images.map((image, index) => ({ id: image.photoId, intakeId: 'i1',
    capturedAt: new Date(Date.parse('2026-09-25T00:01:00.000Z') + index * 1000).toISOString(),
    width: 4, height: 4, format: 'jpg', originalRef: '', thumbnailRef: '', originalUri: '', thumbnailUri: '' })),
  listSessions: async () => [], savePhoto: async () => { throw Error('unused'); },
  discardPhoto: async () => { throw Error('unused'); },
};
const finished: FinishedImageService = { prepare: async (credential) => {
  if (credential !== 'a') throw Error('unauthorized');
  return preview;
}, confirm: async () => preview, getSaved: async () => [], isConfirmed: async () => true };
const groupPrefix = buildNamespacePrefix({ environment: 'development', source: 'mock', owner: { kind: 'group', id: 'group-a' } });
const serverPrefix = buildNamespacePrefix({ environment: 'development', source: 'mock', owner: { kind: 'mock-server', id: 'server' } });
async function setup(count: number, overrideStorage?: (storage: KeyValueStore) => KeyValueStore) {
  const storage = overrideStorage?.(await openSqliteKeyValueStore()) ?? await openSqliteKeyValueStore();
  const server = new MockUploadServer('development', storage, createMockPhotoTransfer(), { now: () => now });
  const bundle = createMockUploadService({ environment: 'development', storage, auth, capture, finished, server, gate: new LocalOperationGate() });
  preview = { intake: { id: 'i1', groupId: 'group-a', recipientRef: 'recipient-a', idolIds: ['idol-a'], acceptedAt: '2026-09-25T00:00:00.000Z' },
    recipientLabel: '確認済みの受取人 1人', idolNames: ['アイドルA'], confirmedAt: '2026-09-25T00:30:00.000Z', images: [] };
  const surface = Skia.Surface.Make(4, 4)!;
  surface.getCanvas().clear(Skia.Color('#ff0000'));
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 90);
  surface.dispose();
  for (let index = 1; index <= count; index++) {
    const photoId = `p${index}`;
    const source = path.join(mockDriver.rootPath, ...groupPrefix.split('/').filter(Boolean), 'finished', `${photoId}.jpg`);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, bytes);
    preview.images.push({ photoId, editRevision: 1, quality: 'cheki', width: 4, height: 4,
      byteSize: bytes.length, relativeRef: `finished/${photoId}.jpg`, uri: pathToFileURL(source).href,
      generatedAt: '2026-09-25T00:30:00.000Z' });
  }
  return { storage, server, ...bundle, bytes };
}
beforeEach(() => { mockDriver = createNativeTestDrivers(); now = new Date('2026-09-25T01:00:00.000Z'); });
afterEach(() => { mockDriver.dispose(); });

it('persists one intake outcome, resumes a partial batch manually and retains individual server receipts', async () => {
  const { server, storage } = await setup(3);
  let batch = createMockBatchUpload({ environment: 'development', storage, auth, capture, finished, server });
  await server.setScenario('p2', 'always-fail');
  expect(await batch.send('a', 'i1')).toMatchObject({ status: 'failed', photoCount: 3, failureCount: 1 });
  expect(await server.lookup('group-a', 'i1', 'p1')).not.toBeNull();
  expect(await server.lookup('group-a', 'i1', 'p3')).toBeNull();
  expect((await storage.get(`${groupPrefix}upload-batch/i1`))).not.toMatch(/"photos"|"photoId"/);
  mockDriver.reopenDatabase();
  const reopened = await openSqliteKeyValueStore();
  const reopenedServer = new MockUploadServer('development', reopened, createMockPhotoTransfer(), { now: () => now });
  batch = createMockBatchUpload({ environment: 'development', storage: reopened, auth, capture, finished, server: reopenedServer });
  expect(await batch.observe('a', 'i1')).toMatchObject({ status: 'failed', failureCount: 1 });
  await reopenedServer.setScenario('p2', 'normal');
  expect(await batch.send('a', 'i1')).toMatchObject({ status: 'uploaded', photoCount: 3, failureCount: 1 });
  expect(await batch.observe('a', 'i1')).toMatchObject({ status: 'uploaded' });
  expect(await reopened.get(`${serverPrefix}upload/notification/i1`)).not.toBeNull();
  await expect(batch.send('a', 'i1')).rejects.toMatchObject({ code: 'Conflict' });
});

it('resolves a batch with a lost completion response by query without another transfer', async () => {
  const { server, storage } = await setup(1);
  const batch = createMockBatchUpload({ environment: 'development', storage, auth, capture, finished, server });
  await server.setScenario('p1', 'lost-response');
  expect(await batch.send('a', 'i1')).toMatchObject({ status: 'unknown', failureCount: 0 });
  expect(await batch.query('a', 'i1')).toMatchObject({ status: 'uploaded', failureCount: 0 });
  await expect(batch.send('a', 'i1')).rejects.toMatchObject({ code: 'Conflict' });
});

it('counts one failed batch per manual press and never retries during observation', async () => {
  const { server, storage } = await setup(1);
  const batch = createMockBatchUpload({ environment: 'development', storage, auth, capture, finished, server });
  await server.setScenario('p1', 'fail-three');
  for (let attempt = 1; attempt <= 3; attempt++) {
    expect(await batch.send('a', 'i1')).toMatchObject({ status: 'failed', failureCount: attempt });
    expect(await batch.observe('a', 'i1')).toMatchObject({ status: 'failed', failureCount: attempt });
  }
  expect(await batch.send('a', 'i1')).toMatchObject({ status: 'uploaded', failureCount: 3 });
});

it('copies actual completed JPEG bytes, retries only the failed photo and creates one notification', async () => {
  const { service, controls, storage, bytes } = await setup(3);
  await controls.setScenario('a', 'i1', 'p2', 'always-fail');
  await service.start('a', 'i1', 'p1');
  const partial = await service.start('a', 'i1', 'p2');
  expect(partial.photos.map((item) => item.status)).toEqual(['uploaded', 'failed', 'unsent']);
  await service.start('a', 'i1', 'p3');
  expect((await service.observe('a', 'i1')).notificationCreated).toBe(false);
  await controls.setScenario('a', 'i1', 'p2', 'normal');
  const done = await service.start('a', 'i1', 'p2');
  expect(done.photos.map((item) => item.status)).toEqual(['uploaded', 'uploaded', 'uploaded']);
  expect(done.notificationCreated).toBe(true);
  const copied = path.join(mockDriver.rootPath, ...serverPrefix.split('/').filter(Boolean), 'uploads', 'upload-p2.jpg');
  expect(fs.readFileSync(copied)).toEqual(Buffer.from(bytes));
  const firstAt = done.photos[0].uploadedAt;
  await expect(service.start('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
  mockDriver.reopenDatabase();
  const reopenedStorage = await openSqliteKeyValueStore();
  const reopened = new MockUploadServer('development', reopenedStorage, createMockPhotoTransfer(), { now: () => now });
  const next = createMockUploadService({ environment: 'development', storage: reopenedStorage, auth, capture, finished, server: reopened, gate: new LocalOperationGate() }).service;
  expect((await next.observe('a', 'i1')).photos[0].uploadedAt).toBe(firstAt);
  expect((await storage.get(`${serverPrefix}upload/notification/i1`))).not.toBeNull();
  expect((await reopenedStorage.get(`${serverPrefix}upload/notification/i1`))).toEqual(await storage.get(`${serverPrefix}upload/notification/i1`));
});

it('keeps three confirmed failures through restart and succeeds only on the fourth manual press', async () => {
  let { service, controls } = await setup(1);
  await controls.setScenario('a', 'i1', 'p1', 'fail-three');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await service.start('a', 'i1', 'p1');
    expect(result.photos[0].failureCount).toBe(attempt);
  }
  expect((await service.observe('a', 'i1')).photos[0].status).toBe('needs-attention');
  mockDriver.reopenDatabase();
  const storage = await openSqliteKeyValueStore();
  const server = new MockUploadServer('development', storage, createMockPhotoTransfer(), { now: () => now });
  service = createMockUploadService({ environment: 'development', storage, auth, capture, finished, server, gate: new LocalOperationGate() }).service;
  expect((await service.observe('a', 'i1')).photos[0]).toMatchObject({ status: 'needs-attention', failureCount: 3 });
  expect((await service.start('a', 'i1', 'p1')).photos[0]).toMatchObject({ status: 'uploaded', failureCount: 3 });
});

it('recovers lost completion response by same-ID query and expires only the mock server copy', async () => {
  const { service, controls, server } = await setup(1);
  await controls.setScenario('a', 'i1', 'p1', 'lost-response');
  const lost = await service.start('a', 'i1', 'p1');
  expect(lost.photos[0]).toMatchObject({ status: 'unknown', failureCount: 0, progressPercent: 100 });
  const result = await service.query('a', 'i1', 'p1');
  expect(result.photos[0]).toMatchObject({ status: 'uploaded', retention: 'stored', failureCount: 0 });
  expect(result.notificationCreated).toBe(true);
  const uploadedAt = result.photos[0].uploadedAt;
  const expiresAt = result.photos[0].expiresAt;
  now = new Date(Date.parse(expiresAt!) - 1);
  expect(await server.available((await server.lookup('group-a', 'i1', 'p1'))!)).toBe(true);
  now = new Date(expiresAt!);
  await server.sweepAll();
  const expired = await service.observe('a', 'i1');
  expect(expired.photos[0]).toMatchObject({ status: 'uploaded', retention: 'deleted', uploadedAt, expiresAt });
  expect(await server.available((await server.lookup('group-a', 'i1', 'p1'))!)).toBe(false);
  expect(fs.existsSync(new URL(preview.images[0].uri))).toBe(true);
  expect(fs.existsSync(path.join(mockDriver.rootPath, ...serverPrefix.split('/').filter(Boolean), 'uploads', 'upload-p1.jpg'))).toBe(false);
  await expect(service.start('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
});

it('does not notify after an early photo expires before the last photo completes', async () => {
  const { service, controls } = await setup(2);
  await service.start('a', 'i1', 'p1');
  await controls.advanceDays('a', 7);
  const result = await service.start('a', 'i1', 'p2');
  expect(result.photos.map((item) => item.retention)).toEqual(['deleted', 'stored']);
  expect(result.notificationCreated).toBe(false);
});

it('does not report saved after server record failure and reuses the copied file on manual retry', async () => {
  const { service, controls, server } = await setup(1);
  await controls.setScenario('a', 'i1', 'p1', 'save-fail');
  expect((await service.start('a', 'i1', 'p1')).photos[0]).toMatchObject({ status: 'failed', failureCount: 1, progressPercent: 100 });
  expect(await server.lookup('group-a', 'i1', 'p1')).toBeNull();
  await controls.setScenario('a', 'i1', 'p1', 'normal');
  const result = await service.start('a', 'i1', 'p1');
  expect(result.photos[0]).toMatchObject({ status: 'uploaded', failureCount: 1 });
  await expect(service.observe('b', 'i1')).rejects.toThrow();
});

it('keeps an interrupted transfer unknown until same-ID query, without counting it as a confirmed failure', async () => {
  const { storage } = await setup(1);
  await storage.set(`${groupPrefix}upload-intake/i1`, JSON.stringify({ schemaVersion: 1, groupId: 'group-a', intakeId: 'i1',
    photos: [{ photoId: 'p1', status: 'transferring', progressPercent: 62, failureCount: 1,
      uploadedAt: null, expiresAt: null, retention: null }] }));
  mockDriver.reopenDatabase();
  const reopened = await openSqliteKeyValueStore();
  const server = new MockUploadServer('development', reopened, createMockPhotoTransfer(), { now: () => now });
  const next = createMockUploadService({ environment: 'development', storage: reopened, auth, capture, finished, server,
    gate: new LocalOperationGate() }).service;
  expect((await next.observe('a', 'i1')).photos[0]).toMatchObject({ status: 'unknown', failureCount: 1 });
  expect((await next.query('a', 'i1', 'p1')).photos[0]).toMatchObject({ status: 'failed', failureCount: 1 });
});

it('delays actual copy and rejects a double start for the same photo', async () => {
  const { service, controls } = await setup(1);
  await controls.setScenario('a', 'i1', 'p1', 'delayed');
  const first = service.start('a', 'i1', 'p1');
  await expect(service.start('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
  const serverFile = path.join(mockDriver.rootPath, ...serverPrefix.split('/').filter(Boolean), 'uploads', 'upload-p1.jpg');
  expect(fs.existsSync(serverFile)).toBe(false);
  expect((await first).photos[0].status).toBe('uploaded');
  expect(fs.existsSync(serverFile)).toBe(true);
});
