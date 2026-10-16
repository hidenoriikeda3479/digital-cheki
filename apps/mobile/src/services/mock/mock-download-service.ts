import { AppError, toAppError } from '@/core/errors';
import type { AuthService } from '@/services/contracts/auth';
import type { DevicePhotoLibrary, DownloadIntake, DownloadPhoto, DownloadService, DownloadStatus, LocalAlbumActions,
  MockDownloadControls, MockDownloadScenario, PhotoReceivePort } from '@/services/contracts/download';
import type { IdentificationService } from '@/services/contracts/identification';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type MockEnvironment, type StorageNamespace } from '@/storage/namespace';
import { LocalOperationGate } from '../local-operation-gate';
import { MockUploadServer, type UploadReceipt } from './mock-upload-server';

interface Ledger { schemaVersion: 1; fanId: string; photoId: string; status: DownloadStatus; progressPercent: number }

export function createMockDownloadService(deps: { environment: MockEnvironment; storage: KeyValueStore;
  auth: AuthService; identification: IdentificationService; server: MockUploadServer;
  files: PhotoReceivePort; devicePhotoLibrary?: DevicePhotoLibrary; gate: LocalOperationGate }):
  { service: DownloadService; controls: MockDownloadControls; albumActions: LocalAlbumActions } {
  const inFlight = new Set<string>();
  const ownerKinds = new Map<string, 'fan' | 'guest'>();
  function namespace(fanId: string): StorageNamespace {
    const kind = ownerKinds.get(fanId);
    if (!kind) throw new AppError('Forbidden', '受取先を確認できません。');
    return { environment: deps.environment, source: 'mock', owner: { kind, id: fanId } };
  }
  function key(fanId: string, photoId: string) { return `${buildNamespacePrefix(namespace(fanId))}download/photo/${photoId}`; }
  function favoriteKey(fanId: string, photoId: string) { return `${buildNamespacePrefix(namespace(fanId))}album/favorite/${photoId}`; }
  function readKey(fanId: string, intakeId: string) { return `${buildNamespacePrefix(namespace(fanId))}notification/read/${intakeId}`; }
  function scenarioKey(fanId: string, photoId: string) { return `${buildNamespacePrefix(namespace(fanId))}download/scenario/${photoId}`; }
  async function owner(credential: string) {
    const session = await deps.auth.restore(credential);
    if (session.principal.role !== 'fan' && session.principal.role !== 'guest') throw new AppError('Forbidden', '受取画面のみ利用できます。');
    ownerKinds.set(session.principal.id, session.principal.role);
    const recipientRef = await deps.identification.getOwnRecipientRef(credential);
    return { fanId: session.principal.id, recipientRef };
  }
  async function read(fanId: string, photoId: string): Promise<Ledger | null> {
    const raw = await deps.storage.get(key(fanId, photoId));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Ledger;
      if (value.schemaVersion !== 1 || value.fanId !== fanId || value.photoId !== photoId ||
          !['unreceived', 'receiving', 'failed', 'received', 'removed', 'expired'].includes(value.status) ||
          !Number.isFinite(value.progressPercent) || value.progressPercent < 0 || value.progressPercent > 100) throw Error('bad download ledger');
      return value;
    } catch (cause) { throw new AppError('Storage', '受信記録を読み取れません。', { cause }); }
  }
  async function write(value: Ledger) { await deps.storage.set(key(value.fanId, value.photoId), JSON.stringify(value)); }
  async function photoState(fanId: string, recipientRef: string, receipt: UploadReceipt): Promise<DownloadPhoto> {
    const row = await read(fanId, receipt.photoId);
    const file = await deps.files.inspect(namespace(fanId), receipt.photoId);
    const validFile = file?.byteSize === receipt.byteSize ? file : null;
    let status: DownloadStatus;
    if (row?.status === 'removed' || row?.status === 'unreceived') {
      // Older versions wrote an explicit "unreceived" row only when deleting a received copy.
      status = 'removed';
      if (row.status !== 'removed') await write({ ...row, status });
    } else if (row?.status === 'received' && validFile) status = 'received';
    else if ((row?.status === 'receiving' || row?.status === 'failed') && validFile) {
      // A completed copy may precede its SQLite confirmation. Reconcile without a new transfer.
      status = 'received';
      await write({ schemaVersion: 1, fanId, photoId: receipt.photoId, status, progressPercent: 100 });
    } else if (row?.status === 'received') {
      // A missing file cannot erase the fact that this photo was once received.
      status = 'removed';
      await write({ ...row, status });
    } else if (receipt.retention !== 'stored') status = 'expired';
    else if (row?.status === 'receiving') {
      status = 'failed';
      await write({ schemaVersion: 1, fanId, photoId: receipt.photoId, status, progressPercent: row.progressPercent });
    } else status = row?.status ?? 'unreceived';
    const favorite = await deps.storage.get(favoriteKey(fanId, receipt.photoId));
    if (favorite !== null && favorite !== '1') throw new AppError('Storage', 'お気に入り記録が不正です。');
    const previewUri = status === 'unreceived' || status === 'failed'
      ? await deps.server.previewForRecipient(recipientRef, receipt.intakeId, receipt.photoId) : null;
    return { photoId: receipt.photoId, intakeId: receipt.intakeId,
      capturedAt: receipt.capturedAt ?? receipt.uploadedAt, expiresAt: receipt.expiresAt,
      status, progressPercent: status === 'received' ? 100 : row?.progressPercent ?? 0,
      localUri: status === 'received' ? validFile!.uri : null, previewUri, favorite: favorite === '1' };
  }
  async function listFor(fanId: string, recipientRef: string): Promise<DownloadIntake[]> {
    const groups = await deps.server.listForRecipient(recipientRef);
    const items = await Promise.all(groups.map(async ({ notification, receipts }) => ({
      intakeId: notification.intakeId, createdAt: notification.createdAt,
      groupId: notification.groupId, groupName: notification.groupName ?? notification.groupId,
      idolIds: notification.idolIds ?? [], idolNames: notification.idolNames ?? [],
      photos: await Promise.all(receipts.map((receipt) => photoState(fanId, recipientRef, receipt))),
    })));
    items.forEach((item) => item.photos.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)));
    return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  const service: DownloadService = {
    async list(credential) {
      const { fanId, recipientRef } = await owner(credential);
      return deps.gate.run(fanId, () => listFor(fanId, recipientRef));
    },
    async download(credential, intakeId, photoId, onProgress) {
      const { fanId, recipientRef } = await owner(credential);
      const flightKey = `${fanId}/${photoId}`;
      if (inFlight.has(flightKey)) throw new AppError('Conflict', '同じ写真を受信中です。');
      inFlight.add(flightKey);
      try {
        return await deps.gate.run(fanId, async () => {
          const receipt = await deps.server.getForRecipient(recipientRef, intakeId, photoId);
          const current = await photoState(fanId, recipientRef, receipt);
          if (current.status === 'received' || current.status === 'removed') {
            throw new AppError('Conflict', 'この写真は受信済みのため、再受信できません。');
          }
          if (!(await deps.server.available(receipt))) throw new AppError('Expired', '受信期限を過ぎたか、写真を取得できません。');
          const row: Ledger = { schemaVersion: 1, fanId, photoId, status: 'receiving', progressPercent: 0 };
          await write(row);
          let progress = 0;
          try {
            const scenario = await deps.storage.get(scenarioKey(fanId, photoId));
            await deps.files.copy(deps.server.namespace, namespace(fanId), photoId, receipt.byteSize, (percent) => {
              progress = percent;
              onProgress?.(percent);
            }, scenario === 'fail-midway' ? 1 : undefined);
            await write({ ...row, status: 'received', progressPercent: 100 });
          } catch (cause) {
            try { await write({ ...row, status: 'failed', progressPercent: progress }); }
            catch { /* Preserve the receiving row for next-open file reconciliation. */ }
            throw toAppError(cause);
          }
          return listFor(fanId, recipientRef);
        });
      } finally { inFlight.delete(flightKey); }
    },
    async setFavorite(credential, intakeId, photoId, favorite) {
      const { fanId, recipientRef } = await owner(credential);
      if (typeof favorite !== 'boolean') throw new AppError('Validation', 'お気に入り指定が不正です。');
      return deps.gate.run(fanId, async () => {
        const receipt = await deps.server.getForRecipient(recipientRef, intakeId, photoId);
        const photo = await photoState(fanId, recipientRef, receipt);
        if (photo.status !== 'received') throw new AppError('Conflict', '受信済み写真だけをお気に入りにできます。');
        if (favorite) await deps.storage.set(favoriteKey(fanId, photoId), '1');
        else await deps.storage.remove(favoriteKey(fanId, photoId));
        return listFor(fanId, recipientRef);
      });
    },
    async listNotifications(credential) {
      const { fanId, recipientRef } = await owner(credential);
      return deps.gate.run(fanId, async () => {
        const records = await deps.server.listNotificationsForRecipient(recipientRef);
        return Promise.all(records.map(async (item) => {
          const read = await deps.storage.get(readKey(fanId, item.intakeId));
          if (read !== null && read !== '1') throw new AppError('Storage', '通知既読記録が不正です。');
          const count = item.photoIds.length;
          const message = item.idolNames?.length === 1
            ? `${item.idolNames[0]}とのチェキが${count}枚届きました`
            : item.idolNames && item.idolNames.length > 1
              ? `複数名のアイドルとのチェキが${count}枚届きました`
              : `チェキが${count}枚届きました`;
          return { intakeId: item.intakeId, createdAt: item.createdAt, message, read: read === '1' };
        }));
      });
    },
    async markNotificationRead(credential, intakeId) {
      const { fanId, recipientRef } = await owner(credential);
      await deps.gate.run(fanId, async () => {
        const records = await deps.server.listNotificationsForRecipient(recipientRef);
        if (!records.some((item) => item.intakeId === intakeId)) throw new AppError('NotFound', '通知が見つかりません。');
        await deps.storage.set(readKey(fanId, intakeId), '1');
      });
    },
  };
  const controls: MockDownloadControls = {
    async setScenario(credential, intakeId, photoId, scenario: MockDownloadScenario) {
      if (!['normal', 'fail-midway'].includes(scenario)) throw new AppError('Validation', '仮受信の設定が不正です。');
      const { fanId, recipientRef } = await owner(credential);
      await deps.server.getForRecipient(recipientRef, intakeId, photoId);
      await deps.storage.set(scenarioKey(fanId, photoId), scenario);
    },
  };
  const albumActions: LocalAlbumActions = {
    requestSavePermission: () => deps.devicePhotoLibrary?.requestSavePermission() ?? Promise.reject(new AppError('NotImplemented', '写真アプリへの保存を利用できません。')),
    async saveToPhotoLibrary(credential, intakeId, photoId) {
      const { fanId, recipientRef } = await owner(credential);
      await deps.gate.run(fanId, async () => {
        const receipt = await deps.server.getForRecipient(recipientRef, intakeId, photoId);
        const photo = await photoState(fanId, recipientRef, receipt);
        if (photo.status !== 'received' || !photo.localUri) throw new AppError('Conflict', '受信済みの写真だけを保存できます。');
        if (!deps.devicePhotoLibrary) throw new AppError('NotImplemented', '写真アプリへの保存を利用できません。');
        await deps.devicePhotoLibrary.save(photo.localUri);
      });
    },
    async deleteReceived(credential, intakeId, photoId) {
      const { fanId, recipientRef } = await owner(credential);
      return deps.gate.run(fanId, async () => {
        const receipt = await deps.server.getForRecipient(recipientRef, intakeId, photoId);
        const photo = await photoState(fanId, recipientRef, receipt);
        if (photo.status !== 'received' || !photo.localUri) throw new AppError('Conflict', '受信済みの写真だけを削除できます。');
        await deps.storage.remove(favoriteKey(fanId, photoId));
        await deps.files.remove(namespace(fanId), photoId);
        await write({ schemaVersion: 1, fanId, photoId, status: 'removed', progressPercent: 100 });
        return listFor(fanId, recipientRef);
      });
    },
  };
  return { service, controls, albumActions };
}
