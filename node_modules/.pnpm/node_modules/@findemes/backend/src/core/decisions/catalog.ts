import type { DecisionType } from './decision.ts';

export interface DecisionCatalog {
  get(kind: string): DecisionType | undefined;
  /** Registered kinds in registration order. */
  kinds(): readonly string[];
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * Builds an immutable catalog of decision types (RNF17). The engine looks types up here,
 * so supporting a new decision only requires passing one more type.
 */
export function createDecisionCatalog(types: readonly DecisionType[]): DecisionCatalog {
  const byKind = new Map<string, DecisionType>();
  for (const type of types) {
    if (!SNAKE_CASE.test(type.kind)) {
      throw new Error(`Decision kind "${type.kind}" must be a snake_case identifier`);
    }
    if (byKind.has(type.kind)) {
      throw new Error(`Decision kind "${type.kind}" is registered more than once`);
    }
    byKind.set(type.kind, type);
  }
  const kinds = Object.freeze([...byKind.keys()]);

  return Object.freeze({
    get: (kind: string) => byKind.get(kind),
    kinds: () => kinds,
  });
}
