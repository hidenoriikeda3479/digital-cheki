import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { AppError } from '@/core/errors';
import type { DemoChekiPhotoFactory } from './seed-demo-cheki';

const assets = [
  require('../../../assets/mock-cheki/cheki-01.jpg'),
  require('../../../assets/mock-cheki/cheki-02.jpg'),
  require('../../../assets/mock-cheki/cheki-03.jpg'),
  require('../../../assets/mock-cheki/cheki-04.jpg'),
  require('../../../assets/mock-cheki/cheki-05.jpg'),
  require('../../../assets/mock-cheki/cheki-06.jpg'),
  require('../../../assets/mock-cheki/cheki-07.jpg'),
  require('../../../assets/mock-cheki/cheki-08.jpg'),
  require('../../../assets/mock-cheki/cheki-09.jpg'),
  require('../../../assets/mock-cheki/cheki-10.jpg'),
  require('../../../assets/mock-cheki/cheki-11.jpg'),
  require('../../../assets/mock-cheki/cheki-12.jpg'),
  require('../../../assets/mock-cheki/cheki-13.jpg'),
  require('../../../assets/mock-cheki/cheki-14.jpg'),
  require('../../../assets/mock-cheki/cheki-15.jpg'),
  require('../../../assets/mock-cheki/cheki-16.jpg'),
  require('../../../assets/mock-cheki/cheki-17.jpg'),
  require('../../../assets/mock-cheki/cheki-18.jpg'),
  require('../../../assets/mock-cheki/cheki-19.jpg'),
];

/** Bundled demo assets; downloadAsync uses Metro in development, not a business/remote image API. */
export const createDemoChekiPhoto: DemoChekiPhotoFactory = async (namespace, index) => {
  if (namespace.source !== 'mock' || namespace.owner.kind !== 'mock-server' || !assets[index]) {
    throw new AppError('Configuration', 'デモ写真の指定が不正です。');
  }
  const asset = await Asset.fromModule(assets[index]).downloadAsync();
  if (!asset.localUri) throw new AppError('Storage', 'デモ画像を端末に読み込めません。');
  const file = new File(asset.localUri);
  if (!file.exists || file.size <= 0) throw new AppError('Storage', 'デモ画像がありません。');
  return { uri: file.uri, byteSize: file.size, remove: () => {} };
};
