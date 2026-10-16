import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { IdGenerator } from '@/core/values';
import type { AuthController } from '@/features/auth/auth-controller';
import type { CapturePhoto } from '@/services/contracts/capture';
import type { EditElement, EditingService, EditQuality, FrameId, PhotoEdit, Point, StampId } from '@/services/contracts/editing';

export interface EditingSnapshot { photo: CapturePhoto | null; edit: PhotoEdit | null; busy: boolean; error: ErrorCode | null }
interface WorkingEdit { edit: PhotoEdit; savedRevision: number; dirty: boolean }

export class EditingController {
  private snapshot: EditingSnapshot = { photo: null, edit: null, busy: false, error: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private credential: string | null = null;
  private intakeId: string | null = null;
  private drafts = new Map<string, WorkingEdit>();
  constructor(private readonly auth: AuthController, private readonly service: EditingService, private readonly ids: IdGenerator) {
    this.credential = auth.getSnapshot().session?.credential ?? null;
    auth.subscribe(() => {
      const credential = auth.getSnapshot().session?.credential ?? null;
      if (credential !== this.credential) {
        this.credential = credential; ++this.generation; this.drafts.clear(); this.intakeId = null;
        this.publish({ photo: null, edit: null, busy: false, error: null });
      }
    });
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: EditingSnapshot) { this.snapshot = value; this.listeners.forEach((listener) => listener()); }
  private current() {
    const session = this.auth.getSnapshot().session;
    if (!session || session.principal.role !== 'group' || session.credential !== this.credential) throw new AppError('Forbidden', '編集画面を利用できません。');
    return session.credential;
  }
  hasUnsavedChanges() { return [...this.drafts.values()].some((item) => item.dirty); }
  async open(photo: CapturePhoto) {
    const credential = this.current();
    if (this.snapshot.busy) return;
    if (this.intakeId !== null && this.intakeId !== photo.intakeId) this.drafts.clear();
    this.intakeId = photo.intakeId;
    const generation = ++this.generation;
    const working = this.drafts.get(photo.id);
    if (working) { this.publish({ photo, edit: working.edit, busy: false, error: null }); return; }
    this.publish({ photo, edit: null, busy: true, error: null });
    try {
      const edit = await this.service.load(credential, photo.intakeId, photo.id);
      if (generation === this.generation) {
        this.drafts.set(photo.id, { edit, savedRevision: edit.revision, dirty: false });
        this.publish({ photo, edit, busy: false, error: null });
      }
    } catch (cause) {
      if (generation === this.generation) this.publish({ photo, edit: null, busy: false, error: toAppError(cause).code });
    }
  }
  close() {
    this.current(); if (this.snapshot.busy) return;
    ++this.generation; this.drafts.clear(); this.intakeId = null;
    this.publish({ photo: null, edit: null, busy: false, error: null });
  }
  private update(change: (edit: PhotoEdit) => PhotoEdit) {
    this.current();
    const { photo, edit } = this.snapshot;
    if (this.snapshot.busy || !photo || !edit) return;
    const working = this.drafts.get(photo.id);
    if (!working) return;
    const next = change(edit);
    this.drafts.set(photo.id, { ...working, edit: next, dirty: true });
    this.publish({ photo, edit: next, busy: false, error: null });
  }
  addStroke(points: Point[], color: string, width: number) {
    const element: EditElement = { kind: 'stroke', id: this.ids.next(), points, color, width };
    this.update((edit) => ({ ...edit, elements: [...edit.elements, element] }));
  }
  addStamp(center: Point, stamp: StampId, color: string, size: number) {
    const element: EditElement = { kind: 'stamp', id: this.ids.next(), center, stamp, color, size };
    this.update((edit) => ({ ...edit, elements: [...edit.elements, element] }));
  }
  undo() { this.update((edit) => edit.elements.length ? { ...edit, elements: edit.elements.slice(0, -1) } : edit); }
  setFrame(frame: FrameId) { this.update((edit) => ({ ...edit, frame, elements: [] })); }
  setQuality(quality: EditQuality) { this.update((edit) => ({ ...edit, quality })); }
  async saveDrafts(): Promise<boolean> {
    const credential = this.current();
    const generation = this.generation;
    const { photo } = this.snapshot;
    if (!photo || this.snapshot.busy) return false;
    this.publish({ ...this.snapshot, busy: true, error: null });
    try {
      for (const [photoId, working] of this.drafts) {
        if (!working.dirty) continue;
        if (generation !== this.generation) return false;
        const saved = await this.service.saveDraft(credential, working.edit.intakeId, photoId, working.savedRevision, {
          frame: working.edit.frame, quality: working.edit.quality, elements: working.edit.elements,
        });
        if (generation !== this.generation) return false;
        this.drafts.set(photoId, { edit: saved, savedRevision: saved.revision, dirty: false });
      }
      if (generation !== this.generation) return false;
      this.publish({ photo, edit: this.drafts.get(photo.id)?.edit ?? null, busy: false, error: null });
      return true;
    } catch (cause) {
      if (generation === this.generation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
      return false;
    }
  }
}
