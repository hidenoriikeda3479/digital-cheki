import { AppError, toAppError } from '@/core/errors';
import { currentInstant, type Clock, type IdGenerator } from '@/core/values';
import type { AuthService } from '@/services/contracts/auth';
import type { MockAuthAdministration } from './mock-auth';
import type { CaptureIntake, IdentificationService, RecipientKind, RecipientResolution } from '@/services/contracts/identification';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type MockEnvironment, type StorageNamespace } from '@/storage/namespace';

import initialCatalog from './identification-fixtures.json';
import { createPersistentMockState } from './persistent-state';
import { rankWeeklyIdols, type CompletedCheki } from '@/services/idol-ranking';
import { renameSeedIdol } from './display-names';

interface RecipientRecord { recipientRef: string; kind: RecipientKind; fanId?: string; guestId?: string; number: string; qrPayload: string; active: boolean }
export interface MockIdentificationAdministration {
  addRecipient(id: string, kind: RecipientKind): Promise<void>;
}
interface IdolRecord { id: string; groupId: string; name: string; approved: boolean; selectable: boolean }
interface Catalog { recipients: RecipientRecord[]; idols: IdolRecord[] }
interface Intakes { records: CaptureIntake[] }

const demoPortraits: Record<string, number> = {
  'idol-a': require('../../../assets/mock-idols/idol-a.png'),
  'idol-a2': require('../../../assets/mock-idols/idol-a2.png'),
  'idol-b': require('../../../assets/mock-idols/idol-b.png'),
  'idol-a3': require('../../../assets/mock-idols/idol-a3.png'),
  'idol-a4': require('../../../assets/mock-idols/idol-a4.png'),
  'idol-a5': require('../../../assets/mock-idols/idol-a5.png'),
  'idol-b2': require('../../../assets/mock-idols/idol-b2.png'),
  'idol-b3': require('../../../assets/mock-idols/idol-b3.png'),
};
// Approved demo destinations, not accounts belonging to the fictional idols.
const demoSocialLinks = { x: 'https://x.com/', instagram: 'https://www.instagram.com/' };

function decodeCatalog(value: unknown): Catalog {
  if (!value || typeof value !== 'object' || !('recipients' in value) || !Array.isArray(value.recipients) ||
      !('idols' in value) || !Array.isArray(value.idols) ||
      !value.recipients.every((item: unknown) => item && typeof item === 'object' &&
        'recipientRef' in item && typeof item.recipientRef === 'string' &&
        'kind' in item && (item.kind === 'member' || item.kind === 'guest') &&
        'number' in item && typeof item.number === 'string' &&
        'qrPayload' in item && typeof item.qrPayload === 'string' &&
        'active' in item && typeof item.active === 'boolean') ||
      !value.idols.every((item: unknown) => item && typeof item === 'object' &&
        'id' in item && typeof item.id === 'string' &&
        'groupId' in item && typeof item.groupId === 'string' &&
        'name' in item && typeof item.name === 'string' &&
        'approved' in item && typeof item.approved === 'boolean' &&
        'selectable' in item && typeof item.selectable === 'boolean')) {
    throw new AppError('Storage', '識別用モックデータを読み取れません。');
  }
  return value as Catalog;
}

function decodeIntakes(value: unknown): Intakes {
  if (!value || typeof value !== 'object' || !('records' in value) || !Array.isArray(value.records) ||
      !value.records.every((item: unknown) => item && typeof item === 'object' &&
        'id' in item && typeof item.id === 'string' &&
        'groupId' in item && typeof item.groupId === 'string' &&
        'recipientRef' in item && typeof item.recipientRef === 'string' &&
        'idolIds' in item && Array.isArray(item.idolIds) && item.idolIds.every((id: unknown) => typeof id === 'string') &&
        'acceptedAt' in item && typeof item.acceptedAt === 'string')) {
    throw new AppError('Storage', '保存済み受付を読み取れません。');
  }
  return value as Intakes;
}

export function createMockIdentification(
  storage: KeyValueStore, environment: MockEnvironment,
  auth: AuthService & Pick<MockAuthAdministration, 'getAccountDisplayName'>, clock: Clock, ids: IdGenerator,
  loadCompletedPhotos?: () => Promise<CompletedCheki[]>,
): IdentificationService & MockIdentificationAdministration {
  const server: StorageNamespace = { environment, source: 'mock', owner: { kind: 'mock-server', id: 'server' } };
  const catalog = createPersistentMockState(storage, {
    scope: [environment, 'mock-server', 'identification'],
    key: `${buildNamespacePrefix(server)}identification`, schemaVersion: 1, seedVersion: 3,
    seed: (): Catalog => initialCatalog as Catalog, decode: decodeCatalog,
    migrateSeed: (current) => ({ ...current, idols: [...current.idols.map((idol) => ({ ...idol, name: renameSeedIdol(idol.id, idol.name) })),
      ...initialCatalog.idols.filter((idol) => ['idol-a3', 'idol-a4', 'idol-a5', 'idol-b2', 'idol-b3'].includes(idol.id)
        && !current.idols.some((existing) => existing.id === idol.id))] }),
  });
  const byGroup = new Map<string, ReturnType<typeof createPersistentMockState<Intakes>>>();
  function groupState(groupId: string) {
    let state = byGroup.get(groupId);
    if (!state) {
      const namespace: StorageNamespace = { environment, source: 'mock', owner: { kind: 'group', id: groupId } };
      state = createPersistentMockState(storage, {
        scope: [environment, `group-${groupId}`, 'capture-intakes'],
        key: `${buildNamespacePrefix(namespace)}capture-intakes`, schemaVersion: 1, seedVersion: 1,
        seed: (): Intakes => ({ records: [] }), decode: decodeIntakes,
      });
      byGroup.set(groupId, state);
    }
    return state;
  }
  async function requireRole(credential: string, role: 'group' | 'fan') {
    const session = await auth.restore(credential);
    if (session.principal.role !== role) throw new AppError('Forbidden', 'この操作の権限がありません。');
    return session.principal.id;
  }
  function resolution(record: RecipientRecord | undefined): RecipientResolution | null {
    return record && record.active ? { recipientRef: record.recipientRef, kind: record.kind } : null;
  }
  return {
    async listTrendingIdols(credential) {
      const session = await auth.restore(credential);
      if (session.principal.role !== 'fan' && session.principal.role !== 'guest') throw new AppError('Forbidden', 'この操作の権限がありません。');
      if (!loadCompletedPhotos) throw new AppError('NotImplemented', 'チェキ集計は未接続です。');
      const idols = (await catalog.load()).idols.filter((idol) => idol.approved && idol.selectable && demoPortraits[idol.id]);
      const candidates = await Promise.all(idols.map(async (idol) => ({ id: idol.id, name: idol.name,
        groupName: await auth.getAccountDisplayName(idol.groupId) ?? '', portraitSource: demoPortraits[idol.id], socialLinks: demoSocialLinks })));
      const intakes = new Map<string, CaptureIntake[]>();
      for (const groupId of new Set(idols.map((idol) => idol.groupId))) intakes.set(groupId, (await groupState(groupId).load()).records);
      const photos = (await loadCompletedPhotos()).map((photo) => ({ ...photo,
        idolIds: intakes.get(photo.groupId)?.find((intake) => intake.id === photo.intakeId)?.idolIds ?? photo.idolIds ?? [] }));
      return rankWeeklyIdols(candidates, photos, clock.now());
    },
    async listPickupIdols(credential) {
      const session = await auth.restore(credential);
      if (session.principal.role !== 'fan' && session.principal.role !== 'guest') throw new AppError('Forbidden', 'この操作の権限がありません。');
      const candidates = (await catalog.load()).idols.filter((idol) => idol.approved && idol.selectable && demoPortraits[idol.id]);
      for (let index = candidates.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
      }
      return Promise.all(candidates.slice(0, 10).map(async (idol) => ({ id: idol.id, name: idol.name,
        groupName: await auth.getAccountDisplayName(idol.groupId) ?? '', portraitSource: demoPortraits[idol.id], socialLinks: demoSocialLinks })));
    },
    async getOwnRecipientRef(credential) {
      const session = await auth.restore(credential);
      if (session.principal.role !== 'fan' && session.principal.role !== 'guest') throw new AppError('Forbidden', 'この操作の権限がありません。');
      const person = (await catalog.load()).recipients.find((item) => item.active &&
        (session.principal.role === 'fan' ? item.kind === 'member' && item.fanId === session.principal.id
          : item.kind === 'guest' && item.guestId === session.principal.id));
      if (!person) throw new AppError('NotFound', '会員の受取情報がありません。');
      return person.recipientRef;
    },
    async getOwnIdentity(credential) {
      const session = await auth.restore(credential);
      if (session.principal.role !== 'fan' && session.principal.role !== 'guest') throw new AppError('Forbidden', 'この操作の権限がありません。');
      const person = (await catalog.load()).recipients.find((item) => item.active &&
        (session.principal.role === 'fan' ? item.kind === 'member' && item.fanId === session.principal.id
          : item.kind === 'guest' && item.guestId === session.principal.id));
      if (!person) throw new AppError('NotFound', '会員の識別情報がありません。');
      return { number: person.number, qrPayload: person.qrPayload };
    },
    async resolveQr(credential, payload) {
      await requireRole(credential, 'group');
      if (typeof payload !== 'string' || !/^dc:1:(member|guest):[A-Za-z0-9-]+$/.test(payload)) {
        throw new AppError('Validation', 'このQRは読み取れません。');
      }
      return resolution((await catalog.load()).recipients.find((item) => item.qrPayload === payload));
    },
    async resolveNumber(credential, number) {
      await requireRole(credential, 'group');
      if (typeof number !== 'string' || !/^[0-9]{1,64}$/.test(number)) {
        throw new AppError('Validation', '番号は数字で入力してください。');
      }
      return resolution((await catalog.load()).recipients.find((item) => item.number === number));
    },
    async listSelectableIdols(credential) {
      const groupId = await requireRole(credential, 'group');
      return (await catalog.load()).idols.filter((idol) => idol.groupId === groupId && idol.approved && idol.selectable)
        .map((idol) => ({ id: idol.id, name: idol.name, portraitSource: demoPortraits[idol.id] }));
    },
    async saveIntake(credential, recipientRef, idolIds) {
      const groupId = await requireRole(credential, 'group');
      if (!recipientRef || !Array.isArray(idolIds) || idolIds.length === 0 ||
          new Set(idolIds).size !== idolIds.length) {
        throw new AppError('Validation', '受取人1人とアイドル1人以上を選択してください。');
      }
      const data = await catalog.load();
      if (!data.recipients.some((person) => person.recipientRef === recipientRef && person.active)) {
        throw new AppError('NotFound', '受取人が見つかりません。');
      }
      if (!idolIds.every((id) => data.idols.some((idol) => idol.id === id && idol.groupId === groupId && idol.approved && idol.selectable))) {
        throw new AppError('Forbidden', '選択できないアイドルが含まれています。');
      }
      const intake: CaptureIntake = { id: ids.next(), groupId, recipientRef, idolIds: [...idolIds], acceptedAt: currentInstant(clock) };
      try { await groupState(groupId).update((current) => ({ records: [...current.records, intake] })); }
      catch (cause) { throw toAppError(cause, 'Storage'); }
      return intake;
    },
    async getLatestIntake(credential) {
      const groupId = await requireRole(credential, 'group');
      const records = (await groupState(groupId).load()).records;
      return records.at(-1) ?? null;
    },
    async listIntakes(credential) {
      const groupId = await requireRole(credential, 'group');
      return [...(await groupState(groupId).load()).records];
    },
    async getIntakeRecipientName(credential, intakeId) {
      const groupId = await requireRole(credential, 'group');
      const intake = (await groupState(groupId).load()).records.find((item) => item.id === intakeId);
      if (!intake) throw new AppError('NotFound', '撮影受付が見つかりません。');
      const recipient = (await catalog.load()).recipients.find((item) => item.recipientRef === intake.recipientRef);
      if (!recipient) throw new AppError('NotFound', '撮影相手が見つかりません。');
      if (recipient.kind === 'guest') return 'ゲスト';
      const name = recipient.fanId ? await auth.getAccountDisplayName(recipient.fanId) : null;
      if (!name) throw new AppError('NotFound', '会員名を確認できません。');
      return name;
    },
    async addRecipient(id, kind) {
      await catalog.update((current) => {
        if (current.recipients.some((item) => item[kind === 'member' ? 'fanId' : 'guestId'] === id && item.kind === kind)) return current;
        // Mock-only sequential allocation. Numbers are identifiers, never credentials.
        const used = new Set(current.recipients.map((item) => item.number));
        let number: string | null = null;
        for (let index = kind === 'member' ? 700001 : 0; index <= 999999; index++) {
          const candidate = String(index).padStart(6, '0');
          if (!used.has(candidate)) { number = candidate; break; }
        }
        if (!number) throw new AppError('Conflict', '発行できる番号がありません。');
        const recipient: RecipientRecord = { recipientRef: ids.next(), kind, number,
          qrPayload: `dc:1:${kind}:${id}`, active: true,
          ...(kind === 'member' ? { fanId: id } : { guestId: id }) };
        return { ...current, recipients: [...current.recipients, recipient] };
      });
    },
  };
}
