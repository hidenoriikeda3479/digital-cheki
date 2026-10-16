import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { CapturePhoto, CaptureService } from '@/services/contracts/capture';
import type { CaptureIntake } from '@/services/contracts/identification';

import { CaptureController } from './capture-controller';

const groupA: AuthSession = { credential: 'group-a-token', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const groupB: AuthSession = { credential: 'group-b-token', principal: { id: 'group-b', role: 'group', displayName: 'B' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const intake: CaptureIntake = { id: 'intake-a', groupId: 'group-a', recipientRef: 'person-a', idolIds: ['idol-a'], acceptedAt: '2026-09-25T00:00:00.000Z' };
const photo: CapturePhoto = { id: 'photo-1', intakeId: intake.id, capturedAt: '2026-09-25T01:00:00.000Z', width: 1200, height: 800, format: 'jpg',
  originalRef: 'photos/photo-1.jpg', thumbnailRef: 'photos/thumb-1.jpg', originalUri: 'file:///original.jpg', thumbnailUri: 'file:///thumb.jpg' };

it('blocks capture double press and drops a late result after switching groups', async () => {
  let credential: string | null = null;
  const auth = new AuthController({
    signIn: async ({ email }) => email.includes('group-b') ? groupB : groupA,
    restore: async (value) => value === groupB.credential ? groupB : groupA,
    signOut: async () => {},
  }, { read: async () => credential, write: async (value) => { credential = value; }, remove: async () => { credential = null; } });
  let finish!: (value: CapturePhoto) => void;
  const savePhoto = jest.fn(() => new Promise<CapturePhoto>((resolve) => { finish = resolve; }));
  const service: CaptureService = {
    listSessions: async (value) => value === groupA.credential ? [{ intake, photoCount: 0, needsAttention: false }] : [],
    listPhotos: async () => [], savePhoto, discardPhoto: async () => {},
  };
  const controller = new CaptureController(auth, service);
  await auth.signIn({ email: 'group-a@example.test', password: 'x' });
  await controller.initialize();
  await controller.openIntake(intake.id);
  expect(controller.getSnapshot().phase).toBe('camera');
  const first = controller.capture({ uri: 'file:///camera.jpg', width: 1200, height: 800, format: 'jpg' });
  const duplicate = controller.capture({ uri: 'file:///camera.jpg', width: 1200, height: 800, format: 'jpg' });
  await duplicate;
  expect(savePhoto).toHaveBeenCalledTimes(1);
  await auth.signOut();
  await auth.signIn({ email: 'group-b@example.test', password: 'x' });
  await controller.initialize();
  finish(photo);
  await first;
  expect(controller.getSnapshot()).toMatchObject({ phase: 'home', intakeId: null, photos: [] });
});

it('restores review photos for an existing intake without creating a second photo', async () => {
  const auth = new AuthController({ signIn: async () => groupA, restore: async () => groupA, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const savePhoto = jest.fn(async () => photo);
  const controller = new CaptureController(auth, {
    listSessions: async () => [{ intake, photoCount: 1, needsAttention: false }],
    listPhotos: async () => [photo], savePhoto, discardPhoto: async () => {},
  });
  await auth.signIn({ email: 'group-a@example.test', password: 'x' });
  await controller.initialize();
  await controller.openIntake(intake.id);
  expect(controller.getSnapshot()).toMatchObject({ phase: 'review', photos: [photo] });
  expect(savePhoto).not.toHaveBeenCalled();
});

it('forgets the active intake on returning home without listing old sessions', async () => {
  const auth = new AuthController({ signIn: async () => groupA, restore: async () => groupA, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const listSessions = jest.fn(async () => [{ intake, photoCount: 1, needsAttention: false, confirmed: false }]);
  const controller = new CaptureController(auth, {
    listSessions,
    listPhotos: async () => [photo], savePhoto: async () => { throw Error('unused'); }, discardPhoto: async () => {},
  });
  await auth.signIn({ email: 'group-a@example.test', password: 'x' });
  await controller.initialize();
  expect(listSessions).not.toHaveBeenCalled();
  await controller.openIntake(intake.id);
  expect(listSessions).toHaveBeenCalledTimes(1);
  controller.goHome();
  expect(controller.getSnapshot()).toMatchObject({ phase: 'home', intakeId: null, photos: [] });
  expect(listSessions).toHaveBeenCalledTimes(1);
});

it('keeps the camera open and does not count a failed save', async () => {
  const auth = new AuthController({ signIn: async () => groupA, restore: async () => groupA, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const controller = new CaptureController(auth, {
    listSessions: async () => [{ intake, photoCount: 0, needsAttention: false }], listPhotos: async () => [],
    savePhoto: async () => { throw new Error('disk full'); }, discardPhoto: async () => {},
  });
  await auth.signIn({ email: 'group-a@example.test', password: 'x' });
  await controller.initialize();
  await controller.openIntake(intake.id);
  await controller.capture({ uri: 'file:///cache.jpg', width: 800, height: 1200, format: 'jpg' });
  expect(controller.getSnapshot()).toMatchObject({ phase: 'review', busy: false, error: 'Storage', photos: [] });
  controller.openCamera();
  expect(controller.getSnapshot().phase).toBe('review');
});
