import { addMonths, formatYearMonth, parseYearMonth, type Schedule } from '../../../core/index.ts';
import { currentMonth } from '../../shared/current-month.ts';
import type { Actor } from '../../shared/actor.ts';
import type { Clock, IdGenerator, WriteContext } from '../../shared/ports.ts';
import type {
  AggregatedMovement,
  BankAggregator,
  BankLinkProvider,
  BankProvider,
  BankStore,
  ProviderLink,
  StoredAccount,
  StoredLink,
  StoredMovement,
  TokenCipher,
} from '../ports/aggregation-ports.ts';

/** Months of history read on the first sync of a link. */
export const INITIAL_HISTORY_MONTHS = 12;
export const MAX_MOVEMENT_MONTHS = 12;

export interface DemoProfileSummary {
  readonly id: string;
  readonly label: string;
}

export interface AggregationDeps {
  readonly store: BankStore;
  /** Absent when no Fintoc key is configured: only the demo bank is offered. */
  readonly fintoc?: { readonly links: BankLinkProvider; readonly aggregator: BankAggregator };
  readonly demo: { readonly aggregator: BankAggregator; readonly profiles: readonly DemoProfileSummary[]; readonly linkTokenOf: (profileId: string) => string };
  readonly cipher: TokenCipher;
  /** Ley 21.719: an active `bank_connection` consent is required before connecting. */
  readonly hasBankConsent: (actor: Actor) => Promise<boolean>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export type ConnectInput = { readonly provider: 'fintoc'; readonly exchangeToken: string } | { readonly provider: 'demo'; readonly profileId: string };

export type AggregationRefusal =
  | { readonly reason: 'consent_required' }
  | { readonly reason: 'provider_unavailable' }
  | { readonly reason: 'not_found' }
  | { readonly reason: 'invalid'; readonly field: string; readonly message: string };

type Result<T> = ({ readonly ok: true } & T) | ({ readonly ok: false } & AggregationRefusal);

export interface MonthlyTotal {
  readonly month: string;
  /** Sum of credits (abonos). */
  readonly credits: number;
  /** Sum of debits (cargos), as a positive number. */
  readonly debits: number;
}

const DEMO_INSTITUTION = 'Banco de demostración';

/**
 * Bank aggregation (HU36, ADR-002). The bank password is typed only in the Fintoc widget; the
 * backend keeps the link token encrypted. Movements are shown as they come and summed by month;
 * the user, not the system, confirms which ones are recurring (decision 02-10-2026, rule 4).
 */
export class AggregationService {
  private readonly deps: AggregationDeps;

  constructor(deps: AggregationDeps) {
    this.deps = deps;
  }

  providers(): { readonly fintoc: boolean; readonly demoProfiles: readonly DemoProfileSummary[] } {
    return { fintoc: this.deps.fintoc !== undefined, demoProfiles: this.deps.demo.profiles };
  }

  async fintocIntent(actor: Actor): Promise<Result<{ widgetToken: string; publicKey: string }>> {
    if (this.deps.fintoc === undefined) return { ok: false, reason: 'provider_unavailable' };
    if (!(await this.deps.hasBankConsent(actor))) return { ok: false, reason: 'consent_required' };
    return { ok: true, ...(await this.deps.fintoc.links.createLinkIntent()) };
  }

  /** Connects a bank (or a demo profile) and runs the first sync. */
  async connect(context: WriteContext, input: ConnectInput): Promise<Result<{ id: string }>> {
    if (!(await this.deps.hasBankConsent(context.actor))) return { ok: false, reason: 'consent_required' };
    let link: ProviderLink;
    if (input.provider === 'fintoc') {
      if (this.deps.fintoc === undefined) return { ok: false, reason: 'provider_unavailable' };
      link = await this.deps.fintoc.links.exchange(input.exchangeToken);
    } else {
      if (!this.deps.demo.profiles.some((profile) => profile.id === input.profileId)) {
        return { ok: false, reason: 'invalid', field: 'profileId', message: 'Ese perfil de demostración no existe.' };
      }
      link = { providerLinkId: `demo-${input.profileId}`, linkToken: this.deps.demo.linkTokenOf(input.profileId), institutionName: DEMO_INSTITUTION, origin: 'demo' };
    }
    const id = await this.deps.store.upsertLink(context, {
      provider: input.provider,
      providerLinkId: link.providerLinkId,
      institutionName: link.institutionName,
      origin: link.origin,
      sealedToken: this.deps.cipher.encrypt(link.linkToken),
    });
    await this.sync(context, id);
    return { ok: true, id };
  }

  /** Reads accounts and movements again; storing them is idempotent. */
  async sync(context: WriteContext, linkId: string): Promise<Result<object>> {
    const link = await this.deps.store.findLink(context.actor, linkId);
    if (link?.status !== 'active') return { ok: false, reason: 'not_found' };
    const aggregator = this.aggregatorFor(link.provider);
    if (aggregator === null) return { ok: false, reason: 'provider_unavailable' };
    const token = this.deps.cipher.decrypt(link.sealedToken);
    const accounts = await aggregator.listAccounts(token);
    const since = addMonths(currentMonth(this.deps.clock), -(INITIAL_HISTORY_MONTHS - 1));
    const movements: AggregatedMovement[] = [];
    for (const account of accounts) {
      movements.push(...(await aggregator.listMovements(token, account.externalId, link.lastSyncedAt === null ? { since } : { updatedSince: link.lastSyncedAt })));
    }
    await this.deps.store.saveSync(context, linkId, accounts, movements);
    return { ok: true };
  }

  /** Revokes the provider's access (best effort) and deletes the link with its data. */
  async disconnect(context: WriteContext, linkId: string): Promise<boolean> {
    const link = await this.deps.store.findLink(context.actor, linkId);
    if (link === null) return false;
    if (link.provider === 'fintoc' && this.deps.fintoc !== undefined) {
      await this.deps.fintoc.links.revoke(this.deps.cipher.decrypt(link.sealedToken)).catch(() => undefined);
    }
    return this.deps.store.deleteLink(context, linkId);
  }

  /** HU21: before erasing the account, revoke every provider link (best effort). */
  async revokeAllAtProvider(actor: Actor): Promise<void> {
    if (this.deps.fintoc === undefined) return;
    const links = await this.deps.store.listLinks(actor);
    for (const link of links.filter((candidate) => candidate.provider === 'fintoc')) {
      await this.deps.fintoc.links.revoke(this.deps.cipher.decrypt(link.sealedToken)).catch(() => undefined);
    }
  }

  async overview(actor: Actor): Promise<{ readonly links: readonly StoredLink[]; readonly accounts: readonly StoredAccount[] }> {
    const [links, accounts] = await Promise.all([this.deps.store.listLinks(actor), this.deps.store.listAccounts(actor)]);
    return { links, accounts };
  }

  /** Movements of the last `months` months with neutral monthly totals (no classification). */
  async movements(actor: Actor, filter: { readonly accountId?: string; readonly months: number }): Promise<{ movements: readonly StoredMovement[]; totals: readonly MonthlyTotal[] }> {
    const months = Math.min(Math.max(filter.months, 1), MAX_MOVEMENT_MONTHS);
    const since = `${formatYearMonth(addMonths(currentMonth(this.deps.clock), -(months - 1)))}-01`;
    const movements = await this.deps.store.listMovements(actor, { since, ...(filter.accountId === undefined ? {} : { accountId: filter.accountId }) });
    const byMonth = new Map<string, { credits: number; debits: number }>();
    for (const movement of movements) {
      const month = movement.postedOn.slice(0, 7);
      const total = byMonth.get(month) ?? { credits: 0, debits: 0 };
      if (movement.amount > 0) total.credits += movement.amount;
      else total.debits += -movement.amount;
      byMonth.set(month, total);
    }
    const totals = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, ...total }));
    return { movements, totals };
  }

  /**
   * The user confirms a movement as a recurring income (credit) or expense (debit). The entry is
   * created in their registry with the movement's origin, so test or demo data stays labelled.
   */
  async confirmRecurring(
    context: WriteContext,
    movementId: string,
    input: { readonly label: string; readonly schedule?: Schedule; readonly nature?: 'fixed' | 'variable_estimate' },
  ): Promise<Result<{ id: string }>> {
    const movement = await this.deps.store.findMovement(context.actor, movementId);
    if (movement === null) return { ok: false, reason: 'not_found' };
    const label = input.label.trim();
    if (label.length < 1 || label.length > 80) return { ok: false, reason: 'invalid', field: 'label', message: 'Ingresa un nombre de hasta 80 caracteres.' };
    const id = this.deps.ids.newId();
    const schedule = input.schedule ?? { kind: 'monthly', from: parseYearMonth(movement.postedOn.slice(0, 7)), until: null };
    const confirmed = await this.deps.store.confirmRecurring(context, movementId, {
      id,
      kind: movement.amount > 0 ? 'income' : 'expense',
      label,
      amount: Math.abs(movement.amount),
      schedule,
      nature: input.nature ?? 'fixed',
    });
    return confirmed ? { ok: true, id } : { ok: false, reason: 'not_found' };
  }

  /** HU04 from a bank account: the available balance at the start of the current month. */
  async openingBalanceFromAccount(context: WriteContext, accountId: string): Promise<boolean> {
    return this.deps.store.openingBalanceFromAccount(context, accountId, currentMonth(this.deps.clock));
  }

  private aggregatorFor(provider: BankProvider): BankAggregator | null {
    if (provider === 'demo') return this.deps.demo.aggregator;
    return this.deps.fintoc?.aggregator ?? null;
  }
}
