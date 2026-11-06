import type { AccessTokenService, PasswordHasher } from '../../identity/ports/identity-ports.ts';
import type { UserId } from '../../shared/actor.ts';
import type { Clock } from '../../shared/ports.ts';
import type {
  AccountSummary,
  AdminContext,
  AdminDirectory,
  AuditEntryView,
  AuditFilter,
  PaymentFilter,
  PaymentOrderView,
  PaymentStatusSource,
  PlatformMetrics,
  SealedSecret,
} from '../ports/administration-ports.ts';

/** HU17.1 applied to the panel: temporary lock with growing wait, never permanent. */
const FREE_ATTEMPTS = 5;
const MAX_LOCK_MS = 60 * 60 * 1000;
/** An order still open after this long needs a look (HU26). */
export const UNCONFIRMED_AFTER_MS = 60 * 60 * 1000;

export type PaymentFlag = 'monto_distinto' | 'sin_confirmar' | 'autorizada_sin_activar';
export type ReconciliationFlag = 'cobro_sin_activacion' | 'activacion_sin_cobro' | 'monto_distinto' | 'sin_diferencias';

export interface AdminDeps {
  readonly directory: AdminDirectory;
  readonly hasher: PasswordHasher;
  readonly openTotpSecret: (sealed: SealedSecret) => string;
  readonly verifyTotp: (secret: string, code: string, now: Date) => number | null;
  /** Tokens with the admin audience and their own secret: a public API token is never accepted. */
  readonly tokens: AccessTokenService;
  readonly clock: Clock;
  readonly payments?: PaymentStatusSource;
  /** Verified when the email is not an admin, so both cases cost one argon2id verification. */
  readonly dummyPasswordHash: string;
  /** HU24: health of the public API as seen from the admin network. */
  readonly checkPublicApi?: () => Promise<{ readonly up: boolean; readonly latencyMs: number | null }>;
}

interface Throttle {
  failures: number;
  lockedUntil: number;
}

export type AdminLoginResult =
  | { readonly ok: true; readonly token: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: 'invalid' }
  | { readonly ok: false; readonly reason: 'locked'; readonly retryAfterMs: number };

/**
 * Administration (HU22-HU26, RNF22). Separate process and API (rule 9); second factor TOTP;
 * every action is recorded in the audit trail; no access to users' financial data (HU23).
 */
export class AdminService {
  private readonly deps: AdminDeps;
  private readonly throttles = new Map<string, Throttle>();
  /** Last TOTP step accepted per admin: a code cannot be used twice. */
  private readonly lastStep = new Map<string, number>();

  constructor(deps: AdminDeps) {
    this.deps = deps;
  }

  async login(input: { readonly email: string; readonly password: string; readonly code: string; readonly ip: string }): Promise<AdminLoginResult> {
    const now = this.deps.clock.now().getTime();
    const keys = [`email:${input.email.trim().toLowerCase()}`, `ip:${input.ip}`];
    const lockedUntil = Math.max(...keys.map((key) => this.throttles.get(key)?.lockedUntil ?? 0));
    if (lockedUntil > now) return { ok: false, reason: 'locked', retryAfterMs: lockedUntil - now };

    const login = await this.deps.directory.lookupLogin(input.email);
    const passwordOk = await this.deps.hasher.verify(login?.passwordHash ?? this.deps.dummyPasswordHash, input.password);
    let step: number | null = null;
    if (login !== null && passwordOk && login.status === 'active') {
      step = this.deps.verifyTotp(this.deps.openTotpSecret(login.totp), input.code, this.deps.clock.now());
      if (step !== null && step <= (this.lastStep.get(login.userId) ?? -1)) step = null;
    }
    if (login === null || step === null) {
      for (const key of keys) this.fail(key, now);
      return { ok: false, reason: 'invalid' };
    }
    for (const key of keys) this.throttles.delete(key);
    this.lastStep.set(login.userId, step);
    const issued = await this.deps.tokens.issue(login.userId);
    await this.deps.directory.recordAdminAction({ adminId: login.userId, ip: input.ip }, 'admin.login', 'user', login.userId);
    return { ok: true, token: issued.token, expiresAt: issued.expiresAt };
  }

  /** Deny by default: a valid token of someone who is no longer an admin is refused. */
  async authenticate(token: string): Promise<UserId | null> {
    const adminId = await this.deps.tokens.verify(token);
    if (adminId === null) return null;
    return (await this.deps.directory.isActiveAdmin(adminId)) ? adminId : null;
  }

  /** HU23: search by email fragment; shows plan and subscription, never financial data. */
  async searchAccounts(admin: AdminContext, query: string): Promise<readonly AccountSummary[]> {
    const accounts = await this.deps.directory.searchAccounts(query.trim().toLowerCase(), 50);
    await this.deps.directory.recordAdminAction(admin, 'admin.accounts_searched', 'user', null);
    return accounts;
  }

  async setAccountStatus(admin: AdminContext, userId: string, status: 'active' | 'suspended'): Promise<'ok' | 'not_found' | 'self'> {
    if (userId === admin.adminId) return 'self';
    return (await this.deps.directory.setAccountStatus(admin, userId, status)) ? 'ok' : 'not_found';
  }

  /** HU25: read-only; the panel cannot alter it and the database refuses changes anyway. */
  async audit(admin: AdminContext, filter: AuditFilter): Promise<{ entries: readonly AuditEntryView[]; brokenAtSeq: number | null }> {
    const [entries, brokenAtSeq] = await Promise.all([this.deps.directory.auditEntries(filter), this.deps.directory.verifyAuditChain()]);
    await this.deps.directory.recordAdminAction(admin, 'admin.audit_viewed', 'audit_log', null);
    return { entries, brokenAtSeq };
  }

  /** HU26: orders by status and period, with the inconsistencies of our own records flagged. */
  async payments(admin: AdminContext, filter: PaymentFilter): Promise<readonly (PaymentOrderView & { flags: readonly PaymentFlag[] })[]> {
    const orders = await this.deps.directory.paymentOrders(filter);
    await this.deps.directory.recordAdminAction(admin, 'admin.payments_viewed', 'payment_order', null);
    const now = this.deps.clock.now().getTime();
    return orders.map((order) => ({ ...order, flags: paymentFlags(order, now) }));
  }

  /** HU26: compares one order with what Transbank reports for its transaction. */
  async reconcile(admin: AdminContext, buyOrder: string): Promise<{ flag: ReconciliationFlag; providerStatus: string } | 'not_found' | 'unavailable'> {
    if (this.deps.payments === undefined) return 'unavailable';
    const token = await this.deps.directory.providerTokenOf(buyOrder);
    if (token === null) return 'not_found';
    const [order] = await this.deps.directory.paymentOrders({ limit: 1, buyOrder });
    const provider = await this.deps.payments.status(token);
    await this.deps.directory.recordAdminAction(admin, 'admin.payment_reconciled', 'payment_order', null);
    if (provider === null || order === undefined) return { flag: 'sin_diferencias', providerStatus: provider?.status ?? 'desconocido' };
    const charged = provider.status === 'AUTHORIZED';
    const activated = order.activatedAt !== null;
    let flag: ReconciliationFlag = 'sin_diferencias';
    if (charged && !activated) flag = 'cobro_sin_activacion';
    else if (!charged && activated) flag = 'activacion_sin_cobro';
    else if (charged && provider.amount !== null && provider.amount !== order.amount) flag = 'monto_distinto';
    return { flag, providerStatus: provider.status };
  }

  /** HU24 and the KPI of section 4.1: aggregate figures only. */
  async metrics(admin: AdminContext): Promise<PlatformMetrics & { publicApi: { up: boolean; latencyMs: number | null } | null }> {
    const [metrics, publicApi] = await Promise.all([this.deps.directory.metrics(), this.deps.checkPublicApi?.() ?? Promise.resolve(null)]);
    await this.deps.directory.recordAdminAction(admin, 'admin.metrics_viewed', 'platform', null);
    return { ...metrics, publicApi };
  }

  private fail(key: string, now: number) {
    const throttle = this.throttles.get(key) ?? { failures: 0, lockedUntil: 0 };
    throttle.failures += 1;
    if (throttle.failures >= FREE_ATTEMPTS) {
      throttle.lockedUntil = now + Math.min(60_000 * 2 ** (throttle.failures - FREE_ATTEMPTS), MAX_LOCK_MS);
    }
    this.throttles.set(key, throttle);
  }
}

export function paymentFlags(order: PaymentOrderView, now: number): PaymentFlag[] {
  const flags: PaymentFlag[] = [];
  if (order.status === 'amount_mismatch') flags.push('monto_distinto');
  if (order.status === 'created' && now - order.createdAt.getTime() > UNCONFIRMED_AFTER_MS) flags.push('sin_confirmar');
  if (order.status === 'authorized' && order.activatedAt === null) flags.push('autorizada_sin_activar');
  return flags;
}
