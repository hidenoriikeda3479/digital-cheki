import { AppError } from '@/core/errors';
import type { AuthService } from './contracts/auth';
import type { CaptureService } from './contracts/capture';
import type { LocalPhotoManagementService, ManagedIntake } from './contracts/photo-management';
import type { BatchUploadService } from './contracts/batch-upload';
import type { FinishedImageService } from './contracts/finished-image';
import type { IdentificationService } from './contracts/identification';
import type { PhotoFileStore } from '@/storage/photo-file-store';
import type { FinishedImageFiles } from '@/storage/finished-image-files';
import type { StorageEnvironment } from '@/storage/namespace';

// Device warning threshold for mock field testing, not an agreed product limit.
export const PROVISIONAL_LOW_SPACE_BYTES = 200 * 1024 * 1024;

export function createLocalPhotoManagement(deps: { environment: StorageEnvironment; source: 'mock' | 'api';
  auth: AuthService; capture: CaptureService & {
    markLocalDeleting(credential: string, intakeId: string, photoId: string): Promise<void>;
    markLocalDeleted(credential: string, intakeId: string, photoId: string): Promise<void>;
    markLocalDeletingBatch(credential: string, photos: { intakeId: string; photoId: string }[]): Promise<void>;
    markLocalDeletedBatch(credential: string, photos: { intakeId: string; photoId: string }[]): Promise<void>;
  }; identification: IdentificationService; finished: FinishedImageService; upload: BatchUploadService;
  photoFiles: PhotoFileStore; finishedFiles: FinishedImageFiles }): LocalPhotoManagementService {
  const inFlight = new Set<string>();
  const sending = new Set<string>();
  async function group(credential: string) {
    const session = await deps.auth.restore(credential);
    if (session.principal.role !== 'group') throw new AppError('Forbidden', 'グループの端末写真だけ管理できます。');
    return session.principal.id;
  }
  async function list(credential: string) {
    await group(credential);
    const sessions = await deps.capture.listSessions(credential);
    const idols = await deps.identification.listSelectableIdols(credential);
    const confirmed = sessions.filter((item) => item.confirmed);
    const idolNames = new Map(idols.map((idol) => [idol.id, idol.name]));
    const intakes: ManagedIntake[] = [];
    // Bound concurrent intake reads so a growing library does not queue every file and DB lookup at once.
    for (let index = 0; index < confirmed.length; index += 4) {
      const batch = confirmed.slice(index, index + 4);
      intakes.push(...await Promise.all(batch.map(async (session) => {
        const [rows, saved, upload, recipientName] = await Promise.all([
          deps.capture.listPhotos(credential, session.intake.id),
          deps.finished.getSaved(credential, session.intake.id),
          deps.upload.observe(credential, session.intake.id),
          deps.identification.getIntakeRecipientName(credential, session.intake.id),
        ]);
        const savedByPhoto = new Map(saved.map((image) => [image.photoId, image.uri]));
        return { intake: session.intake, recipientName,
          idolNames: session.intake.idolIds.map((id) => idolNames.get(id) ?? id),
          uploadStatus: upload.status,
          photos: rows.map((photo) => ({ photo, displayUri: savedByPhoto.get(photo.id),
            localDeleted: !!photo.localDeleted,
            deletionPending: !!photo.localDeletionPending })) };
      })));
    }
    const available = deps.photoFiles.availableBytes?.();
    return { intakes: intakes.sort((a, b) => Date.parse(b.intake.acceptedAt) - Date.parse(a.intake.acceptedAt)),
      lowSpace: available !== undefined && available < PROVISIONAL_LOW_SPACE_BYTES };
  }
  return { list, async retryUpload(credential, intakeId) {
    const groupId = await group(credential);
    const flight = `${groupId}/${intakeId}`;
    if (sending.has(flight)) throw new AppError('Conflict', 'この受付を送信中です。');
    sending.add(flight);
    try {
      const session = (await deps.capture.listSessions(credential)).find((row) => row.intake.id === intakeId);
      if (!session) throw new AppError('NotFound', '撮影受付が見つかりません。');
      if (!session.confirmed) throw new AppError('Conflict', '送信前に中断した受付は再開できません。新しい撮影受付からやり直してください。');
      if (!session.photoCount) throw new AppError('Validation', '送信する写真がありません。');
      const current = await deps.upload.observe(credential, intakeId);
      if (current.status === 'uploaded') throw new AppError('Conflict', '送信済みの受付です。');
      if (current.status === 'unknown' || current.status === 'sending') return deps.upload.query(credential, intakeId);
      return deps.upload.send(credential, intakeId);
    } finally { sending.delete(flight); }
  }, deleteUploaded(credential, intakeId, photoId) {
    return this.deleteUploadedBatch!(credential, [{ intakeId, photoId }]);
  }, async deleteUploadedBatch(credential, photos) {
    if (photos.length === 0) return;
    const groupId = await group(credential);
    if (inFlight.has(groupId)) throw new AppError('Conflict', '端末写真を削除中です。');
    inFlight.add(groupId);
    try {
      const sessions = new Map((await deps.capture.listSessions(credential)).map((item) => [item.intake.id, item]));
      const selected = new Map<string, { intakeId: string; photoId: string }[]>();
      const ids = new Set<string>();
      for (const item of photos) {
        if (ids.has(item.photoId)) throw new AppError('Validation', '同じ写真が重複しています。');
        ids.add(item.photoId);
        const session = sessions.get(item.intakeId);
        if (!session) throw new AppError('NotFound', '端末写真が見つかりません。');
        if (!session.confirmed) throw new AppError('Forbidden', '送信前の写真は端末写真管理から削除できません。');
        selected.set(item.intakeId, [...selected.get(item.intakeId) ?? [], item]);
      }
      const targets = [] as { intakeId: string; photoId: string; format: 'jpg' | 'png'; pending: boolean }[];
      for (const [intakeId, entries] of selected) {
        const [rows, upload] = await Promise.all([
          deps.capture.listPhotos(credential, intakeId), deps.upload.observe(credential, intakeId),
        ]);
        if (upload.status !== 'uploaded') throw new AppError('Forbidden', 'アップロード未完了の写真は削除できません。');
        const byId = new Map(rows.map((item) => [item.id, item]));
        for (const entry of entries) {
          const target = byId.get(entry.photoId);
          if (!target) throw new AppError('NotFound', '端末写真が見つかりません。');
          if (target.localDeleted && !target.localDeletionPending) throw new AppError('Conflict', '端末から削除済みです。');
          targets.push({ ...entry, format: target.format, pending: !!target.localDeletionPending });
        }
      }
      const toMark = targets.filter((item) => !item.pending);
      if (toMark.length) await deps.capture.markLocalDeletingBatch(credential, toMark);
      const namespace = { environment: deps.environment, source: deps.source, owner: { kind: 'group' as const, id: groupId } };
      for (const item of targets) await deps.photoFiles.remove(namespace, item.photoId, item.format);
      if (deps.finishedFiles.removePhotos) await deps.finishedFiles.removePhotos(namespace, targets.map((item) => item.photoId));
      else for (const item of targets) await deps.finishedFiles.removePhoto(namespace, item.photoId);
      await deps.capture.markLocalDeletedBatch(credential, targets);
    } finally { inFlight.delete(groupId); }
  } };
}
