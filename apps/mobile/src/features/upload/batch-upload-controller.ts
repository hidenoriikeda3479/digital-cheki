import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { AuthController } from '@/features/auth/auth-controller';
import type { BatchUploadService, BatchUploadSnapshot } from '@/services/contracts/batch-upload';

export interface BatchUploadState {
  intakeId: string | null; snapshot: BatchUploadSnapshot | null; busy: boolean; error: ErrorCode | null;
}
const empty = (): BatchUploadState => ({ intakeId: null, snapshot: null, busy: false, error: null });
export class BatchUploadController {
  private state = empty();
  private listeners = new Set<() => void>();
  private credential: string | null;
  private generation = 0;
  constructor(private readonly auth: AuthController, private readonly service: BatchUploadService) {
    this.credential = auth.getSnapshot().session?.credential ?? null;
    auth.subscribe(() => {
      const next = auth.getSnapshot().session?.credential ?? null;
      if (next !== this.credential) { this.credential = next; ++this.generation; this.publish(empty()); }
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: BatchUploadState) { this.state = value; this.listeners.forEach((listener) => listener()); }
  private current() {
    const session = this.auth.getSnapshot().session;
    if (!session || session.principal.role !== 'group' || session.credential !== this.credential)
      throw new AppError('Forbidden', 'この撮影受付を送信できません。');
    return session.credential;
  }
  async open(intakeId: string) {
    const credential = this.current();
    const generation = ++this.generation;
    this.publish({ intakeId, snapshot: null, busy: true, error: null });
    try {
      const snapshot = await this.service.observe(credential, intakeId);
      if (generation === this.generation) this.publish({ intakeId, snapshot, busy: false, error: null });
    } catch (cause) {
      if (generation === this.generation) this.publish({ intakeId, snapshot: null, busy: false, error: toAppError(cause).code });
    }
  }
  async send() {
    const credential = this.current();
    const intakeId = this.state.intakeId;
    if (!intakeId || this.state.busy || this.state.snapshot?.status === 'uploaded' ||
      this.state.snapshot?.status === 'unknown') return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      const snapshot = await this.service.send(credential, intakeId);
      if (generation === this.generation) this.publish({ intakeId, snapshot, busy: false, error: null });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, error: toAppError(cause).code });
    }
  }
  async query() {
    const credential = this.current();
    const intakeId = this.state.intakeId;
    if (!intakeId || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      const snapshot = await this.service.query(credential, intakeId);
      if (generation === this.generation) this.publish({ intakeId, snapshot, busy: false, error: null });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, error: toAppError(cause).code });
    }
  }
}
