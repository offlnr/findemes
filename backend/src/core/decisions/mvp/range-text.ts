import type { MonthRange } from '../../calendar/year-month.ts';
import { formatMonthEs } from '../../text/spanish.ts';

/** "desde marzo de 2027 hasta junio de 2027" or "desde marzo de 2027, de forma permanente". */
export function describeRange(range: MonthRange): string {
  const from = `desde ${formatMonthEs(range.from)}`;
  return range.until === null ? `${from}, de forma permanente` : `${from} hasta ${formatMonthEs(range.until)}`;
}
