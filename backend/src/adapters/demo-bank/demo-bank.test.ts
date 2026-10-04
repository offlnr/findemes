import { describe, expect, it } from 'vitest';
import { yearMonth } from '../../core/index.ts';
import type { AggregatedMovement } from '../../modules/aggregation/ports/aggregation-ports.ts';
import { createDemoBankAggregator, demoLinkToken } from './demo-bank.ts';

const TODAY = new Date('2026-10-03T15:00:00Z');
const clock = { now: () => TODAY };
const bank = createDemoBankAggregator(clock);
const FAMILY = demoLinkToken('familia');
const FAMILY_ACCOUNT = 'demo-familia-cuenta-corriente';

async function familyMovementsSince(month: number, year = 2026): Promise<readonly AggregatedMovement[]> {
  return bank.listMovements(FAMILY, FAMILY_ACCOUNT, { since: yearMonth(year, month) });
}

describe('demo bank', () => {
  it('lists the accounts of a profile, labelled as demo data', async () => {
    const accounts = await bank.listAccounts(FAMILY);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      externalId: FAMILY_ACCOUNT,
      name: 'Cuenta Corriente',
      type: 'checking_account',
      origin: 'demo',
    });
  });

  it('rejects unknown link tokens and accounts', async () => {
    await expect(bank.listAccounts('demo:nobody')).rejects.toThrow(/unknown demo/i);
    await expect(bank.listAccounts('link_abc_token')).rejects.toThrow(/unknown demo/i);
    await expect(bank.listMovements(FAMILY, 'other-account', { since: yearMonth(2026, 9) })).rejects.toThrow(
      /unknown demo account/i,
    );
  });

  it('generates the same movements on every call (deterministic)', async () => {
    expect(await familyMovementsSince(1)).toEqual(await familyMovementsSince(1));
  });

  it('includes every recurring item once per elapsed month', async () => {
    const august = (await familyMovementsSince(8)).filter((m) => m.postedOn.startsWith('2026-08'));
    const salary = august.filter((m) => m.description === 'Remuneración Empresa Andes SpA');
    const rent = august.filter((m) => m.description === 'Transferencia a Inmobiliaria Los Robles');
    expect(salary.map((m) => [m.postedOn, m.amount])).toEqual([['2026-08-30', 1_250_000]]);
    expect(rent.map((m) => [m.postedOn, m.amount])).toEqual([['2026-08-05', -520_000]]);
  });

  it('clamps recurring days to the length of the month', async () => {
    const february = (await familyMovementsSince(2)).filter((m) => m.postedOn.startsWith('2026-02'));
    expect(february.find((m) => m.amount === 1_250_000)?.postedOn).toBe('2026-02-28');
  });

  it('never returns movements after today', async () => {
    const october = (await familyMovementsSince(10)).map((m) => m.postedOn);
    expect(october.every((date) => date <= '2026-10-03')).toBe(true);
    // The salary (day 30) and the gas bill (day 20) of October have not happened yet.
    const descriptions = (await familyMovementsSince(10)).map((m) => m.description);
    expect(descriptions).not.toContain('Remuneración Empresa Andes SpA');
    expect(descriptions).not.toContain('Metrogas');
  });

  it('keeps every amount an integer CLP within the configured ranges', async () => {
    const movements = await familyMovementsSince(1);
    expect(movements.every((m) => Number.isSafeInteger(m.amount) && m.amount !== 0)).toBe(true);
    const groceries = movements.filter((m) => m.description === 'Compra Supermercado Líder');
    expect(groceries.length).toBeGreaterThan(0);
    expect(groceries.every((m) => m.amount <= -35_000 && m.amount >= -70_000)).toBe(true);
  });

  it('respects the since window and returns newest first', async () => {
    const movements = await familyMovementsSince(9);
    expect(movements.every((m) => m.postedOn >= '2026-09-01')).toBe(true);
    const dates = movements.map((m) => m.postedOn);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('supports incremental syncs with updatedSince', async () => {
    const recent = await bank.listMovements(FAMILY, FAMILY_ACCOUNT, {
      updatedSince: new Date('2026-09-30T00:00:00Z'),
    });
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((m) => m.postedOn >= '2026-09-30')).toBe(true);
  });

  it('reports a balance equal to the opening balance plus the generated history', async () => {
    const [account] = await bank.listAccounts(FAMILY);
    const history = await bank.listMovements(FAMILY, FAMILY_ACCOUNT, { since: yearMonth(2025, 11) });
    const net = history.reduce((sum, m) => sum + m.amount, 0);
    expect(account?.availableBalance).toBe(420_000 + net);
  });

  it('uses unique movement ids', async () => {
    const ids = (await familyMovementsSince(1)).map((m) => m.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
