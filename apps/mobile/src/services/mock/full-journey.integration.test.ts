/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { filterAlbum } from '@/features/download/album-filter';
import { createFileStore } from '@/storage/file-store';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import type { TokenStore } from '@/storage/token-store';

import { createMockServices } from './create-mock-services';

let mockDriver: NativeTestDrivers;
let mockThumbnailIndex = 0;
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (name: string) => mockDriver.sqlite.openDatabaseAsync(name) }));
jest.mock('expo-file-system', () => {
  const { createFileSystemTestModule } = jest.requireActual<typeof import('@/storage/testing/native-test-drivers')>('@/storage/testing/native-test-drivers');
  return createFileSystemTestModule(() => mockDriver);
});
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: (uri: string) => ({
    resize: () => {},
    renderAsync: async () => ({ saveAsync: async () => {
      const filesystem = jest.requireActual<typeof import('node:fs')>('node:fs');
      const paths = jest.requireActual<typeof import('node:path')>('node:path');
      const urls = jest.requireActual<typeof import('node:url')>('node:url');
      const file = paths.join(mockDriver.rootPath, `journey-thumb-${++mockThumbnailIndex}.jpg`);
      filesystem.copyFileSync(urls.fileURLToPath(uri), file);
      return { uri: urls.pathToFileURL(file).href };
    } }),
  }) },
}));
jest.mock('@shopify/react-native-skia', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Skia's Jest mock is CommonJS.
  const { Mock } = require('@shopify/react-native-skia/lib/commonjs/mock');
  return Mock((globalThis as unknown as { CanvasKit: unknown }).CanvasKit);
});

const sourcePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAA//8DAJcBZ2oAAAAASUVORK5CYII=', 'base64');

beforeEach(() => { mockDriver = createNativeTestDrivers(); mockThumbnailIndex = 0; });
afterEach(() => { mockDriver.dispose(); });

it('persists a three-photo group-to-fan journey across restarts and isolates another fan', async () => {
  let credential: string | null = null;
  let sequence = 0;
  const activeCredentials = {
    read: async () => credential,
    write: async (value: string) => { credential = value; },
    remove: async () => { credential = null; },
  };
  const tokens: TokenStore = { read: async () => null, write: async () => {}, remove: async () => {} };
  const clock = { now: () => new Date('2026-09-25T01:00:00.000Z') };
  const config = { appEnvironment: 'development', dataSource: 'mock' } as const;
  const assemble = async () => createMockServices(config, {
    storage: await openSqliteKeyValueStore(), files: createFileStore(), tokens, activeCredentials,
    clock, ids: { next: () => `journey-${++sequence}` },
  });
  let app = await assemble();
  await app.auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  await app.identification.initialize();
  app.identification.openReception();
  app.identification.openNumber();
  await app.identification.resolveNumber('700001');
  expect(app.identification.getSnapshot().match).toBe('found');
  app.identification.toggleIdol('idol-a');
  app.identification.toggleIdol('idol-a2');
  await app.identification.saveIntake();
  const intake = app.identification.getSnapshot().latestIntake!;
  expect(intake.idolIds).toEqual(['idol-a', 'idol-a2']);
  await app.capture.initialize();
  await app.capture.openIntake(intake.id);
  const source = path.join(mockDriver.rootPath, 'journey-source.png');
  fs.writeFileSync(source, sourcePng);
  for (let index = 0; index < 3; index++) {
    if (index) app.capture.openCamera();
    await app.capture.capture({ uri: pathToFileURL(source).href, width: 1, height: 1, format: 'png' });
  }
  const photos = app.capture.getSnapshot().photos;
  expect(photos).toHaveLength(3);
  for (const [index, photo] of photos.entries()) {
    await app.editing.open(photo);
    await app.editing.addStamp({ x: 0.25 + index * 0.2, y: 0.5 }, 'circle', '#e53935', 0.1);
    expect(app.editing.getSnapshot().edit?.elements).toHaveLength(1);
  }
  expect(await app.editing.saveDrafts()).toBe(true);
  mockDriverReopen();
  app = await assemble();
  expect(app.auth.getSnapshot().session?.principal.id).toBe('group-a');
  await app.capture.openIntake(intake.id);
  expect(app.capture.getSnapshot().photos.map((photo) => photo.id)).toEqual(photos.map((photo) => photo.id));
  await app.editing.open(app.capture.getSnapshot().photos[0]);
  expect(app.editing.getSnapshot().edit?.elements).toHaveLength(1);
  await app.finishedImage.open(intake.id);
  expect(app.finishedImage.getSnapshot().preview?.images).toHaveLength(3);
  await app.finishedImage.confirm();
  const groupCredential = app.auth.getSnapshot().session!.credential;
  expect((await app.photoManagement.list(groupCredential)).intakes.find((item) => item.intake.id === intake.id))
    .toMatchObject({ uploadStatus: 'unsent', idolNames: ['朝比奈みお', '白瀬りん'] });
  expect(await app.photoManagement.retryUpload(groupCredential, intake.id)).toMatchObject({ status: 'uploaded', photoCount: 3 });
  expect((await app.photoManagement.list(groupCredential)).intakes.find((item) => item.intake.id === intake.id)?.uploadStatus)
    .toBe('uploaded');
  await app.auth.signOut();
  await app.auth.signIn({ email: 'fan@example.test', password: 'DemoPass123' });
  await app.download.refreshReceivables();
  expect((await app.identification.loadTrendingIdols()).map((idol) => idol.id)).toEqual(['idol-a', 'idol-a2']);
  expect(app.download.getSnapshot().intakes.map((item) => item.intakeId)).toContain(intake.id);
  await app.download.receiveIntake(intake.id);
  expect(app.download.getSnapshot().intakes.find((item) => item.intakeId === intake.id)?.photos.map((photo) => photo.status))
    .toEqual(['received', 'received', 'received']);
  await app.download.setFavorite(photos[0].id, true);
  const received = app.download.getSnapshot().intakes;
  expect(filterAlbum(received, { groupId: 'group-a', idolId: 'idol-a2', capturedDate: null, favoritesOnly: true }).map((entry) => entry.photo.photoId))
    .toEqual([photos[0].id]);
  mockDriverReopen();
  app = await assemble();
  expect(app.auth.getSnapshot().session?.principal.id).toBe('fan-a');
  await app.download.open();
  expect(app.download.getSnapshot().intakes.find((item) => item.intakeId === intake.id)?.photos.every((photo) => photo.status === 'received')).toBe(true);
  expect(app.download.getSnapshot().intakes.find((item) => item.intakeId === intake.id)?.photos.find((photo) => photo.photoId === photos[0].id)?.favorite).toBe(true);
  await app.auth.signOut();
  await app.auth.signIn({ email: 'fan-b@example.test', password: 'DemoPass123' });
  await app.download.open();
  expect(app.download.getSnapshot().intakes).toEqual([]);
});

function mockDriverReopen() { mockDriver.reopenDatabase(); }

