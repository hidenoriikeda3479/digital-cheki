import type { Instant } from '@/core/values';
import type { AuthRole } from './auth';

export interface SupportReceipt { id: string; acceptedAt: Instant }
export interface SupportRecord extends SupportReceipt { principalId: string; role: AuthRole; subject: string; content: string }
export interface SupportService { submit(credential: string, subject: string, content: string): Promise<SupportReceipt> }
/** Mock-only inspection for tests. No external mail is sent. */
export interface MockSupportInbox { list(): Promise<SupportRecord[]> }
