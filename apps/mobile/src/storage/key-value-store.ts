export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Literal prefix, not a SQL LIKE pattern. Empty prefixes are rejected. */
  removePrefix(prefix: string): Promise<void>;
}
