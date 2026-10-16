import { readRuntimeConfig } from '@/config/runtime';
import { AppError } from '@/core/errors';
import { systemClock } from '@/core/values';

import type { AppServices } from './contracts/app-services';
import { selectBusinessService } from './select-business-service';

let services: Promise<AppServices> | undefined;

async function initialize(): Promise<AppServices> {
  const config = readRuntimeConfig();
  return selectBusinessService<Promise<AppServices>>(config, {
    mock: async () => {
      // Metroが公開bundleからfixtureと検証画面の依存を除去できる静的な分岐。
      if (__DEV__) {
        const { randomUUID } = await import('expo-crypto');
        const { openSqliteKeyValueStore } = await import('@/storage/sqlite-key-value-store');
        const { createFileStore } = await import('@/storage/file-store');
        const { createPhotoFileStore } = await import('@/storage/photo-file-store');
        const { createTokenStore } = await import('@/storage/token-store');
        const { createActiveCredentialStore } = await import('@/storage/active-credential-store');
        const { createGuestAccessStore } = await import('@/storage/guest-access-store');
        const { createDevicePhotoLibrary } = await import('@/storage/device-photo-library');
        const { createMockServices } = await import('./mock/create-mock-services');
        const { createDemoChekiPhoto } = await import('./mock/demo-cheki-photos');
        return createMockServices(config, {
          storage: await openSqliteKeyValueStore(),
          files: createFileStore(),
          photoFiles: createPhotoFileStore(),
          devicePhotoLibrary: createDevicePhotoLibrary(),
          tokens: createTokenStore(),
          activeCredentials: createActiveCredentialStore(config),
          guestAccess: createGuestAccessStore(config),
          clock: systemClock,
          ids: { next: randomUUID },
          demoChekiPhoto: createDemoChekiPhoto,
        });
      }
      throw new AppError('Configuration', 'モック確認機能は開発用bundleでのみ利用できます。');
    },
  });
}

export function getAppServices(): Promise<AppServices> {
  services ??= initialize();
  return services;
}
