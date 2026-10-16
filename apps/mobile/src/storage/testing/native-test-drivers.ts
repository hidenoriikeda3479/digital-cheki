import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';

interface TestTransaction {
  getFirstAsync(sql: string, ...parameters: SQLInputValue[]): Promise<Record<string, SQLOutputValue> | null>;
  execAsync(sql: string): Promise<void>;
}

export interface NativeTestDrivers {
  rootPath: string;
  readonly database: DatabaseSync;
  events: { openedNames: string[]; closedConnections: number };
  io: {
    writeText(filePath: string, contents: string): void;
    move(source: string, destination: string): void;
    copy(source: string, destination: string): void;
    execute(sql: string): void;
  };
  sqlite: {
    openDatabaseAsync(name: string): Promise<TestTransaction & {
      closeAsync(): Promise<void>;
      runAsync(sql: string, ...parameters: SQLInputValue[]): Promise<void>;
      withExclusiveTransactionAsync(operation: (transaction: TestTransaction) => Promise<void>): Promise<void>;
    }>;
  };
  reopenDatabase(): void;
  dispose(): void;
}

/** Desktop test IO only. It does not emulate or certify Expo's native bridge. */
export function createNativeTestDrivers(): NativeTestDrivers {
  const rootPath = fs.mkdtempSync(path.join(tmpdir(), 'digital-cheki-storage-test-'));
  const databasePath = path.join(rootPath, 'test-state.sqlite');
  let database = new DatabaseSync(databasePath);
  const events = { openedNames: [] as string[], closedConnections: 0 };
  const io = {
    writeText(filePath: string, contents: string) { fs.writeFileSync(filePath, contents, 'utf8'); },
    move(source: string, destination: string) { fs.renameSync(source, destination); },
    copy(source: string, destination: string) { fs.copyFileSync(source, destination); },
    execute(sql: string) { database.exec(sql); },
  };
  return {
    rootPath, events, io,
    get database() { return database; },
    sqlite: {
      async openDatabaseAsync(name) {
        events.openedNames.push(name);
        const transaction: TestTransaction = {
          getFirstAsync: async (sql, ...parameters) => database.prepare(sql).get(...parameters) ?? null,
          execAsync: async (sql) => { io.execute(sql); },
        };
        return {
          ...transaction,
          closeAsync: async () => { events.closedConnections += 1; },
          runAsync: async (sql, ...parameters) => { database.prepare(sql).run(...parameters); },
          withExclusiveTransactionAsync: async (operation) => {
            database.exec('BEGIN EXCLUSIVE');
            try {
              await operation(transaction);
              database.exec('COMMIT');
            } catch (error) {
              database.exec('ROLLBACK');
              throw error;
            }
          },
        };
      },
    },
    reopenDatabase() {
      database.close();
      database = new DatabaseSync(databasePath);
    },
    dispose() {
      database.close();
      const target = path.resolve(rootPath);
      const expectedParent = path.resolve(tmpdir());
      if (path.dirname(target) !== expectedParent ||
          !path.relative(expectedParent, target).startsWith('digital-cheki-storage-test-')) {
        throw new Error('Unexpected test directory; refusing cleanup');
      }
      fs.rmSync(target, { recursive: true, force: true });
    },
  };
}

export function createFileSystemTestModule(getDriver: () => NativeTestDrivers) {
  type Location = string | { uri: string };
  const locationPath = (part: Location) => {
    const value = typeof part === 'string' ? part : part.uri;
    return value.startsWith('file://') ? fileURLToPath(value) : value;
  };
  class Directory {
    uri: string;
    constructor(...parts: Location[]) {
      this.uri = path.join(...parts.map(locationPath));
    }
    get exists() { return fs.existsSync(this.uri); }
    create() { fs.mkdirSync(this.uri, { recursive: true }); }
    list() { return fs.readdirSync(this.uri).map((name) => fs.statSync(path.join(this.uri, name)).isDirectory()
      ? new Directory(this.uri, name) : new File(this.uri, name)); }
    delete() {
      const belowRoot = path.relative(getDriver().rootPath, this.uri);
      if (!belowRoot || belowRoot.startsWith('..') || path.isAbsolute(belowRoot)) {
        throw new Error('Test bridge rejected unsafe recursive delete');
      }
      fs.rmSync(this.uri, { recursive: true });
    }
  }
  class File {
    private filePath: string;
    constructor(...parts: Location[]) {
      this.filePath = path.join(...parts.map(locationPath));
    }
    get uri() { return pathToFileURL(this.filePath).href; }
    get name() { return path.basename(this.filePath); }
    get exists() { return fs.existsSync(this.filePath); }
    get size() { return this.exists ? fs.statSync(this.filePath).size : 0; }
    create() { fs.writeFileSync(this.filePath, '', { flag: 'wx' }); }
    write(contents: string | Uint8Array) {
      if (typeof contents === 'string') getDriver().io.writeText(this.filePath, contents);
      else fs.writeFileSync(this.filePath, contents);
    }
    async bytes() { return new Uint8Array(fs.readFileSync(this.filePath)); }
    open(mode: string) {
      const descriptor = fs.openSync(this.filePath, mode === 'r' ? 'r' : 'w');
      let offset = 0;
      return {
        readBytes(length: number) {
          const buffer = Buffer.alloc(length);
          const count = fs.readSync(descriptor, buffer, 0, length, offset);
          offset += count;
          return new Uint8Array(buffer.subarray(0, count));
        },
        writeBytes(bytes: Uint8Array) {
          const count = fs.writeSync(descriptor, bytes, 0, bytes.length, offset);
          offset += count;
          if (count !== bytes.length) throw new Error('Short test write');
        },
        close() { fs.closeSync(descriptor); },
      };
    }
    textSync() { return fs.readFileSync(this.filePath, 'utf8'); }
    delete() { fs.unlinkSync(this.filePath); }
    moveSync(destination: File, options: { overwrite: boolean }) {
      if (!options.overwrite && destination.exists) throw new Error('Already exists');
      getDriver().io.move(this.filePath, destination.filePath);
      this.filePath = destination.filePath;
    }
    async move(destination: File, options: { overwrite: boolean }) { this.moveSync(destination, options); }
    async copy(destination: File, options: { overwrite: boolean }) {
      if (!options.overwrite && destination.exists) throw new Error('Already exists');
      getDriver().io.copy(this.filePath, destination.filePath);
    }
  }
  return { File, Directory, FileMode: { ReadOnly: 'r', WriteOnly: 'w' }, Paths: {
    document: { get uri() { return getDriver().rootPath; } },
    availableDiskSpace: Number.MAX_SAFE_INTEGER,
  } };
}
