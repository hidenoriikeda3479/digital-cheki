import type { DownloadIntake, DownloadPhoto } from '@/services/contracts/download';

export interface AlbumFilter {
  groupId: string | null;
  idolId: string | null;
  capturedDate: string | null;
  favoritesOnly: boolean;
}
export interface AlbumEntry { intake: DownloadIntake; photo: DownloadPhoto }
export const emptyAlbumFilter = (): AlbumFilter => ({ groupId: null, idolId: null, capturedDate: null, favoritesOnly: false });

/** The user's local calendar day, independent of the UTC date in the stored instant. */
export function localCaptureDate(instant: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export function filterAlbum(intakes: DownloadIntake[], filter: AlbumFilter): AlbumEntry[] {
  return intakes.flatMap((intake) => intake.photos.map((photo) => ({ intake, photo })))
    .filter(({ intake, photo }) => photo.status === 'received' && !!photo.localUri &&
      (!filter.groupId || intake.groupId === filter.groupId) &&
      (!filter.idolId || intake.idolIds.includes(filter.idolId)) &&
      (!filter.capturedDate || localCaptureDate(photo.capturedAt) === filter.capturedDate) &&
      (!filter.favoritesOnly || photo.favorite))
    .sort((a, b) => Date.parse(b.photo.capturedAt) - Date.parse(a.photo.capturedAt) ||
      a.photo.photoId.localeCompare(b.photo.photoId));
}
