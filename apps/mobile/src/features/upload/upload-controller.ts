import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { AuthController } from '@/features/auth/auth-controller';
import type { MockUploadControls, MockUploadScenario, UploadService, UploadSnapshot } from '@/services/contracts/upload';

export interface UploadScreenState {
  phase: 'closed' | 'open'; intakeId: string | null; snapshot: UploadSnapshot | null;
  busy: boolean; activePhotoId: string | null; progressPercent: number; error: ErrorCode | null;
  selectedScenarios: Record<string, MockUploadScenario>;
}
const empty = (): UploadScreenState => ({ phase: 'closed', intakeId: null, snapshot: null,
  busy: false, activePhotoId: null, progressPercent: 0, error: null, selectedScenarios: {} });

export class UploadController {
  private state = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private credential: string | null;
  constructor(private readonly auth: AuthController, private readonly service: UploadService,
    readonly controls?: MockUploadControls) {
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
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: UploadScreenState) { this.state = value; this.listeners.forEach((listener) => listener()); }
  private current(): string {
    const session = this.auth.getSnapshot().session;
    if (!session || session.principal.role !== 'group' || session.credential !== this.credential) {
      throw new AppError('Forbidden', '送信状況を表示できません。');
    }
    return session.credential;
  }
  async open(intakeId: string) {
    const credential = this.current();
    if (this.state.busy) return;
    const generation = ++this.generation;
    this.publish({ ...empty(), phase: 'open', intakeId, busy: true });
    try {
      const snapshot = await this.service.observe(credential, intakeId);
      if (generation === this.generation) this.publish({ ...this.state, snapshot, busy: false });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, error: toAppError(cause).code });
    }
  }
  async start(photoId: string) {
    const credential = this.current();
    const intakeId = this.state.intakeId;
    if (!intakeId || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, activePhotoId: photoId, progressPercent: 0, error: null });
    try {
      const snapshot = await this.service.start(credential, intakeId, photoId, (percent) => {
        if (generation === this.generation) this.publish({ ...this.state, progressPercent: percent });
      });
      if (generation === this.generation) this.publish({ ...this.state, snapshot, busy: false, activePhotoId: null });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false,
        activePhotoId: null, error: toAppError(cause).code });
    }
  }
  async startUnsent() {
    const ids = this.state.snapshot?.photos.filter((item) => item.status === 'unsent').map((item) => item.photoId) ?? [];
    for (const id of ids) {
      if (this.state.phase !== 'open') break;
      await this.start(id);
    }
  }
  async query(photoId: string) {
    const credential = this.current();
    const intakeId = this.state.intakeId;
    if (!intakeId || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, busy: true, error: null });
    try {
      const snapshot = await this.service.query(credential, intakeId, photoId);
      if (generation === this.generation) this.publish({ ...this.state, snapshot, busy: false });
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.state, busy: false, error: toAppError(cause).code });
    }
  }
  async setScenario(photoId: string, scenario: MockUploadScenario) {
    const credential = this.current();
    const intakeId = this.state.intakeId;
    if (!intakeId || !this.controls || this.state.busy) return;
    try { await this.controls.setScenario(credential, intakeId, photoId, scenario); this.publish({ ...this.state,
      selectedScenarios: { ...this.state.selectedScenarios, [photoId]: scenario }, error: null }); }
    catch (cause) { this.publish({ ...this.state, error: toAppError(cause).code }); }
  }
  async advanceDays(days: number) {
    const credential = this.current();
    const intakeId = this.state.intakeId;
    if (!intakeId || !this.controls || this.state.busy) return;
    try {
      await this.controls.advanceDays(credential, days);
      const snapshot = await this.service.observe(credential, intakeId);
      this.publish({ ...this.state, snapshot, error: null });
    } catch (cause) { this.publish({ ...this.state, error: toAppError(cause).code }); }
  }
  close() {
    this.current();
    if (this.state.busy) return;
    ++this.generation;
    this.publish(empty());
  }
}
