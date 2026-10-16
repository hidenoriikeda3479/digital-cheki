import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { AuthController } from '@/features/auth/auth-controller';
import type { CapturePhoto, CaptureService } from '@/services/contracts/capture';

export type CapturePhase = 'home' | 'camera' | 'review';
export interface CaptureSnapshot {
  phase: CapturePhase; busy: boolean; error: ErrorCode | null;
  intakeId: string | null;
  photos: CapturePhoto[];
  confirmed: boolean;
}
function empty(): CaptureSnapshot {
  return { phase: 'home', busy: false, error: null, intakeId: null, photos: [], confirmed: false };
}

export class CaptureController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private credential: string | null = null;
  private generation = 0;
  private operation = 0;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly auth: AuthController, private readonly service: CaptureService) {
    auth.subscribe(() => { this.pending = this.synchronize(); });
  }
  getSnapshot = (): CaptureSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: CaptureSnapshot) { this.snapshot = next; this.listeners.forEach((listener) => listener()); }
  async initialize() { await this.pending; await this.synchronize(); }

  private async synchronize() {
    const session = this.auth.getSnapshot().session;
    const credential = session?.credential ?? null;
    if (credential === this.credential) return;
    this.credential = credential;
    ++this.generation;
    ++this.operation;
    this.publish(empty());
  }
  private current(): string {
    const session = this.auth.getSnapshot().session;
    if (!session || session.principal.role !== 'group' || session.credential !== this.credential) {
      throw new AppError('Forbidden', '撮影画面を利用できません。');
    }
    return session.credential;
  }
  async openIntake(intakeId: string) {
    const credential = this.current();
    if (this.snapshot.busy) return;
    const generation = this.generation;
    const operation = ++this.operation;
    this.publish({ ...this.snapshot, busy: true, error: null });
    try {
      const photos = await this.service.listPhotos(credential, intakeId);
      const sessions = await this.service.listSessions(credential);
      const visible = photos.filter((photo) => !photo.localDeleted);
      const confirmed = !!sessions.find((item) => item.intake.id === intakeId)?.confirmed;
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot,
        phase: visible.length || confirmed ? 'review' : 'camera', busy: false, intakeId, photos: visible,
        confirmed });
    } catch (cause) {
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
    }
  }
  openCamera() {
    this.current();
    if (!this.snapshot.busy && !this.snapshot.error && this.snapshot.intakeId && !this.snapshot.confirmed) this.publish({ ...this.snapshot, phase: 'camera' });
  }
  showReview() {
    this.current();
    if (!this.snapshot.busy && this.snapshot.intakeId) this.publish({ ...this.snapshot, phase: 'review', error: null });
  }
  goHome() {
    this.current();
    if (this.snapshot.busy) return;
    ++this.operation;
    this.publish({ ...empty() });
  }
  async capture(source: { uri: string; width: number; height: number; format: 'jpg' | 'png' }) {
    const credential = this.current();
    const intakeId = this.snapshot.intakeId;
    if (this.snapshot.busy || this.snapshot.confirmed || this.snapshot.phase !== 'camera' || !intakeId) return;
    const generation = this.generation;
    const operation = ++this.operation;
    this.publish({ ...this.snapshot, busy: true, error: null });
    try {
      const photo = await this.service.savePhoto(credential, intakeId, source);
      if (generation !== this.generation || operation !== this.operation) return;
      this.publish({ ...this.snapshot, phase: 'review', busy: false, photos: [...this.snapshot.photos, photo] });
    } catch (cause) {
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot,
        phase: 'review', busy: false, error: toAppError(cause).code });
    }
  }
  async discard(photoId: string) {
    const credential = this.current();
    const intakeId = this.snapshot.intakeId;
    if (this.snapshot.busy || this.snapshot.confirmed || !intakeId || !this.snapshot.photos.some((photo) => photo.id === photoId)) return;
    const generation = this.generation;
    const operation = ++this.operation;
    this.publish({ ...this.snapshot, busy: true, error: null });
    try {
      await this.service.discardPhoto(credential, intakeId, photoId);
      if (generation !== this.generation || operation !== this.operation) return;
      this.publish({ ...this.snapshot,
        phase: 'review', busy: false,
        photos: this.snapshot.photos.filter((photo) => photo.id !== photoId) });
    } catch (cause) {
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
    }
  }
}
