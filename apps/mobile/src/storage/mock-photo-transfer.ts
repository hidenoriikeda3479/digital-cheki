import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { AppError, toAppError } from '@/core/errors';
import type { PhotoTransferPort } from '@/services/contracts/upload';
import { buildNamespacePrefix, validateFileName, type StorageNamespace } from './namespace';

function destination(server: StorageNamespace, photoId: string) {
  if (server.owner.kind !== 'mock-server' || server.source !== 'mock') throw new AppError('Configuration', '仮サーバー保存先が不正です。');
  const name = `upload-${photoId}.jpg`;
  validateFileName(name);
  const directory = new Directory(Paths.document, ...buildNamespacePrefix(server).split('/').filter(Boolean), 'uploads');
  return { directory, file: new File(directory, name), pending: new File(directory, `.pending-${name}`) };
}

export function createMockPhotoTransfer(): PhotoTransferPort {
  return {
    async inspect(server, photoId) {
      try {
        const file = destination(server, photoId).file;
        return file.exists && file.size > 0 ? { byteSize: file.size, uri: file.uri } : null;
      } catch (cause) { throw toAppError(cause); }
    },
    async copy(server, photoId, sourceUri, expectedBytes, onProgress) {
      try {
        if (!sourceUri.startsWith('file://') || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
          throw new AppError('Validation', '完成画像の参照が不正です。');
        }
        const source = new File(sourceUri);
        if (!source.exists || source.size !== expectedBytes) throw new AppError('Storage', '完成画像が見つからないか破損しています。');
        const target = destination(server, photoId);
        target.directory.create({ intermediates: true, idempotent: true });
        if (target.file.exists) {
          if (target.file.size !== expectedBytes) throw new AppError('Conflict', '同じ写真IDの仮サーバー画像が一致しません。');
          onProgress?.(100);
          return;
        }
        if (Paths.availableDiskSpace < expectedBytes * 2) throw new AppError('Storage', '端末の空き容量が不足しています。');
        if (target.pending.exists) target.pending.delete();
        onProgress?.(0);
        target.pending.create({ overwrite: false });
        let reader: ReturnType<File['open']> | null = null;
        let writer: ReturnType<File['open']> | null = null;
        try {
          reader = source.open(FileMode.ReadOnly);
          writer = target.pending.open(FileMode.WriteOnly);
          let copied = 0;
          while (copied < expectedBytes) {
            const chunk = reader.readBytes(Math.min(256 * 1024, expectedBytes - copied));
            if (!chunk.length) throw new AppError('Storage', '転送中の画像が途中で終了しました。');
            writer.writeBytes(chunk);
            copied += chunk.length;
            onProgress?.(Math.min(99, Math.floor(copied * 100 / expectedBytes)));
            // Let React paint progress between chunks without keeping the whole JPEG in JS memory.
            if (copied < expectedBytes) await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } finally { writer?.close(); reader?.close(); }
        if (!target.pending.exists || target.pending.size !== expectedBytes) throw new AppError('Storage', '転送中の画像を確認できません。');
        onProgress?.(100);
        await target.pending.move(target.file, { overwrite: false });
        if (!target.file.exists || target.file.size !== expectedBytes) throw new AppError('Storage', '仮サーバー画像の保存を確認できません。');
      } catch (cause) { throw toAppError(cause); }
    },
    async remove(server, photoId) {
      try {
        const target = destination(server, photoId);
        if (target.file.exists) target.file.delete();
      } catch (cause) { throw toAppError(cause); }
    },
  };
}
