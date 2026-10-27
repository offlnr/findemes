import { describe, expect, it } from 'vitest';
import { yearMonth } from '../calendar/year-month.ts';
import { clp } from '../money/clp.ts';
import { formatClpEs, formatMonthEs, formatSignedClpEs } from './spanish.ts';

describe('formatClpEs', () => {
  it('groups thousands with dots, as written in Chile', () => {
    expect(formatClpEs(clp(0))).toBe('$0');
    expect(formatClpEs(clp(999))).toBe('$999');
    expect(formatClpEs(clp(1_000))).toBe('$1.000');
    expect(formatClpEs(clp(1_234_567))).toBe('$1.234.567');
  });

  it('places the minus sign before the currency symbol', () => {
    expect(formatClpEs(clp(-45_000))).toBe('-$45.000');
  });
});

describe('formatSignedClpEs', () => {
  it('always shows the sign of a difference', () => {
    expect(formatSignedClpEs(clp(12_000))).toBe('+$12.000');
    expect(formatSignedClpEs(clp(-12_000))).toBe('-$12.000');
    expect(formatSignedClpEs(clp(0))).toBe('$0');
  });
});

describe('formatMonthEs', () => {
  it('writes the month name in Spanish followed by the year', () => {
    expect(formatMonthEs(yearMonth(2027, 1))).toBe('enero de 2027');
    expect(formatMonthEs(yearMonth(2026, 12))).toBe('diciembre de 2026');
  });
});
