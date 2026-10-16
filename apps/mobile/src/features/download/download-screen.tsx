import { useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { PhotoViewer } from '@/components/photo-viewer';
import type { DownloadController } from './download-controller';
import { AlbumGallery } from './album-gallery';
import { filterAlbum, localCaptureDate } from './album-filter';

export function DownloadScreen({ controller, embeddedAlbum = false, embedded = false, initialDisplay, backgroundProvided = false }: {
  controller: DownloadController; embeddedAlbum?: boolean; embedded?: boolean; initialDisplay?: 'list' | 'second'; backgroundProvided?: boolean;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const selected = state.intakes.find((item) => item.intakeId === state.selectedIntakeId);
  const selectedPhoto = selected?.photos.find((item) => item.photoId === state.selectedPhotoId);
  const viewerEntries = filterAlbum(state.intakes, { ...state.filter,
    favoritesOnly: state.photoBackPhase === 'favorites' || state.filter.favoritesOnly });
  // Keep the open image visible if its like is removed while browsing favorites.
  if (selected && selectedPhoto?.status === 'received' && selectedPhoto.localUri &&
    !viewerEntries.some(({ photo }) => photo.photoId === selectedPhoto.photoId)) {
    viewerEntries.push({ intake: selected, photo: selectedPhoto });
  }
  const viewer = state.phase === 'photo' ? <PhotoViewer visible onClose={() => controller.back()}
    photo={selectedPhoto?.localUri ? { id: selectedPhoto.photoId, uri: selectedPhoto.localUri,
      thumbnailUri: selectedPhoto.localUri } : null}
    photos={viewerEntries.map(({ photo }) => ({
        id: photo.photoId, uri: photo.localUri!, thumbnailUri: photo.localUri!,
      }))}
    onSelect={(id) => controller.showPhoto(id)}
    date={selectedPhoto ? localCaptureDate(selectedPhoto.capturedAt).replaceAll('-', '/') : undefined}
    details={selected?.idolNames.join('・')}
    busy={state.busy}
    message={state.busy ? state.batchOperation === 'save' ? '保存中…' : state.batchOperation === 'delete' ? '削除中…' : '更新中…'
      : state.error ? state.error === 'Forbidden' ? '写真への保存を許可してください。' : '処理できませんでした。もう一度お試しください。' : state.batchMessage}
    actions={selectedPhoto ? { favorite: selectedPhoto.favorite, localActionsAvailable: controller.canManageLocalPhotos(),
      onSave: () => { void controller.saveCurrentPhoto(); },
      onFavorite: () => { void controller.setFavorite(selectedPhoto.photoId, !selectedPhoto.favorite); },
      onDelete: () => {
        const photoId = selectedPhoto.photoId;
        Alert.alert('写真を削除しますか？', '削除後は再受信できません。写真アプリに保存済みのコピーは削除されません。', [
          { text: 'キャンセル', style: 'cancel' },
          { text: '削除', style: 'destructive', onPress: () => {
            if (controller.getSnapshot().selectedPhotoId === photoId) void controller.deleteCurrentPhoto();
          } },
        ]);
      },
    } : undefined}
    placeholder="写真を表示できません。"
    ids={{ modal: 'album-photo-modal', safe: 'album-photo-safe', close: 'album-photo-back',
      image: 'album-photo-large', filmstrip: 'album-photo-filmstrip', filmPrefix: 'album-photo-film-',
      unavailable: 'album-photo-unavailable', date: 'album-photo-date', details: 'album-photo-idols' }} /> : null;
  if (state.phase === 'photo' || state.phase === 'list' || state.phase === 'search' || state.phase === 'favorites') {
    return <><AlbumGallery controller={controller}
      state={state.phase === 'photo' ? { ...state, phase: state.photoBackPhase } : state}
      embedded={embedded || embeddedAlbum} initialDisplay={initialDisplay} backgroundProvided={backgroundProvided} />{viewer}</>;
  }
  return null;
}
