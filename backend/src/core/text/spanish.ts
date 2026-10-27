import type { YearMonth } from '../calendar/year-month.ts';
import type { Clp } from '../money/clp.ts';

// Hand-written formatting: Intl and toLocale* depend on the runtime's locale data and are
// banned in the core (rule 1), so explanations are identical on every machine.

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** "$1.234.567" or "-$45.000". */
export function formatClpEs(amount: Clp): string {
  const digits = String(Math.abs(amount));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return amount < 0 ? `-$${grouped}` : `$${grouped}`;
}

/** Difference with an explicit sign: "+$12.000", "-$12.000" or "$0". */
export function formatSignedClpEs(amount: Clp): string {
  return amount > 0 ? `+${formatClpEs(amount)}` : formatClpEs(amount);
}

/** "marzo de 2027". */
export function formatMonthEs(month: YearMonth): string {
  return `${MONTH_NAMES[month.month - 1] ?? ''} de ${String(month.year)}`;
}
