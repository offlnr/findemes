import { createMvpCatalog, simulate, type FinancialState, type Schedule, type SimulationResult } from '../../../core/index.ts';
import type { Actor } from '../../shared/actor.ts';
import type { IdGenerator } from '../../shared/ports.ts';
import {
  debtIssues,
  expandDebt,
  openingBalanceIssues,
  scheduledEntryIssues,
  toFinancialState,
  type DebtInput,
  type OpeningBalance,
  type RegistryExpense,
  type RegistryIssue,
  type RegistrySnapshot,
} from '../domain/registry.ts';
import type { CommitmentSource, RegistryRepository, WriteContext } from '../ports/registry-ports.ts';

export interface EntryInput {
  readonly label: string;
  readonly amount: number;
  readonly schedule: Schedule;
}

export interface ExpenseInput extends EntryInput {
  readonly nature: RegistryExpense['nature'];
}

export type WriteResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly RegistryIssue[] }
  /** The record does not exist or belongs to another user: both answer the same (404). */
  | { readonly ok: false; readonly reason: 'not_found' };

export type ProjectionResult =
  | { readonly ok: true; readonly state: FinancialState; readonly horizonMonths: number; readonly result: SimulationResult }
  | { readonly ok: false; readonly reason: 'opening_balance_required' };

/** HU05: configurable horizon; the free plan and the paid plans share it in the MVP. */
export const PROJECTION_HORIZON = Object.freeze({ default: 12, min: 1, max: 36 });

const catalog = createMvpCatalog();
const invalid = (issues: readonly RegistryIssue[]): WriteResult => ({ ok: false, reason: 'invalid', issues });

/**
 * Financial registry use cases (HU01-HU04) and the projection built from it (HU05, HU39). The
 * calculation always happens here, with the engine; clients only display it (rule 8).
 */
export class RegistryService {
  private readonly repository: RegistryRepository;
  private readonly ids: IdGenerator;
  private readonly commitments: CommitmentSource | null;

  constructor(repository: RegistryRepository, ids: IdGenerator, commitments: CommitmentSource | null = null) {
    this.repository = repository;
    this.ids = ids;
    this.commitments = commitments;
  }

  snapshot(actor: Actor): Promise<RegistrySnapshot> {
    return this.repository.load(actor);
  }

  async setOpeningBalance(context: WriteContext, balance: OpeningBalance): Promise<WriteResult> {
    const issues = openingBalanceIssues(balance);
    if (issues.length > 0) return invalid(issues);
    await this.repository.setOpeningBalance(context, balance);
    return { ok: true, id: context.actor.userId };
  }

  async createIncome(context: WriteContext, input: EntryInput): Promise<WriteResult> {
    const issues = scheduledEntryIssues(input);
    if (issues.length > 0) return invalid(issues);
    const id = this.ids.newId();
    await this.repository.createIncome(context, { id, ...trimmed(input) });
    return { ok: true, id };
  }

  async updateIncome(context: WriteContext, id: string, input: EntryInput): Promise<WriteResult> {
    const issues = scheduledEntryIssues(input);
    if (issues.length > 0) return invalid(issues);
    return found(await this.repository.updateIncome(context, { id, ...trimmed(input) }), id);
  }

  async createExpense(context: WriteContext, input: ExpenseInput): Promise<WriteResult> {
    const issues = scheduledEntryIssues(input);
    if (issues.length > 0) return invalid(issues);
    const id = this.ids.newId();
    await this.repository.createExpense(context, { id, ...trimmed(input), nature: input.nature });
    return { ok: true, id };
  }

  async updateExpense(context: WriteContext, id: string, input: ExpenseInput): Promise<WriteResult> {
    const issues = scheduledEntryIssues(input);
    if (issues.length > 0) return invalid(issues);
    return found(await this.repository.updateExpense(context, { id, ...trimmed(input), nature: input.nature }), id);
  }

  async createDebt(context: WriteContext, input: DebtInput): Promise<WriteResult> {
    const issues = debtIssues(input);
    if (issues.length > 0) return invalid(issues);
    const id = this.ids.newId();
    await this.repository.createDebt(context, { id, label: input.label.trim(), totalInstallments: input.totalInstallments, installments: expandDebt(input) });
    return { ok: true, id };
  }

  /** Replaces the pending schedule with the one described by the new HU03 input. */
  async updateDebt(context: WriteContext, id: string, input: DebtInput): Promise<WriteResult> {
    const issues = debtIssues(input);
    if (issues.length > 0) return invalid(issues);
    return found(
      await this.repository.updateDebt(context, { id, label: input.label.trim(), totalInstallments: input.totalInstallments, installments: expandDebt(input) }),
      id,
    );
  }

  async deleteIncome(context: WriteContext, id: string): Promise<boolean> {
    return this.repository.deleteIncome(context, id);
  }

  async deleteExpense(context: WriteContext, id: string): Promise<boolean> {
    return this.repository.deleteExpense(context, id);
  }

  async deleteDebt(context: WriteContext, id: string): Promise<boolean> {
    return this.repository.deleteDebt(context, id);
  }

  /** HU05 and HU39: projection of the registered state, recomputed on every read. */
  async projection(actor: Actor, horizonMonths: number = PROJECTION_HORIZON.default): Promise<ProjectionResult> {
    const state = await loadFinancialState(this.repository, this.commitments, actor);
    if (state === null) {
      return { ok: false, reason: 'opening_balance_required' };
    }
    const outcome = simulate({ state, decisions: [], horizonMonths }, catalog);
    if (!outcome.ok) {
      // Without decisions the engine has nothing to reject.
      throw new Error('Projection without decisions cannot fail');
    }
    return { ok: true, state, horizonMonths, result: outcome.result };
  }
}

/** The registry plus outside commitments (HU15), as the engine input; `null` without opening balance. */
export async function loadFinancialState(repository: RegistryRepository, commitments: CommitmentSource | null, actor: Actor): Promise<FinancialState | null> {
  const [snapshot, extra] = await Promise.all([repository.load(actor), commitments === null ? [] : commitments.commitmentsFor(actor)]);
  return toFinancialState(snapshot, extra);
}

function trimmed(input: EntryInput): EntryInput {
  return { label: input.label.trim(), amount: input.amount, schedule: input.schedule };
}

function found(ok: boolean, id: string): WriteResult {
  return ok ? { ok: true, id } : { ok: false, reason: 'not_found' };
}
