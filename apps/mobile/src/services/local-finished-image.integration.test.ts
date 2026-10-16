/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import { createFinishedImageFiles } from '@/storage/finished-image-files';
import type { KeyValueStore } from '@/storage/key-value-store';
import type { AuthService, AuthSession } from './contracts/auth';
import type { CapturePhoto, CaptureService } from './contracts/capture';
import type { EditingService, PhotoEdit } from './contracts/editing';
import type { IdentificationService } from './contracts/identification';
import { createSkiaFinishedImageRenderer } from '@/features/finished-image/skia-renderer';
import { createLocalFinishedImageService } from './local-finished-image';
import { LocalOperationGate } from './local-operation-gate';
import { confirmationKey } from './confirmation-lock';

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
const intake = { id: 'i1', groupId: 'group-a', recipientRef: 'recipient-a', idolIds: ['idol-a', 'idol-b'], acceptedAt: '2026-09-25T00:00:00.000Z' };
const identification: IdentificationService = { getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => { throw Error('unused'); },
  getOwnRecipientRef: async () => { throw Error('unused'); },
  resolveQr: async () => null, resolveNumber: async () => null,
  listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [{ id: 'idol-a', name: 'アイドルA' }, { id: 'idol-b', name: 'アイドルB' }],
  saveIntake: async () => { throw Error('unused'); }, getLatestIntake: async () => intake, listIntakes: async () => [intake] };
const sourcePng = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAA//8DAJcBZ2oAAAAASUVORK5CYII=', 'base64'));
let photoList: CapturePhoto[];
let editMap: Map<string, PhotoEdit>;
const capture: CaptureService = { listSessions: async () => [], listPhotos: async () => photoList,
  savePhoto: async () => { throw Error('unused'); }, discardPhoto: async () => {} };
const editing: EditingService = { load: async (_, __, photoId) => editMap.get(photoId)!,
  append: async () => { throw Error('unused'); }, undo: async () => { throw Error('unused'); },
  setFrame: async () => { throw Error('unused'); }, setQuality: async () => { throw Error('unused'); },
  saveDraft: async () => { throw Error('unused'); } };
const clock = { now: () => new Date('2026-09-25T01:00:00.000Z') };
const renderer = createSkiaFinishedImageRenderer();
const spy = jest.fn((...args: Parameters<typeof renderer.render>) => renderer.render(...args));
const files = createFinishedImageFiles();
const gate = new LocalOperationGate();
function service(storage: KeyValueStore) {
  return createLocalFinishedImageService({ environment: 'development', source: 'mock', storage, auth, capture,
    editing, identification, files, renderer: { render: spy }, clock, gate });
}
beforeEach(() => {
  mockDriver = createNativeTestDrivers();
  spy.mockClear();
  const original = path.join(mockDriver.rootPath, 'source.png');
  fs.writeFileSync(original, sourcePng);
  const uri = pathToFileURL(original).href;
  photoList = [{ id: 'p1', intakeId: 'i1', capturedAt: intake.acceptedAt, width: 1, height: 1, format: 'png',
    originalRef: 'photos/p1.png', thumbnailRef: 'photos/thumb-p1.jpg', originalUri: uri, thumbnailUri: uri }];
  editMap = new Map([['p1', { schemaVersion: 1, photoId: 'p1', intakeId: 'i1', groupId: 'group-a',
    originalRef: 'photos/p1.png', baseWidth: 1, baseHeight: 1, frame: 'white', quality: 'cheki',
    elements: [{ kind: 'stamp', id: 's1', stamp: 'circle', color: '#e53935', center: { x: 0.5, y: 0.5 }, size: 0.1 }],
    revision: 1, updatedAt: intake.acceptedAt }]]);
});
afterEach(() => { mockDriver.dispose(); });

it('removes only one uploaded photo’s finished files and keeps another file in the group folder', async () => {
  const namespace = { environment: 'development', source: 'mock', owner: { kind: 'group', id: 'group-a' } } as const;
  const output = await renderer.render(photoList[0], editMap.get('p1')!, sourcePng);
  const first = await files.persist(namespace, 'p1', 1, 'cheki', output.bytes, output.width, output.height);
  const other = await files.persist(namespace, 'p2', 1, 'cheki', output.bytes, output.width, output.height);
  const legacy = new URL('./final-p1-r1-cheki.jpg', first.uri);
  fs.copyFileSync(new URL(first.uri), legacy);
  expect((await files.inspectLegacy?.(namespace, 'p1', 1, 'cheki'))?.uri).toBe(legacy.href);
  await files.removePhoto(namespace, 'p1');
  expect(fs.existsSync(new URL(first.uri))).toBe(false);
  expect(fs.existsSync(legacy)).toBe(false);
  expect(fs.existsSync(new URL(other.uri))).toBe(true);
});

it('retains a confirmed photo manifest after manual local image deletion', async () => {
  const finished = service(await openSqliteKeyValueStore());
  await finished.prepare('a', 'i1');
  await finished.confirm('a', 'i1');
  await files.removePhoto({ environment: 'development', source: 'mock', owner: { kind: 'group', id: 'group-a' } }, 'p1');
  photoList = photoList.map((photo) => ({ ...photo, localDeleted: true }));
  expect((await finished.prepare('a', 'i1')).images[0]).toMatchObject({ photoId: 'p1', uri: '' });
});

it('stores real JPEG and SQLite metadata, reuses after restart, then regenerates only after edit revision changes', async () => {
  let finished = service(await openSqliteKeyValueStore());
  expect(await finished.getSaved('a', 'i1')).toEqual([]);
  const first = await finished.prepare('a', 'i1');
  expect(first).toMatchObject({ recipientLabel: 'テストファンA', idolNames: ['アイドルA', 'アイドルB'], confirmedAt: null });
  expect(first.images).toHaveLength(1);
  expect(first.images[0]).toMatchObject({ width: 1005, height: 1600, quality: 'cheki', editRevision: 1 });
  expect((await finished.getSaved('a', 'i1'))[0].uri).toBe(first.images[0].uri);
  expect(fs.existsSync(new URL(first.images[0].uri))).toBe(true);
  expect(first.images[0].byteSize).toBeGreaterThan(100);
  expect(spy).toHaveBeenCalledTimes(1);
  mockDriver.reopenDatabase();
  finished = service(await openSqliteKeyValueStore());
  expect((await finished.getSaved('a', 'i1'))[0].uri).toBe(first.images[0].uri);
  expect((await finished.prepare('a', 'i1')).images[0].uri).toBe(first.images[0].uri);
  expect(spy).toHaveBeenCalledTimes(1);
  editMap.set('p1', { ...editMap.get('p1')!, quality: 'high', revision: 2 });
  expect(await finished.getSaved('a', 'i1')).toEqual([]);
  const newer = await finished.prepare('a', 'i1');
  expect(newer.images[0]).toMatchObject({ width: 1884, height: 3000, quality: 'high', editRevision: 2 });
  expect(newer.images[0].uri).not.toBe(first.images[0].uri);
  expect(spy).toHaveBeenCalledTimes(2);
  const confirmed = await finished.confirm('a', 'i1');
  expect(confirmed.confirmedAt).toBe('2026-09-25T01:00:00.000Z');
  expect(await finished.isConfirmed('a', 'i1')).toBe(true);
});

it('does not mark a completed image after SQLite failure and recovers the already saved JPEG', async () => {
  const storage = await openSqliteKeyValueStore();
  let fail = true;
  const broken: KeyValueStore = { ...storage, set: async (key, value) => {
    if (fail && key.includes('finished-intake')) { fail = false; throw Error('disk full'); }
    await storage.set(key, value);
  } };
  await expect(service(broken).prepare('a', 'i1')).rejects.toMatchObject({ code: 'Storage' });
  expect(spy).toHaveBeenCalledTimes(1);
  mockDriver.reopenDatabase();
  const reopened = service(await openSqliteKeyValueStore());
  expect((await reopened.prepare('a', 'i1')).images).toHaveLength(1);
  expect(spy).toHaveBeenCalledTimes(1);
});

it('rejects zero photos and an edit that changed after generation', async () => {
  const finished = service(await openSqliteKeyValueStore());
  photoList = [];
  await expect(finished.prepare('a', 'i1')).rejects.toMatchObject({ code: 'Validation' });
  photoList = [{ id: 'p1', intakeId: 'i1', capturedAt: intake.acceptedAt, width: 1, height: 1, format: 'png',
    originalRef: 'photos/p1.png', thumbnailRef: 'photos/thumb-p1.jpg', originalUri: pathToFileURL(path.join(mockDriver.rootPath, 'source.png')).href,
    thumbnailUri: '' }];
  await finished.prepare('a', 'i1');
  editMap.set('p1', { ...editMap.get('p1')!, revision: 3 });
  await expect(finished.confirm('a', 'i1')).rejects.toMatchObject({ code: 'Conflict' });
});

it('resumes after the second image fails without losing the first or its source', async () => {
  const second = { ...photoList[0], id: 'p2', originalRef: 'photos/p2.png' };
  photoList.push(second);
  editMap.set('p2', { ...editMap.get('p1')!, photoId: 'p2', originalRef: second.originalRef, revision: 0 });
  spy.mockImplementationOnce(renderer.render).mockImplementationOnce(async () => { throw Error('render interrupted'); });
  const finished = service(await openSqliteKeyValueStore());
  await expect(finished.prepare('a', 'i1')).rejects.toMatchObject({ code: 'Storage' });
  expect(fs.existsSync(path.join(mockDriver.rootPath, 'source.png'))).toBe(true);
  mockDriver.reopenDatabase();
  const resumed = await service(await openSqliteKeyValueStore()).prepare('a', 'i1');
  expect(resumed.images.map((item) => item.photoId)).toEqual(['p1', 'p2']);
  expect(spy).toHaveBeenCalledTimes(3);
});

it('warns on disk shortage and never records a complete image', async () => {
  const expoFiles = jest.requireMock<{ Paths: { availableDiskSpace: number } }>('expo-file-system');
  const previous = expoFiles.Paths.availableDiskSpace;
  expoFiles.Paths.availableDiskSpace = 1;
  try {
    const storage = await openSqliteKeyValueStore();
    await expect(service(storage).prepare('a', 'i1')).rejects.toMatchObject({ code: 'Storage' });
    expect(await storage.get(confirmationKey('development', 'mock', 'group-a', 'i1'))).toBeNull();
    expect(fs.existsSync(path.join(mockDriver.rootPath, 'source.png'))).toBe(true);
  } finally { expoFiles.Paths.availableDiskSpace = previous; }
});
