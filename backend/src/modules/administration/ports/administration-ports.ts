import type { UserId } from '../../shared/actor.ts';

/** Sealed TOTP secret as stored (migration 0009); opened only by the admin service. */
export interface SealedSecret {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly keyVersion: number;
}

export interface AdminLogin {
  readonly userId: UserId;
  readonly passwordHash: string;
  readonly status: 'active' | 'suspended';
  readonly totp: SealedSecret;
}

/** HU23: account data the panel may see. Never income, expenses, debts or scenarios. */
export interface AccountSummary {
  readonly id: string;
  readonly email: string;
  readonly status: 'active' | 'suspended';
  readonly emailVerified: boolean;
  readonly createdAt: Date;
  readonly planCode: 'free' | 'paid' | 'family';
  readonly periodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
}

export interface AuditEntryView {
  readonly seq: number;
  readonly occurredAt: Date;
  readonly actorType: 'user' | 'admin' | 'system';
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly originIp: string | null;
}

export interface AuditFilter {
  readonly limit: number;
  /** Entries with seq below this one (pagination from the newest). */
  readonly beforeSeq?: number;
  readonly actorId?: string;
  readonly actionPrefix?: string;
}

export interface PaymentOrderView {
  readonly buyOrder: string;
  readonly userId: string | null;
  readonly planCode: string;
  readonly amount: number;
  readonly status: 'created' | 'authorized' | 'rejected' | 'aborted' | 'amount_mismatch';
  readonly authorizedAmount: number | null;
  readonly responseCode: string | null;
  readonly createdAt: Date;
  readonly committedAt: Date | null;
  readonly activatedAt: Date | null;
  readonly hasProviderToken: boolean;
}

export interface PaymentFilter {
  readonly status?: PaymentOrderView['status'];
  /** ISO dates (YYYY-MM-DD), inclusive, on the creation date. */
  readonly from?: string;
  readonly to?: string;
  readonly buyOrder?: string;
  readonly limit: number;
}

export interface PlatformMetrics {
  readonly users: number;
  readonly verifiedUsers: number;
  readonly suspendedUsers: number;
  readonly onboardingStarted: number;
  readonly onboardingCompleted: number;
  /** Median minutes from start to completion of the initial registration (KPI 4.1). */
  readonly onboardingMedianMinutes: number | null;
  readonly activeSubscriptions: Readonly<Record<string, number>>;
}

/**
 * What the admin API reads and writes, with the app_admin database role: account status,
 * subscription data, payment orders and the audit trail. It has no grant on financial tables
 * (HU23), so this port cannot reach them either.
 */
export interface AdminDirectory {
  lookupLogin(email: string): Promise<AdminLogin | null>;
  isActiveAdmin(userId: UserId): Promise<boolean>;
  searchAccounts(query: string, limit: number): Promise<readonly AccountSummary[]>;
  /** Changes the status and records the admin action in the audit trail, atomically. */
  setAccountStatus(admin: AdminContext, userId: string, status: 'active' | 'suspended'): Promise<boolean>;
  auditEntries(filter: AuditFilter): Promise<readonly AuditEntryView[]>;
  /** Seq of the first broken entry, or null when the hash chain is intact (HU25). */
  verifyAuditChain(): Promise<number | null>;
  paymentOrders(filter: PaymentFilter): Promise<readonly PaymentOrderView[]>;
  providerTokenOf(buyOrder: string): Promise<string | null>;
  metrics(): Promise<PlatformMetrics>;
  recordAdminAction(admin: AdminContext, action: string, targetType: string, targetId: string | null): Promise<void>;
}

export interface AdminContext {
  readonly adminId: UserId;
  readonly ip: string;
}

/** HU26: what Transbank reports for a transaction, to reconcile it with our order. */
export interface PaymentStatusSource {
  status(token: string): Promise<{ readonly status: string; readonly amount: number | null; readonly buyOrder: string | null } | null>;
}
