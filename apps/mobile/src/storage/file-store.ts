import { Directory, File, Paths } from 'expo-file-system';

import { AppError } from '@/core/errors';

import { buildMockPrefix, buildNamespacePrefix, validateFileName,
  type MockEnvironment, type StorageNamespace } from './namespace';

/** Small text artifacts only. Photo bytes belong in a future streaming/file-copy port. */
export interface FileStore {
  writeText(namespace: StorageNamespace, name: string, contents: string): Promise<void>;
  readText(namespace: StorageNamespace, name: string): Promise<string | null>;
  remove(namespace: StorageNamespace, name: string): Promise<void>;
  resetMock(environment: MockEnvironment): Promise<void>;
}

function directoryFor(namespace: StorageNamespace): Directory {
  return new Directory(Paths.document, ...buildNamespacePrefix(namespace).split('/').filter(Boolean));
}

async function fileOperation<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError('Storage', '端末のファイルを読み書きできませんでした。', { cause });
  }
}

export function createFileStore(): FileStore {
  return {
    async writeText(namespace, name, contents) {
      validateFileName(name);
      await fileOperation(() => {
        const directory = directoryFor(namespace);
        directory.create({ intermediates: true, idempotent: true });
        const destination = new File(directory, name);
        if (destination.exists) {
          throw new AppError('Conflict', '同じ名前の保存済みファイルがあります。');
        }
        const pending = new File(directory, `.pending-${name}`);
        // Operations below are synchronous and limited to small text, so JS calls
        // cannot interleave between staging and commit. A crashed write may leave
        // this private staging file; only that same operation's staging is replaced.
        if (pending.exists) pending.delete();
        pending.create({ overwrite: false });
        pending.write(contents, { encoding: 'utf8' });
        if (!pending.exists || pending.textSync() !== contents) {
          throw new AppError('Storage', 'ファイルの保存内容を確認できませんでした。');
        }
        pending.moveSync(destination, { overwrite: false });
        if (!destination.exists) {
          throw new AppError('Storage', 'ファイルの保存を確定できませんでした。');
        }
      });
    },
    async readText(namespace, name) {
      validateFileName(name);
      return fileOperation(() => {
        const file = new File(directoryFor(namespace), name);
        return file.exists ? file.textSync() : null;
      });
    },
    async remove(namespace, name) {
      validateFileName(name);
      await fileOperation(() => {
        const directory = directoryFor(namespace);
        const file = new File(directory, name);
        if (file.exists) file.delete();
        const pending = new File(directory, `.pending-${name}`);
        if (pending.exists) pending.delete();
      });
    },
    async resetMock(environment) {
      const prefix = buildMockPrefix(environment);
      await fileOperation(() => {
        // The complete relative target is generated from fixed segments and a
        // validated environment. Never accepts an arbitrary recursive-delete URI.
        const directory = new Directory(Paths.document, ...prefix.split('/').filter(Boolean));
        if (directory.exists) directory.delete();
      });
    },
  };
}
