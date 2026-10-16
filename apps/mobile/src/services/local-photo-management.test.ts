import type { AuthService, AuthSession } from './contracts/auth';
import type { CaptureService } from './contracts/capture';
import type { IdentificationService } from './contracts/identification';
import type { FinishedImageService, SendPreview } from './contracts/finished-image';
import type { BatchUploadService, BatchUploadSnapshot } from './contracts/batch-upload';
import type { PhotoFileStore } from '@/storage/photo-file-store';
import type { FinishedImageFiles } from '@/storage/finished-image-files';
import { createLocalPhotoManagement } from './local-photo-management';

const session: AuthSession = { credential: 'group-token', principal: { id: 'group-a', role: 'group', displayName: 'A' },
  expiresAt: '2026-12-01T00:00:00.000Z' };
const intake = { id: 'intake-a', groupId: 'group-a', recipientRef: 'recipient-a', idolIds: ['idol-a'],
  acceptedAt: '2026-09-25T00:00:00.000Z' };
const photo = { id: 'photo-a', intakeId: intake.id, capturedAt: intake.acceptedAt, width: 800, height: 1200,
  format: 'jpg' as const, originalRef: 'photos/a.jpg', thumbnailRef: 'photos/thumb-a.jpg',
  originalUri: 'file:///a.jpg', thumbnailUri: 'file:///thumb-a.jpg' };
const preview: SendPreview = { intake, idolNames: ['アイドルA'], recipientLabel: '受取人1人',
  confirmedAt: null, images: [{ photoId: photo.id, editRevision: 0, quality: 'cheki', width: 800, height: 1200,
    byteSize: 1000, relativeRef: 'finished/a.jpg', uri: 'file:///finished-a.jpg', generatedAt: intake.acceptedAt }] };

function setup(confirmed: boolean, initial: BatchUploadSnapshot['status'], overrides?: {
  listSessions?: CaptureService['listSessions']; listPhotos?: CaptureService['listPhotos'];
}) {
  const auth: AuthService = { signIn: async () => session, restore: async (credential) => {
    if (credential !== session.credential) throw Error('unauthorized'); return session;
  }, signOut: async () => {} };
  const capture: CaptureService & {
    markLocalDeleting(credential: string, intakeId: string, photoId: string): Promise<void>;
    markLocalDeleted(credential: string, intakeId: string, photoId: string): Promise<void>;
    markLocalDeletingBatch(credential: string, photos: { intakeId: string; photoId: string }[]): Promise<void>;
    markLocalDeletedBatch(credential: string, photos: { intakeId: string; photoId: string }[]): Promise<void>;
  } = { listSessions: overrides?.listSessions ?? (async () => [{ intake, photoCount: 1, needsAttention: false, confirmed }]),
    listPhotos: overrides?.listPhotos ?? (async () => [photo]), savePhoto: async () => photo, discardPhoto: async () => {},
    markLocalDeleting: async () => {}, markLocalDeleted: async () => {},
    markLocalDeletingBatch: async () => {}, markLocalDeletedBatch: async () => {} };
  const identification: IdentificationService = { getIntakeRecipientName: async () => 'テストファンA', getOwnIdentity: async () => { throw Error('unused'); },
    getOwnRecipientRef: async () => { throw Error('unused'); }, resolveQr: async () => null, resolveNumber: async () => null,
    listTrendingIdols: async () => [], listPickupIdols: async () => [], listSelectableIdols: async () => [{ id: 'idol-a', name: 'アイドルA' }],
    saveIntake: async () => intake, getLatestIntake: async () => intake, listIntakes: async () => [intake] };
  const confirm = jest.fn(async () => ({ ...preview, confirmedAt: intake.acceptedAt }));
  const finished: FinishedImageService = { prepare: async () => preview, confirm,
    getSaved: async () => preview.images, isConfirmed: async () => confirmed };
  const snapshot = (status: BatchUploadSnapshot['status']): BatchUploadSnapshot =>
    ({ intakeId: intake.id, status, photoCount: 1, failureCount: 0 });
  const observe = jest.fn(async () => snapshot(initial));
  const send = jest.fn(async () => snapshot('uploaded'));
  const query = jest.fn(async () => snapshot('failed'));
  const upload: BatchUploadService = { observe, send, query };
  const photoFiles: PhotoFileStore = { sourceSize: async () => 0, persist: async () => {}, recover: async () => false,
    references: () => ({ originalUri: photo.originalUri, thumbnailUri: photo.thumbnailUri }), remove: async () => {} };
  const finishedFiles: FinishedImageFiles = { readOriginal: async () => new Uint8Array(), inspect: async () => null,
    persist: async () => { throw Error('unused'); }, removePhoto: async () => {} };
  const manage = createLocalPhotoManagement({ environment: 'development', source: 'mock', auth, capture, identification,
    finished, upload, photoFiles, finishedFiles });
  return { manage, confirm, observe, send, query, capture, photoFiles, finishedFiles, finished };
}

it('deletes selected device photos with one intake read and one ledger transition per phase', async () => {
  const second = { ...photo, id: 'photo-b' };
  const listPhotos = jest.fn(async () => [photo, second]);
  const { manage, capture, observe, photoFiles, finishedFiles, finished } = setup(true, 'uploaded', { listPhotos });
  const markDeleting = jest.spyOn(capture, 'markLocalDeletingBatch');
  const markDeleted = jest.spyOn(capture, 'markLocalDeletedBatch');
  const removeOriginal = jest.spyOn(photoFiles, 'remove');
  const removeFinished = jest.spyOn(finishedFiles, 'removePhoto');
  const readFinished = jest.spyOn(finished, 'getSaved');
  await manage.deleteUploadedBatch?.(session.credential, [
    { intakeId: intake.id, photoId: photo.id }, { intakeId: intake.id, photoId: second.id },
  ]);
  expect(listPhotos).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(readFinished).not.toHaveBeenCalled();
  expect(markDeleting).toHaveBeenCalledTimes(1);
  expect(markDeleted).toHaveBeenCalledTimes(1);
  expect(removeOriginal).toHaveBeenCalledTimes(2);
  expect(removeFinished).toHaveBeenCalledTimes(2);
});

it('rejects an unuploaded batch before marking or removing device files', async () => {
  const { manage, capture, photoFiles } = setup(true, 'failed');
  const markDeleting = jest.spyOn(capture, 'markLocalDeletingBatch');
  const remove = jest.spyOn(photoFiles, 'remove');
  await expect(manage.deleteUploadedBatch?.(session.credential, [{ intakeId: intake.id, photoId: photo.id }]))
    .rejects.toMatchObject({ code: 'Forbidden' });
  expect(markDeleting).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it('does not expose or send an intake abandoned before confirmation', async () => {
  const { manage, confirm, send } = setup(false, 'unsent');
  expect((await manage.list(session.credential)).intakes).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  await expect(manage.retryUpload(session.credential, intake.id)).rejects.toMatchObject({ code: 'Conflict' });
  expect(confirm).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it('keeps a confirmed failed upload visible for manual retry', async () => {
  const { manage, send } = setup(true, 'failed');
  expect((await manage.list(session.credential)).intakes[0]).toMatchObject({ uploadStatus: 'failed',
    recipientName: 'テストファンA', idolNames: ['アイドルA'], photos: [{ photo: { id: 'photo-a' }, displayUri: 'file:///finished-a.jpg' }] });
  expect(await manage.retryUpload(session.credential, intake.id)).toMatchObject({ status: 'uploaded' });
  expect(send).toHaveBeenCalledWith(session.credential, intake.id);
});

it('starts another intake lookup before the first photo lookup finishes', async () => {
  const second = { ...intake, id: 'intake-b' };
  let release!: (photos: typeof photo[]) => void;
  const listPhotos = jest.fn(async (_credential: string, id: string) => id === intake.id
    ? new Promise<typeof photo[]>((resolve) => { release = resolve; })
    : [{ ...photo, id: 'photo-b', intakeId: second.id }]);
  const { manage } = setup(true, 'uploaded', {
    listSessions: async () => [intake, second].map((row) => ({ intake: row, photoCount: 1,
      needsAttention: false, confirmed: true })),
    listPhotos,
  });
  const pending = manage.list(session.credential);
  for (let index = 0; index < 20 && !release; index++) await Promise.resolve();
  const secondStarted = listPhotos.mock.calls.some((call) => call[1] === second.id);
  release([photo]);
  await pending;
  expect(secondStarted).toBe(true);
});

it('queries an unknown result without starting a duplicate send and rejects another group', async () => {
  const { manage, query, send } = setup(true, 'unknown');
  expect(await manage.retryUpload(session.credential, intake.id)).toMatchObject({ status: 'failed' });
  expect(query).toHaveBeenCalledWith(session.credential, intake.id);
  expect(send).not.toHaveBeenCalled();
  await expect(manage.retryUpload('other-group', intake.id)).rejects.toThrow('unauthorized');
});
