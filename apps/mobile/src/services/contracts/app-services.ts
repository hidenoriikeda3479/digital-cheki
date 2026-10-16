import type { RuntimeConfig } from '@/config/runtime';
import type { FoundationCheckService } from './foundation-check';
import type { AuthController } from '@/features/auth/auth-controller';
import type { IdentificationController } from '@/features/identification/identification-controller';
import type { CaptureController } from '@/features/capture/capture-controller';
import type { EditingController } from '@/features/editing/editing-controller';
import type { FinishedImageController } from '@/features/finished-image/finished-image-controller';
import type { BatchUploadController } from '@/features/upload/batch-upload-controller';
import type { DownloadController } from '@/features/download/download-controller';
import type { EnrollmentService, MockEnrollmentInbox } from './enrollment';
import type { PasswordService, MockPasswordInbox } from './password';
import type { SupportService, MockSupportInbox } from './support';
import type { LocalPhotoManagementService } from './photo-management';

export interface AppServices {
  config: RuntimeConfig;
  foundationCheck: FoundationCheckService;
  auth: AuthController;
  identification: IdentificationController;
  capture: CaptureController;
  editing: EditingController;
  finishedImage: FinishedImageController;
  upload: BatchUploadController;
  download: DownloadController;
  enrollment: EnrollmentService;
  mockInbox?: MockEnrollmentInbox;
  password: PasswordService;
  mockPasswordInbox?: MockPasswordInbox;
  support: SupportService;
  mockSupportInbox?: MockSupportInbox;
  photoManagement: LocalPhotoManagementService;
}
