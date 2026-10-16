import { AppError, toAppError } from '@/core/errors';
import { currentInstant, type Clock, type IdGenerator } from '@/core/values';
import type { AuthService } from '@/services/contracts/auth';
import type { MockSupportInbox, SupportRecord, SupportService } from '@/services/contracts/support';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type MockEnvironment } from '@/storage/namespace';
import { createPersistentMockState } from './persistent-state';

function decode(value: unknown): SupportRecord[] {
  if (!Array.isArray(value) || !value.every((item: unknown) => item && typeof item === 'object' &&
    'id' in item && typeof item.id === 'string' && 'acceptedAt' in item && typeof item.acceptedAt === 'string' &&
    'principalId' in item && typeof item.principalId === 'string' && 'role' in item &&
    ['group', 'fan', 'guest'].includes(String(item.role)) && 'subject' in item && typeof item.subject === 'string' &&
    'content' in item && typeof item.content === 'string')) throw new AppError('Storage', '問い合わせ記録を読み取れません。');
  return value as SupportRecord[];
}

export function createMockSupport(deps: { storage: KeyValueStore; environment: MockEnvironment;
  auth: AuthService; clock: Clock; ids: IdGenerator }): { service: SupportService; inbox: MockSupportInbox } {
  const state = createPersistentMockState(deps.storage, { scope: [deps.environment, 'mock-server', 'support'],
    key: `${buildNamespacePrefix({ environment: deps.environment, source: 'mock', owner: { kind: 'mock-server', id: 'server' } })}support`,
    schemaVersion: 1, seedVersion: 1, seed: () => [] as SupportRecord[], decode });
  return {
    service: { async submit(credential, subject, content) {
      const title = subject.trim();
      const body = content.trim();
      if (!title || !body) throw new AppError('Validation', '件名と内容を入力してください。');
      const session = await deps.auth.restore(credential);
      const receipt = { id: deps.ids.next(), acceptedAt: currentInstant(deps.clock) };
      const record: SupportRecord = { ...receipt, principalId: session.principal.id, role: session.principal.role,
        subject: title, content: body };
      try { await state.update((rows) => [...rows, record]); }
      catch (cause) { throw toAppError(cause, 'Storage'); }
      return receipt;
    } }, inbox: { list: () => state.load() },
  };
}
