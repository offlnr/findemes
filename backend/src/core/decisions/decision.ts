import type { EntryId, FinancialState } from '../financial-state/financial-state.ts';

/** Supplied by the engine to each applied decision. */
export interface DecisionContext {
  /** Position of the decision in the request (0-based). */
  readonly decisionIndex: number;
  /**
   * Deterministic id for the n-th entry this decision adds (n = 0, 1, ...). Unique across the
   * scenario and stable between runs, so explanations and comparisons can refer to it.
   */
  entryId(n: number): EntryId;
}

/** Validation problem in a decision's parameters. `message` is user-facing neutral Spanish. */
export interface DecisionIssue {
  readonly field: string;
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly DecisionIssue[] };

/**
 * Common contract every decision type implements (Tabla 11). Adding a type means implementing
 * this interface and registering it in a catalog, without touching the engine (RNF17).
 *
 * Methods use shorthand syntax on purpose: it lets a catalog hold types with different params.
 */
export interface DecisionType<TKind extends string = string, TParams = unknown> {
  /** Stable snake_case identifier, used by the API and stored with saved scenarios. */
  readonly kind: TKind;
  /** Validates raw parameters received from outside; the core does not trust its callers. */
  parseParams(raw: unknown, state: FinancialState): ParseResult<TParams>;
  /** Returns a new state with the decision applied. Must never mutate `state` (rule 3). */
  apply(state: FinancialState, params: TParams, context: DecisionContext): FinancialState;
  /** Descriptive sentence for the explanation; states the assumption used, never a judgement. */
  describe(params: TParams, state: FinancialState): string;
}

/**
 * A decision as requested by a caller, before validation. The API passes `params` through
 * unchanged: `parseParams` of the registered type is the single validation authority, so the
 * API never needs a per-kind switch and new kinds need no API change (RNF17).
 */
export interface DecisionInput {
  readonly kind: string;
  readonly params: unknown;
}
