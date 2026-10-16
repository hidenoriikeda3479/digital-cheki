import { Directory, File, Paths } from 'expo-file-system';
import { AppError, toAppError } from '@/core/errors';
import type { EditQuality } from '@/services/contracts/editing';
import { buildNamespacePrefix, validateFileName, type StorageNamespace } from './namespace';

export interface StoredFinishedFile { relativeRef: string; uri: string; byteSize: number; width: number; height: number }
export interface FinishedImageFiles {
  readOriginal(uri: string): Promise<Uint8Array>;
  inspect(namespace: StorageNamespace, photoId: string, revision: number, quality: EditQuality): Promise<StoredFinishedFile | null>;
  inspectLegacy?(namespace: StorageNamespace, photoId: string, revision: number, quality: EditQuality): Promise<StoredFinishedFile | null>;
  persist(namespace: StorageNamespace, photoId: string, revision: number, quality: EditQuality,
    bytes: Uint8Array, width: number, height: number): Promise<StoredFinishedFile>;
  removePhoto(namespace: StorageNamespace, photoId: string): Promise<void>;
  removePhotos?(namespace: StorageNamespace, photoIds: string[]): Promise<void>;
}

/** Reads the encoded dimensions instead of trusting requested dimensions or DB metadata. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    throw new AppError('Storage', '完成画像がJPEGではありません。');
  }
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    let marker = bytes[offset + 1];
    while (marker === 0xff && offset + 2 < bytes.length) marker = bytes[++offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break;
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width > 0 && height > 0) return { width, height };
      break;
    }
    offset += length;
  }
  throw new AppError('Storage', 'JPEGの画像寸法を確認できませんでした。');
}

function target(namespace: StorageNamespace, photoId: string, revision: number, quality: EditQuality) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new AppError('Validation', '編集世代が不正です。');
  const name = `final-${photoId}-v2-r${revision}-${quality}.jpg`;
  validateFileName(name);
  const directory = new Directory(Paths.document, ...buildNamespacePrefix(namespace).split('/').filter(Boolean), 'finished');
  return { directory, file: new File(directory, name), pending: new File(directory, `.pending-${name}`), relativeRef: `finished/${name}` };
}
async function inspectFile(file: File, relativeRef: string): Promise<StoredFinishedFile | null> {
  if (!file.exists || file.size <= 0) return null;
  const bytes = await file.bytes();
  const size = jpegDimensions(bytes);
  if (file.size !== bytes.length) throw new AppError('Storage', '完成画像のサイズが一致しません。');
  return { relativeRef, uri: file.uri, byteSize: bytes.length, ...size };
}
export function createFinishedImageFiles(): FinishedImageFiles {
  async function removePhotos(namespace: StorageNamespace, photoIds: string[]) {
    try {
      for (const id of photoIds) validateFileName(id);
      const directory = new Directory(Paths.document, ...buildNamespacePrefix(namespace).split('/').filter(Boolean), 'finished');
      if (!directory.exists || photoIds.length === 0) return;
      const prefixes = photoIds.flatMap((id) => [`final-${id}-r`, `.pending-final-${id}-r`,
        `final-${id}-v2-r`, `.pending-final-${id}-v2-r`]);
      for (const entry of directory.list()) {
        if (entry instanceof File && prefixes.some((prefix) => entry.name.startsWith(prefix))) entry.delete();
      }
    } catch (cause) { throw toAppError(cause); }
  }
  return {
    removePhoto(namespace, photoId) { return removePhotos(namespace, [photoId]); },
    removePhotos,
    async readOriginal(uri) {
      try {
        if (!uri.startsWith('file://')) throw new AppError('Validation', '端末内の写真だけ合成できます。');
        const file = new File(uri);
        if (!file.exists || file.size <= 0) throw new AppError('Storage', '元写真が見つかりません。');
        return await file.bytes();
      } catch (cause) { throw toAppError(cause); }
    },
    async inspect(namespace, photoId, revision, quality) {
      try {
        const item = target(namespace, photoId, revision, quality);
        return await inspectFile(item.file, item.relativeRef);
      } catch (cause) { throw toAppError(cause); }
    },
    async inspectLegacy(namespace, photoId, revision, quality) {
      try {
        const item = target(namespace, photoId, revision, quality);
        const legacy = new File(item.directory, `final-${photoId}-r${revision}-${quality}.jpg`);
        return await inspectFile(legacy, `finished/${legacy.name}`);
      } catch (cause) { throw toAppError(cause); }
    },
    async persist(namespace, photoId, revision, quality, bytes, width, height) {
      try {
        const dimensions = jpegDimensions(bytes);
        if (dimensions.width !== width || dimensions.height !== height) throw new AppError('Storage', '生成寸法がJPEGと一致しません。');
        const item = target(namespace, photoId, revision, quality);
        item.directory.create({ intermediates: true, idempotent: true });
        const previous = await inspectFile(item.file, item.relativeRef);
        if (previous) {
          if (previous.width !== width || previous.height !== height) throw new AppError('Conflict', '同じ世代の完成画像が異なります。');
          return previous;
        }
        if (Paths.availableDiskSpace < bytes.length * 2) throw new AppError('Storage', '端末の空き容量が不足しています。');
        if (item.pending.exists) item.pending.delete();
        item.pending.create({ overwrite: false });
        item.pending.write(bytes);
        const staged = await inspectFile(item.pending, item.relativeRef);
        if (!staged || staged.byteSize !== bytes.length || staged.width !== width || staged.height !== height) {
          throw new AppError('Storage', '完成画像の一時保存を確認できませんでした。');
        }
        await item.pending.move(item.file, { overwrite: false });
        const saved = await inspectFile(item.file, item.relativeRef);
        if (!saved || saved.byteSize !== bytes.length || saved.width !== width || saved.height !== height) {
          throw new AppError('Storage', '完成画像の確定を確認できませんでした。');
        }
        return saved;
      } catch (cause) { throw toAppError(cause); }
    },
  };
}
