import type { EntityId, Instant } from '@/core/values';

export interface CheckTarget { id: string; label: string }
export interface CheckRecord { id: EntityId; savedAt: Instant; fileName: string }
export interface CheckSnapshot {
  target: CheckTarget;
  record: CheckRecord | null;
  fileContents: string | null;
  seed: { version: number; groupCount: number; fanCount: number; idolCount: number };
}

// 端末保存の確認専用ポート。本番HTTPエンドポイントや認証の契約ではない。
export interface FoundationCheckService {
  readonly targets: readonly CheckTarget[];
  read(targetId: string): Promise<CheckSnapshot>;
  save(targetId: string): Promise<CheckSnapshot>;
  reset(confirmation: 'RESET_MOCK_DATA'): Promise<void>;
}
