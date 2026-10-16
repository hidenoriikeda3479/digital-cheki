import type { RuntimeConfig } from '@/config/runtime';
import { AppError } from '@/core/errors';
import type { Clock, IdGenerator } from '@/core/values';
import { createFoundationCheck } from '@/features/foundation-check/create-foundation-check';
import type { FileStore } from '@/storage/file-store';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildMockPrefix, buildNamespacePrefix, type StorageNamespace } from '@/storage/namespace';
import type { TokenStore } from '@/storage/token-store';
import type { ActiveCredentialStore } from '@/storage/active-credential-store';
import { createGuestAccessStore, type GuestAccessStore } from '@/storage/guest-access-store';
import { AuthController } from '@/features/auth/auth-controller';
import { IdentificationController } from '@/features/identification/identification-controller';
import { CaptureController } from '@/features/capture/capture-controller';
import { EditingController } from '@/features/editing/editing-controller';
import { FinishedImageController } from '@/features/finished-image/finished-image-controller';
import { BatchUploadController } from '@/features/upload/batch-upload-controller';
import { DownloadController } from '@/features/download/download-controller';
import { createSkiaFinishedImageRenderer } from '@/features/finished-image/skia-renderer';
import { createLocalCaptureService } from '@/services/local-capture';
import { createLocalEditingService } from '@/services/local-editing';
import { createLocalFinishedImageService } from '@/services/local-finished-image';
import { LocalOperationGate } from '@/services/local-operation-gate';
import { createFinishedImageFiles } from '@/storage/finished-image-files';
import { createMockPhotoTransfer } from '@/storage/mock-photo-transfer';
import type { PhotoTransferPort } from '@/services/contracts/upload';
import { createMockPhotoReceive } from '@/storage/mock-photo-receive';
import type { DevicePhotoLibrary } from '@/services/contracts/download';
import { MockUploadServer } from './mock-upload-server';
import { createSampleArrivalPhoto, type SampleArrivalPhoto } from './sample-arrival-photo';
import { createMockBatchUpload } from './mock-batch-upload';
import { createMockDownloadService } from './mock-download-service';
import { createPhotoFileStore, type PhotoFileStore } from '@/storage/photo-file-store';

import type { AppServices } from '../contracts/app-services';
import { createFixtures, decodeFixtures, SEED_VERSION } from './fixtures';
import { createPersistentMockState } from './persistent-state';
import { createMockAuthService } from './mock-auth';
import { createMockIdentification } from './mock-identification';
import { createMockEnrollment } from './mock-enrollment';
import { createMockSupport } from './mock-support';
import { createLocalPhotoManagement } from '@/services/local-photo-management';
import { renameSeedGroup, renameSeedIdol } from './display-names';
import { seedDemoCheki, type DemoChekiPhotoFactory } from './seed-demo-cheki';

export interface MockDependencies {
  storage: KeyValueStore;
  files: FileStore;
  tokens: TokenStore;
  activeCredentials: ActiveCredentialStore;
  guestAccess?: GuestAccessStore;
  clock: Clock;
  ids: IdGenerator;
  photoFiles?: PhotoFileStore;
  mockPhotoTransfer?: PhotoTransferPort;
  sampleArrivalPhoto?: (namespace: StorageNamespace) => SampleArrivalPhoto;
  demoChekiPhoto?: DemoChekiPhotoFactory;
  devicePhotoLibrary?: DevicePhotoLibrary;
}

export async function createMockServices(config: RuntimeConfig, deps: MockDependencies): Promise<AppServices> {
  if (config.dataSource !== 'mock' || config.appEnvironment === 'production') {
    throw new AppError('Configuration', 'この設定ではモックを利用できません。');
  }
  const environment = config.appEnvironment;
  const server: StorageNamespace = {
    environment, source: 'mock', owner: { kind: 'mock-server', id: 'server' },
  };
  const mockPrefix = buildMockPrefix(environment);
  const resetKey = `${mockPrefix}reset-in-progress`;
  const fixtures = createPersistentMockState(deps.storage, {
    scope: [environment, 'mock-server', 'fixtures'],
    key: `${buildNamespacePrefix(server)}fixtures`,
    schemaVersion: 1,
    seedVersion: SEED_VERSION,
    seed: createFixtures,
    decode: decodeFixtures,
    migrateSeed: (current) => ({ ...current,
      groups: current.groups.map((group) => ({ ...group, label: renameSeedGroup(group.id, group.label) })),
      idols: [...current.idols.map((idol) => ({ ...idol, label: renameSeedIdol(idol.id, idol.label) })),
      ...createFixtures().idols.filter((idol) => !current.idols.some((existing) => existing.id === idol.id))] }),
  });
  const authService = createMockAuthService(deps.storage, `${buildNamespacePrefix(server)}auth`, deps.clock, deps.ids, environment);
  const auth = new AuthController(authService, deps.activeCredentials);
  const identificationService = createMockIdentification(deps.storage, environment, authService, deps.clock, deps.ids,
    () => uploadServer.listCompletedPhotos());
  const identification = new IdentificationController(auth, identificationService);
  const enrollment = createMockEnrollment({ storage: deps.storage, environment, clock: deps.clock, ids: deps.ids,
    auth: authService, identification: identificationService, guestAccess: deps.guestAccess ?? createGuestAccessStore(config) });
  const gate = new LocalOperationGate();
  const photoFiles = deps.photoFiles ?? createPhotoFileStore();
  const finishedFiles = createFinishedImageFiles();
  const captureService = createLocalCaptureService({
    environment, source: 'mock', storage: deps.storage, files: photoFiles,
    auth: authService, identification: identificationService, clock: deps.clock, ids: deps.ids, gate,
  });
  const capture = new CaptureController(auth, captureService);
  const editingService = createLocalEditingService({
    environment, source: 'mock', storage: deps.storage, auth: authService, capture: captureService,
    clock: deps.clock, ids: deps.ids, gate,
  });
  const editing = new EditingController(auth, editingService, deps.ids);
  const finishedService = createLocalFinishedImageService({
    environment, source: 'mock', storage: deps.storage, auth: authService, capture: captureService,
    editing: editingService, identification: identificationService, files: finishedFiles,
    renderer: createSkiaFinishedImageRenderer(), clock: deps.clock, gate,
  });
  const finishedImage = new FinishedImageController(auth, finishedService);
  const uploadServer = new MockUploadServer(environment, deps.storage, deps.mockPhotoTransfer ?? createMockPhotoTransfer(), deps.clock);
  const batchService = createMockBatchUpload({ environment, storage: deps.storage, auth: authService,
    capture: captureService, finished: finishedService, server: uploadServer });
  const upload = new BatchUploadController(auth, batchService);
  const photoManagement = createLocalPhotoManagement({ environment, source: 'mock', auth: authService,
    capture: captureService, identification: identificationService, finished: finishedService,
    upload: batchService, photoFiles, finishedFiles });
  const support = createMockSupport({ environment, storage: deps.storage, auth: authService, clock: deps.clock, ids: deps.ids });
  const receiveFiles = createMockPhotoReceive();
  const downloadServices = createMockDownloadService({ environment, storage: deps.storage, auth: authService,
    identification: identificationService, server: uploadServer, files: receiveFiles,
    devicePhotoLibrary: deps.devicePhotoLibrary, gate });
  const download = new DownloadController(auth, downloadServices.service, downloadServices.controls, downloadServices.albumActions);

  const initial = createFixtures();
  const targets = [
    ...initial.groups.map((group) => ({
      target: group,
      namespace: { environment, source: 'mock', owner: { kind: 'group', id: group.id } } as const,
    })),
    ...initial.fans.map((fan) => ({
      target: fan,
      namespace: { environment, source: 'mock', owner: { kind: 'fan', id: fan.id } } as const,
    })),
    { target: { id: 'mock-server', label: '仮サーバー' }, namespace: server },
  ];

  async function finishReset() {
    await deps.activeCredentials.remove();
    await (deps.guestAccess ?? createGuestAccessStore(config)).remove();
    await deps.files.resetMock(environment);
    for (const { namespace } of targets) {
      if (namespace.owner.kind !== 'mock-server') await deps.tokens.remove(namespace);
    }
    await deps.storage.removePrefix(mockPrefix);
  }

  async function seed() {
    if (await deps.storage.get(resetKey) !== null) await finishReset();
    const snapshot = await fixtures.inspect();
    if (deps.demoChekiPhoto) await seedDemoCheki({ environment, storage: deps.storage, server: uploadServer,
      files: receiveFiles, photo: deps.demoChekiPhoto });
    else await uploadServer.seedSampleArrival(() => (deps.sampleArrivalPhoto ?? createSampleArrivalPhoto)(server));
    return {
      version: snapshot.seedVersion,
      groupCount: snapshot.data.groups.length,
      fanCount: snapshot.data.fans.length,
      idolCount: snapshot.data.idols.length,
    };
  }

  await seed();
  await uploadServer.sweepAll();
  await auth.restore();
  await identification.initialize();
  await capture.initialize();
  const foundationCheck = createFoundationCheck({
    ...deps,
    targets,
    seed,
    async reset() {
      // 初期化の途中終了を次回起動で再開できる。対象は同じmock環境だけ。
      await auth.signOut();
      await deps.storage.set(resetKey, '1');
      await finishReset();
      await seed();
    },
  });
  return { config, foundationCheck, auth, identification, capture, editing, finishedImage, upload, download,
    enrollment: enrollment.service, mockInbox: enrollment.inbox, password: authService, mockPasswordInbox: authService,
    support: support.service, mockSupportInbox: support.inbox, photoManagement };
}
