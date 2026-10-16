/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Skia, ImageFormat } from '@shopify/react-native-skia';
import type { AuthService, AuthSession } from '@/services/contracts/auth';
import type { IdentificationService } from '@/services/contracts/identification';
import { LocalOperationGate } from '@/services/local-operation-gate';
import { createMockPhotoReceive } from '@/storage/mock-photo-receive';
import { createMockPhotoTransfer } from '@/storage/mock-photo-transfer';
import { buildNamespacePrefix } from '@/storage/namespace';
import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import { MockUploadServer } from './mock-upload-server';
import { createMockDownloadService } from './mock-download-service';

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

const session = (credential: string): AuthSession => ({ credential, principal: {
  id: credential === 'a' ? 'fan-a' : credential === 'b' ? 'fan-b' : 'group-a',
  role: credential === 'g' ? 'group' : 'fan', displayName: credential,
}, expiresAt: '2026-12-01T00:00:00.000Z' });
const auth: AuthService = { signIn: async () => session('a'), restore: async (credential) => session(credential), signOut: async () => {} };
const identification: IdentificationService = {
  getOwnRecipientRef: async (credential) => credential === 'a' ? 'recipient-member-a' : 'recipient-member-b',
  getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => { throw Error('unused'); }, resolveQr: async () => null, resolveNumber: async () => null,
  listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [], saveIntake: async () => { throw Error('unused'); },
  getLatestIntake: async () => null, listIntakes: async () => [],
};
let now: Date;
const prefix = (kind: 'group' | 'fan' | 'guest' | 'mock-server', id: string) => buildNamespacePrefix({
  environment: 'development', source: 'mock', owner: { kind, id },
});
async function setup(photoCount = 3) {
  const storage = await openSqliteKeyValueStore();
  const server = new MockUploadServer('development', storage, createMockPhotoTransfer(), { now: () => now });
  const surface = Skia.Surface.Make(4, 4)!;
  surface.getCanvas().clear(Skia.Color('#00aaee'));
  const bytes = Buffer.from(surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 90));
  surface.dispose();
  const sourceDir = path.join(mockDriver.rootPath, ...prefix('group', 'group-a').split('/').filter(Boolean), 'finished');
  fs.mkdirSync(sourceDir, { recursive: true });
  await storage.set(`${prefix('group', 'group-a')}capture-intakes`, JSON.stringify({ schemaVersion: 1, seedVersion: 1,
    data: { records: [{ id: 'i1', groupId: 'group-a', recipientRef: 'recipient-member-a',
      idolIds: ['idol-a', 'idol-a2'], acceptedAt: '2026-09-25T00:00:00.000Z' }] } }));
  await storage.set(`${prefix('mock-server', 'server')}identification`, JSON.stringify({ schemaVersion: 1, seedVersion: 1,
    data: { idols: [{ id: 'idol-a', groupId: 'group-a', name: 'アイドルA' },
      { id: 'idol-a2', groupId: 'group-a', name: 'アイドルA2' }] } }));
  await storage.set(`${prefix('mock-server', 'server')}auth`, JSON.stringify({ schemaVersion: 1, seedVersion: 1,
    data: { accounts: [{ id: 'group-a', role: 'group', displayName: 'グループA' }] } }));
  for (let i = 1; i <= photoCount; i++) {
    const photoId = `p${i}`;
    const source = path.join(sourceDir, `${photoId}.jpg`);
    fs.writeFileSync(source, bytes);
    await server.send({ groupId: 'group-a', intakeId: 'i1', photoId, recipientRef: 'recipient-member-a',
      sourceUri: pathToFileURL(source).href, byteSize: bytes.length,
      capturedAt: new Date(Date.parse('2026-09-25T00:00:00.000Z') + i * 1000).toISOString(), confirmedFailures: 0 });
  }
  await server.notification('group-a', 'i1', 'recipient-member-a', Array.from({ length: photoCount }, (_, i) => `p${i + 1}`));
  const devicePhotoLibrary = { requestSavePermission: jest.fn(async () => true), save: jest.fn(async (_uri: string) => {}) };
  const services = createMockDownloadService({ environment: 'development', storage, auth, identification,
    server, files: createMockPhotoReceive(), devicePhotoLibrary, gate: new LocalOperationGate() });
  return { storage, server, bytes, devicePhotoLibrary, ...services };
}
beforeEach(() => { mockDriver = createNativeTestDrivers(); now = new Date('2026-09-25T01:00:00.000Z'); });

it('provides an authorized local preview before receipt without creating a fan copy', async () => {
  const { service, server } = await setup(1);
  const photo = (await service.list('a'))[0].photos[0];
  expect(photo).toMatchObject({ status: 'unreceived', localUri: null });
  expect(photo.previewUri).toContain('mock-server');
  expect(photo.previewUri).toContain('upload-p1.jpg');
  const fanFile = path.join(mockDriver.rootPath, ...prefix('fan', 'fan-a').split('/').filter(Boolean), 'received', 'received-p1.jpg');
  expect(fs.existsSync(fanFile)).toBe(false);
  expect(await service.list('b')).toEqual([]);
  await service.download('a', 'i1', 'p1');
  expect((await service.list('a'))[0].photos[0]).toMatchObject({ status: 'received', previewUri: null });
  now = new Date('2026-10-02T01:00:00.000Z');
  await server.sweepAll();
  expect((await service.list('a'))[0].photos[0].previewUri).toBeNull();
});
afterEach(() => { mockDriver.dispose(); });

it('copies three completed server JPEGs to fan-owned files, persists and sorts by capture time', async () => {
  const { service, bytes } = await setup();
  expect((await service.list('a'))[0].photos.map((item) => item.photoId)).toEqual(['p3', 'p2', 'p1']);
  for (const photoId of ['p1', 'p2', 'p3']) await service.download('a', 'i1', photoId);
  const received = (await service.list('a'))[0].photos;
  expect(received.map((item) => item.status)).toEqual(['received', 'received', 'received']);
  const fanFile = path.join(mockDriver.rootPath, ...prefix('fan', 'fan-a').split('/').filter(Boolean), 'received', 'received-p1.jpg');
  const serverFile = path.join(mockDriver.rootPath, ...prefix('mock-server', 'server').split('/').filter(Boolean), 'uploads', 'upload-p1.jpg');
  expect(fs.readFileSync(fanFile)).toEqual(bytes);
  expect(fs.readFileSync(serverFile)).toEqual(bytes);
  expect(fanFile).not.toBe(serverFile);
  mockDriver.reopenDatabase();
  const storage = await openSqliteKeyValueStore();
  const server = new MockUploadServer('development', storage, createMockPhotoTransfer(), { now: () => now });
  const reopened = createMockDownloadService({ environment: 'development', storage, auth, identification,
    server, files: createMockPhotoReceive(), gate: new LocalOperationGate() }).service;
  expect((await reopened.list('a'))[0].photos.map((item) => item.status)).toEqual(['received', 'received', 'received']);
  expect(await reopened.list('b')).toEqual([]);
  await expect(reopened.download('b', 'i1', 'p1')).rejects.toMatchObject({ code: 'NotFound' });
});

it('exports received files and removes only the fan copy while retaining server history', async () => {
  const { service, albumActions, devicePhotoLibrary } = await setup(2);
  await service.download('a', 'i1', 'p1');
  await service.download('a', 'i1', 'p2');
  await expect(service.download('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
  expect(await albumActions.requestSavePermission()).toBe(true);
  await albumActions.saveToPhotoLibrary('a', 'i1', 'p1');
  expect(devicePhotoLibrary.save).toHaveBeenCalledWith(expect.stringContaining('received-p1.jpg'));
  await expect(albumActions.saveToPhotoLibrary('b', 'i1', 'p1')).rejects.toMatchObject({ code: 'NotFound' });
  await service.setFavorite('a', 'i1', 'p1', true);
  const fanFile = path.join(mockDriver.rootPath, ...prefix('fan', 'fan-a').split('/').filter(Boolean), 'received', 'received-p1.jpg');
  const serverFile = path.join(mockDriver.rootPath, ...prefix('mock-server', 'server').split('/').filter(Boolean), 'uploads', 'upload-p1.jpg');
  await albumActions.deleteReceived('a', 'i1', 'p1');
  expect(fs.existsSync(fanFile)).toBe(false);
  expect(fs.existsSync(serverFile)).toBe(true);
  expect((await service.list('a'))[0].photos.find((photo) => photo.photoId === 'p1')).toMatchObject({ status: 'removed', localUri: null, favorite: false });
  await expect(service.download('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
  expect((await service.list('a'))[0].photos.find((photo) => photo.photoId === 'p2')?.status).toBe('received');
  await expect(albumActions.deleteReceived('b', 'i1', 'p2')).rejects.toMatchObject({ code: 'NotFound' });
  mockDriver.reopenDatabase();
  const reopenedStorage = await openSqliteKeyValueStore();
  const reopenedServer = new MockUploadServer('development', reopenedStorage, createMockPhotoTransfer(), { now: () => now });
  const reopened = createMockDownloadService({ environment: 'development', storage: reopenedStorage,
    auth, identification, server: reopenedServer,
    files: createMockPhotoReceive(), gate: new LocalOperationGate() });
  expect((await reopened.service.list('a'))[0].photos.find((photo) => photo.photoId === 'p1')?.status).toBe('removed');
  await expect(reopened.service.download('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
  now = new Date('2026-10-02T01:00:00.000Z');
  await reopenedServer.sweepAll();
  expect((await reopened.service.list('a'))[0].photos.find((photo) => photo.photoId === 'p1')?.status).toBe('removed');
  await expect(reopened.service.download('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
});

it('migrates old deleted rows and a missing received file without allowing another transfer', async () => {
  const { service, storage, server } = await setup(2);
  await service.download('a', 'i1', 'p1');
  await service.download('a', 'i1', 'p2');
  const ledgerKey = `${prefix('fan', 'fan-a')}download/photo/p1`;
  await storage.set(ledgerKey, JSON.stringify({ schemaVersion: 1, fanId: 'fan-a', photoId: 'p1', status: 'unreceived', progressPercent: 0 }));
  const fanFile = path.join(mockDriver.rootPath, ...prefix('fan', 'fan-a').split('/').filter(Boolean), 'received', 'received-p2.jpg');
  fs.rmSync(fanFile);
  expect((await service.list('a'))[0].photos.map((photo) => photo.status)).toEqual(['removed', 'removed']);
  expect(JSON.parse((await storage.get(ledgerKey))!).status).toBe('removed');
  await expect(service.download('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Conflict' });
  await expect(service.download('a', 'i1', 'p2')).rejects.toMatchObject({ code: 'Conflict' });
  expect((await server.listForRecipient('recipient-member-a'))[0].receipts).toHaveLength(2);
});

it('receives a newly issued guest photo only into the guest namespace', async () => {
  const { storage, server, bytes } = await setup(1);
  const source = path.join(mockDriver.rootPath, ...prefix('group', 'group-a').split('/').filter(Boolean), 'finished', 'p1.jpg');
  const guestAuth: AuthService = { ...auth, restore: async (credential) => credential === 'guest'
    ? { credential, principal: { id: 'guest-new', role: 'guest', displayName: 'ゲスト' }, expiresAt: session('a').expiresAt }
    : session(credential) };
  const guestIdentification: IdentificationService = { ...identification,
    getOwnRecipientRef: async (credential) => credential === 'guest' ? 'recipient-guest-new' : 'recipient-member-a' };
  await server.send({ groupId: 'group-a', intakeId: 'guest-intake', photoId: 'guest-photo',
    recipientRef: 'recipient-guest-new', sourceUri: pathToFileURL(source).href, byteSize: bytes.length,
    capturedAt: '2026-09-25T00:20:00.000Z', confirmedFailures: 0 });
  await server.notification('group-a', 'guest-intake', 'recipient-guest-new', ['guest-photo']);
  const guestService = createMockDownloadService({ environment: 'development', storage, auth: guestAuth,
    identification: guestIdentification, server, files: createMockPhotoReceive(), gate: new LocalOperationGate() }).service;
  expect((await guestService.list('guest'))[0].photos[0].photoId).toBe('guest-photo');
  await expect(guestService.download('a', 'guest-intake', 'guest-photo')).rejects.toMatchObject({ code: 'NotFound' });
  await guestService.download('guest', 'guest-intake', 'guest-photo');
  const guestFile = path.join(mockDriver.rootPath, ...prefix('guest', 'guest-new').split('/').filter(Boolean), 'received', 'received-guest-photo.jpg');
  const fanFile = path.join(mockDriver.rootPath, ...prefix('fan', 'guest-new').split('/').filter(Boolean), 'received', 'received-guest-photo.jpg');
  expect(fs.readFileSync(guestFile)).toEqual(bytes);
  expect(fs.existsSync(fanFile)).toBe(false);
  mockDriver.reopenDatabase();
  expect((await guestService.list('guest'))[0].photos[0].status).toBe('received');
});

it('keeps partial receive out of album and retries only after another manual call', async () => {
  const { service, controls } = await setup(1);
  await controls.setScenario('a', 'i1', 'p1', 'fail-midway');
  await expect(service.download('a', 'i1', 'p1')).rejects.toMatchObject({ code: 'Transport' });
  expect((await service.list('a'))[0].photos[0]).toMatchObject({ status: 'failed', localUri: null });
  mockDriver.reopenDatabase();
  expect((await service.list('a'))[0].photos[0].status).toBe('failed');
  await controls.setScenario('a', 'i1', 'p1', 'normal');
  expect((await service.list('a'))[0].photos[0].status).toBe('failed');
  expect((await service.download('a', 'i1', 'p1'))[0].photos[0].status).toBe('received');
});

it('rejects new download after expiry but keeps a received local copy visible', async () => {
  const { service, server } = await setup(2);
  await service.download('a', 'i1', 'p1');
  now = new Date('2026-10-02T01:00:00.000Z');
  await server.sweepAll();
  expect((await service.list('a'))[0].photos.map((item) => item.status)).toEqual(['expired', 'received']);
  await expect(service.download('a', 'i1', 'p2')).rejects.toMatchObject({ code: 'Expired' });
  expect((await service.list('a'))[0].photos.find((item) => item.photoId === 'p1')?.localUri).toContain('received-p1.jpg');
});

it('recovers a file copied before SQLite completion without downloading again', async () => {
  const { service, storage, server, bytes } = await setup(1);
  const fan = { environment: 'development', source: 'mock', owner: { kind: 'fan', id: 'fan-a' } } as const;
  await storage.set(`${prefix('fan', 'fan-a')}download/photo/p1`, JSON.stringify({ schemaVersion: 1,
    fanId: 'fan-a', photoId: 'p1', status: 'receiving', progressPercent: 99 }));
  await createMockPhotoReceive().copy(server.namespace, fan, 'p1', bytes.length);
  expect((await service.list('a'))[0].photos[0].status).toBe('received');
});

it('persists favorite per fan and keeps received photos after the 30-day notice window', async () => {
  const { service, server, storage } = await setup(2);
  await service.download('a', 'i1', 'p1');
  const favorited = await service.setFavorite('a', 'i1', 'p1', true);
  expect(favorited[0].photos.find((item) => item.photoId === 'p1')?.favorite).toBe(true);
  await expect(service.setFavorite('a', 'i1', 'p2', true)).rejects.toMatchObject({ code: 'Conflict' });
  await expect(service.setFavorite('b', 'i1', 'p1', true)).rejects.toMatchObject({ code: 'NotFound' });
  expect((await service.listNotifications('a'))[0].message).toBe('複数名のアイドルとのチェキが2枚届きました');
  await service.markNotificationRead('a', 'i1');
  mockDriver.reopenDatabase();
  const reopenedStorage = await openSqliteKeyValueStore();
  const reopenedServer = new MockUploadServer('development', reopenedStorage, createMockPhotoTransfer(), { now: () => now });
  const reopened = createMockDownloadService({ environment: 'development', storage: reopenedStorage, auth,
    identification, server: reopenedServer, files: createMockPhotoReceive(), gate: new LocalOperationGate() }).service;
  expect((await reopened.list('a'))[0].photos.find((item) => item.photoId === 'p1')?.favorite).toBe(true);
  expect((await reopened.listNotifications('a'))[0].read).toBe(true);
  expect(await reopened.listNotifications('b')).toEqual([]);
  expect(await storage.get(`${prefix('mock-server', 'server')}upload/notification/i1`)).not.toBeNull();
  now = new Date('2026-10-02T01:00:00.000Z');
  await server.sweepAll();
  expect((await reopened.list('a'))[0].photos.map((item) => item.status)).toEqual(['expired', 'received']);
  expect(await reopened.listNotifications('a')).toHaveLength(1);
  now = new Date('2026-10-25T01:00:00.000Z');
  expect(await reopened.listNotifications('a')).toHaveLength(0);
  expect((await reopened.list('a'))[0].photos.find((item) => item.photoId === 'p1')).toMatchObject({ status: 'received', favorite: true });
  await reopened.setFavorite('a', 'i1', 'p1', false);
  expect((await reopened.list('a'))[0].photos.find((item) => item.photoId === 'p1')?.favorite).toBe(false);
});

it('keeps same-day notifications tied to separate intakes and enriches a legacy record in place', async () => {
  const { service, server, storage, bytes } = await setup(1);
  const key = `${prefix('group', 'group-a')}capture-intakes`;
  const state = JSON.parse((await storage.get(key))!);
  state.data.records.push({ id: 'i2', groupId: 'group-a', recipientRef: 'recipient-member-a',
    idolIds: ['idol-a'], acceptedAt: '2026-09-25T00:10:00.000Z' });
  await storage.set(key, JSON.stringify(state));
  const source = path.join(mockDriver.rootPath, ...prefix('group', 'group-a').split('/').filter(Boolean), 'finished', 'p2.jpg');
  fs.writeFileSync(source, bytes);
  await server.send({ groupId: 'group-a', intakeId: 'i2', photoId: 'p2', recipientRef: 'recipient-member-a',
    sourceUri: pathToFileURL(source).href, byteSize: bytes.length, capturedAt: '2026-09-25T00:11:00.000Z', confirmedFailures: 0 });
  await server.notification('group-a', 'i2', 'recipient-member-a', ['p2']);
  const notices = await service.listNotifications('a');
  expect(notices).toHaveLength(2);
  expect(notices.find((item) => item.intakeId === 'i2')?.message).toBe('アイドルAとのチェキが1枚届きました');
  expect((await service.list('a')).map((item) => [item.intakeId, item.photos.map((photo) => photo.photoId)]))
    .toEqual(expect.arrayContaining([['i1', ['p1']], ['i2', ['p2']]]));
  const notificationKey = `${prefix('mock-server', 'server')}upload/notification/i2`;
  const stored = JSON.parse((await storage.get(notificationKey))!);
  const createdAt = stored.createdAt;
  delete stored.groupName;
  delete stored.idolIds;
  delete stored.idolNames;
  await storage.set(notificationKey, JSON.stringify(stored));
  expect((await service.listNotifications('a')).find((item) => item.intakeId === 'i2')?.message)
    .toBe('アイドルAとのチェキが1枚届きました');
  expect(JSON.parse((await storage.get(notificationKey))!).createdAt).toBe(createdAt);
  expect((await service.listNotifications('a'))).toHaveLength(2);
  const unchanged = await storage.get(notificationKey);
  await service.list('a');
  await service.listNotifications('a');
  await service.download('a', 'i2', 'p2');
  expect(await storage.get(notificationKey)).toBe(unchanged);
});
