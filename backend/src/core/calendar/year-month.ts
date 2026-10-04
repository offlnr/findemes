/**
 * Calendar month. The engine is monthly (CLAUDE.md, Tabla 12) and never reads the clock:
 * the first month of a projection always arrives as input.
 */
export interface YearMonth {
  readonly year: number;
  /** 1 = January ... 12 = December. */
  readonly month: number;
  /** Type-only brand: a YearMonth can only come from `yearMonth()` or `parseYearMonth()`. */
  readonly __brand: 'YearMonth';
}

/** Inclusive month range. `until: null` means permanent (Tabla 11, "carácter permanente o acotado"). */
export interface MonthRange {
  readonly from: YearMonth;
  readonly until: YearMonth | null;
}

const MIN_YEAR = 1900;
const MAX_YEAR = 9999;
const ISO_YEAR_MONTH = /^(\d{4})-(\d{2})$/;

export function yearMonth(year: number, month: number): YearMonth {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`Year must be an integer between ${String(MIN_YEAR)} and ${String(MAX_YEAR)}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Month must be an integer between 1 and 12');
  }
  return Object.freeze({ year, month }) as YearMonth;
}

function toIndex(value: YearMonth): number {
  return value.year * 12 + (value.month - 1);
}

function fromIndex(index: number): YearMonth {
  return yearMonth(Math.floor(index / 12), (index % 12) + 1);
}

export function addMonths(value: YearMonth, months: number): YearMonth {
  if (!Number.isInteger(months)) {
    throw new RangeError('Month offset must be an integer');
  }
  return fromIndex(toIndex(value) + months);
}

/** Whole months from `from` to `to`; negative when `to` is earlier. */
export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return toIndex(to) - toIndex(from);
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return toIndex(a) - toIndex(b);
}

export function isWithinRange(value: YearMonth, range: MonthRange): boolean {
  if (compareYearMonth(value, range.from) < 0) {
    return false;
  }
  return range.until === null || compareYearMonth(value, range.until) <= 0;
}

export function formatYearMonth(value: YearMonth): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}`;
}

export function parseYearMonth(text: string): YearMonth {
  const match = ISO_YEAR_MONTH.exec(text);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new RangeError(`Expected a month in YYYY-MM form, received "${text}"`);
  }
  return yearMonth(Number(match[1]), Number(match[2]));
}
