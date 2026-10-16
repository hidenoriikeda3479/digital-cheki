import { AppError, toAppError } from '@/core/errors';
import { currentInstant, type Clock, type IdGenerator } from '@/core/values';
import type { AuthService } from './contracts/auth';
import type { CaptureService } from './contracts/capture';
import type { EditElement, EditingService, PhotoEdit } from './contracts/editing';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type StorageEnvironment } from '@/storage/namespace';
import { LocalOperationGate } from './local-operation-gate';
import { assertUnconfirmed, confirmationKey } from './confirmation-lock';

function validPoint(point: { x: number; y: number }) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}
function validElement(element: EditElement) {
  if (!element.id || !/^#[0-9a-fA-F]{6}$/.test(element.color)) return false;
  if (element.kind === 'stroke') return element.width > 0 && element.width <= 0.1 &&
    element.points.length > 0 && element.points.every(validPoint);
  return element.kind === 'stamp' && ['heart', 'star', 'circle'].includes(element.stamp) &&
    element.size > 0 && element.size <= 1 && validPoint(element.center);
}
function decode(raw: string): PhotoEdit {
  try {
    const item = JSON.parse(raw) as PhotoEdit;
    if (item.schemaVersion !== 1 || !item.photoId || !item.groupId || !item.intakeId || !item.originalRef ||
      !Number.isSafeInteger(item.baseWidth) || item.baseWidth <= 0 || !Number.isSafeInteger(item.baseHeight) || item.baseHeight <= 0 ||
      !['none', 'white'].includes(item.frame) || !['cheki', 'high'].includes(item.quality) ||
      !Array.isArray(item.elements) || !item.elements.every(validElement) ||
      !Number.isSafeInteger(item.revision) || item.revision < 0 || !Number.isFinite(Date.parse(item.updatedAt))) throw Error('invalid edit');
    return item;
  } catch (cause) { throw new AppError('Storage', '編集状態を読み取れません。', { cause }); }
}

export function createLocalEditingService(deps: {
  environment: StorageEnvironment; source: 'mock' | 'api'; storage: KeyValueStore;
  auth: AuthService; capture: CaptureService; clock: Clock; ids: IdGenerator;
  gate?: LocalOperationGate;
}): EditingService {
  const queues = new Map<string, Promise<unknown>>();
  const gate = deps.gate ?? new LocalOperationGate();
  function key(groupId: string, photoId: string) {
    return `${buildNamespacePrefix({ environment: deps.environment, source: deps.source, owner: { kind: 'group', id: groupId } })}photo-edit/${photoId}`;
  }
  function serial<T>(name: string, work: () => Promise<T>): Promise<T> {
    const next = (queues.get(name) ?? Promise.resolve()).then(work);
    queues.set(name, next.catch(() => undefined));
    return next;
  }
  async function context(credential: string, intakeId: string, photoId: string) {
    const session = await deps.auth.restore(credential);
    if (session.principal.role !== 'group') throw new AppError('Forbidden', 'グループのみ編集できます。');
    const photo = (await deps.capture.listPhotos(credential, intakeId)).find((item) => item.id === photoId);
    if (!photo) throw new AppError('NotFound', '編集する写真が見つかりません。');
    return { groupId: session.principal.id, photo };
  }
  async function read(groupId: string, intakeId: string, photoId: string, photo: Awaited<ReturnType<CaptureService['listPhotos']>>[number]) {
    const raw = await deps.storage.get(key(groupId, photoId));
    if (raw === null) return { schemaVersion: 1, photoId, intakeId, groupId, originalRef: photo.originalRef,
      baseWidth: photo.width, baseHeight: photo.height, frame: 'none', quality: 'cheki', elements: [],
      revision: 0, updatedAt: photo.capturedAt } satisfies PhotoEdit;
    const edit = decode(raw);
    if (edit.groupId !== groupId || edit.intakeId !== intakeId || edit.photoId !== photoId ||
      edit.originalRef !== photo.originalRef || edit.baseWidth !== photo.width || edit.baseHeight !== photo.height) {
      throw new AppError('Storage', '写真と編集データの所有者が一致しません。');
    }
    return edit;
  }
  async function mutate(credential: string, intakeId: string, photoId: string, expectedRevision: number,
    change: (edit: PhotoEdit) => PhotoEdit): Promise<PhotoEdit> {
    const { groupId, photo } = await context(credential, intakeId, photoId);
    return gate.run(groupId, async () => serial(key(groupId, photoId), async () => {
      try {
        await assertUnconfirmed(deps.storage, confirmationKey(deps.environment, deps.source, groupId, intakeId));
        if (!(await deps.capture.listPhotos(credential, intakeId)).some((item) => item.id === photoId)) {
          throw new AppError('NotFound', '編集する写真が見つかりません。');
        }
        const edit = await read(groupId, intakeId, photoId, photo);
        if (edit.revision !== expectedRevision) throw new AppError('Conflict', '別の編集操作が先に保存されました。');
        const next = { ...change(edit), revision: edit.revision + 1, updatedAt: currentInstant(deps.clock) };
        await deps.storage.set(key(groupId, photoId), JSON.stringify(next));
        return next;
      } catch (cause) { throw toAppError(cause); }
    }));
  }
  return {
    async load(credential, intakeId, photoId) {
      const { groupId, photo } = await context(credential, intakeId, photoId);
      return serial(key(groupId, photoId), () => read(groupId, intakeId, photoId, photo));
    },
    saveDraft(credential, intakeId, photoId, revision, draft) {
      if (!['none', 'white'].includes(draft.frame) || !['cheki', 'high'].includes(draft.quality) ||
        !Array.isArray(draft.elements) || !draft.elements.every(validElement) ||
        new Set(draft.elements.map((item) => item.id)).size !== draft.elements.length) {
        throw new AppError('Validation', '編集内容が不正です。');
      }
      return mutate(credential, intakeId, photoId, revision, (edit) => ({ ...edit,
        frame: draft.frame, quality: draft.quality, elements: draft.elements }));
    },
    append(credential, intakeId, photoId, revision, element) {
      if (!validElement(element)) throw new AppError('Validation', '落書き操作が不正です。');
      return mutate(credential, intakeId, photoId, revision, (edit) => {
        if (edit.elements.some((item) => item.id === element.id)) throw new AppError('Conflict', '同じ操作が保存済みです。');
        return { ...edit, elements: [...edit.elements, element] };
      });
    },
    undo(credential, intakeId, photoId, revision) {
      return mutate(credential, intakeId, photoId, revision, (edit) => {
        if (!edit.elements.length) throw new AppError('Validation', '取り消す操作がありません。');
        return { ...edit, elements: edit.elements.slice(0, -1) };
      });
    },
    setFrame(credential, intakeId, photoId, revision, frame) {
      if (frame !== 'none' && frame !== 'white') throw new AppError('Validation', 'フレームが不正です。');
      return mutate(credential, intakeId, photoId, revision, (edit) => ({ ...edit, frame, elements: [] }));
    },
    setQuality(credential, intakeId, photoId, revision, quality) {
      if (quality !== 'cheki' && quality !== 'high') throw new AppError('Validation', '画質が不正です。');
      return mutate(credential, intakeId, photoId, revision, (edit) => ({ ...edit, quality }));
    },
  };
}
