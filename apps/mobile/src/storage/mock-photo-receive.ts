import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { AppError, toAppError } from '@/core/errors';
import type { PhotoReceivePort } from '@/services/contracts/download';
import { buildNamespacePrefix, validateFileName, type StorageNamespace } from './namespace';

function locations(server: StorageNamespace, fan: StorageNamespace, photoId: string) {
  if (server.owner.kind !== 'mock-server' || server.source !== 'mock' || !['fan', 'guest'].includes(fan.owner.kind) ||
      fan.source !== 'mock' || fan.environment !== server.environment) {
    throw new AppError('Configuration', '写真の受取先が不正です。');
  }
  const serverName = `upload-${photoId}.jpg`;
  const fanName = `received-${photoId}.jpg`;
  validateFileName(serverName);
  validateFileName(fanName);
  const sourceDir = new Directory(Paths.document, ...buildNamespacePrefix(server).split('/').filter(Boolean), 'uploads');
  const fanDir = new Directory(Paths.document, ...buildNamespacePrefix(fan).split('/').filter(Boolean), 'received');
  return { source: new File(sourceDir, serverName), directory: fanDir,
    file: new File(fanDir, fanName), pending: new File(fanDir, `.pending-${fanName}`) };
}

export function createMockPhotoReceive(): PhotoReceivePort {
  return {
    async inspect(fan, photoId) {
      try {
        if (!['fan', 'guest'].includes(fan.owner.kind) || fan.source !== 'mock') throw new AppError('Configuration', '写真の保存先が不正です。');
        const name = `received-${photoId}.jpg`;
        validateFileName(name);
        const directory = new Directory(Paths.document, ...buildNamespacePrefix(fan).split('/').filter(Boolean), 'received');
        const file = new File(directory, name);
        return file.exists && file.size > 0 ? { uri: file.uri, byteSize: file.size } : null;
      } catch (cause) { throw toAppError(cause); }
    },
    async copy(server, fan, photoId, expectedBytes, onProgress, failAfterBytes) {
      try {
        if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) throw new AppError('Validation', '写真サイズが不正です。');
        const target = locations(server, fan, photoId);
        if (!target.source.exists || target.source.size !== expectedBytes) throw new AppError('Storage', '仮サーバーの写真を確認できません。');
        target.directory.create({ intermediates: true, idempotent: true });
        if (target.file.exists) {
          if (target.file.size !== expectedBytes) throw new AppError('Storage', '保存済み写真のサイズが一致しません。');
          return { uri: target.file.uri, byteSize: target.file.size };
        }
        if (Paths.availableDiskSpace < expectedBytes * 2) throw new AppError('Storage', '端末の空き容量が不足しています。');
        if (target.pending.exists) target.pending.delete();
        target.pending.create({ overwrite: false });
        onProgress?.(0);
        let reader: ReturnType<File['open']> | null = null;
        let writer: ReturnType<File['open']> | null = null;
        try {
          reader = target.source.open(FileMode.ReadOnly);
          writer = target.pending.open(FileMode.WriteOnly);
          let copied = 0;
          while (copied < expectedBytes) {
            const chunk = reader.readBytes(Math.min(256 * 1024, expectedBytes - copied));
            if (!chunk.length) throw new AppError('Storage', '受信途中で写真を読み取れなくなりました。');
            writer.writeBytes(chunk);
            copied += chunk.length;
            onProgress?.(Math.min(99, Math.floor(copied * 100 / expectedBytes)));
            if (failAfterBytes && copied >= failAfterBytes) throw new AppError('Transport', '仮受信が途中で失敗しました。');
            if (copied < expectedBytes) await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } finally { writer?.close(); reader?.close(); }
        if (!target.pending.exists || target.pending.size !== expectedBytes) throw new AppError('Storage', '受信写真のサイズを確認できません。');
        await target.pending.move(target.file, { overwrite: false });
        if (!target.file.exists || target.file.size !== expectedBytes) throw new AppError('Storage', '写真の確定保存に失敗しました。');
        onProgress?.(100);
        return { uri: target.file.uri, byteSize: target.file.size };
      } catch (cause) { throw toAppError(cause); }
    },
    async remove(fan, photoId) {
      try {
        if (!['fan', 'guest'].includes(fan.owner.kind) || fan.source !== 'mock')
          throw new AppError('Configuration', '写真の保存先が不正です。');
        const name = `received-${photoId}.jpg`;
        validateFileName(name);
        const directory = new Directory(Paths.document, ...buildNamespacePrefix(fan).split('/').filter(Boolean), 'received');
        const file = new File(directory, name);
        if (file.exists) file.delete();
      } catch (cause) { throw toAppError(cause); }
    },
  };
}
