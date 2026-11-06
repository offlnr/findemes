import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { HouseholdRefusal, HouseholdService, SharedExpenseInput } from '../../modules/household/application/household-service.ts';
import type { ContributionRule } from '../../modules/household/domain/household.ts';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import type { UserId } from '../../modules/shared/actor.ts';
import { noStore, requireActor } from './authenticate.ts';
import { badRequestSchema } from './common-schemas.ts';
import { amount, id, label, scheduleFromJson, scheduleSchema, scheduleToJson, strict, type ScheduleJson } from './schedule-schema.ts';

export interface HouseholdRoutesOptions {
  readonly households: HouseholdService;
  readonly accessTokens: AccessTokenService;
}

const TAGS = ['hogar'];
const security = [{ bearerAuth: [] }];
const errorSchema = strict({ error: { type: 'string' }, message: { type: 'string' } });
const token = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$', description: 'Token del enlace de invitación.' } as const;

const ruleSchema = {
  description: 'Regla de aporte (HU14). Sin regla, el gasto se reparte en partes iguales. Porcentajes en puntos base (10000 = 100 %).',
  oneOf: [
    strict({ mode: { type: 'string', enum: ['equal'] } }),
    strict({ mode: { type: 'string', enum: ['assigned'] }, userId: id }),
    strict({
      mode: { type: 'string', enum: ['percentage'] },
      shares: { type: 'array', minItems: 1, maxItems: 20, items: strict({ userId: id, basisPoints: { type: 'integer', minimum: 1, maximum: 10000 } }) },
    }),
  ],
} as const;
const expenseBody = strict({ label, amount, schedule: scheduleSchema, rule: ruleSchema }, ['label', 'amount', 'schedule']);

const memberView = strict({ userId: id, displayName: { type: 'string' }, role: { type: 'string', enum: ['admin', 'member'] }, isMe: { type: 'boolean' } });
const expenseView = strict({
  id,
  label: { type: 'string' },
  amount: { type: 'integer' },
  schedule: scheduleSchema,
  rule: ruleSchema,
  createdByName: { type: 'string', description: 'Quién lo registró (HU13).' },
  canEdit: { type: 'boolean' },
  myShare: { type: 'integer', description: 'Mi aporte mensual a este gasto (HU15).' },
  shares: { type: 'array', items: strict({ userId: id, amount: { type: 'integer' } }) },
});
const householdView = strict({
  id,
  name: { type: 'string' },
  myRole: { type: 'string', enum: ['admin', 'member'] },
  readOnly: { type: 'boolean', description: 'HU20: ningún integrante tiene un plan Familiar vigente.' },
  members: { type: 'array', items: memberView },
  expenses: { type: 'array', items: expenseView },
  myMonthlyContribution: { type: 'integer', description: 'Suma de mis aportes a los gastos mensuales.' },
});

interface ExpenseJson {
  label: string;
  amount: number;
  schedule: ScheduleJson;
  rule?: { mode: 'equal' } | { mode: 'assigned'; userId: string } | { mode: 'percentage'; shares: { userId: string; basisPoints: number }[] };
}

const expenseInput = (body: ExpenseJson): SharedExpenseInput => ({
  label: body.label,
  amount: body.amount,
  schedule: scheduleFromJson(body.schedule),
  ...(body.rule === undefined ? {} : { rule: body.rule as ContributionRule }),
});

/**
 * HU12-HU16, HU20, HU31. Only the actor's own household is reachable, and it exposes shared
 * data only: names, roles and shared expenses, never a member's individual finances (rule 5).
 */
export const householdRoutes: FastifyPluginCallback<HouseholdRoutesOptions> = (app, options, done) => {
  const { households, accessTokens } = options;
  const context = async (request: FastifyRequest) => ({ actor: await requireActor(request, accessTokens), ip: request.ip });

  const refuse = (reply: FastifyReply, refusal: HouseholdRefusal) => {
    switch (refusal.reason) {
      case 'not_found':
        return reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' });
      case 'invalid':
        return reply.status(400).send({ error: 'invalid_fields', message: 'Revisa los datos ingresados.', issues: refusal.issues });
      case 'already_member':
        return reply.status(409).send({ error: 'already_member', message: 'Ya perteneces a un hogar. Sal de él antes de unirte a otro.' });
      case 'invalid_invitation':
        return reply.status(400).send({ error: 'invalid_invitation', message: 'La invitación no es válida, ya se usó o venció.' });
      case 'forbidden':
        return reply.status(403).send({ error: 'forbidden', message: refusal.message });
      case 'plan_limit':
        return reply.status(403).send({ error: 'plan_limit', message: refusal.message });
      case 'read_only':
        return reply.status(403).send({ error: 'read_only', message: refusal.message });
    }
  };
  const refusals = { 400: badRequestSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema };

  app.get(
    '/household',
    {
      schema: {
        summary: 'Mi hogar: integrantes, gastos comunes y mi aporte (HU12-HU15)',
        description: 'household es null si no perteneces a un hogar. No incluye datos individuales de ningún integrante.',
        tags: TAGS,
        security,
        response: { 200: strict({ household: { anyOf: [householdView, { type: 'null' }] } }), 401: errorSchema },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const view = await households.view(actor);
      noStore(reply);
      if (view === null) return { household: null };
      const { household } = view;
      const isAdmin = view.myRole === 'admin';
      let monthly = 0;
      const expenses = household.expenses.map((expense) => {
        const myShare = view.myShares.get(expense.id) ?? 0;
        if (expense.schedule.kind === 'monthly') monthly += myShare;
        return {
          id: expense.id,
          label: expense.label,
          amount: expense.amount,
          schedule: scheduleToJson(expense.schedule),
          rule: expense.rule,
          createdByName: expense.createdByName,
          canEdit: household.spaceActive && (isAdmin || expense.createdBy === actor.userId),
          myShare,
          shares: [...(view.shares.get(expense.id) ?? new Map<UserId, number>())].map(([userId, part]) => ({ userId, amount: part })),
        };
      });
      return {
        household: {
          id: household.id,
          name: household.name,
          myRole: view.myRole,
          readOnly: !household.spaceActive,
          members: household.members.map((member) => ({ userId: member.userId, displayName: member.displayName, role: member.role, isMe: member.userId === actor.userId })),
          expenses,
          myMonthlyContribution: monthly,
        },
      };
    },
  );

  app.post<{ Body: { name: string; displayName: string } }>(
    '/household',
    {
      schema: {
        summary: 'Crear un hogar (HU12)',
        description: 'Quien lo crea queda como administrador. Requiere el plan Familiar (Tabla 13).',
        tags: TAGS,
        security,
        body: strict({ name: label, displayName: label }),
        response: { 201: strict({ id }), ...refusals },
      },
    },
    async (request, reply) => {
      const result = await households.create(await context(request), request.body);
      return result.ok ? reply.status(201).send({ id: result.id }) : refuse(reply, result);
    },
  );

  app.post(
    '/household/invitations',
    {
      schema: {
        summary: 'Generar un enlace de invitación (HU12, HU31)',
        description: 'Enlace de un solo uso con vigencia de 7 días. Solo el administrador.',
        tags: TAGS,
        security,
        response: { 201: strict({ url: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } }), ...refusals },
      },
    },
    async (request, reply) => {
      const result = await households.invite(await context(request));
      noStore(reply);
      return result.ok ? reply.status(201).send({ url: result.url, expiresAt: result.expiresAt.toISOString() }) : refuse(reply, result);
    },
  );

  app.post<{ Body: { token: string } }>(
    '/household/invitations/preview',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        summary: 'Ver una invitación antes de aceptarla (HU31)',
        description: 'Sin sesión. Informa el nombre del hogar, cuántos integrantes tiene, qué será visible y qué permanece privado.',
        tags: TAGS,
        body: strict({ token }),
        response: {
          200: strict({
            householdName: { type: 'string' },
            memberCount: { type: 'integer' },
            expiresAt: { type: 'string', format: 'date-time' },
            visibleToMembers: { type: 'array', items: { type: 'string' } },
            private: { type: 'array', items: { type: 'string' } },
          }),
          400: badRequestSchema,
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const preview = await households.preview(request.body.token);
      noStore(reply);
      if (preview === null) return reply.status(404).send({ error: 'invalid_invitation', message: 'La invitación no es válida, ya se usó o venció.' });
      return {
        householdName: preview.householdName,
        memberCount: preview.memberCount,
        expiresAt: preview.expiresAt.toISOString(),
        visibleToMembers: ['Tu nombre en el hogar', 'Los gastos comunes que registres', 'Tu parte de cada gasto común'],
        private: ['Tus ingresos', 'Tus gastos personales', 'Tus deudas y cuotas', 'Tus escenarios', 'Tu correo'],
      };
    },
  );

  app.post<{ Body: { token: string; displayName: string } }>(
    '/household/invitations/accept',
    {
      schema: {
        summary: 'Aceptar una invitación (HU12, HU31)',
        tags: TAGS,
        security,
        body: strict({ token, displayName: label }),
        response: { 200: strict({ id }), ...refusals },
      },
    },
    async (request, reply) => {
      const result = await households.accept(await context(request), request.body);
      return result.ok ? { id: result.id } : refuse(reply, result);
    },
  );

  app.delete<{ Params: { userId: string } }>(
    '/household/members/:userId',
    {
      schema: {
        summary: 'Remover un integrante o salir del hogar (HU12)',
        description: 'El administrador remueve integrantes; cualquier integrante puede salir indicando su propio id.',
        tags: TAGS,
        security,
        params: strict({ userId: id }),
        response: { 204: { type: 'null' }, ...refusals },
      },
    },
    async (request, reply) => {
      const result = await households.removeMember(await context(request), request.params.userId);
      return result.ok ? reply.status(204).send() : refuse(reply, result);
    },
  );

  app.post<{ Body: ExpenseJson }>(
    '/household/expenses',
    {
      schema: { summary: 'Registrar un gasto común (HU13, HU14)', tags: TAGS, security, body: expenseBody, response: { 201: strict({ id }), ...refusals } },
    },
    async (request, reply) => {
      const result = await households.addExpense(await context(request), expenseInput(request.body));
      return result.ok ? reply.status(201).send({ id: result.id }) : refuse(reply, result);
    },
  );

  app.put<{ Params: { id: string }; Body: ExpenseJson }>(
    '/household/expenses/:id',
    {
      schema: {
        summary: 'Modificar un gasto común o su regla de aporte (HU13, HU14)',
        description: 'Quien lo registró o el administrador. Solo el administrador cambia la regla de aporte.',
        tags: TAGS,
        security,
        params: strict({ id }),
        body: expenseBody,
        response: { 200: strict({ id }), ...refusals },
      },
    },
    async (request, reply) => {
      const result = await households.updateExpense(await context(request), request.params.id, expenseInput(request.body));
      return result.ok ? { id: result.id } : refuse(reply, result);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/household/expenses/:id',
    {
      schema: { summary: 'Eliminar un gasto común (HU13)', tags: TAGS, security, params: strict({ id }), response: { 204: { type: 'null' }, ...refusals } },
    },
    async (request, reply) => {
      const result = await households.deleteExpense(await context(request), request.params.id);
      return result.ok ? reply.status(204).send() : refuse(reply, result);
    },
  );

  done();
};
