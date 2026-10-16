import { createNativeTestDrivers, type NativeTestDrivers } from '@/storage/testing/native-test-drivers';
import { openSqliteKeyValueStore } from '@/storage/sqlite-key-value-store';
import type { KeyValueStore } from '@/storage/key-value-store';
import type { AuthService, AuthSession } from './contracts/auth';
import type { CapturePhoto, CaptureService } from './contracts/capture';
import { createLocalEditingService } from './local-editing';
import { confirmationKey } from './confirmation-lock';

let mockDriver: NativeTestDrivers;
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: (name: string) => mockDriver.sqlite.openDatabaseAsync(name) }));

const groupA: AuthSession = { credential: 'a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const groupB: AuthSession = { credential: 'b', principal: { id: 'group-b', role: 'group', displayName: 'B' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const fan: AuthSession = { credential: 'fan', principal: { id: 'fan-a', role: 'fan', displayName: 'F' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const photo = (id: string, intakeId: string): CapturePhoto => ({ id, intakeId, capturedAt: '2026-09-25T00:00:00.000Z',
  width: 800, height: 1200, format: 'jpg', originalRef: `photos/${id}.jpg`, thumbnailRef: `photos/thumb-${id}.jpg`,
  originalUri: `file:///${id}.jpg`, thumbnailUri: `file:///thumb-${id}.jpg` });
const photos = [photo('p1', 'i1'), photo('p2', 'i1'), photo('p3', 'i2')];
const auth: AuthService = { signIn: async () => groupA, restore: async (credential) => {
  const session = [groupA, groupB, fan].find((item) => item.credential === credential);
  if (!session) throw Error('no session');
  return session;
}, signOut: async () => {} };
const capture: CaptureService = { listSessions: async () => [], listPhotos: async (credential, intakeId) =>
  credential === 'a' ? photos.filter((item) => item.intakeId === intakeId && item.id !== 'p3') :
    credential === 'b' ? photos.filter((item) => item.id === 'p3' && item.intakeId === intakeId) : [],
savePhoto: async () => { throw Error('unused'); }, discardPhoto: async () => {} };
const clock = { now: () => new Date('2026-09-25T01:00:00.000Z') };
const ids = { next: () => 'operation-id' };
function service(storage: KeyValueStore) { return createLocalEditingService({ environment: 'development', source: 'mock', storage, auth, capture, clock, ids }); }
beforeEach(() => { mockDriver = createNativeTestDrivers(); });
afterEach(() => { mockDriver.dispose(); });

it('persists separate photo edits in SQLite across reopen, frame reset, undo and stale writes', async () => {
  let editService = service(await openSqliteKeyValueStore());
  const a = await editService.load('a', 'i1', 'p1');
  expect(a).toMatchObject({ frame: 'none', elements: [], revision: 0, baseWidth: 800, baseHeight: 1200 });
  const stroke = { kind: 'stroke' as const, id: 'line-1', color: '#e53935', width: 0.007,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] };
  const afterStroke = await editService.append('a', 'i1', 'p1', 0, stroke);
  await editService.append('a', 'i1', 'p2', 0, { kind: 'stamp', id: 'heart-1', stamp: 'heart', color: '#e91e8f', center: { x: 0.5, y: 0.5 }, size: 0.11 });
  mockDriver.reopenDatabase();
  editService = service(await openSqliteKeyValueStore());
  expect((await editService.load('a', 'i1', 'p1')).elements).toEqual([stroke]);
  expect((await editService.load('a', 'i1', 'p2')).elements[0]).toMatchObject({ kind: 'stamp', stamp: 'heart' });
  const reset = await editService.setFrame('a', 'i1', 'p1', afterStroke.revision, 'white');
  expect(reset).toMatchObject({ frame: 'white', elements: [], revision: 2 });
  await expect(editService.append('a', 'i1', 'p1', afterStroke.revision, { ...stroke, id: 'late' })).rejects.toMatchObject({ code: 'Conflict' });
  await expect(editService.undo('a', 'i1', 'p1', reset.revision)).rejects.toMatchObject({ code: 'Validation' });
  expect((await editService.load('a', 'i1', 'p1')).elements).toEqual([]);
  const quality = await editService.setQuality('a', 'i1', 'p1', reset.revision, 'high');
  expect(quality.quality).toBe('high');
  mockDriver.reopenDatabase();
  editService = service(await openSqliteKeyValueStore());
  expect(await editService.load('a', 'i1', 'p1')).toMatchObject({ frame: 'white', quality: 'high', elements: [] });
  expect((await editService.load('a', 'i1', 'p2')).elements).toHaveLength(1);
  await expect(editService.load('b', 'i1', 'p1')).rejects.toMatchObject({ code: 'NotFound' });
  await expect(editService.load('fan', 'i1', 'p1')).rejects.toMatchObject({ code: 'Forbidden' });
});

it('does not advance the edit when SQLite rejects a write', async () => {
  const real = await openSqliteKeyValueStore();
  const failing: KeyValueStore = { ...real, set: async () => { throw Error('disk full'); } };
  const editService = service(failing);
  await expect(editService.append('a', 'i1', 'p1', 0, { kind: 'stamp', id: 's', stamp: 'circle', color: '#111111',
    center: { x: 0.4, y: 0.4 }, size: 0.11 })).rejects.toMatchObject({ code: 'Storage' });
  await expect(editService.saveDraft('a', 'i1', 'p1', 0, { frame: 'white', quality: 'high', elements: [] }))
    .rejects.toMatchObject({ code: 'Storage' });
  expect(await service(real).load('a', 'i1', 'p1')).toMatchObject({ revision: 0, elements: [] });
});

it('keeps confirmed send targets immutable at the editing service boundary', async () => {
  const storage = await openSqliteKeyValueStore();
  await storage.set(confirmationKey('development', 'mock', 'group-a', 'i1'), JSON.stringify({ confirmedAt: '2026-09-25T02:00:00.000Z' }));
  const edits = service(storage);
  await expect(edits.append('a', 'i1', 'p1', 0, { kind: 'stamp', id: 's1', stamp: 'circle', color: '#111111',
    center: { x: 0.5, y: 0.5 }, size: 0.11 })).rejects.toMatchObject({ code: 'Conflict' });
  await expect(edits.setQuality('a', 'i1', 'p1', 0, 'high')).rejects.toMatchObject({ code: 'Conflict' });
  expect(await edits.load('a', 'i1', 'p1')).toMatchObject({ revision: 0, elements: [] });
});

it('commits an entire editing draft once, survives reopen and rejects a stale completion', async () => {
  const storage = await openSqliteKeyValueStore();
  let edits = service(storage);
  const stroke = { kind: 'stroke' as const, id: 'draft-line', color: '#e53935', width: 0.007,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] };
  expect(await edits.load('a', 'i1', 'p1')).toMatchObject({ revision: 0, elements: [] });
  const saved = await edits.saveDraft('a', 'i1', 'p1', 0, { frame: 'white', quality: 'high', elements: [stroke] });
  expect(saved).toMatchObject({ revision: 1, frame: 'white', quality: 'high', elements: [stroke] });
  mockDriver.reopenDatabase();
  edits = service(await openSqliteKeyValueStore());
  expect(await edits.load('a', 'i1', 'p1')).toMatchObject({ revision: 1, elements: [stroke] });
  await expect(edits.saveDraft('a', 'i1', 'p1', 0, { frame: 'none', quality: 'cheki', elements: [] }))
    .rejects.toMatchObject({ code: 'Conflict' });
  await expect(edits.saveDraft('b', 'i1', 'p1', 0, { frame: 'none', quality: 'cheki', elements: [] }))
    .rejects.toMatchObject({ code: 'NotFound' });
});
