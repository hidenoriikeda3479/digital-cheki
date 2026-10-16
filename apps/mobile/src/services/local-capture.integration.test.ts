import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import { createPhotoFileStore } from '@/storage/photo-file-store';
import type { KeyValueStore } from '@/storage/key-value-store';
import type { AuthService, AuthSession } from '@/services/contracts/auth';
import type { CaptureIntake, IdentificationService } from '@/services/contracts/identification';

import { createLocalCaptureService } from './local-capture';
import { confirmationKey } from './confirmation-lock';
import { createLocalPhotoManagement } from './local-photo-management';
import type { FinishedImageFiles } from '@/storage/finished-image-files';
import type { BatchUploadService } from './contracts/batch-upload';
import type { FinishedImageService } from './contracts/finished-image';
import { buildNamespacePrefix } from '@/storage/namespace';

let mockDriver: NativeTestDrivers;
let mockThumbnailIndex = 0;
let mockFailThumbnail = false;
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (name: string) => mockDriver.sqlite.openDatabaseAsync(name) }));
jest.mock('expo-file-system', () => {
  const { createFileSystemTestModule: createModule } = jest.requireActual<typeof import('@/storage/testing/native-test-drivers')>('@/storage/testing/native-test-drivers');
  return createModule(() => mockDriver);
});
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: (uri: string) => ({
    resize: () => {},
    renderAsync: async () => ({ saveAsync: async () => {
      if (mockFailThumbnail) throw new Error('interrupted thumbnail');
      const filesystem = jest.requireActual<typeof import('node:fs')>('node:fs');
      const paths = jest.requireActual<typeof import('node:path')>('node:path');
      const urls = jest.requireActual<typeof import('node:url')>('node:url');
      const thumb = paths.join(mockDriver.rootPath, `generated-${++mockThumbnailIndex}.jpg`);
      filesystem.copyFileSync(urls.fileURLToPath(uri), thumb);
      return { uri: urls.pathToFileURL(thumb).href };
    } }),
  }) },
}));

const groupA: AuthSession = { credential: 'credential-a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const groupB: AuthSession = { credential: 'credential-b', principal: { id: 'group-b', role: 'group', displayName: 'B' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const fan: AuthSession = { credential: 'credential-f', principal: { id: 'fan-a', role: 'fan', displayName: 'F' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const intakeA: CaptureIntake = { id: 'intake-a', groupId: 'group-a', recipientRef: 'recipient-a', idolIds: ['idol-a'], acceptedAt: '2026-09-25T00:00:00.000Z' };
const intakeB: CaptureIntake = { id: 'intake-b', groupId: 'group-b', recipientRef: 'recipient-b', idolIds: ['idol-b'], acceptedAt: '2026-09-25T00:00:00.000Z' };
const auth: AuthService = {
  signIn: async () => groupA,
  restore: async (credential) => {
    const session = [groupA, groupB, fan].find((item) => item.credential === credential);
    if (!session) throw new Error('unauthorized');
    return session;
  },
  signOut: async () => {},
};
const identification: IdentificationService = {
  getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => { throw new Error('unused'); }, resolveQr: async () => null,
  getOwnRecipientRef: async () => { throw new Error('unused'); },
  resolveNumber: async () => null, listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [],
  saveIntake: async () => { throw new Error('unused'); }, getLatestIntake: async () => intakeA,
  listIntakes: async (credential) => credential === groupA.credential ? [intakeA] : credential === groupB.credential ? [intakeB] : [],
};
let sequence = 0;
const clock = { now: () => new Date('2026-09-25T01:00:00.000Z') };
const ids = { next: () => `photo-id-${++sequence}` };
function service(storage: KeyValueStore) {
  return createLocalCaptureService({ environment: 'development', source: 'mock', storage,
    files: createPhotoFileStore(), auth, identification, clock, ids });
}
function cacheFile(name: string) {
  const file = path.join(mockDriver.rootPath, name);
  fs.writeFileSync(file, `fixture-image-${name}`);
  return { uri: pathToFileURL(file).href, width: 1200, height: 800, format: 'jpg' as const };
}

beforeEach(() => { mockDriver = createNativeTestDrivers(); mockThumbnailIndex = 0; mockFailThumbnail = false; sequence = 0; });
afterEach(() => { mockDriver.dispose(); });

it('keeps three photos and stable IDs after SQLite/file reopen, then removes only a discarded photo', async () => {
  const first = service(await openSqliteKeyValueStore());
  const saved = [];
  for (let index = 1; index <= 3; index++) saved.push(await first.savePhoto(groupA.credential, intakeA.id, cacheFile(`capture-${index}.jpg`)));
  expect(saved.map((photo) => photo.id)).toEqual(['photo-id-1', 'photo-id-2', 'photo-id-3']);
  expect(saved.every((photo) => fs.existsSync(fileURLToPath(photo.originalUri)) && fs.existsSync(fileURLToPath(photo.thumbnailUri)))).toBe(true);
  mockDriver.reopenDatabase();
  const reopened = service(await openSqliteKeyValueStore());
  expect((await reopened.listPhotos(groupA.credential, intakeA.id)).map((photo) => photo.id)).toEqual(saved.map((photo) => photo.id));
  expect((await reopened.listSessions(groupA.credential))[0].photoCount).toBe(3);
  await reopened.discardPhoto(groupA.credential, intakeA.id, saved[1].id);
  mockDriver.reopenDatabase();
  const again = service(await openSqliteKeyValueStore());
  expect((await again.listPhotos(groupA.credential, intakeA.id)).map((photo) => photo.id)).toEqual([saved[0].id, saved[2].id]);
  expect((await again.listSessions(groupA.credential))[0].photoCount).toBe(2);
  expect(fs.existsSync(fileURLToPath(saved[1].originalUri))).toBe(false);
  expect(await again.listPhotos(groupB.credential, intakeB.id)).toEqual([]);
  await expect(again.listPhotos(fan.credential, intakeA.id)).rejects.toMatchObject({ code: 'Forbidden' });
  await expect(again.listPhotos(groupB.credential, intakeA.id)).rejects.toMatchObject({ code: 'Forbidden' });
});

it('protects unfinished photos and manually removes only uploaded device files across restart', async () => {
  const storage = await openSqliteKeyValueStore();
  const capture = service(storage);
  const first = await capture.savePhoto(groupA.credential, intakeA.id, cacheFile('manage-first.jpg'));
  const second = await capture.savePhoto(groupA.credential, intakeA.id, cacheFile('manage-second.jpg'));
  const unrelated = [
    { environment: 'development', source: 'mock', owner: { kind: 'mock-server', id: 'server' } },
    { environment: 'development', source: 'mock', owner: { kind: 'fan', id: 'fan-a' } },
  ] as const;
  const unrelatedPaths = unrelated.map((namespace) => path.join(mockDriver.rootPath, buildNamespacePrefix(namespace), `${first.id}.jpg`));
  unrelatedPaths.forEach((file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'received-copy'); });
  const upload: BatchUploadService = { observe: async (_credential, intakeId) => ({ intakeId, status: 'uploaded', photoCount: 2, failureCount: 0 }),
    send: async () => { throw Error('unused'); }, query: async () => { throw Error('unused'); } };
  const finished: FinishedImageService = { prepare: async () => { throw Error('unused'); },
    confirm: async () => { throw Error('unused'); }, getSaved: async () => [], isConfirmed: async () => false };
  const removed: string[] = [];
  let failFinishedDelete = true;
  const finishedFiles: FinishedImageFiles = { readOriginal: async () => new Uint8Array(), inspect: async () => null,
    persist: async () => { throw Error('unused'); }, removePhoto: async (_ns, id) => {
      if (failFinishedDelete) { failFinishedDelete = false; throw Error('disk unavailable'); }
      removed.push(id);
    } };
  const make = (captureService: ReturnType<typeof service>) => createLocalPhotoManagement({ environment: 'development', source: 'mock',
    auth, capture: captureService, identification, finished, upload, photoFiles: createPhotoFileStore(), finishedFiles });
  const manage = make(capture);
  expect((await manage.list(groupA.credential)).intakes).toEqual([]);
  await expect(manage.retryUpload(groupA.credential, intakeA.id)).rejects.toMatchObject({ code: 'Conflict' });
  expect(fs.existsSync(fileURLToPath(second.originalUri))).toBe(true);
  await expect(manage.deleteUploaded(groupA.credential, intakeA.id, second.id)).rejects.toMatchObject({ code: 'Forbidden' });
  await storage.set(confirmationKey('development', 'mock', 'group-a', intakeA.id), JSON.stringify({ confirmedAt: '2026-09-25T00:00:00.000Z' }));
  await expect(manage.deleteUploaded(groupB.credential, intakeA.id, first.id)).rejects.toMatchObject({ code: 'NotFound' });
  await expect(manage.deleteUploaded(groupA.credential, intakeA.id, first.id)).rejects.toThrow('disk unavailable');
  expect((await manage.list(groupA.credential)).intakes[0].photos.find((item) => item.photo.id === first.id)?.deletionPending).toBe(true);
  await manage.deleteUploaded(groupA.credential, intakeA.id, first.id);
  expect(fs.existsSync(fileURLToPath(first.originalUri))).toBe(false);
  expect(fs.existsSync(fileURLToPath(first.thumbnailUri))).toBe(false);
  expect(fs.existsSync(fileURLToPath(second.originalUri))).toBe(true);
  expect(unrelatedPaths.every((file) => fs.existsSync(file))).toBe(true);
  expect(removed).toEqual([first.id]);
  mockDriver.reopenDatabase();
  const reopened = make(service(await openSqliteKeyValueStore()));
  expect((await reopened.list(groupA.credential)).intakes[0]).toMatchObject({ uploadStatus: 'uploaded' });
  expect((await reopened.list(groupA.credential)).intakes[0].photos.find((item) => item.photo.id === first.id)).toMatchObject({
    localDeleted: true, deletionPending: false });
  expect((await reopened.list(groupA.credential)).intakes[0].photos.find((item) => item.photo.id === second.id)).toMatchObject({
    localDeleted: false });
});

it('removes a selected group of uploaded device photos without touching the uploaded record', async () => {
  const storage = await openSqliteKeyValueStore();
  const capture = service(storage);
  const first = await capture.savePhoto(groupA.credential, intakeA.id, cacheFile('batch-first.jpg'));
  const second = await capture.savePhoto(groupA.credential, intakeA.id, cacheFile('batch-second.jpg'));
  await storage.set(confirmationKey('development', 'mock', 'group-a', intakeA.id),
    JSON.stringify({ confirmedAt: '2026-09-25T00:00:00.000Z' }));
  const upload: BatchUploadService = { observe: async (_credential, intakeId) => ({ intakeId, status: 'uploaded',
    photoCount: 2, failureCount: 0 }), send: async () => { throw Error('unused'); }, query: async () => { throw Error('unused'); } };
  const finished: FinishedImageService = { prepare: async () => { throw Error('unused'); },
    confirm: async () => { throw Error('unused'); }, getSaved: async () => [], isConfirmed: async () => true };
  const finishedFiles: FinishedImageFiles = { readOriginal: async () => new Uint8Array(), inspect: async () => null,
    persist: async () => { throw Error('unused'); }, removePhoto: async () => {} };
  const manage = createLocalPhotoManagement({ environment: 'development', source: 'mock', auth, capture,
    identification, finished, upload, photoFiles: createPhotoFileStore(), finishedFiles });
  await manage.deleteUploadedBatch?.(groupA.credential, [
    { intakeId: intakeA.id, photoId: first.id }, { intakeId: intakeA.id, photoId: second.id },
  ]);
  expect([first, second].every((item) => !fs.existsSync(fileURLToPath(item.originalUri)) &&
    !fs.existsSync(fileURLToPath(item.thumbnailUri)))).toBe(true);
  mockDriver.reopenDatabase();
  const reopened = service(await openSqliteKeyValueStore());
  expect((await reopened.listPhotos(groupA.credential, intakeA.id)).map((item) => ({ id: item.id,
    localDeleted: item.localDeleted, pending: item.localDeletionPending }))).toEqual([
    { id: first.id, localDeleted: true, pending: false },
    { id: second.id, localDeleted: true, pending: false },
  ]);
  expect((await manage.list(groupA.credential)).intakes[0].uploadStatus).toBe('uploaded');
});

it('does not count a failed copy or full storage as saved, then recovers from the same pending ID', async () => {
  const storage = await openSqliteKeyValueStore();
  const capture = service(storage);
  const source = cacheFile('copy-failure.jpg');
  const originalCopy = mockDriver.io.copy;
  mockDriver.io.copy = () => { throw new Error('ENOSPC'); };
  await expect(capture.savePhoto(groupA.credential, intakeA.id, source)).rejects.toMatchObject({ code: 'Storage' });
  expect((await capture.listSessions(groupA.credential))[0]).toMatchObject({ photoCount: 0, needsAttention: true });
  mockDriver.io.copy = originalCopy;
  mockDriver.reopenDatabase();
  const recovered = service(await openSqliteKeyValueStore());
  const photos = await recovered.listPhotos(groupA.credential, intakeA.id);
  expect(photos).toHaveLength(1);
  expect(photos[0].id).toBe('photo-id-1');
  expect((await recovered.listSessions(groupA.credential))[0].photoCount).toBe(1);
});

it('recovers a copied file when the final SQLite update fails; never shows a missing file as ready', async () => {
  const base = await openSqliteKeyValueStore();
  let failReady = true;
  const failing: KeyValueStore = { ...base, set: async (key, value) => {
    if (failReady && key.endsWith('capture-photos') && value.includes('"stage":"ready"')) {
      failReady = false;
      throw new Error('simulated SQL failure');
    }
    await base.set(key, value);
  } };
  const first = service(failing);
  await expect(first.savePhoto(groupA.credential, intakeA.id, cacheFile('db-failure.jpg'))).rejects.toMatchObject({ code: 'Storage' });
  mockDriver.reopenDatabase();
  const recovered = service(await openSqliteKeyValueStore());
  const photos = await recovered.listPhotos(groupA.credential, intakeA.id);
  expect(photos).toHaveLength(1);
  expect(photos[0].id).toBe('photo-id-1');
  fs.unlinkSync(fileURLToPath(photos[0].originalUri));
  mockDriver.reopenDatabase();
  const missing = service(await openSqliteKeyValueStore());
  expect(await missing.listPhotos(groupA.credential, intakeA.id)).toEqual([]);
  expect((await missing.listSessions(groupA.credential))[0]).toMatchObject({ photoCount: 0, needsAttention: true });
});

it('does not copy a photo before the pending SQLite record commits', async () => {
  const base = await openSqliteKeyValueStore();
  const failing: KeyValueStore = { ...base, set: async (key, value) => {
    if (key.endsWith('capture-photos') && value.includes('"stage":"copying"')) throw new Error('simulated SQL failure');
    await base.set(key, value);
  } };
  const capture = service(failing);
  await expect(capture.savePhoto(groupA.credential, intakeA.id, cacheFile('before-db.jpg'))).rejects.toMatchObject({ code: 'Storage' });
  expect(await service(base).listPhotos(groupA.credential, intakeA.id)).toEqual([]);
  expect(fs.existsSync(path.join(mockDriver.rootPath, 'digital-cheki', 'development', 'mock'))).toBe(false);
});

it('warns without deleting user photos when available space is insufficient', async () => {
  const expoFiles = jest.requireMock<{ Paths: { availableDiskSpace: number } }>('expo-file-system');
  const previous = expoFiles.Paths.availableDiskSpace;
  expoFiles.Paths.availableDiskSpace = 1;
  try {
    const capture = service(await openSqliteKeyValueStore());
    await expect(capture.savePhoto(groupA.credential, intakeA.id, cacheFile('disk-full.jpg'))).rejects.toMatchObject({ code: 'Storage' });
    expect((await capture.listSessions(groupA.credential))[0]).toMatchObject({ photoCount: 0, needsAttention: true });
  } finally { expoFiles.Paths.availableDiskSpace = previous; }
});

it('refuses to add or discard photos after send targets are locally confirmed', async () => {
  const storage = await openSqliteKeyValueStore();
  const capture = service(storage);
  const saved = await capture.savePhoto(groupA.credential, intakeA.id, cacheFile('confirmed.jpg'));
  await storage.set(confirmationKey('development', 'mock', 'group-a', intakeA.id), JSON.stringify({ confirmedAt: '2026-09-25T02:00:00.000Z' }));
  await expect(capture.savePhoto(groupA.credential, intakeA.id, cacheFile('later.jpg'))).rejects.toMatchObject({ code: 'Conflict' });
  await expect(capture.discardPhoto(groupA.credential, intakeA.id, saved.id)).rejects.toMatchObject({ code: 'Conflict' });
  expect((await capture.listPhotos(groupA.credential, intakeA.id)).map((item) => item.id)).toEqual([saved.id]);
});

it('finishes an interrupted thumbnail without recapturing or changing the photo ID', async () => {
  const first = service(await openSqliteKeyValueStore());
  mockFailThumbnail = true;
  await expect(first.savePhoto(groupA.credential, intakeA.id, cacheFile('thumbnail-failure.jpg'))).rejects.toMatchObject({ code: 'Storage' });
  mockDriver.reopenDatabase();
  mockFailThumbnail = false;
  const recovered = service(await openSqliteKeyValueStore());
  const photos = await recovered.listPhotos(groupA.credential, intakeA.id);
  expect(photos.map((item) => item.id)).toEqual(['photo-id-1']);
  expect(fs.existsSync(fileURLToPath(photos[0].thumbnailUri))).toBe(true);
});
