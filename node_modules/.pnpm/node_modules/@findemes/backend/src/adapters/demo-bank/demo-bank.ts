import { clp, compareYearMonth, type YearMonth, yearMonth } from '../../core/index.ts';
import type {
  AggregatedAccount,
  AggregatedMovement,
  BankAggregator,
  MovementWindow,
} from '../../modules/aggregation/ports/aggregation-ports.ts';
import type { Clock } from '../../modules/shared/ports.ts';
import { DEMO_PROFILES, type DemoAccount, type DemoProfile } from './profiles.ts';

const LINK_PREFIX = 'demo:';
/** Months of history generated up to the current month (inclusive). */
const HISTORY_MONTHS = 12;

/** Link token of a demo profile. Not a secret: it only selects curated fictional data. */
export function demoLinkToken(profileId: string): string {
  return `${LINK_PREFIX}${profileId}`;
}

/**
 * Demo bank (ADR-002): implements the aggregation port with curated, deterministic profiles so
 * validation sessions and the defense show realistic data. Every item is marked `origin: 'demo'`.
 * Generation depends only on the profile and the clock's current day.
 */
export function createDemoBankAggregator(clock: Clock): BankAggregator {
  return {
    listAccounts(linkToken) {
      return settle(() => {
        const profile = profileFor(linkToken);
        const today = isoDay(clock.now());
        return profile.accounts.map((account): AggregatedAccount => {
          const net = generateHistory(profile, account, today).reduce((sum, m) => sum + m.amount, 0);
          return {
            externalId: account.externalId,
            name: account.name,
            type: account.type,
            availableBalance: clp(account.openingBalance + net),
            origin: 'demo',
          };
        });
      });
    },

    listMovements(linkToken, accountExternalId, window) {
      return settle(() => {
        const profile = profileFor(linkToken);
        const account = profile.accounts.find((candidate) => candidate.externalId === accountExternalId);
        if (account === undefined) {
          throw new Error('Unknown demo account');
        }
        const history = generateHistory(profile, account, isoDay(clock.now()));
        return history.filter((movement) => inWindow(movement, window));
      });
    },
  };
}

/** Runs `compute` so that a thrown error becomes a rejected promise, like a real provider call. */
function settle<T>(compute: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(compute());
  });
}

function profileFor(linkToken: string): DemoProfile {
  const id = linkToken.startsWith(LINK_PREFIX) ? linkToken.slice(LINK_PREFIX.length) : null;
  const profile = DEMO_PROFILES.find((candidate) => candidate.id === id);
  if (profile === undefined) {
    throw new Error('Unknown demo link token');
  }
  return profile;
}

function inWindow(movement: AggregatedMovement, window: MovementWindow): boolean {
  if ('since' in window) {
    return compareYearMonth(movement.month, window.since) >= 0;
  }
  return movement.postedOn >= isoDay(window.updatedSince);
}

/** Movements from HISTORY_MONTHS ago up to `today` (ISO day), newest first. */
function generateHistory(profile: DemoProfile, account: DemoAccount, today: string): AggregatedMovement[] {
  const [currentYear, currentMonth] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const movements: AggregatedMovement[] = [];

  for (let offset = HISTORY_MONTHS - 1; offset >= 0; offset -= 1) {
    const monthIndex = currentYear * 12 + (currentMonth - 1) - offset;
    const month = yearMonth(Math.floor(monthIndex / 12), (monthIndex % 12) + 1);
    const lastDay = daysInMonth(month);
    const add = (key: string, day: number, amount: number, description: string): void => {
      const postedOn = `${monthKey(month)}-${String(day).padStart(2, '0')}`;
      if (postedOn <= today) {
        movements.push({
          externalId: `${account.externalId}-${monthKey(month)}-${key}`,
          accountExternalId: account.externalId,
          postedOn,
          month,
          amount: clp(amount),
          description,
          origin: 'demo',
        });
      }
    };

    account.recurring.forEach((item, index) => {
      add(`r${String(index)}`, Math.min(item.dayOfMonth, lastDay), item.amount, item.description);
    });

    account.variable.forEach((item, index) => {
      const random = seededRandom(`${profile.id}:${account.externalId}:${monthKey(month)}:${String(index)}`);
      const [min, max] = item.timesPerMonth;
      const times = min + Math.floor(random() * (max - min + 1));
      for (let n = 0; n < times; n += 1) {
        const day = 1 + Math.floor(random() * lastDay);
        const amount = roundToTen(item.minAmount + random() * (item.maxAmount - item.minAmount));
        add(`v${String(index)}-${String(n)}`, day, -amount, item.description);
      }
    });
  }

  return movements.sort((a, b) =>
    a.postedOn === b.postedOn ? a.externalId.localeCompare(b.externalId) : a.postedOn < b.postedOn ? 1 : -1,
  );
}

function roundToTen(value: number): number {
  return Math.round(value / 10) * 10;
}

function monthKey(month: YearMonth): string {
  return `${String(month.year)}-${String(month.month).padStart(2, '0')}`;
}

function daysInMonth(month: YearMonth): number {
  return new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic PRNG (FNV-1a seed + mulberry32): same seed, same sequence. */
function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
