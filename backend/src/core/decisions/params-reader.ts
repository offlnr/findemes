import { compareYearMonth, parseYearMonth, type MonthRange, type YearMonth } from '../calendar/year-month.ts';
import { clp, type Clp } from '../money/clp.ts';
import type { DecisionIssue, ParseResult } from './decision.ts';

/** Largest amount accepted in a decision (one trillion pesos): rejects absurd inputs early. */
export const MAX_DECISION_AMOUNT = 1_000_000_000_000;
export const MAX_LABEL_LENGTH = 80;

type Raw = Readonly<Record<string, unknown>>;

/**
 * Hand-written validation of raw decision parameters. The core cannot use validation libraries
 * (rule 1), and `parseParams` is the single validation authority for every decision kind.
 * Each reader returns `undefined` after recording a neutral, user-facing issue with `fail`.
 */
export class ParamsReader {
  readonly issues: DecisionIssue[] = [];
  private readonly raw: Raw;

  private constructor(raw: Raw) {
    this.raw = raw;
  }

  /** Starts reading an object whose keys must all belong to `allowed` (unknown fields are rejected). */
  static open(raw: unknown, allowed: readonly string[]): ParamsReader {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      const reader = new ParamsReader({});
      reader.fail('params', 'Los parámetros de la decisión deben ser un objeto.');
      return reader;
    }
    const reader = new ParamsReader(raw as Raw);
    for (const key of Object.keys(raw)) {
      if (!allowed.includes(key)) {
        reader.fail(key, 'Campo no reconocido.');
      }
    }
    return reader;
  }

  fail(field: string, message: string): void {
    // When the params are not an object, field-level issues would only repeat that fact.
    if (this.issues[0]?.field !== 'params') {
      this.issues.push({ field, message });
    }
  }

  /** True when the field is present with a value other than `null`. */
  has(field: string): boolean {
    return this.raw[field] !== undefined && this.raw[field] !== null;
  }

  label(field: string): string | undefined {
    const value = this.raw[field];
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(field, 'Ingresa un nombre.');
      return undefined;
    }
    if (value.trim().length > MAX_LABEL_LENGTH) {
      this.fail(field, `El nombre admite hasta ${String(MAX_LABEL_LENGTH)} caracteres.`);
      return undefined;
    }
    return value.trim();
  }

  /** Whole pesos. `sign` restricts the accepted values; the absolute value is always bounded. */
  amount(field: string, sign: 'positive' | 'non_negative' | 'non_zero'): Clp | undefined {
    const value = this.raw[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      this.fail(field, 'El monto debe ser un número entero de pesos.');
      return undefined;
    }
    if (Math.abs(value) > MAX_DECISION_AMOUNT) {
      this.fail(field, 'El monto excede el máximo permitido.');
      return undefined;
    }
    if (sign === 'positive' && value <= 0) {
      this.fail(field, 'El monto debe ser mayor que cero.');
      return undefined;
    }
    if (sign === 'non_negative' && value < 0) {
      this.fail(field, 'El monto no puede ser negativo.');
      return undefined;
    }
    if (sign === 'non_zero' && value === 0) {
      this.fail(field, 'El monto de la variación no puede ser cero.');
      return undefined;
    }
    return clp(value);
  }

  integer(field: string, min: number, max: number): number | undefined {
    const value = this.raw[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.fail(field, `Debe ser un número entero entre ${String(min)} y ${String(max)}.`);
      return undefined;
    }
    return value;
  }

  month(field: string): YearMonth | undefined {
    return this.monthFrom(this.raw[field], field);
  }

  /** `{ from: "YYYY-MM", until: "YYYY-MM" | null }`; `until: null` means permanent. */
  range(field: string): MonthRange | undefined {
    const value = this.raw[field];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(field, 'Indica el mes de inicio y, si corresponde, el mes de término.');
      return undefined;
    }
    const { from, until, ...rest } = value as Raw;
    for (const key of Object.keys(rest)) {
      this.fail(`${field}.${key}`, 'Campo no reconocido.');
    }
    const start = this.monthFrom(from, `${field}.from`);
    const end = until === null || until === undefined ? null : this.monthFrom(until, `${field}.until`);
    if (start === undefined || end === undefined) {
      return undefined;
    }
    if (end !== null && compareYearMonth(end, start) < 0) {
      this.fail(`${field}.until`, 'El mes de término no puede ser anterior al mes de inicio.');
      return undefined;
    }
    return { from: start, until: end };
  }

  oneOf<T extends string>(field: string, values: readonly T[], fallback: T): T | undefined {
    const value = this.raw[field];
    if (value === undefined) {
      return fallback;
    }
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
      this.fail(field, 'Opción no válida.');
      return undefined;
    }
    return value as T;
  }

  string(field: string): string | undefined {
    const value = this.raw[field];
    if (typeof value !== 'string' || value === '') {
      this.fail(field, 'Selecciona un elemento.');
      return undefined;
    }
    return value;
  }

  /** Every reader that returned `undefined` recorded an issue, so this is never empty after one. */
  failure(): ParseResult<never> {
    return { ok: false, issues: this.issues };
  }

  private monthFrom(value: unknown, field: string): YearMonth | undefined {
    if (typeof value !== 'string') {
      this.fail(field, 'Indica un mes con el formato AAAA-MM.');
      return undefined;
    }
    try {
      return parseYearMonth(value);
    } catch {
      this.fail(field, 'Indica un mes con el formato AAAA-MM.');
      return undefined;
    }
  }
}
