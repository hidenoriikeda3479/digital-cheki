import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';

import { AppError, toAppError } from '@/core/errors';

import { buildNamespacePrefix, validateFileName, type StorageNamespace } from './namespace';

export interface PhotoFileStore {
  availableBytes?(): number;
  sourceSize(uri: string): Promise<number>;
  persist(namespace: StorageNamespace, id: string, sourceUri: string, width: number, height: number, expectedBytes: number, format: 'jpg' | 'png'): Promise<void>;
  recover(namespace: StorageNamespace, id: string, sourceUri: string, width: number, height: number, expectedBytes: number, format: 'jpg' | 'png'): Promise<boolean>;
  references(namespace: StorageNamespace, id: string, format: 'jpg' | 'png'): { originalUri: string; thumbnailUri: string };
  remove(namespace: StorageNamespace, id: string, format: 'jpg' | 'png'): Promise<void>;
}

function directoryFor(namespace: StorageNamespace): Directory {
  return new Directory(Paths.document, ...buildNamespacePrefix(namespace).split('/').filter(Boolean), 'photos');
}
function names(id: string, format: 'jpg' | 'png') {
  const original = `photo-${id}.${format}`;
  const thumbnail = `thumb-${id}.jpg`;
  validateFileName(original);
  return { original, thumbnail };
}
function files(namespace: StorageNamespace, id: string, format: 'jpg' | 'png') {
  const directory = directoryFor(namespace);
  const { original, thumbnail } = names(id, format);
  return {
    availableBytes: () => Paths.availableDiskSpace,
    directory,
    original: new File(directory, original), thumbnail: new File(directory, thumbnail),
    pendingOriginal: new File(directory, `.pending-${original}`),
    pendingThumbnail: new File(directory, `.pending-${thumbnail}`),
  };
}
function good(file: File, expected?: number): boolean {
  return file.exists && file.size > 0 && (expected === undefined || file.size === expected);
}
async function thumbnail(source: File, target: File, width: number, height: number) {
  const scale = Math.min(1, 320 / Math.max(width, height));
  const context = ImageManipulator.manipulate(source.uri);
  context.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const generated = new File(result.uri);
  try {
    if (!good(generated)) throw new AppError('Storage', '縮小画像を生成できませんでした。');
    if (target.exists) target.delete();
    await generated.copy(target, { overwrite: false });
    if (!good(target, generated.size)) throw new AppError('Storage', '縮小画像を確認できませんでした。');
  } finally {
    if (generated.exists) generated.delete();
  }
}

export function createPhotoFileStore(): PhotoFileStore {
  async function sourceSize(uri: string): Promise<number> {
    try {
      if (!uri.startsWith('file://')) throw new AppError('Validation', '端末内の撮影画像だけ保存できます。');
      const source = new File(uri);
      if (!good(source)) throw new AppError('Storage', '撮影画像を読み取れませんでした。');
      return source.size;
    } catch (cause) { throw toAppError(cause); }
  }
  async function persist(namespace: StorageNamespace, id: string, uri: string, width: number, height: number, expectedBytes: number, format: 'jpg' | 'png') {
    try {
      const entry = files(namespace, id, format);
      entry.directory.create({ intermediates: true, idempotent: true });
      if (!good(entry.original, expectedBytes)) {
        if (entry.original.exists) throw new AppError('Storage', '保存済み画像のサイズが一致しません。');
        const source = new File(uri);
        if (!good(source, expectedBytes)) throw new AppError('Storage', '撮影画像が見つからないか破損しています。');
        if (Paths.availableDiskSpace < expectedBytes * 2) throw new AppError('Storage', '端末の空き容量が不足しています。');
        if (entry.pendingOriginal.exists) entry.pendingOriginal.delete();
        await source.copy(entry.pendingOriginal, { overwrite: false });
        if (!good(entry.pendingOriginal, expectedBytes)) throw new AppError('Storage', '元画像のコピーを確認できませんでした。');
        await entry.pendingOriginal.move(entry.original, { overwrite: false });
        if (!good(entry.original, expectedBytes)) throw new AppError('Storage', '元画像の確定を確認できませんでした。');
      }
      if (!good(entry.thumbnail)) {
        await thumbnail(entry.original, entry.pendingThumbnail, width, height);
        await entry.pendingThumbnail.move(entry.thumbnail, { overwrite: false });
        if (!good(entry.thumbnail)) throw new AppError('Storage', '縮小画像の確定を確認できませんでした。');
      }
    } catch (cause) { throw toAppError(cause); }
  }
  return {
    sourceSize,
    persist,
    async recover(namespace, id, uri, width, height, expectedBytes, format) {
      try {
        const entry = files(namespace, id, format);
        if (!good(entry.original, expectedBytes) && (!uri || !good(new File(uri), expectedBytes))) return false;
        await persist(namespace, id, uri, width, height, expectedBytes, format);
        return good(entry.original, expectedBytes) && good(entry.thumbnail);
      } catch { return false; }
    },
    references(namespace, id, format) {
      const entry = files(namespace, id, format);
      return { originalUri: entry.original.uri, thumbnailUri: entry.thumbnail.uri };
    },
    async remove(namespace, id, format) {
      try {
        const entry = files(namespace, id, format);
        for (const file of [entry.original, entry.thumbnail, entry.pendingOriginal, entry.pendingThumbnail]) {
          if (file.exists) file.delete();
        }
      } catch (cause) { throw toAppError(cause); }
    },
  };
}
