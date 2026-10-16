import { AppError, toAppError } from '@/core/errors';
import { currentInstant, parseId, parseInstant, type Clock, type IdGenerator } from '@/core/values';
import type { CheckRecord, CheckSnapshot, CheckTarget, FoundationCheckService } from '@/services/contracts/foundation-check';
import type { FileStore } from '@/storage/file-store';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type StorageNamespace } from '@/storage/namespace';

export interface CheckDependencies {
  storage: KeyValueStore;
  files: FileStore;
  clock: Clock;
  ids: IdGenerator;
  targets: readonly { target: CheckTarget; namespace: StorageNamespace }[];
  seed: () => Promise<CheckSnapshot['seed']>;
  reset: () => Promise<void>;
}

function decodeRecord(raw: string): CheckRecord {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('id' in value) ||
      !('savedAt' in value) || !('fileName' in value) || typeof value.fileName !== 'string' ||
      !/^check-[A-Za-z0-9-]+\.txt$/.test(value.fileName)) {
    throw new AppError('Storage', '保存確認レコードが破損しています。');
  }
  return { id: parseId(value.id), savedAt: parseInstant(value.savedAt), fileName: value.fileName };
}

function contents(record: CheckRecord, target: CheckTarget): string {
  return `Digital Cheki storage check\nTarget: ${target.id}\nID: ${record.id}\nSaved: ${record.savedAt}\n`;
}

export function createFoundationCheck(deps: CheckDependencies): FoundationCheckService {
  // 同一アプリでの保存・読出し・リセットの競合を防ぐ。
  let pending: Promise<unknown> = Promise.resolve();
  function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation).catch((error: unknown) => { throw toAppError(error); });
    pending = result.catch(() => undefined);
    return result;
  }

  function resolve(targetId: string) {
    const entry = deps.targets.find(({ target }) => target.id === targetId);
    if (!entry) throw new AppError('Validation', '確認対象が不正です。');
    return entry;
  }

  async function read(targetId: string): Promise<CheckSnapshot> {
    const { target, namespace } = resolve(targetId);
    const seed = await deps.seed();
    const prefix = `${buildNamespacePrefix(namespace)}foundation-check/`;
    const unfinished = await deps.storage.get(`${prefix}pending`);
    if (unfinished !== null) {
      const record = decodeRecord(unfinished);
      const file = await deps.files.readText(namespace, record.fileName);
      if (file !== null) {
        if (file !== contents(record, target)) throw new AppError('Storage', '保存内容が一致しません。');
        await deps.storage.set(`${prefix}latest`, JSON.stringify(record));
      } else {
        await deps.files.remove(namespace, record.fileName);
      }
      // ファイル未確定なら従来のlatestを残す。書き直しや自動再送は行わない。
      await deps.storage.remove(`${prefix}pending`);
    }
    const raw = await deps.storage.get(`${prefix}latest`);
    const record = raw === null ? null : decodeRecord(raw);
    const fileContents = record === null ? null : await deps.files.readText(namespace, record.fileName);
    if (record !== null && fileContents !== contents(record, target)) {
      throw new AppError('Storage', '記録に対応するファイルが見つからないか、内容が一致しません。');
    }
    return { target, seed, record, fileContents };
  }

  return {
    targets: deps.targets.map(({ target }) => target),
    read: (targetId) => run(() => read(targetId)),
    save: (targetId) => run(async () => {
      const { target, namespace } = resolve(targetId);
      await read(targetId);
      const id = parseId(deps.ids.next());
      if (!/^[A-Za-z0-9-]+$/.test(id)) throw new AppError('Validation', '保存IDが不正です。');
      const record: CheckRecord = { id, savedAt: currentInstant(deps.clock), fileName: `check-${id}.txt` };
      const prefix = `${buildNamespacePrefix(namespace)}foundation-check/`;
      await deps.storage.set(`${prefix}pending`, JSON.stringify(record));
      await deps.files.writeText(namespace, record.fileName, contents(record, target));
      // readと同じ復旧経路でファイルを照合し、DBへ完了を確定する。
      return read(targetId);
    }),
    reset: (confirmation) => run(async () => {
      if (confirmation !== 'RESET_MOCK_DATA') throw new AppError('Validation', '初期化には確認が必要です。');
      await deps.reset();
    }),
  };
}
