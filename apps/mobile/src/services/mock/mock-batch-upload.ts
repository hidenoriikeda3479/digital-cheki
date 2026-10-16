import { AppError, toAppError } from '@/core/errors';
import type { AuthService } from '@/services/contracts/auth';
import type { BatchUploadService, BatchUploadSnapshot, BatchUploadStatus } from '@/services/contracts/batch-upload';
import type { CaptureService } from '@/services/contracts/capture';
import type { FinishedImageService, SendPreview } from '@/services/contracts/finished-image';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type MockEnvironment } from '@/storage/namespace';
import { MockUploadServer } from './mock-upload-server';

interface Ledger { schemaVersion: 1; groupId: string; intakeId: string; status: BatchUploadStatus; failureCount: number }
const inFlight = new Set<string>();

/** The app persists only an intake outcome. Photo receipts on the mock server provide idempotency and seven-day expiry. */
export function createMockBatchUpload(deps: { environment: MockEnvironment; storage: KeyValueStore;
  auth: AuthService; capture: CaptureService; finished: FinishedImageService; server: MockUploadServer }): BatchUploadService {
  function key(groupId: string, intakeId: string) {
    return `${buildNamespacePrefix({ environment: deps.environment, source: 'mock',
      owner: { kind: 'group', id: groupId } })}upload-batch/${intakeId}`;
  }
  async function confirmed(credential: string, intakeId: string): Promise<SendPreview> {
    const session = await deps.auth.restore(credential);
    if (session.principal.role !== 'group') throw new AppError('Forbidden', 'グループだけが写真を送信できます。');
    const preview = await deps.finished.prepare(credential, intakeId);
    if (preview.intake.groupId !== session.principal.id) throw new AppError('Forbidden', '別グループの受付です。');
    if (!preview.confirmedAt || !preview.images.length)
      throw new AppError('Conflict', '完成画像の確定が必要です。');
    return preview;
  }
  async function read(preview: SendPreview): Promise<Ledger> {
    const raw = await deps.storage.get(key(preview.intake.groupId, preview.intake.id));
    if (raw === null) return { schemaVersion: 1, groupId: preview.intake.groupId, intakeId: preview.intake.id,
      status: 'unsent', failureCount: 0 };
    try {
      const value = JSON.parse(raw) as Ledger;
      if (value.schemaVersion !== 1 || value.groupId !== preview.intake.groupId ||
        value.intakeId !== preview.intake.id || !['unsent', 'sending', 'failed', 'unknown', 'uploaded'].includes(value.status) ||
        !Number.isSafeInteger(value.failureCount) || value.failureCount < 0) throw Error('invalid batch ledger');
      return value;
    } catch (cause) { throw new AppError('Storage', '撮影受付の送信状態を読み取れません。', { cause }); }
  }
  async function write(value: Ledger) { await deps.storage.set(key(value.groupId, value.intakeId), JSON.stringify(value)); }
  async function receipts(preview: SendPreview) {
    return Promise.all(preview.images.map((image) => deps.server.lookup(preview.intake.groupId, preview.intake.id, image.photoId)));
  }
  async function reconcile(preview: SendPreview, resolveUnknown: boolean): Promise<BatchUploadSnapshot> {
    const ledger = await read(preview);
    const results = await receipts(preview);
    const allReceived = results.every(Boolean);
    const status: BatchUploadStatus = allReceived ? 'uploaded'
      : ledger.status === 'sending' ? 'unknown'
        : ledger.status === 'unknown' && resolveUnknown ? 'failed'
          : ledger.status === 'unsent' && results.some(Boolean) ? 'failed' : ledger.status;
    if (status !== ledger.status) await write({ ...ledger, status });
    if (allReceived) await deps.server.notification(preview.intake.groupId, preview.intake.id,
      preview.intake.recipientRef, preview.images.map((image) => image.photoId));
    return { intakeId: preview.intake.id, status, photoCount: preview.images.length, failureCount: ledger.failureCount };
  }
  return {
    async observe(credential, intakeId) { return reconcile(await confirmed(credential, intakeId), false); },
    async query(credential, intakeId) { return reconcile(await confirmed(credential, intakeId), true); },
    async send(credential, intakeId) {
      const preview = await confirmed(credential, intakeId);
      const flight = `${preview.intake.groupId}/${intakeId}`;
      if (inFlight.has(flight)) throw new AppError('Conflict', 'この受付を送信中です。');
      inFlight.add(flight);
      try {
        const current = await reconcile(preview, false);
        if (current.status === 'uploaded') throw new AppError('Conflict', '送信済みの受付です。');
        if (current.status === 'unknown') throw new AppError('UnknownOutcome', '先に送信結果を照会してください。');
        const ledger = await read(preview);
        await write({ ...ledger, status: 'sending' });
        try {
          const captured = await deps.capture.listPhotos(credential, intakeId);
          for (const image of preview.images) {
            const existing = await deps.server.lookup(preview.intake.groupId, intakeId, image.photoId);
            if (existing) continue;
            const photo = captured.find((row) => row.id === image.photoId);
            if (!photo || !image.uri) throw new AppError('NotFound', '撮影済み写真が見つかりません。');
            await deps.server.send({ groupId: preview.intake.groupId, intakeId, photoId: image.photoId,
              recipientRef: preview.intake.recipientRef, sourceUri: image.uri, byteSize: image.byteSize,
              capturedAt: photo.capturedAt, confirmedFailures: ledger.failureCount });
          }
          const result = await reconcile(preview, false);
          if (result.status !== 'uploaded') throw new AppError('Storage', 'すべての写真の保存を確認できません。');
          return result;
        } catch (cause) {
          const error = toAppError(cause);
          const failed: Ledger = { ...ledger, status: error.code === 'UnknownOutcome' ? 'unknown' : 'failed',
            failureCount: error.code === 'UnknownOutcome' ? ledger.failureCount : ledger.failureCount + 1 };
          await write(failed);
          return { intakeId, status: failed.status, photoCount: preview.images.length, failureCount: failed.failureCount };
        }
      } finally { inFlight.delete(flight); }
    },
  };
}
