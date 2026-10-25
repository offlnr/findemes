import { describe, expect, it } from 'vitest';
import {
  addMonths,
  compareYearMonth,
  formatYearMonth,
  isWithinRange,
  monthsBetween,
  parseYearMonth,
  yearMonth,
} from './year-month.ts';

describe('yearMonth', () => {
  it('creates a month from a year and a month number from 1 to 12', () => {
    expect(yearMonth(2026, 10)).toEqual({ year: 2026, month: 10 });
  });

  it('rejects month numbers outside 1..12', () => {
    expect(() => yearMonth(2026, 0)).toThrow(RangeError);
    expect(() => yearMonth(2026, 13)).toThrow(RangeError);
    expect(() => yearMonth(2026, 1.5)).toThrow(RangeError);
  });

  it('rejects years outside 1900..9999', () => {
    expect(() => yearMonth(1899, 1)).toThrow(RangeError);
    expect(() => yearMonth(10_000, 1)).toThrow(RangeError);
  });

  it('returns a frozen value so a scenario cannot alter a month of the base state', () => {
    expect(Object.isFrozen(yearMonth(2026, 1))).toBe(true);
  });
});

describe('addMonths', () => {
  it('moves forward and backward across year boundaries', () => {
    expect(addMonths(yearMonth(2026, 11), 3)).toEqual(yearMonth(2027, 2));
    expect(addMonths(yearMonth(2026, 1), -1)).toEqual(yearMonth(2025, 12));
    expect(addMonths(yearMonth(2026, 5), 0)).toEqual(yearMonth(2026, 5));
    expect(addMonths(yearMonth(2026, 1), 24)).toEqual(yearMonth(2028, 1));
  });

  it('rejects non-integer offsets', () => {
    expect(() => addMonths(yearMonth(2026, 1), 0.5)).toThrow(RangeError);
  });
});

describe('monthsBetween', () => {
  it('counts whole months from the first to the second month', () => {
    expect(monthsBetween(yearMonth(2026, 10), yearMonth(2027, 3))).toBe(5);
    expect(monthsBetween(yearMonth(2027, 3), yearMonth(2026, 10))).toBe(-5);
    expect(monthsBetween(yearMonth(2026, 10), yearMonth(2026, 10))).toBe(0);
  });
});

describe('compareYearMonth', () => {
  it('orders months chronologically', () => {
    expect(compareYearMonth(yearMonth(2026, 1), yearMonth(2026, 2))).toBeLessThan(0);
    expect(compareYearMonth(yearMonth(2027, 1), yearMonth(2026, 12))).toBeGreaterThan(0);
    expect(compareYearMonth(yearMonth(2026, 6), yearMonth(2026, 6))).toBe(0);
  });
});

describe('isWithinRange', () => {
  const from = yearMonth(2026, 3);
  const until = yearMonth(2026, 6);

  it('includes both ends of a bounded range', () => {
    expect(isWithinRange(from, { from, until })).toBe(true);
    expect(isWithinRange(until, { from, until })).toBe(true);
    expect(isWithinRange(yearMonth(2026, 2), { from, until })).toBe(false);
    expect(isWithinRange(yearMonth(2026, 7), { from, until })).toBe(false);
  });

  it('treats a range without end as permanent', () => {
    expect(isWithinRange(yearMonth(2040, 1), { from, until: null })).toBe(true);
    expect(isWithinRange(yearMonth(2026, 2), { from, until: null })).toBe(false);
  });
});

describe('formatYearMonth / parseYearMonth', () => {
  it('uses the ISO YYYY-MM form', () => {
    expect(formatYearMonth(yearMonth(2026, 3))).toBe('2026-03');
    expect(parseYearMonth('2026-03')).toEqual(yearMonth(2026, 3));
  });

  it('rejects malformed text', () => {
    expect(() => parseYearMonth('2026-3')).toThrow(RangeError);
    expect(() => parseYearMonth('2026-13')).toThrow(RangeError);
    expect(() => parseYearMonth('03-2026')).toThrow(RangeError);
    expect(() => parseYearMonth('2026-03-01')).toThrow(RangeError);
  });
});
