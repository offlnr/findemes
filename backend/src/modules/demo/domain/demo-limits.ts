/**
 * Limits of the demo mode (HU28): at most an opening balance, one income and one fixed expense,
 * a three-month projection and one simulated decision. The demo endpoint is stateless and
 * stores nothing (decision of 2026-10-02). The preloaded examples (HU27) are fictitious and
 * fixed by the server, so they are projected over a full year.
 */
export const DEMO_LIMITS = Object.freeze({
  horizonMonths: 3,
  exampleHorizonMonths: 12,
  maxIncomes: 1,
  maxExpenses: 1,
  maxDecisions: 1,
});

/** Shown with every demo result (HU28): what an account enables, without blocking the result. */
export const DEMO_LIMIT_NOTICE =
  'En el modo demostración se usa un ingreso, un gasto fijo, una decisión y tres meses. Con una cuenta ' +
  'puedes registrar todos tus ingresos, gastos y deudas, proyectar más meses y guardar escenarios.';
