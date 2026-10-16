import type { EntityId, Instant } from '@/core/values';
import type { CaptureIntake } from './identification';
import type { CapturePhoto } from './capture';
import type { EditQuality, PhotoEdit } from './editing';

export interface FinishedImage {
  photoId: EntityId; editRevision: number; quality: EditQuality; renderVersion?: 2;
  width: number; height: number; byteSize: number;
  relativeRef: string; uri: string; generatedAt: Instant;
}
export interface SendPreview {
  intake: CaptureIntake;
  idolNames: string[];
  /** Group-authorized recipient display name; guests are shown as ゲスト. */
  recipientLabel: string;
  images: FinishedImage[];
  confirmedAt: Instant | null;
}
export interface FinishedImageRenderer {
  render(photo: CapturePhoto, edit: PhotoEdit, sourceBytes: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }>;
}
export interface FinishedImageService {
  prepare(credential: string, intakeId: EntityId): Promise<SendPreview>;
  /** Read only, revision-matched compositions already stored on this group device. */
  getSaved(credential: string, intakeId: EntityId): Promise<FinishedImage[]>;
  confirm(credential: string, intakeId: EntityId): Promise<SendPreview>;
  isConfirmed(credential: string, intakeId: EntityId): Promise<boolean>;
}
