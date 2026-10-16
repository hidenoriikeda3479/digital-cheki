import { AppError, toAppError } from '@/core/errors';
import { currentInstant, type Clock } from '@/core/values';
import type { AuthService } from './contracts/auth';
import type { CapturePhoto, CaptureService } from './contracts/capture';
import type { EditingService, PhotoEdit } from './contracts/editing';
import type { FinishedImage, FinishedImageRenderer, FinishedImageService, SendPreview } from './contracts/finished-image';
import type { IdentificationService } from './contracts/identification';
import type { KeyValueStore } from '@/storage/key-value-store';
import { type StorageEnvironment, type StorageNamespace } from '@/storage/namespace';
import type { FinishedImageFiles } from '@/storage/finished-image-files';
import { confirmationKey } from './confirmation-lock';
import { LocalOperationGate } from './local-operation-gate';

type StoredImage = Omit<FinishedImage, 'uri'>;
interface Ledger {
  schemaVersion: 1; groupId: string; intakeId: string; recipientRef: string;
  idolIds: string[]; images: StoredImage[]; confirmedAt: string | null;
}
function decode(raw: string | null, groupId: string, intakeId: string): Ledger | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Ledger;
    if (value.schemaVersion !== 1 || value.groupId !== groupId || value.intakeId !== intakeId ||
      typeof value.recipientRef !== 'string' || !Array.isArray(value.idolIds) || !value.idolIds.every((id) => typeof id === 'string') ||
      !Array.isArray(value.images) || (value.confirmedAt !== null && typeof value.confirmedAt !== 'string') ||
      !value.images.every((image) => image && typeof image.photoId === 'string' &&
        Number.isSafeInteger(image.editRevision) && image.editRevision >= 0 &&
        (image.renderVersion === undefined || image.renderVersion === 2) &&
        ['cheki', 'high'].includes(image.quality) && Number.isSafeInteger(image.width) && image.width > 0 &&
        Number.isSafeInteger(image.height) && image.height > 0 && Number.isSafeInteger(image.byteSize) && image.byteSize > 0 &&
        typeof image.relativeRef === 'string' && typeof image.generatedAt === 'string')) throw Error('invalid finished ledger');
    return value;
  } catch (cause) { throw new AppError('Storage', '完成画像の記録を読み取れません。', { cause }); }
}
function sameSource(image: StoredImage, edit: PhotoEdit) {
  return image.renderVersion === 2 && image.photoId === edit.photoId && image.editRevision === edit.revision && image.quality === edit.quality;
}

export function createLocalFinishedImageService(deps: {
  environment: StorageEnvironment; source: 'mock' | 'api'; storage: KeyValueStore;
  auth: AuthService; capture: CaptureService; editing: EditingService; identification: IdentificationService;
  files: FinishedImageFiles; renderer: FinishedImageRenderer; clock: Clock; gate?: LocalOperationGate;
}): FinishedImageService {
  const gate = deps.gate ?? new LocalOperationGate();
  function namespace(groupId: string): StorageNamespace {
    return { environment: deps.environment, source: deps.source, owner: { kind: 'group', id: groupId } };
  }
  function key(groupId: string, intakeId: string) {
    return confirmationKey(deps.environment, deps.source, groupId, intakeId);
  }
  async function context(credential: string, intakeId: string) {
    const session = await deps.auth.restore(credential);
    if (session.principal.role !== 'group') throw new AppError('Forbidden', 'グループのみ送信対象を確認できます。');
    const intake = (await deps.identification.listIntakes(credential)).find((item) => item.id === intakeId && item.groupId === session.principal.id);
    if (!intake) throw new AppError('NotFound', '撮影受付が見つかりません。');
    if (!intake.recipientRef || !intake.idolIds.length) throw new AppError('Validation', '受取人と参加アイドルを確認してください。');
    const idols = await deps.identification.listSelectableIdols(credential);
    const names = intake.idolIds.map((id) => idols.find((idol) => idol.id === id)?.name);
    if (names.some((name) => !name)) throw new AppError('Conflict', '参加アイドルを確認できません。');
    return { groupId: session.principal.id, intake, idolNames: names as string[] };
  }
  async function read(groupId: string, intakeId: string) {
    try { return decode(await deps.storage.get(key(groupId, intakeId)), groupId, intakeId); }
    catch (cause) { throw toAppError(cause); }
  }
  async function write(ledger: Ledger) {
    try { await deps.storage.set(key(ledger.groupId, ledger.intakeId), JSON.stringify(ledger)); }
    catch (cause) { throw toAppError(cause); }
  }
  function base(groupId: string, intakeId: string, recipientRef: string, idolIds: string[]): Ledger {
    return { schemaVersion: 1, groupId, intakeId, recipientRef, idolIds: [...idolIds], images: [], confirmedAt: null };
  }
  async function present(credential: string, ledger: Ledger, contextValue: Awaited<ReturnType<typeof context>>,
    currentPhotos: CapturePhoto[]): Promise<SendPreview> {
    const images: FinishedImage[] = [];
    for (const row of ledger.images) {
      if (currentPhotos.find((photo) => photo.id === row.photoId)?.localDeleted) {
        images.push({ ...row, uri: '' });
        continue;
      }
      const inspect = row.renderVersion === 2 ? deps.files.inspect : deps.files.inspectLegacy;
      const file = inspect ? await inspect(namespace(ledger.groupId), row.photoId, row.editRevision, row.quality) : null;
      if (!file || file.relativeRef !== row.relativeRef || file.byteSize !== row.byteSize ||
        file.width !== row.width || file.height !== row.height) throw new AppError('Storage', '完成画像が見つからないか破損しています。');
      images.push({ ...row, uri: file.uri });
    }
    const recipientLabel = await deps.identification.getIntakeRecipientName(credential, ledger.intakeId);
    return { intake: contextValue.intake, idolNames: contextValue.idolNames,
      recipientLabel, images, confirmedAt: ledger.confirmedAt };
  }
  async function photos(credential: string, intakeId: string): Promise<CapturePhoto[]> {
    const value = await deps.capture.listPhotos(credential, intakeId);
    if (!value.length) throw new AppError('Validation', '送信対象の写真がありません。');
    return value;
  }
  return {
    async getSaved(credential, intakeId) {
      const ctx = await context(credential, intakeId);
      const ledger = await read(ctx.groupId, intakeId);
      if (!ledger) return [];
      const currentPhotos = await deps.capture.listPhotos(credential, intakeId);
      const saved: FinishedImage[] = [];
      for (const row of ledger.images) {
        const photo = currentPhotos.find((item) => item.id === row.photoId && !item.localDeleted);
        if (!photo) continue;
        const edit = await deps.editing.load(credential, intakeId, photo.id);
        if (!sameSource(row, edit) && (!ledger.confirmedAt || row.editRevision !== edit.revision || row.quality !== edit.quality)) continue;
        const inspect = row.renderVersion === 2 ? deps.files.inspect : deps.files.inspectLegacy;
        const file = inspect ? await inspect(namespace(ctx.groupId), row.photoId, row.editRevision, row.quality) : null;
        if (!file || file.relativeRef !== row.relativeRef || file.byteSize !== row.byteSize ||
          file.width !== row.width || file.height !== row.height) throw new AppError('Storage', '端末の完成画像を確認できません。');
        saved.push({ ...row, uri: file.uri });
      }
      return saved;
    },
    async prepare(credential, intakeId) {
      const ctx = await context(credential, intakeId);
      return gate.run(ctx.groupId, async () => {
        const currentPhotos = await photos(credential, intakeId);
        let ledger = await read(ctx.groupId, intakeId) ?? base(ctx.groupId, intakeId, ctx.intake.recipientRef, ctx.intake.idolIds);
        if (ledger.recipientRef !== ctx.intake.recipientRef || JSON.stringify(ledger.idolIds) !== JSON.stringify(ctx.intake.idolIds)) {
          throw new AppError('Conflict', '受付の対象が変更されています。');
        }
        if (ledger.confirmedAt) {
          if (ledger.images.length !== currentPhotos.length || !ledger.images.every((row) => currentPhotos.some((item) => item.id === row.photoId))) {
            throw new AppError('Conflict', '確定済みの送信対象が変更されています。');
          }
          return present(credential, ledger, ctx, currentPhotos);
        }
        for (const photo of currentPhotos) {
          const edit = await deps.editing.load(credential, intakeId, photo.id);
          const current = ledger.images.find((item) => sameSource(item, edit));
          const existing = await deps.files.inspect(namespace(ctx.groupId), photo.id, edit.revision, edit.quality);
          if (current && existing && existing.relativeRef === current.relativeRef && existing.byteSize === current.byteSize &&
            existing.width === current.width && existing.height === current.height) continue;
          let saved = existing;
          if (!saved) {
            const source = await deps.files.readOriginal(photo.originalUri);
            let rendered: Awaited<ReturnType<FinishedImageRenderer['render']>>;
            try { rendered = await deps.renderer.render(photo, edit, source); }
            catch (cause) { throw toAppError(cause); }
            if (rendered.width <= 0 || rendered.height <= 0) throw new AppError('Storage', '画像寸法が不正です。');
            if ((await deps.editing.load(credential, intakeId, photo.id)).revision !== edit.revision) {
              throw new AppError('Conflict', '生成中に編集が変更されました。再生成してください。');
            }
            saved = await deps.files.persist(namespace(ctx.groupId), photo.id, edit.revision, edit.quality,
              rendered.bytes, rendered.width, rendered.height);
          }
          const next: StoredImage = { photoId: photo.id, editRevision: edit.revision, quality: edit.quality, renderVersion: 2,
            width: saved.width, height: saved.height, byteSize: saved.byteSize, relativeRef: saved.relativeRef,
            generatedAt: current?.generatedAt ?? currentInstant(deps.clock) };
          ledger = { ...ledger, images: [...ledger.images.filter((item) => item.photoId !== photo.id), next] };
          await write(ledger);
        }
        ledger = { ...ledger, images: currentPhotos.map((photo) => ledger.images.find((item) => item.photoId === photo.id)!) };
        await write(ledger);
        return present(credential, ledger, ctx, currentPhotos);
      });
    },
    async confirm(credential, intakeId) {
      const ctx = await context(credential, intakeId);
      return gate.run(ctx.groupId, async () => {
        const ledger = await read(ctx.groupId, intakeId);
        const currentPhotos = await photos(credential, intakeId);
        if (!ledger || !ledger.images.length || ledger.images.length !== currentPhotos.length ||
          ledger.recipientRef !== ctx.intake.recipientRef || JSON.stringify(ledger.idolIds) !== JSON.stringify(ctx.intake.idolIds)) {
          throw new AppError('Conflict', '完成画像を生成してから確認してください。');
        }
        for (const photo of currentPhotos) {
          const row = ledger.images.find((item) => item.photoId === photo.id);
          const edit = await deps.editing.load(credential, intakeId, photo.id);
          if (!row || !sameSource(row, edit)) throw new AppError('Conflict', '編集後の完成画像を再生成してください。');
        }
        const checked = await present(credential, ledger, ctx, currentPhotos);
        if (ledger.confirmedAt) return checked;
        const confirmed = { ...ledger, confirmedAt: currentInstant(deps.clock) };
        await write(confirmed);
        return present(credential, confirmed, ctx, currentPhotos);
      });
    },
    async isConfirmed(credential, intakeId) {
      const ctx = await context(credential, intakeId);
      return !!(await read(ctx.groupId, intakeId))?.confirmedAt;
    },
  };
}
