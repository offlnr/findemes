import { describe, expect, it } from 'vitest';
import { addClp, clp, subtractClp } from './clp.ts';

describe('clp', () => {
  it('accepts whole peso amounts, including zero and negatives', () => {
    expect(clp(450_000)).toBe(450_000);
    expect(clp(0)).toBe(0);
    expect(clp(-12_500)).toBe(-12_500);
  });

  it('rejects amounts with decimals', () => {
    expect(() => clp(1_000.5)).toThrow(RangeError);
  });

  it('rejects non-finite values', () => {
    expect(() => clp(Number.NaN)).toThrow(RangeError);
    expect(() => clp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects amounts outside the safe integer range', () => {
    expect(() => clp(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('normalizes negative zero to zero', () => {
    expect(Object.is(clp(-0), 0)).toBe(true);
  });
});

describe('addClp / subtractClp', () => {
  it('adds and subtracts amounts exactly', () => {
    expect(addClp(clp(300_000), clp(150_000))).toBe(450_000);
    expect(subtractClp(clp(100_000), clp(250_000))).toBe(-150_000);
  });

  it('rejects results that leave the safe integer range', () => {
    expect(() => addClp(clp(Number.MAX_SAFE_INTEGER), clp(1))).toThrow(RangeError);
    expect(() => subtractClp(clp(Number.MIN_SAFE_INTEGER), clp(1))).toThrow(RangeError);
  });
});
