/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Skia } from '@shopify/react-native-skia';
import { createFileStore } from '@/storage/file-store';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import { createMockServices } from './create-mock-services';
import { demoChekiManifest } from './demo-cheki-manifest';
import { buildNamespacePrefix } from '@/storage/namespace';

jest.mock('@shopify/react-native-skia', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Mock } = require('@shopify/react-native-skia/lib/commonjs/mock');
  return Mock((globalThis as unknown as { CanvasKit: unknown }).CanvasKit);
});
let mockDriver: NativeTestDrivers;
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (name: string) => mockDriver.sqlite.openDatabaseAsync(name) }));
jest.mock('expo-file-system', () => {
  const { createFileSystemTestModule } = jest.requireActual<typeof import('@/storage/testing/native-test-drivers')>('@/storage/testing/native-test-drivers');
  return createFileSystemTestModule(() => mockDriver);
});
beforeEach(() => { mockDriver = createNativeTestDrivers(); });
afterEach(() => { mockDriver.dispose(); });

function assetPath(index: number) { return path.resolve(__dirname, '../../..', 'assets/mock-cheki', `cheki-${String(index + 1).padStart(2, '0')}.jpg`); }

it('uses nineteen framed JPEGs across scattered weekdays and weekend days with four or five photos', () => {
  expect(demoChekiManifest).toHaveLength(26);
  expect(demoChekiManifest.filter((item) => !item.received).map((item) => item.date))
    .toEqual(['2026-10-04', '2026-10-08', '2026-10-10', '2026-10-11', '2026-10-14']);
  const days = [...new Set(demoChekiManifest.map((item) => item.date))];
  expect(days).toHaveLength(19);
  const weekdays = days.map((day) => new Date(`${day}T00:00:00Z`).getUTCDay());
  expect(weekdays.filter((day) => day === 0 || day === 6)).toHaveLength(12);
  expect(new Set(weekdays.filter((day) => day > 0 && day < 6))).toEqual(new Set([1, 2, 3, 4, 5]));
  expect(demoChekiManifest.filter((item) => item.date === '2026-09-12')).toHaveLength(5);
  expect(demoChekiManifest.filter((item) => item.date === '2026-09-27')).toHaveLength(4);
  expect(new Set(demoChekiManifest.map((item) => item.photoId)).size).toBe(26);
  expect(demoChekiManifest.slice(-5).every((item) => !item.received)).toBe(true);
  const content = new Set<string>();
  for (const item of demoChekiManifest) {
    const bytes = fs.readFileSync(assetPath(item.index));
    content.add(bytes.toString('base64'));
    const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
    expect(image?.width()).toBe(864); expect(image?.height()).toBe(1376);
    const white = image?.readPixels(8, 8, { ...image.getImageInfo(), width: 1, height: 1 });
    expect(Array.from(white!).slice(0, 3)).toEqual([255, 255, 255]);
    image?.dispose();
  }
  expect(content.size).toBe(19);
});

it('imports 21 received and 5 pending, migrates dates without restoring deleted photos, and isolates fan B', async () => {
  let credential: string | null = null;
  let sequence = 0;
  let interrupt = true;
  const photo = jest.fn(async (_namespace: unknown, index: number) => {
    if (index === 6 && interrupt) { interrupt = false; throw Error('interrupted import'); }
    return { uri: pathToFileURL(assetPath(index)).href, byteSize: fs.statSync(assetPath(index)).size, remove: () => {} };
  });
  const deps = {
    files: createFileStore(), clock: { now: () => new Date('2026-10-14T09:00:00Z') }, ids: { next: () => `demo-${++sequence}` },
    tokens: { read: async () => null, write: async () => {}, remove: async () => {} },
    activeCredentials: { read: async () => credential, write: async (value: string) => { credential = value; }, remove: async () => { credential = null; } },
    demoChekiPhoto: photo,
  };
  const assemble = async () => createMockServices({ appEnvironment: 'development', dataSource: 'mock' },
    { ...deps, storage: await openSqliteKeyValueStore() });
  await expect(assemble()).rejects.toThrow('interrupted import');
  let app = await assemble();
  await app.auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  await app.identification.showFanCode();
  expect(app.identification.getSnapshot().ownIdentity?.number).toBe('700001');
  await app.download.refreshReceivables();
  const photos = app.download.getSnapshot().intakes.flatMap((item) => item.photos);
  expect(photos).toHaveLength(26);
  expect(photos.filter((item) => item.status === 'received')).toHaveLength(21);
  expect(photos.filter((item) => item.status === 'unreceived')).toHaveLength(5);
  const saved = photos.find((item) => item.status === 'received')!;
  expect(fs.existsSync(fileURLToPath(saved.localUri!))).toBe(true);
  expect(fs.readFileSync(fileURLToPath(saved.localUri!))).toEqual(fs.readFileSync(assetPath(demoChekiManifest.find((item) => item.photoId === saved.photoId)!.index)));
  const pending = photos.find((item) => item.status === 'unreceived')!;
  expect(pending.previewUri).toBeTruthy();
  expect(pending.expiresAt).toBe('2026-10-21T09:00:00.000Z');
  expect(saved.localUri).not.toBe(pending.previewUri);
  expect(await app.identification.loadTrendingIdols()).toHaveLength(3);
  await app.download.startReceive();
  expect(app.download.getSnapshot().receiveBatch?.items).toHaveLength(5);
  expect(app.download.getSnapshot().receiveBatch?.status).toBe('complete');
  app.download.dismissReceive();
  await app.download.open(); app.download.showPhoto(saved.photoId);
  jest.useFakeTimers();
  await app.download.deleteCurrentPhoto();
  jest.advanceTimersByTime(3000); jest.useRealTimers();
  // Simulate a v1 import: completed-photo markers exist, but the old capture date needs migration.
  const storage = await openSqliteKeyValueStore();
  const prefix = buildNamespacePrefix({ environment: 'development', source: 'mock', owner: { kind: 'mock-server', id: 'server' } });
  const changed = demoChekiManifest.find((item) => item.photoId === 'demo-700001-2026-09-09-photo')!;
  const receiptKey = `${prefix}upload/receipt/${changed.photoId}`;
  const receipt = JSON.parse((await storage.get(receiptKey))!);
  await storage.set(receiptKey, JSON.stringify({ ...receipt, capturedAt: '2026-09-09T12:31:00+09:00' }));
  await storage.remove(`${prefix}fixture/member-700001-cheki-v2`);
  mockDriver.reopenDatabase(); app = await assemble();
  await app.download.refreshReceivables();
  expect(photo).toHaveBeenCalledTimes(27); // Completed imports are not copied again after interruption/migration.
  const migrated = await openSqliteKeyValueStore();
  expect(JSON.parse((await migrated.get(receiptKey))!)).toEqual({ ...receipt, capturedAt: changed.capturedAt });
  expect(app.download.getSnapshot().intakes.flatMap((item) => item.photos).find((item) => item.photoId === saved.photoId)?.status).toBe('removed');
  expect(app.download.getSnapshot().intakes.flatMap((item) => item.photos).filter((item) => item.status === 'unreceived')).toHaveLength(0);
  mockDriver.reopenDatabase(); app = await assemble();
  expect(photo).toHaveBeenCalledTimes(27);
  await app.auth.signOut();
  await app.auth.signIn({ email: 'fan-b@example.test', password: 'DemoPass123' });
  await app.download.refreshReceivables();
  expect(app.download.getSnapshot().intakes).toHaveLength(0);
});
