import type { Clock } from '../modules/shared/ports.ts';

/** Real wall clock, wired only here; tests and the OpenAPI generator pass fixed clocks. */
export const systemClock: Clock = { now: () => new Date() };
