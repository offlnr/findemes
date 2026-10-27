import type { FastifyPluginCallback } from 'fastify';
import { formatYearMonth, MAX_DECISION_AMOUNT, MVP_DECISION_KINDS, type DecisionInput } from '../../core/index.ts';
import { runDemoProjection, type DemoBase } from '../../modules/demo/application/run-demo-projection.ts';
import { DEMO_EXAMPLE_IDS, listDemoExamples } from '../../modules/demo/domain/demo-examples.ts';
import { DEMO_LIMIT_NOTICE, DEMO_LIMITS } from '../../modules/demo/domain/demo-limits.ts';
import { currentMonth } from '../../modules/shared/current-month.ts';
import type { Clock } from '../../modules/shared/ports.ts';
import {
  decisionIssueSchema,
  entriesSchema,
  entriesView,
  explanationSchema,
  outcomeSchema,
  outcomeView,
  variationSchema,
  variationView,
} from './simulation-view.ts';

export interface DemoRoutesOptions {
  readonly clock: Clock;
}

/** Per client IP. The demo is public, so its cost is bounded by this limit (decision of 2026-10-02). */
export const DEMO_RATE_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' });

const TAGS = ['modo demostración'];
const boundedAmount = { type: 'integer', minimum: 0, maximum: MAX_DECISION_AMOUNT } as const;

const projectionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['base'],
  properties: {
    base: {
      description: 'Estado base: un ejemplo ficticio (HU27) o los datos mínimos del visitante (HU28).',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['example'],
          properties: { example: { type: 'string', enum: DEMO_EXAMPLE_IDS } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['openingBalance', 'monthlyIncome', 'monthlyFixedExpense'],
          properties: {
            openingBalance: { type: 'integer', minimum: -MAX_DECISION_AMOUNT, maximum: MAX_DECISION_AMOUNT },
            monthlyIncome: boundedAmount,
            monthlyFixedExpense: boundedAmount,
          },
        },
      ],
    },
    decision: {
      description:
        'Una decisión del catálogo (Tabla 11). Sus parámetros los valida el motor; los meses usan el formato AAAA-MM.',
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'params'],
          properties: { kind: { type: 'string', enum: [...MVP_DECISION_KINDS] }, params: { type: 'object' } },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

const projectionResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['origin', 'startMonth', 'horizonMonths', 'entries', 'base', 'scenario', 'variation', 'explanation', 'limitNotice'],
  properties: {
    origin: { type: 'string', enum: ['demo'], description: 'Los datos son de demostración y no se guardan.' },
    startMonth: { type: 'string' },
    horizonMonths: { type: 'integer' },
    entries: entriesSchema,
    base: outcomeSchema,
    scenario: { anyOf: [outcomeSchema, { type: 'null' }], description: 'null cuando no se aplica una decisión.' },
    variation: { anyOf: [variationSchema, { type: 'null' }] },
    explanation: explanationSchema,
    limitNotice: { type: 'string', description: 'Qué se habilita al crear una cuenta (HU28).' },
  },
} as const;

/** Public, stateless demo mode (HU27, HU28): no account, no persistence, rate limited. */
export const demoRoutes: FastifyPluginCallback<DemoRoutesOptions> = (app, options, done) => {
  app.get(
    '/demo/examples',
    {
      schema: {
        summary: 'Ejemplos ficticios del modo demostración',
        tags: TAGS,
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name', 'description'],
              properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } },
            },
          },
        },
      },
    },
    () => listDemoExamples(),
  );

  app.post<{ Body: { base: DemoBase; decision?: DecisionInput | null } }>(
    '/demo/projection',
    {
      config: { rateLimit: DEMO_RATE_LIMIT },
      schema: {
        summary: 'Proyección del modo demostración',
        description:
          `Calcula la proyección de un estado base de demostración con a lo más ${String(DEMO_LIMITS.maxDecisions)} decisión. ` +
          `Con datos propios proyecta ${String(DEMO_LIMITS.horizonMonths)} meses; con un ejemplo, ` +
          `${String(DEMO_LIMITS.exampleHorizonMonths)}. No guarda ni registra los datos enviados.`,
        tags: TAGS,
        body: projectionBody,
        response: {
          200: projectionResponse,
          422: {
            type: 'object',
            additionalProperties: false,
            required: ['error', 'message', 'issues'],
            properties: {
              error: { type: 'string', enum: ['invalid_decision'] },
              message: { type: 'string' },
              issues: { type: 'array', items: decisionIssueSchema },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMonth = currentMonth(options.clock);
      const outcome = runDemoProjection({ base: request.body.base, decision: request.body.decision ?? null }, startMonth);

      if (!outcome.ok) {
        // unknown_example cannot happen after schema validation; answer as a validation error anyway.
        if (outcome.reason === 'unknown_example') {
          return reply.status(400).send({ error: 'validation_error', message: 'La solicitud no es válida.', fields: ['/base/example'] });
        }
        return reply.status(422).send({ error: 'invalid_decision', message: 'La decisión no es válida.', issues: outcome.issues });
      }

      const { result } = outcome;
      return {
        origin: 'demo' as const,
        startMonth: formatYearMonth(startMonth),
        horizonMonths: outcome.horizonMonths,
        entries: entriesView(outcome.state),
        base: outcomeView(result.base),
        scenario: outcome.hasDecision ? outcomeView(result.scenario) : null,
        variation: outcome.hasDecision ? variationView(result.variation) : null,
        explanation: result.explanation,
        limitNotice: DEMO_LIMIT_NOTICE,
      };
    },
  );
  done();
};
