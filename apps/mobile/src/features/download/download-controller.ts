import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { AuthController } from '@/features/auth/auth-controller';
import type { DownloadIntake, DownloadService, LocalAlbumActions, MockDownloadControls } from '@/services/contracts/download';
import { emptyAlbumFilter, type AlbumFilter } from './album-filter';

export interface ReceiveBatchItem {
  intakeId: string; photoId: string; uri: string | null;
  status: 'pending' | 'saved' | 'failed' | 'expired' | 'unknown'; error: ErrorCode | null;
}
export interface ReceiveBatch {
  status: 'preparing' | 'receiving' | 'complete' | 'failed' | 'interrupted';
  items: ReceiveBatchItem[]; attempt: number;
}
export interface DownloadScreenState {
  phase: 'closed' | 'list' | 'photo' | 'search' | 'favorites';
  intakes: DownloadIntake[];
  receiveStatus: 'loading' | 'ready' | 'error';
  receiveBatch: ReceiveBatch | null;
  searchBackPhase: 'list' | 'favorites';
  filter: AlbumFilter;
  photoBackPhase: 'list' | 'search' | 'favorites';
  selectedIntakeId: string | null;
  selectedPhotoId: string | null;
  busy: boolean;
  favoritePhotoId: string | null;
  activePhotoId: string | null;
  progressPercent: number;
  error: ErrorCode | null;
  selecting: boolean;
  selectedPhotoIds: string[];
  batchOperation: 'save' | 'delete' | null;
  batchCompleted: number;
  batchTotal: number;
  batchMessage: string | null;
}
const empty = (): DownloadScreenState => ({ phase: 'closed', intakes: [], receiveStatus: 'loading',
  receiveBatch: null, searchBackPhase: 'list', filter: emptyAlbumFilter(),
  photoBackPhase: 'list', selectedIntakeId: null,
  selectedPhotoId: null, busy: false, favoritePhotoId: null, activePhotoId: null, progressPercent: 0, error: null,
  selecting: false, selectedPhotoIds: [], batchOperation: null, batchCompleted: 0, batchTotal: 0, batchMessage: null });

export class DownloadController {
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private state = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private receiveRequest = 0;
  private credential: string | null;
  constructor(private readonly auth: AuthController, private readonly service: DownloadService,
    readonly controls?: MockDownloadControls, private readonly albumActions?: LocalAlbumActions) {
    this.credential = auth.getSnapshot().session?.credential ?? null;
    auth.subscribe(() => {
      const next = auth.getSnapshot().session?.credential ?? null;
      if (next !== this.credential) { this.credential = next; ++this.generation; ++this.receiveRequest; this.publish(empty()); }
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: DownloadScreenState) {
    const messageChanged = value.batchMessage !== this.state.batchMessage || value.error !== this.state.error;
    this.state = value;
    if (messageChanged) {
      if (this.messageTimer) clearTimeout(this.messageTimer);
      this.messageTimer = null;
      if (value.batchMessage && !value.error) {
        const message = value.batchMessage;
        this.messageTimer = setTimeout(() => {
          this.messageTimer = null;
          if (this.state.batchMessage === message && !this.state.error) this.publish({ ...this.state, batchMessage: null });
        }, 3000);
      }
    }
    this.listeners.forEach((listener) => listener());
  }
  private current() {
    const session = this.auth.getSnapshot().session;
    if (!session || (session.principal.role !== 'fan' && session.principal.role !== 'guest') || session.credential !== this.credential) {
      throw new AppError('Forbidden', '受取画面を表示できません。');
    }
    return session.credential;
  }
  async refreshReceivables() {
    const credential = this.current();
    if (this.state.busy) return;
    const generation = this.generation;
    const request = ++this.receiveRequest;
    this.publish({ ...this.state, receiveStatus: 'loading' });
    try {
      const intakes = await this.service.list(credential);
      if (generation === this.generation && request === this.receiveRequest) {
        this.publish({ ...this.state, intakes, receiveStatus: 'ready' });
      }
    } catch {
      if (generation === this.generation && request === this.receiveRequest) {
        this.publish({ ...this.state, receiveStatus: 'error' });
      }
    }
  }
  async open(mode: 'list' | 'search' | 'favorites' = 'list') {
    const credential = this.current();
    if (this.state.busy || this.state.receiveBatch) return;
    const generation = ++this.generation;
    ++this.receiveRequest;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      const intakes = await this.service.list(credential);
      if (generation === this.generation) this.publish({ ...empty(), phase: mode,
        intakes, receiveStatus: 'ready' });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, receiveStatus: 'error', error: toAppError(cause).code });
    }
  }
  async refresh() {
    const credential = this.current();
    if (this.state.busy) return;
    const generation = this.generation;
    ++this.receiveRequest;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      const intakes = await this.service.list(credential);
      if (generation === this.generation) this.publish({ ...this.state, intakes, receiveStatus: 'ready', busy: false });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, receiveStatus: 'error', error: toAppError(cause).code });
    }
  }
  showSearch() {
    this.current();
    if (this.state.busy || (this.state.phase !== 'list' && this.state.phase !== 'favorites')) return;
    this.publish({ ...this.state, searchBackPhase: this.state.phase, phase: 'search' });
  }
  closeSearch() {
    this.current();
    if (this.state.phase === 'search') this.publish({ ...this.state, phase: this.state.searchBackPhase });
  }
  showFavorites() {
    this.current();
    if (this.state.busy) return;
    if (this.state.phase === 'favorites' || this.state.filter.favoritesOnly) {
      this.publish({ ...this.state, phase: 'list', filter: { ...this.state.filter, favoritesOnly: false } });
    } else this.publish({ ...this.state, phase: 'favorites' });
  }
  setFilter(change: Partial<AlbumFilter>) {
    this.current();
    this.publish({ ...this.state, filter: { ...this.state.filter, ...change } });
  }
  clearFilters() { this.current(); this.publish({ ...this.state, filter: emptyAlbumFilter() }); }
  toggleSelectionMode() {
    this.current();
    if (this.state.busy || !['list', 'favorites'].includes(this.state.phase)) return;
    this.publish({ ...this.state, selecting: !this.state.selecting, selectedPhotoIds: [], batchMessage: null });
  }
  toggleSelected(photoId: string) {
    this.current();
    if (!this.state.selecting || this.state.busy || !this.state.intakes.some((intake) => intake.photos.some((photo) =>
      photo.photoId === photoId && photo.status === 'received' && !!photo.localUri))) return;
    const selected = this.state.selectedPhotoIds;
    this.publish({ ...this.state, selectedPhotoIds: selected.includes(photoId)
      ? selected.filter((id) => id !== photoId) : [...selected, photoId], batchMessage: null });
  }
  private selectedPhotos() {
    const selected = new Set(this.state.selectedPhotoIds);
    return this.state.intakes.flatMap((intake) => intake.photos.filter((photo) => selected.has(photo.photoId) &&
      photo.status === 'received' && !!photo.localUri).map((photo) => ({ intakeId: intake.intakeId, photoId: photo.photoId })));
  }
  canManageLocalPhotos() { return !!this.albumActions; }
  async saveCurrentPhoto() { await this.runCurrentPhotoAction('save'); }
  async deleteCurrentPhoto() { await this.runCurrentPhotoAction('delete'); }
  private async runCurrentPhotoAction(action: 'save' | 'delete') {
    this.current();
    const photoId = this.state.selectedPhotoId;
    if (this.state.busy || this.state.phase !== 'photo' || !photoId || !this.albumActions) return;
    const generation = this.generation;
    this.publish({ ...this.state, selecting: true, selectedPhotoIds: [photoId] });
    if (action === 'save') await this.saveSelectedToPhotoLibrary();
    else await this.deleteSelected();
    if (generation !== this.generation) return;
    this.publish({ ...this.state, selecting: false, selectedPhotoIds: [] });
    if (action === 'delete' && !this.state.error) this.back();
  }
  async saveSelectedToPhotoLibrary() {
    const credential = this.current();
    if (this.state.busy || !this.state.selecting || !this.albumActions) return;
    const photos = this.selectedPhotos();
    if (!photos.length || photos.length !== this.state.selectedPhotoIds.length) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, batchOperation: 'save', batchCompleted: 0, batchTotal: photos.length,
      batchMessage: null, error: null });
    let completed = 0;
    try {
      if (!(await this.albumActions.requestSavePermission())) throw new AppError('Forbidden', '写真アプリへの保存が許可されていません。');
      for (const photo of photos) {
        if (generation !== this.generation) return;
        await this.albumActions.saveToPhotoLibrary(credential, photo.intakeId, photo.photoId);
        completed++;
        if (generation === this.generation) this.publish({ ...this.state, batchCompleted: completed });
      }
      if (generation === this.generation) this.publish({ ...this.state, busy: false, batchOperation: null,
        selecting: false, selectedPhotoIds: [], batchMessage: `${completed}枚を写真アプリに保存しました。` });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, batchOperation: null,
        selectedPhotoIds: photos.slice(completed).map((photo) => photo.photoId),
        batchMessage: completed ? `${completed}枚を保存しました。残りは再操作してください。` : null,
        error: toAppError(cause).code });
    }
  }
  async deleteSelected() {
    const credential = this.current();
    if (this.state.busy || !this.state.selecting || !this.albumActions) return;
    const photos = this.selectedPhotos();
    if (!photos.length || photos.length !== this.state.selectedPhotoIds.length) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, batchOperation: 'delete', batchCompleted: 0, batchTotal: photos.length,
      batchMessage: null, error: null });
    let completed = 0;
    try {
      for (const photo of photos) {
        if (generation !== this.generation) return;
        const intakes = await this.albumActions.deleteReceived(credential, photo.intakeId, photo.photoId);
        completed++;
        if (generation === this.generation) this.publish({ ...this.state, intakes, batchCompleted: completed,
          selectedPhotoIds: photos.slice(completed).map((item) => item.photoId) });
      }
      if (generation === this.generation) this.publish({ ...this.state, busy: false, batchOperation: null,
        selecting: false, selectedPhotoIds: [], batchMessage: `${completed}枚をアプリ内の写真一覧から削除しました。` });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, batchOperation: null,
        selectedPhotoIds: photos.slice(completed).map((photo) => photo.photoId),
        batchMessage: completed ? `${completed}枚を削除しました。残りは再操作してください。` : null,
        error: toAppError(cause).code });
    }
  }
  showPhoto(photoId: string) {
    this.current();
    const photo = this.state.intakes.flatMap((item) => item.photos).find((item) => item.photoId === photoId);
    if (photo?.status !== 'received' || !photo.localUri) return;
    const photoBackPhase = this.state.phase === 'photo' ? this.state.photoBackPhase
      : this.state.phase === 'search' || this.state.phase === 'favorites' ? this.state.phase : 'list';
    this.publish({ ...this.state, phase: 'photo', selectedIntakeId: photo.intakeId,
      selectedPhotoId: photoId, photoBackPhase });
  }
  async setFavorite(photoId: string, favorite: boolean) {
    const credential = this.current();
    const photo = this.state.intakes.flatMap((item) => item.photos).find((item) => item.photoId === photoId);
    if (!photo || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, favoritePhotoId: photoId, error: null });
    try {
      const intakes = await this.service.setFavorite(credential, photo.intakeId, photoId, favorite);
      if (generation === this.generation) this.publish({ ...this.state, intakes, busy: false, favoritePhotoId: null });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, favoritePhotoId: null, error: toAppError(cause).code });
    }
  }
  async receiveIntake(intakeId: string) {
    await this.startReceive(intakeId);
  }
  async receiveAll() {
    await this.startReceive();
  }
  async startReceive(intakeId?: string) {
    this.current();
    if (this.state.busy || this.state.receiveBatch || this.state.phase !== 'closed') return;
    const items: ReceiveBatchItem[] = this.state.intakes.filter((intake) => !intakeId || intake.intakeId === intakeId)
      .flatMap((intake) => intake.photos.filter((photo) => ['unreceived', 'failed', 'expired'].includes(photo.status))
        .map((photo) => ({ intakeId: intake.intakeId, photoId: photo.photoId, uri: photo.previewUri ?? null,
          status: 'pending' as const, error: null })));
    if (!items.length) return;
    await this.runReceive(items, 1);
  }
  async retryReceive() {
    this.current();
    const batch = this.state.receiveBatch;
    if (!batch || this.state.busy || batch.status === 'complete') return;
    await this.runReceive(batch.items.map((item) => item.status === 'saved' ? item
      : { ...item, status: 'pending', error: null }), batch.attempt + 1);
  }
  dismissReceive() {
    this.current();
    if (!this.state.busy) this.publish({ ...this.state, receiveBatch: null });
  }
  stopReceiveWait() {
    this.current();
    if (!this.state.busy || !this.state.receiveBatch) return;
    ++this.generation; ++this.receiveRequest;
    this.publish({ ...this.state, busy: false, activePhotoId: null, progressPercent: 0,
      receiveBatch: { ...this.state.receiveBatch, status: 'interrupted', items: this.state.receiveBatch.items.map((item) =>
        item.status === 'pending' ? { ...item, status: 'unknown', error: 'UnknownOutcome' } : item) } });
  }
  private reconcileReceive(intakes: DownloadIntake[]) {
    const batch = this.state.receiveBatch;
    if (!batch) return;
    const items = batch.items.map((item): ReceiveBatchItem => {
      const photo = intakes.find((intake) => intake.intakeId === item.intakeId)?.photos.find((photo) => photo.photoId === item.photoId);
      if (photo?.status === 'received' && photo.localUri) return { ...item, status: 'saved', uri: photo.localUri, error: null };
      if (photo?.status === 'expired') return { ...item, status: 'expired', error: 'Expired', uri: null };
      if (photo?.status === 'removed') return { ...item, status: 'failed', error: 'Conflict', uri: null };
      if (!photo) return { ...item, status: 'failed', error: 'NotFound', uri: null };
      return item;
    });
    this.publish({ ...this.state, intakes, receiveStatus: 'ready', receiveBatch: { ...batch, items } });
  }
  private failReceiveItem(photoId: string, error: ErrorCode) {
    const batch = this.state.receiveBatch;
    if (!batch) return;
    this.publish({ ...this.state, receiveBatch: { ...batch, items: batch.items.map((item) => item.photoId === photoId
      ? { ...item, status: error === 'Expired' ? 'expired' : error === 'UnknownOutcome' ? 'unknown' : 'failed', error } : item) } });
  }
  private async runReceive(items: ReceiveBatchItem[], attempt: number) {
    const credential = this.current();
    const generation = ++this.generation;
    ++this.receiveRequest;
    this.publish({ ...this.state, busy: true, activePhotoId: null, progressPercent: 0, error: null,
      receiveBatch: { status: 'preparing', items, attempt } });
    try {
      const current = await this.service.list(credential);
      if (generation !== this.generation) return;
      this.reconcileReceive(current);
      const preparedBatch = this.state.receiveBatch;
      if (!preparedBatch) return;
      this.publish({ ...this.state, receiveBatch: { ...preparedBatch, status: 'receiving' } });
      for (const target of items) {
        if (generation !== this.generation) return;
        const item = this.state.receiveBatch?.items.find((item) => item.photoId === target.photoId);
        if (item?.status !== 'pending') continue;
        this.publish({ ...this.state, activePhotoId: target.photoId, progressPercent: 0 });
        try {
          const intakes = await this.service.download(credential, target.intakeId, target.photoId, (progressPercent) => {
            if (generation === this.generation) this.publish({ ...this.state, progressPercent });
          });
          if (generation !== this.generation) return;
          this.reconcileReceive(intakes);
          if (this.state.receiveBatch?.items.find((item) => item.photoId === target.photoId)?.status !== 'saved')
            this.failReceiveItem(target.photoId, 'Storage');
        } catch (cause) {
          if (generation !== this.generation) return;
          this.failReceiveItem(target.photoId, toAppError(cause).code);
        }
      }
      const intakes = await this.service.list(credential);
      if (generation !== this.generation) return;
      this.reconcileReceive(intakes);
    } catch (cause) {
      if (generation !== this.generation) return;
      for (const item of this.state.receiveBatch?.items ?? []) {
        if (item.status === 'pending') this.failReceiveItem(item.photoId, toAppError(cause).code);
      }
      this.publish({ ...this.state, receiveStatus: 'error' });
    }
    if (generation !== this.generation || !this.state.receiveBatch) return;
    const batch = this.state.receiveBatch;
    this.publish({ ...this.state, busy: false, activePhotoId: null, progressPercent: 0,
      receiveBatch: { ...batch, status: batch.items.every((item) => item.status === 'saved') ? 'complete' : 'failed' } });
  }
  close() {
    this.current();
    if (this.state.busy) return;
    ++this.generation; ++this.receiveRequest;
    this.publish({ ...empty(), intakes: this.state.intakes, receiveStatus: this.state.receiveStatus });
  }
  back() {
    this.current();
    if (this.state.busy) return;
    if (this.state.phase === 'photo') this.publish({ ...this.state, phase: this.state.photoBackPhase, selectedPhotoId: null });
    else if (this.state.phase === 'search' || this.state.phase === 'favorites') {
      this.publish({ ...this.state, phase: this.state.phase === 'search' ? this.state.searchBackPhase : 'list' });
    }
    else { ++this.generation; ++this.receiveRequest;
      this.publish({ ...empty(), intakes: this.state.intakes, receiveStatus: this.state.receiveStatus }); }
  }
}
