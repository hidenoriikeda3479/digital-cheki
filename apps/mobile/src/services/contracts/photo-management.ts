import type { CapturePhoto } from './capture';
import type { CaptureIntake } from './identification';
import type { BatchUploadSnapshot, BatchUploadStatus } from './batch-upload';

export interface ManagedPhoto { photo: CapturePhoto; displayUri?: string; localDeleted: boolean; deletionPending: boolean }
export interface ManagedIntake {
  intake: CaptureIntake; recipientName: string; idolNames: string[]; uploadStatus: BatchUploadStatus; photos: ManagedPhoto[];
}
export interface LocalPhotoManagementService {
  list(credential: string): Promise<{ intakes: ManagedIntake[]; lowSpace: boolean }>;
  /** One explicit tap acts on one intake. Unknown outcomes are queried before any retry. */
  retryUpload(credential: string, intakeId: string): Promise<BatchUploadSnapshot>;
  deleteUploaded(credential: string, intakeId: string, photoId: string): Promise<void>;
  deleteUploadedBatch?(credential: string, photos: { intakeId: string; photoId: string }[]): Promise<void>;
}
