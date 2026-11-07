import { yearMonth, type YearMonth } from '../../core/index.ts';
import type { Clock } from './ports.ts';

/** Projections start in the current calendar month as seen in Chile. */
export const BUSINESS_TIME_ZONE = 'America/Santiago';

/** Current month in the business time zone. The core never reads the clock (rule 1), so callers pass this in. */
export function currentMonth(clock: Clock, timeZone: string = BUSINESS_TIME_ZONE): YearMonth {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(clock.now());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return yearMonth(year, month);
}
