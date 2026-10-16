import { AppError } from '@/core/errors';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type MockEnvironment, type StorageNamespace } from '@/storage/namespace';
import type { PhotoReceivePort } from '@/services/contracts/download';
import type { SampleArrivalPhoto } from './sample-arrival-photo';
import type { MockUploadServer } from './mock-upload-server';
import catalog from './identification-fixtures.json';
import { demoGroupNames } from './display-names';
import { demoChekiManifest } from './demo-cheki-manifest';

export type DemoChekiPhotoFactory = (namespace: StorageNamespace, index: number) => Promise<SampleArrivalPhoto>;

/** Explicit mock fixture import. Markers prevent restoring received/deleted data on ordinary restarts. */
export async function seedDemoCheki(deps: { environment: MockEnvironment; storage: KeyValueStore; server: MockUploadServer;
  files: PhotoReceivePort; photo: DemoChekiPhotoFactory }) {
  const prefix = buildNamespacePrefix(deps.server.namespace);
  const marker = `${prefix}fixture/member-700001-cheki-v1`;
  const migration = `${prefix}fixture/member-700001-cheki-v2`;
  if (await deps.storage.get(migration) === '1') return;
  const fan: StorageNamespace = { environment: deps.environment, source: 'mock', owner: { kind: 'fan', id: 'fan-a' } };
  for (const item of demoChekiManifest) {
    const done = `${marker}/${item.photoId}`;
    const idol = catalog.idols.find((idol) => idol.id === item.idolId);
    if (!idol) throw new AppError('Configuration', 'デモのアイドル情報がありません。');
    if (await deps.storage.get(done) === '1') {
      await deps.server.reviseDemoCaptureDate({ groupId: idol.groupId, intakeId: item.intakeId,
        photoId: item.photoId, capturedAt: item.capturedAt });
      continue;
    }
    const photo = await deps.photo(deps.server.namespace, item.index);
    try {
      await deps.server.seedDemoCheki({ groupId: idol.groupId, intakeId: item.intakeId, photoId: item.photoId,
        recipientRef: 'recipient-member-a', capturedAt: item.capturedAt, sourceUri: photo.uri, byteSize: photo.byteSize,
        groupName: demoGroupNames[idol.groupId], idolIds: [idol.id], idolNames: [idol.name] });
      if (item.received) {
        const key = `${buildNamespacePrefix(fan)}download/photo/${item.photoId}`;
        const raw = await deps.storage.get(key);
        const row = raw ? JSON.parse(raw) as { status: string } : null;
        if (row?.status !== 'received' && row?.status !== 'removed') {
          await deps.storage.set(key, JSON.stringify({ schemaVersion: 1, fanId: 'fan-a', photoId: item.photoId,
            status: 'receiving', progressPercent: 0 }));
          const existing = await deps.files.inspect(fan, item.photoId);
          const saved = existing?.byteSize === photo.byteSize ? existing
            : await deps.files.copy(deps.server.namespace, fan, item.photoId, photo.byteSize);
          if (saved.byteSize !== photo.byteSize) throw new AppError('Storage', 'デモ受信写真を確認できません。');
          await deps.storage.set(key, JSON.stringify({ schemaVersion: 1, fanId: 'fan-a', photoId: item.photoId,
            status: 'received', progressPercent: 100 }));
        }
      }
      await deps.storage.set(done, '1');
    } finally { photo.remove(); }
  }
  await deps.storage.set(marker, '1');
  await deps.storage.set(migration, '1');
}
