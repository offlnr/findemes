/**
 * Limits of the demo mode (HU28): at most an opening balance, one income and one fixed expense,
 * a three-month projection and one simulated decision. The demo endpoint is stateless and
 * stores nothing (decision of 2026-10-02).
 */
export const DEMO_LIMITS = Object.freeze({
  horizonMonths: 3,
  maxIncomes: 1,
  maxExpenses: 1,
  maxDecisions: 1,
});
