import type { StorageNamespace } from '@/storage/namespace';

export type DownloadStatus = 'unreceived' | 'receiving' | 'failed' | 'received' | 'removed' | 'expired';
export interface DownloadPhoto {
  photoId: string;
  intakeId: string;
  capturedAt: string;
  expiresAt: string;
  status: DownloadStatus;
  progressPercent: number;
  localUri: string | null;
  /** Authorized, temporary preview of an unreceived image; never implies receipt. */
  previewUri?: string | null;
  favorite: boolean;
}
export interface DownloadIntake {
  intakeId: string; createdAt: string; groupId: string; groupName: string;
  idolIds: string[]; idolNames: string[]; photos: DownloadPhoto[];
}
export interface ArrivalNotification {
  intakeId: string; createdAt: string; message: string; read: boolean;
}
export interface DownloadService {
  list(credential: string): Promise<DownloadIntake[]>;
  download(credential: string, intakeId: string, photoId: string,
    onProgress?: (percent: number) => void): Promise<DownloadIntake[]>;
  setFavorite(credential: string, intakeId: string, photoId: string, favorite: boolean): Promise<DownloadIntake[]>;
  listNotifications(credential: string): Promise<ArrivalNotification[]>;
  markNotificationRead(credential: string, intakeId: string): Promise<void>;
}
/** File transfer is isolated from screens and the mock server's authorization checks. */
export interface PhotoReceivePort {
  inspect(fan: StorageNamespace, photoId: string): Promise<{ uri: string; byteSize: number } | null>;
  copy(server: StorageNamespace, fan: StorageNamespace, photoId: string, expectedBytes: number,
    onProgress?: (percent: number) => void, failAfterBytes?: number): Promise<{ uri: string; byteSize: number }>;
  remove(fan: StorageNamespace, photoId: string): Promise<void>;
}
/** Local album actions never delete an uploaded image or a copy in the OS photo library. */
export interface LocalAlbumActions {
  requestSavePermission(): Promise<boolean>;
  saveToPhotoLibrary(credential: string, intakeId: string, photoId: string): Promise<void>;
  deleteReceived(credential: string, intakeId: string, photoId: string): Promise<DownloadIntake[]>;
}
export interface DevicePhotoLibrary {
  requestSavePermission(): Promise<boolean>;
  save(localUri: string): Promise<void>;
}
export type MockDownloadScenario = 'normal' | 'fail-midway';
export interface MockDownloadControls {
  setScenario(credential: string, intakeId: string, photoId: string, scenario: MockDownloadScenario): Promise<void>;
}
