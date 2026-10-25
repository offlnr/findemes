declare const clpBrand: unique symbol;

/** Amount in Chilean pesos. Always a safe integer (CLAUDE.md rule 10). */
export type Clp = number & { readonly [clpBrand]: true };

export function clp(amount: number): Clp {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`CLP amounts must be safe integers, received ${String(amount)}`);
  }
  // Normalize -0 so equal amounts are always identical.
  return (amount === 0 ? 0 : amount) as Clp;
}

export function addClp(a: Clp, b: Clp): Clp {
  return clp(a + b);
}

export function subtractClp(a: Clp, b: Clp): Clp {
  return clp(a - b);
}
