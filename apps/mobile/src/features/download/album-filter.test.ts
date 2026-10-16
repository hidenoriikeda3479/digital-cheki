import type { DownloadIntake, DownloadPhoto } from '@/services/contracts/download';
import { emptyAlbumFilter, filterAlbum, localCaptureDate } from './album-filter';

const photo = (photoId: string, intakeId: string, capturedAt: string, favorite: boolean): DownloadPhoto => ({
  photoId, intakeId, capturedAt, favorite, expiresAt: '2026-10-02T00:00:00.000Z',
  status: 'received', progressPercent: 100, localUri: `file:///${photoId}.jpg`,
});
const intakes: DownloadIntake[] = [
  { intakeId: 'i1', createdAt: '2026-09-25T01:00:00.000Z', groupId: 'group-a', groupName: 'Group A',
    idolIds: ['idol-a', 'idol-a2'], idolNames: ['A', 'A2'], photos: [
      photo('p1', 'i1', '2026-09-25T00:10:00.000Z', true), photo('p2', 'i1', '2026-09-25T00:11:00.000Z', false),
    ] },
  { intakeId: 'i2', createdAt: '2026-09-25T02:00:00.000Z', groupId: 'group-b', groupName: 'Group B',
    idolIds: ['idol-b'], idolNames: ['B'], photos: [photo('p3', 'i2', '2026-09-24T00:00:00.000Z', true)] },
];

it('combines group, any participating idol, local shooting date and favorite filters, then clears them', () => {
  const day = localCaptureDate(intakes[0].photos[0].capturedAt);
  const filtered = filterAlbum(intakes, { groupId: 'group-a', idolId: 'idol-a2', capturedDate: day, favoritesOnly: true });
  expect(filtered.map((entry) => entry.photo.photoId)).toEqual(['p1']);
  expect(filterAlbum(intakes, emptyAlbumFilter()).map((entry) => entry.photo.photoId)).toEqual(['p2', 'p1', 'p3']);
  expect(filterAlbum(intakes, { ...emptyAlbumFilter(), idolId: 'idol-a2' }).map((entry) => entry.photo.photoId))
    .toEqual(['p2', 'p1']);
});
