import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { compareYearMonth, formatYearMonth, parseYearMonth } from '../../core/index.ts';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import { PROJECTION_HORIZON, type EntryInput, type RegistryService, type WriteResult } from '../../modules/registry/application/registry-service.ts';
import type { DebtInput, RegistryDebt, RegistryExpense, ScheduledEntry } from '../../modules/registry/domain/registry.ts';
import { currentMonth } from '../../modules/shared/current-month.ts';
import type { Clock } from '../../modules/shared/ports.ts';
import { noStore, requireActor } from './authenticate.ts';
import { badRequestSchema } from './common-schemas.ts';
import { amount, id, label, month, scheduleFromJson, scheduleSchema, scheduleToJson, strict, type ScheduleJson } from './schedule-schema.ts';
import { explanationSchema, outcomeSchema, outcomeView } from './simulation-view.ts';

export interface RegistryRoutesOptions {
  readonly registry: RegistryService;
  readonly accessTokens: AccessTokenService;
  readonly clock: Clock;
}

const TAGS = ['registro financiero'];
const security = [{ bearerAuth: [] }];

// ---- Schemas ----

const nature = { type: 'string', enum: ['fixed', 'variable_estimate'], description: 'Gasto fijo recurrente o gasto variable estimado (HU02).' } as const;
const incomeBody = strict({ label, amount, schedule: scheduleSchema });
const expenseBody = strict({ label, amount, nature, schedule: scheduleSchema });
const debtBody = strict(
  {
    label,
    installmentAmount: amount,
    pendingInstallments: { type: 'integer', minimum: 1, maximum: 600 },
    nextInstallmentMonth: month,
    totalInstallments: { anyOf: [{ type: 'integer', minimum: 1, maximum: 600 }, { type: 'null' }] },
  },
  ['label', 'installmentAmount', 'pendingInstallments', 'nextInstallmentMonth'],
);
const balanceBody = strict({ amount: { type: 'integer', minimum: -1_000_000_000_000, maximum: 1_000_000_000_000 }, month });

const incomeView = strict({ id, label, amount: { type: 'integer' }, schedule: scheduleSchema });
const expenseView = strict({ id, label, amount: { type: 'integer' }, nature, schedule: scheduleSchema });
const debtView = strict({
  id,
  label,
  totalInstallments: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  pendingInstallments: { type: 'integer', description: 'Cuotas desde el mes actual.' },
  nextInstallment: { anyOf: [strict({ month, amount: { type: 'integer' } }), { type: 'null' }] },
  installments: { type: 'array', items: strict({ month, amount: { type: 'integer' } }) },
});

const errorSchema = strict({ error: { type: 'string' }, message: { type: 'string' } });
const created = strict({ id });
const idParams = strict({ id });

// ---- Mapping ----

interface EntryJson {
  label: string;
  amount: number;
  schedule: ScheduleJson;
}
interface DebtJson {
  label: string;
  installmentAmount: number;
  pendingInstallments: number;
  nextInstallmentMonth: string;
  totalInstallments?: number | null;
}

const entryInput = (body: EntryJson): EntryInput => ({ label: body.label, amount: body.amount, schedule: scheduleFromJson(body.schedule) });
const debtInput = (body: DebtJson): DebtInput => ({
  label: body.label,
  installmentAmount: body.installmentAmount,
  pendingInstallments: body.pendingInstallments,
  nextInstallmentMonth: parseYearMonth(body.nextInstallmentMonth),
  totalInstallments: body.totalInstallments ?? null,
});

const entryJson = (entry: ScheduledEntry) => ({ id: entry.id, label: entry.label, amount: entry.amount, schedule: scheduleToJson(entry.schedule) });

// ---- Routes ----

/** HU01-HU05, HU39. Every route needs a session and only ever touches the actor's own data. */
export const registryRoutes: FastifyPluginCallback<RegistryRoutesOptions> = (app, options, done) => {
  const { registry, accessTokens } = options;

  const context = async (request: FastifyRequest) => ({ actor: await requireActor(request, accessTokens), ip: request.ip });

  /** 201 with the id, 200 on update, 400 with issues, 404 when the record is not the actor's. */
  const answer = (reply: FastifyReply, result: WriteResult, successStatus: 200 | 201) => {
    if (result.ok) return reply.status(successStatus).send({ id: result.id });
    if (result.reason === 'not_found') return reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' });
    return reply.status(400).send({ error: 'invalid_fields', message: 'Revisa los datos ingresados.', issues: result.issues });
  };

  const notFound = (reply: FastifyReply) => reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' });

  const debtJson = (debt: RegistryDebt) => {
    const now = currentMonth(options.clock);
    const pending = debt.installments.filter((installment) => compareYearMonth(installment.month, now) >= 0);
    const next = pending[0];
    return {
      id: debt.id,
      label: debt.label,
      totalInstallments: debt.totalInstallments,
      pendingInstallments: pending.length,
      nextInstallment: next === undefined ? null : { month: formatYearMonth(next.month), amount: next.amount },
      installments: debt.installments.map((installment) => ({ month: formatYearMonth(installment.month), amount: installment.amount })),
    };
  };

  app.get(
    '/registry',
    {
      schema: {
        summary: 'Mi registro financiero (HU01-HU04)',
        tags: TAGS,
        security,
        response: {
          200: strict({
            openingBalance: { anyOf: [strict({ amount: { type: 'integer' }, month }), { type: 'null' }] },
            incomes: { type: 'array', items: incomeView },
            expenses: { type: 'array', items: expenseView },
            debts: { type: 'array', items: debtView },
          }),
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const snapshot = await registry.snapshot(actor);
      noStore(reply);
      return {
        openingBalance: snapshot.openingBalance === null ? null : { amount: snapshot.openingBalance.amount, month: formatYearMonth(snapshot.openingBalance.month) },
        incomes: snapshot.incomes.map(entryJson),
        expenses: snapshot.expenses.map((expense: RegistryExpense) => ({ ...entryJson(expense), nature: expense.nature })),
        debts: snapshot.debts.map(debtJson),
      };
    },
  );

  app.put<{ Body: { amount: number; month: string } }>(
    '/registry/opening-balance',
    {
      schema: {
        summary: 'Registrar el saldo inicial (HU04)',
        description: 'Acepta saldo positivo o negativo. Es el punto de partida del primer mes de la proyección.',
        tags: TAGS,
        security,
        body: balanceBody,
        response: { 204: { type: 'null' }, 400: badRequestSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await registry.setOpeningBalance(await context(request), { amount: request.body.amount, month: parseYearMonth(request.body.month) });
      if (!result.ok) return answer(reply, result, 200);
      return reply.status(204).send();
    },
  );

  // Incomes (HU01)
  app.post<{ Body: EntryJson }>(
    '/registry/incomes',
    { schema: { summary: 'Registrar un ingreso (HU01)', tags: TAGS, security, body: incomeBody, response: { 201: created, 400: badRequestSchema, 401: errorSchema } } },
    async (request, reply) => answer(reply, await registry.createIncome(await context(request), entryInput(request.body)), 201),
  );
  app.put<{ Params: { id: string }; Body: EntryJson }>(
    '/registry/incomes/:id',
    {
      schema: {
        summary: 'Editar un ingreso (HU01)',
        tags: TAGS,
        security,
        params: idParams,
        body: incomeBody,
        response: { 200: created, 400: badRequestSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => answer(reply, await registry.updateIncome(await context(request), request.params.id, entryInput(request.body)), 200),
  );
  app.delete<{ Params: { id: string } }>(
    '/registry/incomes/:id',
    { schema: { summary: 'Eliminar un ingreso (HU01)', tags: TAGS, security, params: idParams, response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema } } },
    async (request, reply) => ((await registry.deleteIncome(await context(request), request.params.id)) ? reply.status(204).send() : notFound(reply)),
  );

  // Expenses (HU02)
  app.post<{ Body: EntryJson & { nature: RegistryExpense['nature'] } }>(
    '/registry/expenses',
    { schema: { summary: 'Registrar un gasto (HU02)', tags: TAGS, security, body: expenseBody, response: { 201: created, 400: badRequestSchema, 401: errorSchema } } },
    async (request, reply) =>
      answer(reply, await registry.createExpense(await context(request), { ...entryInput(request.body), nature: request.body.nature }), 201),
  );
  app.put<{ Params: { id: string }; Body: EntryJson & { nature: RegistryExpense['nature'] } }>(
    '/registry/expenses/:id',
    {
      schema: {
        summary: 'Editar un gasto (HU02)',
        tags: TAGS,
        security,
        params: idParams,
        body: expenseBody,
        response: { 200: created, 400: badRequestSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) =>
      answer(reply, await registry.updateExpense(await context(request), request.params.id, { ...entryInput(request.body), nature: request.body.nature }), 200),
  );
  app.delete<{ Params: { id: string } }>(
    '/registry/expenses/:id',
    { schema: { summary: 'Eliminar un gasto (HU02)', tags: TAGS, security, params: idParams, response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema } } },
    async (request, reply) => ((await registry.deleteExpense(await context(request), request.params.id)) ? reply.status(204).send() : notFound(reply)),
  );

  // Debts (HU03)
  app.post<{ Body: DebtJson }>(
    '/registry/debts',
    {
      schema: {
        summary: 'Registrar una deuda con sus cuotas pendientes (HU03)',
        description: 'Las cuotas se generan desde el mes de la próxima cuota y se agotan solas al término del plazo.',
        tags: TAGS,
        security,
        body: debtBody,
        response: { 201: created, 400: badRequestSchema, 401: errorSchema },
      },
    },
    async (request, reply) => answer(reply, await registry.createDebt(await context(request), debtInput(request.body)), 201),
  );
  app.put<{ Params: { id: string }; Body: DebtJson }>(
    '/registry/debts/:id',
    {
      schema: {
        summary: 'Editar una deuda (HU03)',
        tags: TAGS,
        security,
        params: idParams,
        body: debtBody,
        response: { 200: created, 400: badRequestSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => answer(reply, await registry.updateDebt(await context(request), request.params.id, debtInput(request.body)), 200),
  );
  app.delete<{ Params: { id: string } }>(
    '/registry/debts/:id',
    { schema: { summary: 'Eliminar una deuda (HU03)', tags: TAGS, security, params: idParams, response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema } } },
    async (request, reply) => ((await registry.deleteDebt(await context(request), request.params.id)) ? reply.status(204).send() : notFound(reply)),
  );

  // Projection and financial health (HU05, HU39)
  app.get<{ Querystring: { months?: string } }>(
    '/projection',
    {
      schema: {
        summary: 'Proyección de mi flujo de caja y salud financiera (HU05, HU39)',
        description:
          `Se recalcula en cada consulta desde el registro. Horizonte configurable de ${String(PROJECTION_HORIZON.min)} a ` +
          `${String(PROJECTION_HORIZON.max)} meses (por defecto ${String(PROJECTION_HORIZON.default)}). No emite recomendaciones.`,
        tags: TAGS,
        security,
        querystring: strict({ months: { type: 'string', pattern: '^[0-9]{1,2}$' } }, []),
        response: {
          200: strict({ startMonth: month, horizonMonths: { type: 'integer' }, base: outcomeSchema, explanation: explanationSchema }),
          400: badRequestSchema,
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const months = request.query.months === undefined ? PROJECTION_HORIZON.default : Number(request.query.months);
      if (months < PROJECTION_HORIZON.min || months > PROJECTION_HORIZON.max) {
        return reply.status(400).send({ error: 'invalid_horizon', message: `El horizonte debe estar entre ${String(PROJECTION_HORIZON.min)} y ${String(PROJECTION_HORIZON.max)} meses.` });
      }
      const projection = await registry.projection(actor, months);
      noStore(reply);
      if (!projection.ok) {
        return reply.status(409).send({ error: 'opening_balance_required', message: 'Registra tu saldo inicial para ver la proyección.' });
      }
      return {
        startMonth: formatYearMonth(projection.state.startMonth),
        horizonMonths: projection.horizonMonths,
        base: outcomeView(projection.result.base),
        explanation: projection.result.explanation,
      };
    },
  );

  done();
};
