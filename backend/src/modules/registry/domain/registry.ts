import {
  addMonths,
  clp,
  compareYearMonth,
  type Debt,
  type EntryId,
  type Expense,
  type FinancialState,
  type Income,
  type Schedule,
  type YearMonth,
} from '../../../core/index.ts';

/** Field problem shown to the user in neutral Spanish. Never echoes the submitted value. */
export interface RegistryIssue {
  readonly field: string;
  readonly message: string;
}

export const MAX_REGISTRY_AMOUNT = 1_000_000_000_000;
export const MAX_PENDING_INSTALLMENTS = 600;

/** HU04: balance at the start of `month`, positive or negative. */
export interface OpeningBalance {
  readonly amount: number;
  readonly month: YearMonth;
}

/** HU01 income, or HU02 expense when `nature` is set. */
export interface ScheduledEntry {
  readonly id: string;
  readonly label: string;
  readonly amount: number;
  readonly schedule: Schedule;
}

export interface RegistryExpense extends ScheduledEntry {
  readonly nature: Expense['nature'];
}

/** HU03: the explicit schedule of pending installments. */
export interface RegistryDebt {
  readonly id: string;
  readonly label: string;
  readonly totalInstallments: number | null;
  readonly installments: readonly { readonly month: YearMonth; readonly amount: number }[];
}

export interface RegistrySnapshot {
  readonly openingBalance: OpeningBalance | null;
  readonly incomes: readonly ScheduledEntry[];
  readonly expenses: readonly RegistryExpense[];
  readonly debts: readonly RegistryDebt[];
  /**
   * Entries that came from the bank in test or demo mode (HU36, ADR-002), by entry id, plus
   * `opening_balance`. The app labels them so they are never presented as real data.
   */
  readonly origins?: Readonly<Record<string, 'provider_test' | 'demo'>>;
}

export const EMPTY_REGISTRY: RegistrySnapshot = { openingBalance: null, incomes: [], expenses: [], debts: [] };

/** HU03 input as the user knows it: installment amount, how many are pending, next month. */
export interface DebtInput {
  readonly label: string;
  readonly installmentAmount: number;
  readonly pendingInstallments: number;
  readonly nextInstallmentMonth: YearMonth;
  readonly totalInstallments: number | null;
}

/** One installment per month from the next one; they end on their own after the last (HU03). */
export function expandDebt(input: DebtInput): RegistryDebt['installments'] {
  return Array.from({ length: input.pendingInstallments }, (_, index) => ({
    month: addMonths(input.nextInstallmentMonth, index),
    amount: input.installmentAmount,
  }));
}

const labelIssue = (label: string): RegistryIssue | null =>
  label.trim().length < 1 || label.trim().length > 80 ? { field: 'label', message: 'Ingresa un nombre de hasta 80 caracteres.' } : null;

const positiveAmountIssue = (amount: number, field = 'amount'): RegistryIssue | null =>
  !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_REGISTRY_AMOUNT
    ? { field, message: 'El monto debe ser un número entero de pesos mayor que cero.' }
    : null;

function scheduleIssue(schedule: Schedule): RegistryIssue | null {
  if (schedule.kind === 'every_n_months' && (schedule.intervalMonths < 2 || schedule.intervalMonths > 24)) {
    return { field: 'schedule.intervalMonths', message: 'La periodicidad debe ser cada 2 a 24 meses.' };
  }
  if (schedule.kind !== 'once' && schedule.until !== null && compareYearMonth(schedule.until, schedule.from) < 0) {
    return { field: 'schedule.until', message: 'El mes de término no puede ser anterior al mes de inicio.' };
  }
  return null;
}

/** HU01, HU02: positive amounts, a name and a coherent periodicity. */
export function scheduledEntryIssues(entry: Omit<ScheduledEntry, 'id'>): RegistryIssue[] {
  return [labelIssue(entry.label), positiveAmountIssue(entry.amount), scheduleIssue(entry.schedule)].filter((issue) => issue !== null);
}

export function debtIssues(input: DebtInput): RegistryIssue[] {
  const issues = [labelIssue(input.label), positiveAmountIssue(input.installmentAmount, 'installmentAmount')];
  if (!Number.isInteger(input.pendingInstallments) || input.pendingInstallments < 1 || input.pendingInstallments > MAX_PENDING_INSTALLMENTS) {
    issues.push({ field: 'pendingInstallments', message: `Indica entre 1 y ${String(MAX_PENDING_INSTALLMENTS)} cuotas pendientes.` });
  }
  if (input.totalInstallments !== null && (input.totalInstallments < input.pendingInstallments || input.totalInstallments > MAX_PENDING_INSTALLMENTS)) {
    issues.push({ field: 'totalInstallments', message: 'El total de cuotas no puede ser menor que las cuotas pendientes.' });
  }
  return issues.filter((issue) => issue !== null);
}

export function openingBalanceIssues(balance: OpeningBalance): RegistryIssue[] {
  return Number.isSafeInteger(balance.amount) && Math.abs(balance.amount) <= MAX_REGISTRY_AMOUNT
    ? []
    : [{ field: 'amount', message: 'El saldo debe ser un número entero de pesos.' }];
}

/**
 * Engine input built from the registry (HU01-HU04) plus outside commitments (HU15). The projection starts in the month of the
 * opening balance, which is where the user's real figures begin; `null` until it is registered.
 */
export function toFinancialState(snapshot: RegistrySnapshot, commitments: readonly Expense[] = []): FinancialState | null {
  const balance = snapshot.openingBalance;
  if (balance === null) {
    return null;
  }
  return {
    startMonth: balance.month,
    openingBalance: clp(balance.amount),
    incomes: snapshot.incomes.map((entry): Income => ({ id: entry.id as EntryId, label: entry.label, amount: clp(entry.amount), schedule: entry.schedule })),
    expenses: [
      ...snapshot.expenses.map(
        (entry): Expense => ({ id: entry.id as EntryId, label: entry.label, nature: entry.nature, amount: clp(entry.amount), schedule: entry.schedule }),
      ),
      // HU15: commitments from the household, after the user's own entries.
      ...commitments,
    ],
    debts: snapshot.debts.map(
      (debt): Debt => ({
        id: debt.id as EntryId,
        label: debt.label,
        installments: debt.installments.map((installment) => ({ month: installment.month, amount: clp(installment.amount) })),
      }),
    ),
  };
}
