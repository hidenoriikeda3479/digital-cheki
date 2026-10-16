import { AppError, toAppError } from '@/core/errors';
import type { AuthService } from '@/services/contracts/auth';
import type { CaptureService } from '@/services/contracts/capture';
import type { FinishedImageService, SendPreview } from '@/services/contracts/finished-image';
import type { MockUploadControls, MockUploadScenario, UploadPhotoState, UploadService, UploadSnapshot } from '@/services/contracts/upload';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type MockEnvironment } from '@/storage/namespace';
import { LocalOperationGate } from '../local-operation-gate';
import { MockUploadServer } from './mock-upload-server';

interface Ledger { schemaVersion: 1; groupId: string; intakeId: string; photos: UploadPhotoState[] }
const unsent = (photoId: string): UploadPhotoState => ({ photoId, status: 'unsent', progressPercent: 0,
  failureCount: 0, uploadedAt: null, expiresAt: null, retention: null });

export function createMockUploadService(deps: { environment: MockEnvironment; storage: KeyValueStore;
  auth: AuthService; capture: CaptureService; finished: FinishedImageService; server: MockUploadServer; gate: LocalOperationGate }):
  { service: UploadService; controls: MockUploadControls } {
  const inFlight = new Set<string>();
  function key(groupId: string, intakeId: string) {
    return `${buildNamespacePrefix({ environment: deps.environment, source: 'mock', owner: { kind: 'group', id: groupId } })}upload-intake/${intakeId}`;
  }
  async function preview(credential: string, intakeId: string): Promise<SendPreview> {
    const result = await deps.finished.prepare(credential, intakeId);
    if (!result.confirmedAt || !result.images.length) throw new AppError('Conflict', '送信対象を確定してください。');
    return result;
  }
  async function read(groupId: string, intakeId: string, confirmed: SendPreview): Promise<Ledger> {
    const raw = await deps.storage.get(key(groupId, intakeId));
    if (!raw) return { schemaVersion: 1, groupId, intakeId, photos: confirmed.images.map((image) => unsent(image.photoId)) };
    try {
      const value = JSON.parse(raw) as Ledger;
      if (value.schemaVersion !== 1 || value.groupId !== groupId || value.intakeId !== intakeId ||
        !Array.isArray(value.photos) || value.photos.length !== confirmed.images.length ||
        value.photos.some((row, index) => row.photoId !== confirmed.images[index].photoId ||
          !['unsent', 'transferring', 'failed', 'needs-attention', 'uploaded', 'unknown'].includes(row.status) ||
          !Number.isSafeInteger(row.failureCount) || row.failureCount < 0 ||
          !Number.isFinite(row.progressPercent) || row.progressPercent < 0 || row.progressPercent > 100)) throw Error('invalid upload ledger');
      return value;
    } catch (cause) { throw new AppError('Storage', '送信状態を読み取れません。', { cause }); }
  }
  async function write(value: Ledger) { await deps.storage.set(key(value.groupId, value.intakeId), JSON.stringify(value)); }
  async function snapshot(confirmed: SendPreview, resolveMissing: string | null = null): Promise<UploadSnapshot> {
    const groupId = confirmed.intake.groupId;
    const intakeId = confirmed.intake.id;
    const ledger = await read(groupId, intakeId, confirmed);
    const updated: UploadPhotoState[] = [];
    for (const row of ledger.photos) {
      const receipt = await deps.server.lookup(groupId, intakeId, row.photoId);
      if (receipt) {
        updated.push({ ...row, status: 'uploaded', progressPercent: 100, uploadedAt: receipt.uploadedAt,
          expiresAt: receipt.expiresAt, retention: receipt.retention });
      } else if (row.status === 'transferring' || row.status === 'unknown') {
        updated.push({ ...row, status: row.photoId === resolveMissing ? 'failed' : 'unknown' });
      } else updated.push(row);
    }
    await write({ ...ledger, photos: updated });
    const notification = await deps.server.notification(groupId, intakeId, confirmed.intake.recipientRef,
      confirmed.images.map((image) => image.photoId));
    return { intakeId, photos: updated, notificationCreated: notification !== null };
  }
  const service: UploadService = {
    async observe(credential, intakeId) {
      const confirmed = await preview(credential, intakeId);
      return deps.gate.run(confirmed.intake.groupId, () => snapshot(confirmed));
    },
    async start(credential, intakeId, photoId, onProgress) {
      const confirmed = await preview(credential, intakeId);
      const photo = confirmed.images.find((item) => item.photoId === photoId);
      if (!photo) throw new AppError('NotFound', '送信対象の写真が見つかりません。');
      if (inFlight.has(photoId)) throw new AppError('Conflict', 'この写真を送信中です。');
      inFlight.add(photoId);
      try {
        return await deps.gate.run(confirmed.intake.groupId, async () => {
          const current = await snapshot(confirmed);
          const row = current.photos.find((item) => item.photoId === photoId)!;
          if (row.status === 'uploaded') throw new AppError('Conflict', 'アップロード済み写真は再送できません。');
          if (row.status === 'unknown') throw new AppError('UnknownOutcome', '同じ写真IDの状態を照会してください。');
          let progress = 0;
          const ledger = await read(confirmed.intake.groupId, intakeId, confirmed);
          await write({ ...ledger, photos: ledger.photos.map((item) => item.photoId === photoId
            ? { ...item, status: 'transferring', progressPercent: 0 } : item) });
          try {
            const captured = (await deps.capture.listPhotos(credential, intakeId)).find((item) => item.id === photoId);
            if (!captured) throw new AppError('NotFound', '撮影済み写真が見つかりません。');
            await deps.server.send({ groupId: confirmed.intake.groupId, intakeId, photoId,
              recipientRef: confirmed.intake.recipientRef, sourceUri: photo.uri, byteSize: photo.byteSize,
              capturedAt: captured.capturedAt,
              confirmedFailures: row.failureCount }, (percent) => { progress = percent; onProgress?.(percent); });
          } catch (cause) {
            const error = toAppError(cause);
            const latest = await read(confirmed.intake.groupId, intakeId, confirmed);
            const failed = { ...latest, photos: latest.photos.map((item): UploadPhotoState => item.photoId === photoId ? {
              ...item, status: error.code === 'UnknownOutcome' ? 'unknown'
                : item.failureCount + 1 >= 3 ? 'needs-attention' : 'failed',
              progressPercent: progress, failureCount: error.code === 'UnknownOutcome' ? item.failureCount : item.failureCount + 1,
            } : item) };
            await write(failed);
            return { intakeId, photos: failed.photos, notificationCreated: false };
          }
          return snapshot(confirmed);
        });
      } finally { inFlight.delete(photoId); }
    },
    async query(credential, intakeId, photoId) {
      const confirmed = await preview(credential, intakeId);
      if (!confirmed.images.some((item) => item.photoId === photoId)) throw new AppError('NotFound', '送信対象の写真が見つかりません。');
      return deps.gate.run(confirmed.intake.groupId, () => snapshot(confirmed, photoId));
    },
  };
  const controls: MockUploadControls = {
    async setScenario(credential, intakeId, photoId, scenario: MockUploadScenario) {
      const confirmed = await preview(credential, intakeId);
      if (!confirmed.images.some((item) => item.photoId === photoId)) throw new AppError('NotFound', '写真が見つかりません。');
      await deps.server.setScenario(photoId, scenario);
    },
    async advanceDays(credential, days) {
      const session = await deps.auth.restore(credential);
      if (session.principal.role !== 'group') throw new AppError('Forbidden', 'グループのみ確認できます。');
      await deps.server.advanceDays(days);
    },
  };
  return { service, controls };
}
