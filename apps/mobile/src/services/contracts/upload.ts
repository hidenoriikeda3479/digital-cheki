import type { EntityId, Instant } from '@/core/values';
import type { StorageNamespace } from '@/storage/namespace';

export type UploadStatus = 'unsent' | 'transferring' | 'failed' | 'needs-attention' | 'uploaded' | 'unknown';
export type RetentionStatus = 'stored' | 'expired' | 'deleted';
export interface UploadPhotoState {
  photoId: EntityId;
  status: UploadStatus;
  progressPercent: number;
  failureCount: number;
  uploadedAt: Instant | null;
  expiresAt: Instant | null;
  retention: RetentionStatus | null;
}
export interface UploadSnapshot {
  intakeId: EntityId;
  photos: UploadPhotoState[];
  notificationCreated: boolean;
}
export interface UploadService {
  observe(credential: string, intakeId: EntityId): Promise<UploadSnapshot>;
  start(credential: string, intakeId: EntityId, photoId: EntityId, onProgress?: (percent: number) => void): Promise<UploadSnapshot>;
  query(credential: string, intakeId: EntityId, photoId: EntityId): Promise<UploadSnapshot>;
}
export interface PhotoTransferPort {
  inspect(server: StorageNamespace, photoId: EntityId): Promise<{ byteSize: number; uri?: string } | null>;
  copy(server: StorageNamespace, photoId: EntityId, sourceUri: string, expectedBytes: number,
    onProgress?: (percent: number) => void): Promise<void>;
  remove(server: StorageNamespace, photoId: EntityId): Promise<void>;
}
export type MockUploadScenario = 'normal' | 'delayed' | 'always-fail' | 'fail-three' | 'save-fail' | 'lost-response';
/** Present only in the development/mock composition. */
export interface MockUploadControls {
  setScenario(credential: string, intakeId: EntityId, photoId: EntityId, scenario: MockUploadScenario): Promise<void>;
  advanceDays(credential: string, days: number): Promise<void>;
}
