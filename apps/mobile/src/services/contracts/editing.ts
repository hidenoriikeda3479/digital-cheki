import type { EntityId, Instant } from '@/core/values';

export type FrameId = 'none' | 'white';
export type EditQuality = 'cheki' | 'high';
export type StampId = 'heart' | 'star' | 'circle';
export interface Point { x: number; y: number }
export type EditElement =
  | { kind: 'stroke'; id: EntityId; color: string; width: number; points: Point[] }
  | { kind: 'stamp'; id: EntityId; stamp: StampId; color: string; center: Point; size: number };
/** Points and sizes use the full photo canvas normalized to [0,1]. */
export interface PhotoEdit {
  schemaVersion: 1; photoId: EntityId; intakeId: EntityId; groupId: EntityId;
  originalRef: string; baseWidth: number; baseHeight: number;
  frame: FrameId; quality: EditQuality; elements: EditElement[];
  revision: number; updatedAt: Instant;
}
export interface EditingService {
  load(credential: string, intakeId: EntityId, photoId: EntityId): Promise<PhotoEdit>;
  saveDraft(credential: string, intakeId: EntityId, photoId: EntityId, expectedRevision: number,
    draft: Pick<PhotoEdit, 'frame' | 'quality' | 'elements'>): Promise<PhotoEdit>;
  append(credential: string, intakeId: EntityId, photoId: EntityId, expectedRevision: number, element: EditElement): Promise<PhotoEdit>;
  undo(credential: string, intakeId: EntityId, photoId: EntityId, expectedRevision: number): Promise<PhotoEdit>;
  setFrame(credential: string, intakeId: EntityId, photoId: EntityId, expectedRevision: number, frame: FrameId): Promise<PhotoEdit>;
  setQuality(credential: string, intakeId: EntityId, photoId: EntityId, expectedRevision: number, quality: EditQuality): Promise<PhotoEdit>;
}
