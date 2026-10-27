// In-memory double of RegistryRepository with the same ownership rules as the PostgreSQL adapter:
// records of another owner are invisible (updates and deletes answer false).
import { randomUUID } from 'node:crypto';
import type { RegistryRepository, WriteContext } from '../../src/modules/registry/ports/registry-ports.ts';
import type { OpeningBalance, RegistryDebt, RegistryExpense, ScheduledEntry } from '../../src/modules/registry/domain/registry.ts';

interface Owned<T> {
  owner: string;
  value: T;
}

export function createInMemoryRegistry() {
  const balances = new Map<string, OpeningBalance>();
  const incomes = new Map<string, Owned<ScheduledEntry>>();
  const expenses = new Map<string, Owned<RegistryExpense>>();
  const debts = new Map<string, Owned<RegistryDebt>>();
  const audit: { actorId: string; action: string; targetId: string | null; ip: string }[] = [];

  const mine = <T>(table: Map<string, Owned<T>>, owner: string) => [...table.values()].filter((row) => row.owner === owner).map((row) => row.value);
  const record = (context: WriteContext, action: string, targetId: string | null) =>
    audit.push({ actorId: context.actor.userId, action, targetId, ip: context.ip });

  function update<T extends { id: string }>(table: Map<string, Owned<T>>, action: string) {
    return (context: WriteContext, value: T) => {
      const row = table.get(value.id);
      if (row?.owner !== context.actor.userId) return Promise.resolve(false);
      row.value = value;
      record(context, action, value.id);
      return Promise.resolve(true);
    };
  }

  function remove<T>(table: Map<string, Owned<T>>, action: string) {
    return (context: WriteContext, id: string) => {
      if (table.get(id)?.owner !== context.actor.userId) return Promise.resolve(false);
      table.delete(id);
      record(context, action, id);
      return Promise.resolve(true);
    };
  }

  function create<T extends { id: string }>(table: Map<string, Owned<T>>, action: string) {
    return (context: WriteContext, value: T) => {
      table.set(value.id, { owner: context.actor.userId, value });
      record(context, action, value.id);
      return Promise.resolve();
    };
  }

  const repository: RegistryRepository = {
    load: (actor) =>
      Promise.resolve({
        openingBalance: balances.get(actor.userId) ?? null,
        incomes: mine(incomes, actor.userId),
        expenses: mine(expenses, actor.userId),
        debts: mine(debts, actor.userId),
      }),
    setOpeningBalance: (context, balance) => {
      balances.set(context.actor.userId, balance);
      record(context, 'registry.opening_balance_set', null);
      return Promise.resolve();
    },
    createIncome: create(incomes, 'registry.income_created'),
    createExpense: create(expenses, 'registry.expense_created'),
    createDebt: create(debts, 'registry.debt_created'),
    updateIncome: update(incomes, 'registry.income_updated'),
    updateExpense: update(expenses, 'registry.expense_updated'),
    updateDebt: update(debts, 'registry.debt_updated'),
    deleteIncome: remove(incomes, 'registry.income_deleted'),
    deleteExpense: remove(expenses, 'registry.expense_deleted'),
    deleteDebt: remove(debts, 'registry.debt_deleted'),
  };

  return { repository, audit, ids: { newId: () => randomUUID() } };
}
