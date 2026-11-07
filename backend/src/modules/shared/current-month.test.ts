import { describe, expect, it } from 'vitest';
import { currentMonth } from './current-month.ts';

const at = (iso: string) => ({ now: () => new Date(iso) });

describe('currentMonth', () => {
  it('reads the month in Chilean time, not UTC', () => {
    // 02:00 UTC on 1 December is still 30 November in Santiago (UTC-3 in summer).
    expect(currentMonth(at('2026-12-01T02:00:00Z'))).toEqual({ year: 2026, month: 11 });
    expect(currentMonth(at('2026-12-01T04:00:00Z'))).toEqual({ year: 2026, month: 12 });
  });
});
