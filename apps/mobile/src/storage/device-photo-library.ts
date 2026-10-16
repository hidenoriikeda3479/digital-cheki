import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { AppError, toAppError } from '@/core/errors';
import type { DevicePhotoLibrary } from '@/services/contracts/download';

export function createDevicePhotoLibrary(): DevicePhotoLibrary {
  return {
    async requestSavePermission() {
      try { return (await requestPermissionsAsync(true, ['photo'])).granted; }
      catch (cause) { throw toAppError(cause); }
    },
    async save(localUri) {
      if (!localUri.startsWith('file://')) throw new AppError('Validation', '保存する写真の参照が不正です。');
      try { await Asset.create(localUri); }
      catch (cause) { throw toAppError(cause); }
    },
  };
}
