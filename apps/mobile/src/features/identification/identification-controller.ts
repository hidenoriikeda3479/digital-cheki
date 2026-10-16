import { AppError, toAppError, type ErrorCode } from '@/core/errors';
import type { AuthController } from '@/features/auth/auth-controller';
import type { CaptureIntake, IdentificationService, OwnIdentity, RecipientResolution, SelectableIdol } from '@/services/contracts/identification';

export type IdentificationPhase = 'home' | 'scan' | 'number' | 'select' | 'saved' | 'fan-code';
export interface IdentificationSnapshot {
  phase: IdentificationPhase;
  busy: boolean;
  error: ErrorCode | null;
  match: 'none' | 'found' | 'absent';
  recipient: RecipientResolution | null;
  idols: SelectableIdol[];
  selectedIds: string[];
  latestIntake: CaptureIntake | null;
  ownIdentity: OwnIdentity | null;
}

function empty(): IdentificationSnapshot {
  return { phase: 'home', busy: false, error: null, match: 'none', recipient: null,
    idols: [], selectedIds: [], latestIntake: null, ownIdentity: null };
}

export class IdentificationController {
  private snapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private operation = 0;
  private credential: string | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly auth: AuthController, private readonly service: IdentificationService) {
    auth.subscribe(() => { this.pending = this.synchronize(); });
  }

  getSnapshot = (): IdentificationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: IdentificationSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  async initialize(): Promise<void> { await this.pending; await this.synchronize(); }

  loadPickupIdols = async () => {
    return this.loadHomeIdols('listPickupIdols');
  };
  loadTrendingIdols = async () => {
    return this.loadHomeIdols('listTrendingIdols');
  };
  private async loadHomeIdols(method: 'listPickupIdols' | 'listTrendingIdols') {
    const role = this.auth.getSnapshot().session?.principal.role;
    if (role !== 'fan' && role !== 'guest') throw new AppError('Forbidden', 'この画面を利用できません。');
    const credential = this.current(role);
    const generation = this.generation;
    const idols = await this.service[method](credential);
    if (generation !== this.generation || this.auth.getSnapshot().session?.credential !== credential) {
      throw new AppError('Cancelled', 'アカウントが切り替わりました。');
    }
    return idols;
  }

  private async synchronize() {
    const session = this.auth.getSnapshot().session;
    const nextCredential = session?.credential ?? null;
    if (nextCredential === this.credential) return;
    this.credential = nextCredential;
    ++this.generation;
    ++this.operation;
    this.publish(empty());
  }

  private current(role: 'group' | 'fan' | 'guest'): string {
    const session = this.auth.getSnapshot().session;
    if (!session || session.principal.role !== role || session.credential !== this.credential) {
      throw new AppError('Forbidden', 'この画面を利用できません。');
    }
    return session.credential;
  }

  openReception() {
    this.current('group');
    ++this.operation;
    this.publish({ ...empty(), phase: 'scan' });
  }
  openNumber() {
    this.current('group');
    ++this.operation;
    this.publish({ ...this.snapshot, phase: 'number', error: null, match: 'none' });
  }
  goHome() {
    if (this.snapshot.busy && this.snapshot.phase === 'select') return;
    ++this.operation;
    this.publish(empty());
  }
  async showFanCode() {
    const role = this.auth.getSnapshot().session?.principal.role;
    if (role !== 'fan' && role !== 'guest') throw new AppError('Forbidden', 'この画面を利用できません。');
    const credential = this.current(role);
    const generation = this.generation;
    const operation = ++this.operation;
    this.publish({ ...this.snapshot, busy: true, error: null });
    try {
      const ownIdentity = await this.service.getOwnIdentity(credential);
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot, ownIdentity, phase: 'fan-code', busy: false });
    } catch (cause) {
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
    }
  }

  async resolveQr(payload: string) { await this.resolve('qr', payload); }
  async resolveNumber(number: string) { await this.resolve('number', number); }
  private async resolve(method: 'qr' | 'number', value: string) {
    const credential = this.current('group');
    if (this.snapshot.busy || this.snapshot.phase !== method && !(method === 'qr' && this.snapshot.phase === 'scan')) return;
    const generation = this.generation;
    const operation = ++this.operation;
    this.publish({ ...this.snapshot, busy: true, error: null, match: 'none' });
    try {
      const recipient = method === 'qr'
        ? await this.service.resolveQr(credential, value)
        : await this.service.resolveNumber(credential, value);
      if (generation !== this.generation || operation !== this.operation) return;
      if (!recipient) {
        this.publish({ ...this.snapshot, busy: false, match: 'absent', error: null });
        return;
      }
      const idols = await this.service.listSelectableIdols(credential);
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot, busy: false, match: 'found', recipient,
        idols, selectedIds: [], phase: 'select', error: null });
    } catch (cause) {
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
    }
  }

  toggleIdol(id: string) {
    this.current('group');
    if (this.snapshot.phase !== 'select' || !this.snapshot.idols.some((idol) => idol.id === id)) return;
    const selectedIds = this.snapshot.selectedIds.includes(id)
      ? this.snapshot.selectedIds.filter((item) => item !== id)
      : [...this.snapshot.selectedIds, id];
    this.publish({ ...this.snapshot, selectedIds, error: null });
  }

  async saveIntake(): Promise<string | null> {
    const credential = this.current('group');
    if (this.snapshot.busy || this.snapshot.phase !== 'select') return null;
    if (!this.snapshot.recipient || this.snapshot.selectedIds.length === 0) {
      this.publish({ ...this.snapshot, error: 'Validation' });
      return null;
    }
    const generation = this.generation;
    const operation = ++this.operation;
    const { recipientRef } = this.snapshot.recipient;
    const selectedIds = [...this.snapshot.selectedIds];
    this.publish({ ...this.snapshot, busy: true, error: null });
    try {
      const latestIntake = await this.service.saveIntake(credential, recipientRef, selectedIds);
      if (generation === this.generation && operation === this.operation) {
        this.publish({ ...this.snapshot, busy: false, phase: 'saved', recipient: null, selectedIds: [], latestIntake });
        return latestIntake.id;
      }
    } catch (cause) {
      if (generation === this.generation && operation === this.operation) this.publish({ ...this.snapshot, busy: false, error: toAppError(cause).code });
    }
    return null;
  }
}
