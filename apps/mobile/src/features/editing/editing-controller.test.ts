import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { CapturePhoto } from '@/services/contracts/capture';
import type { EditingService, PhotoEdit } from '@/services/contracts/editing';
import { EditingController } from './editing-controller';

const sessions: Record<string, AuthSession> = {
  a: { credential: 'a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' },
  b: { credential: 'b', principal: { id: 'group-b', role: 'group', displayName: 'B' }, expiresAt: '2026-12-01T00:00:00.000Z' },
};
const photo = (id: string): CapturePhoto => ({ id, intakeId: 'i1', capturedAt: '2026-09-25T00:00:00.000Z', width: 800, height: 1200,
  format: 'jpg', originalRef: `photos/${id}.jpg`, thumbnailRef: `photos/thumb-${id}.jpg`, originalUri: `file:///${id}.jpg`, thumbnailUri: `file:///thumb-${id}.jpg` });
const initial = (id: string): PhotoEdit => ({ schemaVersion: 1, photoId: id, intakeId: 'i1', groupId: 'group-a', originalRef: `photos/${id}.jpg`,
  baseWidth: 800, baseHeight: 1200, frame: 'none', quality: 'cheki', elements: [], revision: 0, updatedAt: '2026-09-25T00:00:00.000Z' });

it('keeps edits in memory across photos and writes only when Done is requested', async () => {
  const auth = new AuthController({ signIn: async ({ email }) => email === 'a@example.test' ? sessions.a : sessions.b,
    restore: async (credential) => sessions[credential], signOut: async () => {} },
  { read: async () => null, write: async () => {}, remove: async () => {} });
  const stored = new Map<string, PhotoEdit>();
  const saveDraft = jest.fn<ReturnType<EditingService['saveDraft']>, Parameters<EditingService['saveDraft']>>(
    async (_, __, id, revision, draft) => {
      const saved = { ...initial(id), ...draft, revision: revision + 1 };
      stored.set(id, saved);
      return saved;
    });
  const service: EditingService = { load: async (_, __, id) => stored.get(id) ?? initial(id), saveDraft,
    append: async () => { throw Error('unused'); }, undo: async () => { throw Error('unused'); },
    setFrame: async () => { throw Error('unused'); }, setQuality: async () => { throw Error('unused'); } };
  const controller = new EditingController(auth, service, { next: () => 'line-1' });
  await auth.signIn({ email: 'a@example.test', password: 'x' });
  await controller.open(photo('p1'));
  controller.addStroke([{ x: 0.5, y: 0.5 }], '#111111', 0.007);
  await controller.open(photo('p2'));
  controller.setQuality('high');
  await controller.open(photo('p1'));
  expect(controller.getSnapshot().edit?.elements).toHaveLength(1);
  expect(saveDraft).not.toHaveBeenCalled();
  expect(stored.size).toBe(0);
  expect(await controller.saveDrafts()).toBe(true);
  expect(stored.get('p1')?.elements).toHaveLength(1);
  expect(stored.get('p2')?.quality).toBe('high');
  controller.close();
  await controller.open(photo('p1'));
  expect(controller.getSnapshot().edit?.elements).toHaveLength(1);
});

it('retains a failed draft for retry and ignores an old account save response', async () => {
  const auth = new AuthController({ signIn: async ({ email }) => email === 'a@example.test' ? sessions.a : sessions.b,
    restore: async (credential) => sessions[credential], signOut: async () => {} },
  { read: async () => null, write: async () => {}, remove: async () => {} });
  let finish!: (value: PhotoEdit) => void;
  let fail = true;
  const service: EditingService = { load: async (_, __, id) => initial(id),
    saveDraft: (_, __, id) => fail ? Promise.reject(Error('disk full')) : new Promise((resolve) => { finish = resolve; }),
    append: async () => { throw Error('unused'); }, undo: async () => { throw Error('unused'); },
    setFrame: async () => { throw Error('unused'); }, setQuality: async () => { throw Error('unused'); } };
  const controller = new EditingController(auth, service, { next: () => 'line-1' });
  await auth.signIn({ email: 'a@example.test', password: 'x' });
  await controller.open(photo('p1'));
  controller.addStroke([{ x: 0.5, y: 0.5 }], '#111111', 0.007);
  expect(await controller.saveDrafts()).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ error: 'Storage', busy: false });
  expect(controller.hasUnsavedChanges()).toBe(true);
  fail = false;
  const slow = controller.saveDrafts();
  await auth.signOut();
  await auth.signIn({ email: 'b@example.test', password: 'x' });
  finish({ ...initial('p1'), revision: 1 });
  expect(await slow).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ photo: null, edit: null, busy: false });
});
