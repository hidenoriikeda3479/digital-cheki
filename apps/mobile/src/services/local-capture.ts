import { AppError, toAppError } from '@/core/errors';
import { currentInstant, type Clock, type IdGenerator } from '@/core/values';
import type { AuthService } from '@/services/contracts/auth';
import type { CapturePhoto, CaptureService } from '@/services/contracts/capture';
import type { IdentificationService } from '@/services/contracts/identification';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type StorageEnvironment, type StorageNamespace } from '@/storage/namespace';
import type { PhotoFileStore } from '@/storage/photo-file-store';
import { LocalOperationGate } from './local-operation-gate';
import { assertUnconfirmed, confirmationKey, isIntakeConfirmed } from './confirmation-lock';

type Stage = 'copying' | 'ready' | 'discarding' | 'missing' | 'deleting-local' | 'locally-deleted';
interface Row {
  id: string; intakeId: string; groupId: string; capturedAt: string;
  width: number; height: number; expectedBytes: number;
  format: 'jpg' | 'png';
  originalRef: string; thumbnailRef: string; stage: Stage; sourceUri: string;
}
interface Ledger { schemaVersion: 1; records: Row[] }

function decode(raw: string | null): Ledger {
  if (raw === null) return { schemaVersion: 1, records: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
        !('records' in value) || !Array.isArray(value.records) ||
        !value.records.every((row: unknown) => row && typeof row === 'object' &&
          'id' in row && typeof row.id === 'string' &&
          'intakeId' in row && typeof row.intakeId === 'string' &&
          'groupId' in row && typeof row.groupId === 'string' &&
          'capturedAt' in row && typeof row.capturedAt === 'string' &&
          'width' in row && Number.isSafeInteger(row.width) && Number(row.width) > 0 &&
          'height' in row && Number.isSafeInteger(row.height) && Number(row.height) > 0 &&
          'expectedBytes' in row && Number.isSafeInteger(row.expectedBytes) && Number(row.expectedBytes) > 0 &&
          'format' in row && (row.format === 'jpg' || row.format === 'png') &&
          'originalRef' in row && typeof row.originalRef === 'string' &&
          'thumbnailRef' in row && typeof row.thumbnailRef === 'string' &&
          'sourceUri' in row && typeof row.sourceUri === 'string' &&
          'stage' in row && ['copying', 'ready', 'discarding', 'missing', 'deleting-local', 'locally-deleted'].includes(String(row.stage)))) {
      throw new Error('invalid capture ledger');
    }
    return value as Ledger;
  } catch (cause) { throw new AppError('Storage', '写真の保存記録を読み取れません。', { cause }); }
}

export function createLocalCaptureService(deps: {
  environment: StorageEnvironment; source: 'mock' | 'api'; storage: KeyValueStore;
  files: PhotoFileStore; auth: AuthService; identification: IdentificationService;
  clock: Clock; ids: IdGenerator;
  gate?: LocalOperationGate;
}): CaptureService & { markLocalDeleting(credential: string, intakeId: string, photoId: string): Promise<void>;
  markLocalDeleted(credential: string, intakeId: string, photoId: string): Promise<void>;
  markLocalDeletingBatch(credential: string, photos: { intakeId: string; photoId: string }[]): Promise<void>;
  markLocalDeletedBatch(credential: string, photos: { intakeId: string; photoId: string }[]): Promise<void> } {
  const queues = new Map<string, Promise<unknown>>();
  const gate = deps.gate ?? new LocalOperationGate();
  function namespace(groupId: string): StorageNamespace {
    return { environment: deps.environment, source: deps.source, owner: { kind: 'group', id: groupId } };
  }
  function key(groupId: string) { return `${buildNamespacePrefix(namespace(groupId))}capture-photos`; }
  function serial<T>(groupId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(groupId) ?? Promise.resolve();
    const next = previous.then(operation);
    queues.set(groupId, next.catch(() => undefined));
    return next;
  }
  async function read(groupId: string) {
    try { return decode(await deps.storage.get(key(groupId))); }
    catch (cause) { throw toAppError(cause, 'Storage'); }
  }
  async function write(groupId: string, ledger: Ledger) {
    try { await deps.storage.set(key(groupId), JSON.stringify(ledger)); }
    catch (cause) { throw toAppError(cause, 'Storage'); }
  }
  async function group(credential: string): Promise<string> {
    const session = await deps.auth.restore(credential);
    if (session.principal.role !== 'group') throw new AppError('Forbidden', '撮影はグループのみ利用できます。');
    return session.principal.id;
  }
  async function intake(credential: string, intakeId: string, groupId: string) {
    const found = (await deps.identification.listIntakes(credential)).find((item) => item.id === intakeId && item.groupId === groupId);
    if (!found) throw new AppError('Forbidden', 'この撮影受付を利用できません。');
    return found;
  }
  async function restore(groupId: string): Promise<Ledger> {
    const ledger = await read(groupId);
    let changed = false;
    const records: Row[] = [];
    for (const row of ledger.records) {
      if (row.groupId !== groupId) throw new AppError('Storage', '写真の所有者が一致しません。');
      if (row.stage === 'discarding') {
        await deps.files.remove(namespace(groupId), row.id, row.format);
        changed = true;
        continue;
      }
      if (row.stage === 'deleting-local' || row.stage === 'locally-deleted') {
        records.push(row);
        continue;
      }
      const complete = await deps.files.recover(namespace(groupId), row.id, row.sourceUri,
        row.width, row.height, row.expectedBytes, row.format);
      const stage: Stage = complete ? 'ready' : row.stage === 'ready' ? 'missing' : row.stage;
      const sourceUri = complete ? '' : row.sourceUri;
      if (stage !== row.stage || sourceUri !== row.sourceUri) changed = true;
      records.push({ ...row, stage, sourceUri });
    }
    const next = { ...ledger, records };
    if (changed) await write(groupId, next);
    return next;
  }
  function present(groupId: string, row: Row): CapturePhoto {
    const refs = deps.files.references(namespace(groupId), row.id, row.format);
    return { id: row.id, intakeId: row.intakeId, capturedAt: row.capturedAt, width: row.width, height: row.height, format: row.format,
      localDeleted: row.stage === 'deleting-local' || row.stage === 'locally-deleted',
      localDeletionPending: row.stage === 'deleting-local',
      originalRef: row.originalRef, thumbnailRef: row.thumbnailRef, ...refs };
  }
  async function markBatch(credential: string, photos: { intakeId: string; photoId: string }[],
    expected: Stage[], next: Stage) {
    if (photos.length === 0) return;
    const groupId = await group(credential);
    const intakes = await deps.identification.listIntakes(credential);
    const owned = new Set(intakes.filter((item) => item.groupId === groupId).map((item) => item.id));
    if (photos.some((item) => !owned.has(item.intakeId))) throw new AppError('Forbidden', 'この撮影受付を利用できません。');
    const selected = new Map<string, string>();
    for (const item of photos) {
      if (selected.has(item.photoId)) throw new AppError('Validation', '同じ写真が重複しています。');
      selected.set(item.photoId, item.intakeId);
    }
    await gate.run(groupId, async () => serial(groupId, async () => {
      const ledger = await restore(groupId);
      for (const [photoId, intakeId] of selected) {
        const row = ledger.records.find((item) => item.id === photoId && item.intakeId === intakeId);
        if (!row || !expected.includes(row.stage)) throw new AppError('Conflict', 'この写真は端末から削除できません。');
      }
      await write(groupId, { ...ledger, records: ledger.records.map((row) => selected.get(row.id) === row.intakeId
        ? { ...row, stage: next } : row) });
    }));
  }
  return {
    async listSessions(credential) {
      const groupId = await group(credential);
      const intakes = await deps.identification.listIntakes(credential);
      return serial(groupId, async () => {
        const ledger = await restore(groupId);
        return Promise.all(intakes.filter((item) => item.groupId === groupId).map(async (item) => ({ intake: item,
          photoCount: ledger.records.filter((row) => row.intakeId === item.id && (row.stage === 'ready' || row.stage === 'locally-deleted')).length,
          needsAttention: ledger.records.some((row) => row.intakeId === item.id && !['ready', 'locally-deleted'].includes(row.stage)),
          confirmed: await isIntakeConfirmed(deps.storage, confirmationKey(deps.environment, deps.source, groupId, item.id)) })));
      });
    },
    async listPhotos(credential, intakeId) {
      const groupId = await group(credential);
      await intake(credential, intakeId, groupId);
      return serial(groupId, async () => (await restore(groupId)).records
        .filter((row) => row.intakeId === intakeId && ['ready', 'deleting-local', 'locally-deleted'].includes(row.stage)).map((row) => present(groupId, row)));
    },
    async savePhoto(credential, intakeId, source) {
      const groupId = await group(credential);
      await intake(credential, intakeId, groupId);
      if (!source || !Number.isInteger(source.width) || source.width <= 0 ||
          !Number.isInteger(source.height) || source.height <= 0 ||
          (source.format !== 'jpg' && source.format !== 'png')) throw new AppError('Validation', '撮影画像の寸法または形式が不正です。');
      return gate.run(groupId, async () => serial(groupId, async () => {
        await assertUnconfirmed(deps.storage, confirmationKey(deps.environment, deps.source, groupId, intakeId));
        const id = deps.ids.next();
        const expectedBytes = await deps.files.sourceSize(source.uri);
        const row: Row = { id, intakeId, groupId, capturedAt: currentInstant(deps.clock), width: source.width, height: source.height,
          expectedBytes, format: source.format, originalRef: `photos/photo-${id}.${source.format}`, thumbnailRef: `photos/thumb-${id}.jpg`,
          stage: 'copying', sourceUri: source.uri };
        const ledger = await read(groupId);
        if (ledger.records.some((item) => item.id === id)) throw new AppError('Conflict', '写真IDが重複しています。');
        await write(groupId, { ...ledger, records: [...ledger.records, row] });
        try {
          await deps.files.persist(namespace(groupId), id, source.uri, source.width, source.height, expectedBytes, source.format);
          await write(groupId, { ...ledger, records: [...ledger.records, { ...row, stage: 'ready', sourceUri: '' }] });
          return present(groupId, row);
        } catch (cause) { throw toAppError(cause, 'Storage'); }
      }));
    },
    async discardPhoto(credential, intakeId, photoId) {
      const groupId = await group(credential);
      await intake(credential, intakeId, groupId);
      await gate.run(groupId, async () => serial(groupId, async () => {
        await assertUnconfirmed(deps.storage, confirmationKey(deps.environment, deps.source, groupId, intakeId));
        const ledger = await restore(groupId);
        const row = ledger.records.find((item) => item.id === photoId && item.intakeId === intakeId && item.stage === 'ready');
        if (!row) throw new AppError('NotFound', '不採用にする写真がありません。');
        await write(groupId, { ...ledger, records: ledger.records.map((item) => item.id === photoId ? { ...item, stage: 'discarding' } : item) });
        await deps.files.remove(namespace(groupId), photoId, row.format);
        await write(groupId, { ...ledger, records: ledger.records.filter((item) => item.id !== photoId) });
      }));
    },
    async markLocalDeleting(credential, intakeId, photoId) {
      const groupId = await group(credential);
      await intake(credential, intakeId, groupId);
      await gate.run(groupId, async () => serial(groupId, async () => {
        const ledger = await restore(groupId);
        const row = ledger.records.find((item) => item.id === photoId && item.intakeId === intakeId);
        if (!row || !['ready', 'deleting-local'].includes(row.stage)) throw new AppError('Conflict', 'この写真は端末から削除できません。');
        await write(groupId, { ...ledger, records: ledger.records.map((item) => item.id === photoId ? { ...item, stage: 'deleting-local' } : item) });
      }));
    },
    async markLocalDeleted(credential, intakeId, photoId) {
      const groupId = await group(credential);
      await intake(credential, intakeId, groupId);
      await gate.run(groupId, async () => serial(groupId, async () => {
        const ledger = await restore(groupId);
        const row = ledger.records.find((item) => item.id === photoId && item.intakeId === intakeId && item.stage === 'deleting-local');
        if (!row) throw new AppError('Conflict', '削除準備中の写真がありません。');
        await write(groupId, { ...ledger, records: ledger.records.map((item) => item.id === photoId ? { ...item, stage: 'locally-deleted' } : item) });
      }));
    },
    markLocalDeletingBatch(credential, photos) {
      return markBatch(credential, photos, ['ready', 'deleting-local'], 'deleting-local');
    },
    markLocalDeletedBatch(credential, photos) {
      return markBatch(credential, photos, ['deleting-local'], 'locally-deleted');
    },
  };
}
