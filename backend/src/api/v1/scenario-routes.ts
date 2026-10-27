import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { formatYearMonth, MVP_DECISION_KINDS, type DecisionInput } from '../../core/index.ts';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import { PROJECTION_HORIZON } from '../../modules/registry/application/registry-service.ts';
import { MAX_DECISIONS_PER_SCENARIO, type ScenarioRefusal, type ScenarioService } from '../../modules/scenarios/application/scenario-service.ts';
import type { Scenario } from '../../modules/scenarios/domain/scenario.ts';
import { noStore, requireActor } from './authenticate.ts';
import { badRequestSchema } from './common-schemas.ts';
import { explanationSchema, outcomeSchema, outcomeView, variationSchema, variationView } from './simulation-view.ts';

export interface ScenarioRoutesOptions {
  readonly scenarios: ScenarioService;
  readonly accessTokens: AccessTokenService;
}

const TAGS = ['escenarios'];
const security = [{ bearerAuth: [] }];
const id = { type: 'string', format: 'uuid' } as const;

function strict(properties: Record<string, unknown>, required: string[] = Object.keys(properties)) {
  return { type: 'object', additionalProperties: false, required, properties } as const;
}

const decisionSchema = strict({
  kind: { type: 'string', enum: [...MVP_DECISION_KINDS] },
  params: { type: 'object', description: 'Parámetros del tipo de decisión (Tabla 11); los valida el motor. Meses en formato AAAA-MM.' },
});
const scenarioBody = strict({
  name: { type: 'string', minLength: 1, maxLength: 80 },
  decisions: { type: 'array', maxItems: MAX_DECISIONS_PER_SCENARIO, items: decisionSchema },
});
const errorSchema = strict({ error: { type: 'string' }, message: { type: 'string' } });
const invalidDecisionsSchema = strict({
  error: { type: 'string', enum: ['invalid_decisions'] },
  message: { type: 'string' },
  issues: {
    type: 'array',
    items: strict({
      decisionIndex: { type: 'integer' },
      issues: { type: 'array', items: strict({ field: { type: 'string' }, message: { type: 'string' } }) },
    }),
  },
});
const planSchema = strict({
  code: { type: 'string', enum: ['free', 'paid', 'family'] },
  name: { type: 'string' },
  maxSavedScenarios: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'null = sin límite.' },
  maxComparedScenarios: { type: 'integer' },
  userPrepayments: { type: 'boolean' },
});
const scenarioSummary = strict({ id, name: { type: 'string' }, decisions: { type: 'array', items: decisionSchema } });
const months = strict({ months: { type: 'string', pattern: '^[0-9]{1,2}$' } }, []);
const refusals = { 400: badRequestSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 422: invalidDecisionsSchema };

const summary = (scenario: Scenario) => ({ id: scenario.id, name: scenario.name, decisions: scenario.decisions });

/** HU06-HU11 under the plan limits of Tabla 13. Only the actor's own scenarios are reachable. */
export const scenarioRoutes: FastifyPluginCallback<ScenarioRoutesOptions> = (app, options, done) => {
  const { scenarios, accessTokens } = options;
  const context = async (request: FastifyRequest) => ({ actor: await requireActor(request, accessTokens), ip: request.ip });

  const refuse = (reply: FastifyReply, refusal: ScenarioRefusal) => {
    switch (refusal.reason) {
      case 'not_found':
        return reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' });
      case 'opening_balance_required':
        return reply.status(409).send({ error: 'opening_balance_required', message: 'Registra tu saldo inicial para simular escenarios.' });
      case 'invalid_input':
        return reply.status(400).send({ error: 'invalid_fields', message: refusal.message, issues: [{ field: 'name', message: refusal.message }] });
      case 'plan_limit':
        return reply.status(403).send({ error: 'plan_limit', message: refusal.message });
      case 'invalid_decisions':
        return reply.status(422).send({ error: 'invalid_decisions', message: 'Hay decisiones que no se pueden aplicar.', issues: refusal.issues });
    }
  };

  const horizonOf = (reply: FastifyReply, raw: string | undefined): number | null => {
    const value = raw === undefined ? PROJECTION_HORIZON.default : Number(raw);
    if (value < PROJECTION_HORIZON.min || value > PROJECTION_HORIZON.max) {
      void reply.status(400).send({ error: 'invalid_horizon', message: `El horizonte debe estar entre ${String(PROJECTION_HORIZON.min)} y ${String(PROJECTION_HORIZON.max)} meses.` });
      return null;
    }
    return value;
  };

  app.get(
    '/scenarios',
    {
      schema: {
        summary: 'Mis escenarios y el plan vigente (HU06, Tabla 13)',
        tags: TAGS,
        security,
        response: { 200: strict({ plan: planSchema, scenarios: { type: 'array', items: scenarioSummary } }), 401: errorSchema },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const { scenarios: list, plan } = await scenarios.list(actor);
      noStore(reply);
      return {
        plan: { code: plan.code, name: plan.name, maxSavedScenarios: plan.maxSavedScenarios, maxComparedScenarios: plan.maxComparedScenarios, userPrepayments: plan.userPrepayments },
        scenarios: list.map(summary),
      };
    },
  );

  app.post<{ Body: { name: string; decisions: DecisionInput[] } }>(
    '/scenarios',
    {
      schema: {
        summary: 'Crear un escenario con decisiones (HU06, HU07)',
        description: 'El escenario se deriva del registro y no lo modifica. El plan gratuito guarda hasta 2 escenarios y no simula prepagos.',
        tags: TAGS,
        security,
        body: scenarioBody,
        response: { 201: strict({ id }), ...refusals },
      },
    },
    async (request, reply) => {
      const result = await scenarios.create(await context(request), request.body);
      return result.ok ? reply.status(201).send({ id: result.id }) : refuse(reply, result);
    },
  );

  app.get<{ Querystring: { ids: string; months?: string } }>(
    '/scenarios/compare',
    {
      schema: {
        summary: 'Comparar escenarios entre sí y con la base (HU09)',
        description: 'En el orden pedido, sin ordenar por conveniencia ni destacar uno. El plan gratuito compara un escenario frente a la base.',
        tags: TAGS,
        security,
        querystring: strict({ ids: { type: 'string', pattern: '^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36}){0,9}$' }, months: { type: 'string', pattern: '^[0-9]{1,2}$' } }, ['ids']),
        response: {
          200: strict({
            horizonMonths: { type: 'integer' },
            base: outcomeSchema,
            scenarios: { type: 'array', items: strict({ id, name: { type: 'string' }, scenario: outcomeSchema, variation: variationSchema, explanation: explanationSchema }) },
          }),
          ...refusals,
        },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const horizon = horizonOf(reply, request.query.months);
      if (horizon === null) return reply;
      const ids = [...new Set(request.query.ids.split(','))];
      const result = await scenarios.compare(actor, ids, horizon);
      if (!result.ok) return refuse(reply, result);
      noStore(reply);
      return {
        horizonMonths: result.view.horizonMonths,
        base: outcomeView(result.view.base),
        scenarios: result.view.scenarios.map(({ scenario, result: simulation }) => ({
          id: scenario.id,
          name: scenario.name,
          scenario: outcomeView(simulation.scenario),
          variation: variationView(simulation.variation),
          explanation: simulation.explanation,
        })),
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { months?: string } }>(
    '/scenarios/:id',
    {
      schema: {
        summary: 'Resultado de un escenario: indicadores, variación y explicación (HU08, HU10)',
        tags: TAGS,
        security,
        params: strict({ id }),
        querystring: months,
        response: {
          200: strict({
            id,
            name: { type: 'string' },
            decisions: { type: 'array', items: decisionSchema },
            startMonth: { type: 'string' },
            horizonMonths: { type: 'integer' },
            base: outcomeSchema,
            scenario: outcomeSchema,
            variation: variationSchema,
            explanation: explanationSchema,
          }),
          ...refusals,
        },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const horizon = horizonOf(reply, request.query.months);
      if (horizon === null) return reply;
      const result = await scenarios.view(actor, request.params.id, horizon);
      if (!result.ok) return refuse(reply, result);
      const { scenario, result: simulation } = result.view;
      const first = simulation.base.projection.months[0];
      if (first === undefined) throw new Error('A projection always has at least one month');
      noStore(reply);
      return {
        ...summary(scenario),
        startMonth: formatYearMonth(first.month),
        horizonMonths: result.view.horizonMonths,
        base: outcomeView(simulation.base),
        scenario: outcomeView(simulation.scenario),
        variation: variationView(simulation.variation),
        explanation: simulation.explanation,
      };
    },
  );

  app.put<{ Params: { id: string }; Body: { name: string; decisions: DecisionInput[] } }>(
    '/scenarios/:id',
    {
      schema: {
        summary: 'Renombrar o cambiar las decisiones de un escenario (HU11)',
        tags: TAGS,
        security,
        params: strict({ id }),
        body: scenarioBody,
        response: { 200: strict({ id }), ...refusals },
      },
    },
    async (request, reply) => {
      const result = await scenarios.update(await context(request), request.params.id, request.body);
      return result.ok ? { id: result.id } : refuse(reply, result);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/scenarios/:id',
    {
      schema: {
        summary: 'Eliminar un escenario (HU11)',
        description: 'No afecta el registro ni a los demás escenarios.',
        tags: TAGS,
        security,
        params: strict({ id }),
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) =>
      (await scenarios.delete(await context(request), request.params.id))
        ? reply.status(204).send()
        : reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' }),
  );

  done();
};
