import type { EntityId, Instant } from '@/core/values';
import type { CaptureIntake } from './identification';

export interface CapturePhoto {
  id: EntityId;
  intakeId: EntityId;
  capturedAt: Instant;
  width: number;
  height: number;
  format: 'jpg' | 'png';
  originalRef: string;
  thumbnailRef: string;
  originalUri: string;
  thumbnailUri: string;
  /** Metadata remains for completed upload history after device files are manually removed. */
  localDeleted?: boolean;
  localDeletionPending?: boolean;
}
export interface CaptureSessionSummary { intake: CaptureIntake; photoCount: number; needsAttention: boolean; confirmed?: boolean }

/** Local photo operations validate the credential and intake owner on every entry. */
export interface CaptureService {
  listSessions(credential: string): Promise<CaptureSessionSummary[]>;
  listPhotos(credential: string, intakeId: EntityId): Promise<CapturePhoto[]>;
  savePhoto(credential: string, intakeId: EntityId, source: { uri: string; width: number; height: number; format: 'jpg' | 'png' }): Promise<CapturePhoto>;
  discardPhoto(credential: string, intakeId: EntityId, photoId: EntityId): Promise<void>;
}
