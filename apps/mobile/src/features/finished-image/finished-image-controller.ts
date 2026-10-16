import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { AuthController } from '@/features/auth/auth-controller';
import type { FinishedImageService, SendPreview } from '@/services/contracts/finished-image';

export interface FinishedImageSnapshot {
  phase: 'closed' | 'preview'; intakeId: string | null;
  preview: SendPreview | null; busy: boolean; error: ErrorCode | null;
  lastConfirmedIntakeId: string | null;
}
const empty = (): FinishedImageSnapshot => ({ phase: 'closed', intakeId: null, preview: null, busy: false, error: null, lastConfirmedIntakeId: null });
export class FinishedImageController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private credential: string | null = null;
  private generation = 0;
  constructor(private readonly auth: AuthController, private readonly service: FinishedImageService) {
    this.credential = auth.getSnapshot().session?.credential ?? null;
    auth.subscribe(() => {
      const next = auth.getSnapshot().session?.credential ?? null;
      if (next !== this.credential) {
        this.credential = next;
        ++this.generation;
        this.publish(empty());
      }
    });
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: FinishedImageSnapshot) { this.snapshot = value; this.listeners.forEach((listener) => listener()); }
  private current() {
    const session = this.auth.getSnapshot().session;
    if (!session || session.principal.role !== 'group' || session.credential !== this.credential) {
      throw new AppError('Forbidden', '送信前確認を利用できません。');
    }
    return session.credential;
  }
  async open(intakeId: string) {
    const credential = this.current();
    if (this.snapshot.busy) return false;
    const generation = ++this.generation;
    this.publish({ ...this.snapshot, phase: 'preview', intakeId, preview: null, busy: true, error: null });
    try {
      const preview = await this.service.prepare(credential, intakeId);
      if (generation === this.generation) this.publish({ ...this.snapshot, phase: 'preview', intakeId, preview, busy: false, error: null,
        lastConfirmedIntakeId: preview.confirmedAt ? intakeId : this.snapshot.lastConfirmedIntakeId });
      return generation === this.generation && preview.images.length > 0 && preview.images.every((image) => !!image.uri);
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.snapshot, phase: 'preview', intakeId, preview: null, busy: false, error: toAppError(cause).code });
      return false;
    }
  }
  async confirm(): Promise<string | null> {
    const credential = this.current();
    const { intakeId, preview } = this.snapshot;
    if (!intakeId || !preview || this.snapshot.busy) return null;
    if (preview.confirmedAt) return intakeId;
    const generation = this.generation;
    this.publish({ ...this.snapshot, busy: true, error: null });
    try {
      const confirmed = await this.service.confirm(credential, intakeId);
      if (generation === this.generation) {
        this.publish({ ...this.snapshot, phase: 'preview', intakeId, preview: confirmed, busy: false, error: null, lastConfirmedIntakeId: intakeId });
        return intakeId;
      }
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
    }
    return null;
  }
  /** Generate and confirm without opening a separate preview screen. */
  async confirmIntake(intakeId: string): Promise<boolean> {
    const credential = this.current();
    if (this.snapshot.busy) return false;
    const generation = ++this.generation;
    this.publish({ ...this.snapshot, phase: 'closed', intakeId, preview: null, busy: true, error: null });
    try {
      const prepared = await this.service.prepare(credential, intakeId);
      if (generation !== this.generation) return false;
      if (!prepared.images.length || prepared.images.some((image) => !image.uri))
        throw new AppError('Conflict', '送信できる完成画像がありません。');
      const result = prepared.confirmedAt ? prepared : await this.service.confirm(credential, intakeId);
      if (generation !== this.generation) return false;
      this.publish({ ...this.snapshot, phase: 'closed', intakeId, preview: null, busy: false, error: null,
        lastConfirmedIntakeId: intakeId });
      return !!result.confirmedAt;
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
      return false;
    }
  }
  close() {
    this.current();
    if (this.snapshot.busy) return;
    ++this.generation;
    this.publish({ ...empty(), lastConfirmedIntakeId: this.snapshot.lastConfirmedIntakeId });
  }
}
