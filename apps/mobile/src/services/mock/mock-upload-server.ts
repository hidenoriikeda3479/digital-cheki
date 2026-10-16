import { AppError, toAppError } from '@/core/errors';
import { currentInstant, type Clock } from '@/core/values';
import type { PhotoTransferPort, MockUploadScenario, RetentionStatus } from '@/services/contracts/upload';
import type { KeyValueStore } from '@/storage/key-value-store';
import { buildNamespacePrefix, type MockEnvironment, type StorageNamespace } from '@/storage/namespace';
import { renameSeedGroup, renameSeedIdol } from './display-names';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export interface UploadReceipt {
  groupId: string; intakeId: string; photoId: string; recipientRef: string;
  byteSize: number; uploadedAt: string; expiresAt: string; retention: RetentionStatus;
  /** Older stage-07 receipts may not have this field. */
  capturedAt?: string;
}
export interface UploadNotification {
  groupId: string; intakeId: string; recipientRef: string; photoIds: string[]; createdAt: string;
  groupName?: string; idolIds?: string[]; idolNames?: string[];
}
export class MockUploadServer {
  readonly namespace: StorageNamespace;
  private readonly prefix: string;
  constructor(environment: MockEnvironment, private readonly storage: KeyValueStore,
    private readonly transfer: PhotoTransferPort, private readonly clock: Clock) {
    this.namespace = { environment, source: 'mock', owner: { kind: 'mock-server', id: 'server' } };
    this.prefix = `${buildNamespacePrefix(this.namespace)}upload/`;
  }
  private key(kind: string, id: string) { return `${this.prefix}${kind}/${id}`; }
  /** Fixture migration only: preserve files, upload/expiry dates and user receive state. */
  async reviseDemoCaptureDate(input: { groupId: string; intakeId: string; photoId: string; capturedAt: string }) {
    const receipt = await this.readRaw(input.photoId);
    if (!input.photoId.startsWith('demo-700001-') || !Number.isFinite(Date.parse(input.capturedAt)) ||
      !receipt || receipt.recipientRef !== 'recipient-member-a' || receipt.groupId !== input.groupId ||
      receipt.intakeId !== input.intakeId) throw new AppError('Conflict', 'デモ写真の更新対象が一致しません。');
    if (receipt.capturedAt !== input.capturedAt) {
      await this.storage.set(this.key('receipt', input.photoId), JSON.stringify({ ...receipt, capturedAt: input.capturedAt }));
    }
  }
  async seedDemoCheki(input: { groupId: string; intakeId: string; photoId: string; recipientRef: string;
    capturedAt: string; sourceUri: string; byteSize: number; groupName: string; idolIds: string[]; idolNames: string[] }) {
    await this.send({ ...input, confirmedFailures: 0 });
    const notification = await this.notification(input.groupId, input.intakeId, input.recipientRef, [input.photoId]);
    if (!notification) throw new AppError('Storage', 'デモ写真の保存を確認できません。');
    await this.storage.set(this.key('notification', input.intakeId), JSON.stringify({ ...notification,
      groupName: input.groupName, idolIds: input.idolIds, idolNames: input.idolNames } satisfies UploadNotification));
  }
  /** Internal catalog aggregation only. Never expose recipient/file information to the home UI. */
  async listCompletedPhotos() {
    const index: unknown = JSON.parse(await this.storage.get(this.key('index', 'photos')) ?? '[]');
    if (!Array.isArray(index) || !index.every((id): id is string => typeof id === 'string')) {
      throw new AppError('Storage', '仮サーバー索引が不正です。');
    }
    const photos = [];
    for (const id of new Set(index)) {
      const receipt = await this.readRaw(id);
      if (receipt) {
        const raw = await this.storage.get(this.key('notification', receipt.intakeId));
        const metadata = raw ? await this.metadata(JSON.parse(raw) as UploadNotification) : null;
        photos.push({ photoId: receipt.photoId, groupId: receipt.groupId,
          intakeId: receipt.intakeId, capturedAt: receipt.capturedAt, idolIds: metadata?.idolIds });
      }
    }
    return photos;
  }
  /** A one-time, valid arrival fixture for the mock fan A inbox. Never runs in API mode. */
  async seedSampleArrival(source: () => { uri: string; byteSize: number; remove(): void }) {
    const marker = this.key('fixture', 'arrival-v1');
    if (await this.storage.get(marker) !== null) return;
    const groupId = 'group-a';
    const intakeId = 'sample-arrival-v1';
    const photoId = 'sample-arrival-v1-photo';
    const recipientRef = 'recipient-member-a';
    const existing = await this.lookup(groupId, intakeId, photoId);
    if (!existing) {
      const photo = source();
      try {
        await this.send({ groupId, intakeId, photoId, recipientRef, sourceUri: photo.uri,
          byteSize: photo.byteSize, capturedAt: (await this.now()).toISOString(), confirmedFailures: 0 });
      } finally { photo.remove(); }
    }
    const notification = await this.notification(groupId, intakeId, recipientRef, [photoId]);
    if (!notification) throw new AppError('Storage', 'サンプル通知の写真を確認できません。');
    await this.storage.set(this.key('notification', intakeId), JSON.stringify({ ...notification,
      groupName: 'サンプルグループ', idolIds: ['idol-a'], idolNames: ['サンプルアイドル'] } satisfies UploadNotification));
    await this.storage.set(marker, '1');
  }
  private async now() {
    const raw = await this.storage.get(this.key('clock', 'offset-ms'));
    const offset = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError('Storage', '仮サーバー時計が不正です。');
    return new Date(this.clock.now().getTime() + offset);
  }
  private async readRaw(photoId: string): Promise<UploadReceipt | null> {
    const raw = await this.storage.get(this.key('receipt', photoId));
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as UploadReceipt;
      if (value.photoId !== photoId || !value.groupId || !value.intakeId || !value.recipientRef ||
        !Number.isSafeInteger(value.byteSize) || value.byteSize <= 0 ||
        !Number.isFinite(Date.parse(value.uploadedAt)) || !Number.isFinite(Date.parse(value.expiresAt)) ||
        (value.capturedAt !== undefined && !Number.isFinite(Date.parse(value.capturedAt))) ||
        !['stored', 'expired', 'deleted'].includes(value.retention)) throw Error('invalid receipt');
      return value;
    } catch (cause) { throw new AppError('Storage', '仮サーバーの完了記録を確認できません。', { cause }); }
  }
  private async expire(receipt: UploadReceipt): Promise<UploadReceipt> {
    if ((await this.now()).getTime() < Date.parse(receipt.expiresAt)) return receipt;
    if (receipt.retention === 'deleted') return receipt;
    let retention: RetentionStatus = 'expired';
    try { await this.transfer.remove(this.namespace, receipt.photoId); retention = 'deleted'; }
    catch { /* Access is already denied at the deadline. Retry deletion on the next sweep. */ }
    const next = { ...receipt, retention };
    await this.storage.set(this.key('receipt', receipt.photoId), JSON.stringify(next));
    return next;
  }
  private async metadata(notification: UploadNotification): Promise<UploadNotification> {
    if (notification.groupName && notification.idolIds && notification.idolNames) return { ...notification,
      groupName: renameSeedGroup(notification.groupId, notification.groupName),
      idolNames: notification.idolNames.map((name, index) => renameSeedIdol(notification.idolIds![index], name)) };
    const groupNamespace: StorageNamespace = { environment: this.namespace.environment, source: 'mock',
      owner: { kind: 'group', id: notification.groupId } };
    const serverPrefix = buildNamespacePrefix(this.namespace);
    const [intakesRaw, catalogRaw, authRaw] = await Promise.all([
      this.storage.get(`${buildNamespacePrefix(groupNamespace)}capture-intakes`),
      this.storage.get(`${serverPrefix}identification`), this.storage.get(`${serverPrefix}auth`),
    ]);
    if (!intakesRaw || !catalogRaw || !authRaw) return notification;
    try {
      const intakes = JSON.parse(intakesRaw) as { data?: { records?: { id: string; groupId: string; recipientRef: string; idolIds: string[] }[] } };
      const catalog = JSON.parse(catalogRaw) as { data?: { idols?: { id: string; groupId: string; name: string }[] } };
      const auth = JSON.parse(authRaw) as { data?: { accounts?: { id: string; role: string; displayName: string }[] } };
      const intake = intakes.data?.records?.find((item) => item.id === notification.intakeId &&
        item.groupId === notification.groupId && item.recipientRef === notification.recipientRef);
      const group = auth.data?.accounts?.find((item) => item.id === notification.groupId && item.role === 'group');
      if (!intake || !Array.isArray(intake.idolIds) || !group) return notification;
      const names = intake.idolIds.map((id) => catalog.data?.idols?.find((idol) => idol.id === id &&
        idol.groupId === notification.groupId)?.name);
      if (names.some((name) => !name)) return notification;
      const enriched = { ...notification, groupName: group.displayName, idolIds: [...intake.idolIds], idolNames: names as string[] };
      await this.storage.set(this.key('notification', notification.intakeId), JSON.stringify(enriched));
      return enriched;
    } catch (cause) { throw new AppError('Storage', '通知の撮影情報を読み取れません。', { cause }); }
  }
  async lookup(groupId: string, intakeId: string, photoId: string): Promise<UploadReceipt | null> {
    const receipt = await this.readRaw(photoId);
    if (!receipt) return null;
    if (receipt.groupId !== groupId || receipt.intakeId !== intakeId) throw new AppError('Forbidden', '別の撮影の写真です。');
    return this.expire(receipt);
  }
  async available(receipt: UploadReceipt): Promise<boolean> {
    if (receipt.retention !== 'stored' || (await this.now()).getTime() >= Date.parse(receipt.expiresAt)) return false;
    const file = await this.transfer.inspect(this.namespace, receipt.photoId);
    return file?.byteSize === receipt.byteSize;
  }
  /** Preview is authorized like a download, but does not mark the photo as received. */
  async previewForRecipient(recipientRef: string, intakeId: string, photoId: string): Promise<string | null> {
    const receipt = await this.getForRecipient(recipientRef, intakeId, photoId);
    if (receipt.retention !== 'stored' || (await this.now()).getTime() >= Date.parse(receipt.expiresAt)) return null;
    const file = await this.transfer.inspect(this.namespace, photoId);
    return file?.byteSize === receipt.byteSize ? file.uri ?? null : null;
  }
  async listForRecipient(recipientRef: string): Promise<{ notification: UploadNotification; receipts: UploadReceipt[] }[]> {
    const index = JSON.parse(await this.storage.get(this.key('index', 'photos')) ?? '[]') as string[];
    if (!Array.isArray(index) || !index.every((id) => typeof id === 'string')) throw new AppError('Storage', '仮サーバー索引が不正です。');
    const intakes = new Map<string, { notification: UploadNotification; receipts: UploadReceipt[] }>();
    for (const photoId of index) {
      const receipt = await this.readRaw(photoId);
      if (!receipt || receipt.recipientRef !== recipientRef) continue;
      const raw = await this.storage.get(this.key('notification', receipt.intakeId));
      if (!raw) continue;
      const notification = await this.metadata(JSON.parse(raw) as UploadNotification);
      if (notification.recipientRef !== recipientRef || notification.groupId !== receipt.groupId ||
          !notification.photoIds.includes(photoId)) continue;
      let entry = intakes.get(receipt.intakeId);
      if (!entry) { entry = { notification, receipts: [] }; intakes.set(receipt.intakeId, entry); }
      entry.receipts.push(await this.expire(receipt));
    }
    return [...intakes.values()];
  }
  async listNotificationsForRecipient(recipientRef: string): Promise<UploadNotification[]> {
    const now = (await this.now()).getTime();
    const groups = await this.listForRecipient(recipientRef);
    return groups.map((item) => item.notification)
      .filter((item) => Number.isFinite(Date.parse(item.createdAt)) &&
        now < Date.parse(item.createdAt) + THIRTY_DAYS_MS)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.intakeId.localeCompare(b.intakeId));
  }
  async getForRecipient(recipientRef: string, intakeId: string, photoId: string): Promise<UploadReceipt> {
    const receipt = await this.readRaw(photoId);
    if (!receipt || receipt.recipientRef !== recipientRef || receipt.intakeId !== intakeId) {
      throw new AppError('NotFound', '受取対象の写真がありません。');
    }
    const raw = await this.storage.get(this.key('notification', intakeId));
    if (!raw) throw new AppError('NotFound', '受取対象の撮影がありません。');
    const notification = JSON.parse(raw) as UploadNotification;
    if (notification.recipientRef !== recipientRef || notification.groupId !== receipt.groupId ||
        !notification.photoIds.includes(photoId)) throw new AppError('NotFound', '受取対象の写真がありません。');
    return this.expire(receipt);
  }
  async send(input: { groupId: string; intakeId: string; photoId: string; recipientRef: string;
    sourceUri: string; byteSize: number; capturedAt: string; confirmedFailures: number }, onProgress?: (percent: number) => void): Promise<UploadReceipt> {
    const existing = await this.lookup(input.groupId, input.intakeId, input.photoId);
    if (existing) return existing;
    const mode = (await this.storage.get(this.key('scenario', input.photoId))) as MockUploadScenario | null ?? 'normal';
    if (mode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 1200));
    if (mode === 'always-fail' || (mode === 'fail-three' && input.confirmedFailures < 3)) {
      throw new AppError('Transport', '仮転送が失敗しました。');
    }
    await this.transfer.copy(this.namespace, input.photoId, input.sourceUri, input.byteSize, onProgress);
    if (mode === 'save-fail') throw new AppError('Storage', '仮サーバー記録が失敗しました。');
    const indexKey = this.key('index', 'photos');
    const index = JSON.parse(await this.storage.get(indexKey) ?? '[]') as string[];
    if (!Array.isArray(index) || !index.every((id) => typeof id === 'string')) throw new AppError('Storage', '仮サーバー索引が不正です。');
    if (!index.includes(input.photoId)) await this.storage.set(indexKey, JSON.stringify([...index, input.photoId]));
    const now = await this.now();
    const receipt: UploadReceipt = { groupId: input.groupId, intakeId: input.intakeId, photoId: input.photoId,
      recipientRef: input.recipientRef, byteSize: input.byteSize, capturedAt: input.capturedAt,
      uploadedAt: currentInstant({ now: () => now }), expiresAt: new Date(now.getTime() + SEVEN_DAYS_MS).toISOString(), retention: 'stored' };
    try { await this.storage.set(this.key('receipt', input.photoId), JSON.stringify(receipt)); }
    catch (cause) { throw toAppError(cause); }
    if (mode === 'lost-response') throw new AppError('UnknownOutcome', '保存結果の応答が失われました。');
    return receipt;
  }
  async notification(groupId: string, intakeId: string, recipientRef: string, photoIds: string[]): Promise<UploadNotification | null> {
    const key = this.key('notification', intakeId);
    const raw = await this.storage.get(key);
    if (raw) {
      const notification = JSON.parse(raw) as UploadNotification;
      if (notification.groupId !== groupId || notification.recipientRef !== recipientRef) throw new AppError('Forbidden', '通知の受取人が一致しません。');
      return this.metadata(notification);
    }
    if (!photoIds.length) return null;
    for (const photoId of photoIds) {
      const receipt = await this.lookup(groupId, intakeId, photoId);
      if (!receipt || receipt.recipientRef !== recipientRef || !(await this.available(receipt))) return null;
    }
    const created: UploadNotification = { groupId, intakeId, recipientRef, photoIds: [...photoIds],
      createdAt: (await this.now()).toISOString() };
    await this.storage.set(key, JSON.stringify(created));
    return this.metadata(created);
  }
  async setScenario(photoId: string, mode: MockUploadScenario) {
    if (!['normal', 'delayed', 'always-fail', 'fail-three', 'save-fail', 'lost-response'].includes(mode)) {
      throw new AppError('Validation', '仮転送の設定が不正です。');
    }
    await this.storage.set(this.key('scenario', photoId), mode);
  }
  async advanceDays(days: number) {
    if (!Number.isSafeInteger(days) || days < 0 || days > 30) throw new AppError('Validation', '進める日数が不正です。');
    const key = this.key('clock', 'offset-ms');
    const current = Number(await this.storage.get(key) ?? '0');
    await this.storage.set(key, String(current + days * 24 * 60 * 60 * 1000));
    await this.sweepAll();
  }
  async sweepAll() {
    const index = JSON.parse(await this.storage.get(this.key('index', 'photos')) ?? '[]') as string[];
    if (!Array.isArray(index) || !index.every((id) => typeof id === 'string')) throw new AppError('Storage', '仮サーバー索引が不正です。');
    for (const id of index) {
      const receipt = await this.readRaw(id);
      if (receipt) await this.expire(receipt);
    }
  }
}
