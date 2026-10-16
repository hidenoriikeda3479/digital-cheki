import type { EntityId } from '@/core/values';

/** One visible and persisted outcome per capture intake. Server photo receipts remain independent for delivery and expiry. */
export type BatchUploadStatus = 'unsent' | 'sending' | 'failed' | 'unknown' | 'uploaded';
export interface BatchUploadSnapshot {
  intakeId: EntityId;
  status: BatchUploadStatus;
  photoCount: number;
  failureCount: number;
}
export interface BatchUploadService {
  observe(credential: string, intakeId: EntityId): Promise<BatchUploadSnapshot>;
  send(credential: string, intakeId: EntityId): Promise<BatchUploadSnapshot>;
  query(credential: string, intakeId: EntityId): Promise<BatchUploadSnapshot>;
}
