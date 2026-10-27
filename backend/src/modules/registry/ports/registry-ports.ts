import type { Actor } from '../../shared/actor.ts';
import type { WriteContext } from '../../shared/ports.ts';

export type { WriteContext };
import type { OpeningBalance, RegistryDebt, RegistryExpense, RegistrySnapshot, ScheduledEntry } from '../domain/registry.ts';


/**
 * The actor's own financial registry (HU01-HU04). Every method filters by the actor (deny by
 * default, rule 5); records of other owners behave as if they did not exist (`false`).
 */
export interface RegistryRepository {
  load(actor: Actor): Promise<RegistrySnapshot>;
  setOpeningBalance(context: WriteContext, balance: OpeningBalance): Promise<void>;
  /** The id is chosen by the caller (UUID); the owner is always the actor. */
  createIncome(context: WriteContext, income: ScheduledEntry): Promise<void>;
  createExpense(context: WriteContext, expense: RegistryExpense): Promise<void>;
  createDebt(context: WriteContext, debt: RegistryDebt): Promise<void>;
  /** Updates and deletes return `false` when the record does not exist or belongs to someone else. */
  updateIncome(context: WriteContext, income: ScheduledEntry): Promise<boolean>;
  updateExpense(context: WriteContext, expense: RegistryExpense): Promise<boolean>;
  updateDebt(context: WriteContext, debt: RegistryDebt): Promise<boolean>;
  deleteIncome(context: WriteContext, id: string): Promise<boolean>;
  deleteExpense(context: WriteContext, id: string): Promise<boolean>;
  deleteDebt(context: WriteContext, id: string): Promise<boolean>;
}
