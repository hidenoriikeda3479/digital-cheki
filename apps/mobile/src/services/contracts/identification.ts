import type { EntityId, Instant } from '@/core/values';

export type RecipientKind = 'member' | 'guest';
/** Opaque result for the intake workflow. Never render or use it as authentication. */
export interface RecipientResolution { recipientRef: EntityId; kind: RecipientKind }
export interface OwnIdentity { number: string; qrPayload: string }
/** Display source is supplied by the service, never chosen from an idol ID in the screen. */
export interface SelectableIdol { id: EntityId; name: string; portraitSource?: number | { uri: string } }
export interface PickupIdol { id: EntityId; name: string; groupName: string; portraitSource: number | { uri: string };
  socialLinks?: { x?: string; instagram?: string } }
export interface CaptureIntake {
  id: EntityId;
  groupId: EntityId;
  recipientRef: EntityId;
  idolIds: EntityId[];
  acceptedAt: Instant;
}

/** Every method validates the credential and owner. null means no matching recipient/intake. */
export interface IdentificationService {
  /** Authenticated fan/guest; approved idols with portraits across groups, random unique maximum 10. No private recipient/photo data. */
  listPickupIdols(credential: string): Promise<PickupIdol[]>;
  /** Last 168 hours by capture time, confirmed uploads only. Top three positive counts; ties by name. */
  listTrendingIdols(credential: string): Promise<PickupIdol[]>;
  getOwnIdentity(credential: string): Promise<OwnIdentity>;
  getOwnRecipientRef(credential: string): Promise<EntityId>;
  resolveQr(credential: string, payload: string): Promise<RecipientResolution | null>;
  resolveNumber(credential: string, number: string): Promise<RecipientResolution | null>;
  listSelectableIdols(credential: string): Promise<SelectableIdol[]>;
  saveIntake(credential: string, recipientRef: EntityId, idolIds: EntityId[]): Promise<CaptureIntake>;
  getLatestIntake(credential: string): Promise<CaptureIntake | null>;
  listIntakes(credential: string): Promise<CaptureIntake[]>;
  /** Group-owned saved intake only; never used by the QR/number existence screen. */
  getIntakeRecipientName(credential: string, intakeId: EntityId): Promise<string>;
}
