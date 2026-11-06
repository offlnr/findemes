import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import { WEBPAY_RETURN_PATH, type SubscriptionService, type WebpayReturn } from '../../modules/subscription/application/subscription-service.ts';
import type { PlanCode } from '../../modules/subscription/domain/subscription.ts';
import { noStore, requireActor } from './authenticate.ts';
import { badRequestSchema } from './common-schemas.ts';
import { strict } from './schedule-schema.ts';

export interface SubscriptionRoutesOptions {
  readonly subscriptions: SubscriptionService;
  readonly accessTokens: AccessTokenService;
  /** Public URL of the web app, where the payment result screen lives. */
  readonly appBaseUrl: string;
}

const TAGS = ['planes y pagos'];
const security = [{ bearerAuth: [] }];
const errorSchema = strict({ error: { type: 'string' }, message: { type: 'string' } });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const STATES = ['gratuito', 'pendiente', 'activa', 'por_vencer', 'vencida', 'fallida', 'cancelada'];

const capabilitiesSchema = {
  type: 'array',
  description: 'Tabla 13, en lenguaje claro. Cada capacidad limitada indica el límite (HU30).',
  items: strict({ label: { type: 'string' }, included: { type: 'boolean' }, detail: { type: 'string' } }),
} as const;
const planSchema = strict({
  code: { type: 'string', enum: ['free', 'paid', 'family'] },
  name: { type: 'string' },
  priceClp: { ...nullable({ type: 'integer' }), description: 'Precio mensual en pesos; null en el plan gratuito.' },
  periodMonths: { type: 'integer' },
  capabilities: capabilitiesSchema,
});

// Webpay sends at most these four parameters; any other is ignored rather than failing the return.
const webpayReturn = {
  type: 'object',
  additionalProperties: true,
  properties: {
    token_ws: { type: 'string', maxLength: 128 },
    TBK_TOKEN: { type: 'string', maxLength: 128 },
    TBK_ORDEN_COMPRA: { type: 'string', maxLength: 26 },
    TBK_ID_SESION: { type: 'string', maxLength: 61 },
  },
} as const;

/** HU18, HU30: Tabla 13 as a list the app shows without interpreting it. */
function capabilities(plan: { maxSavedScenarios: number | null; maxComparedScenarios: number; fullHistory: boolean; userPrepayments: boolean; householdSpace: boolean }) {
  return [
    { label: 'Registro base y proyección mensual', included: true, detail: 'Ingresos, gastos, deudas y saldo, con proyección de hasta 36 meses.' },
    {
      label: 'Escenarios guardados',
      included: true,
      detail: plan.maxSavedScenarios === null ? 'Sin límite.' : `Hasta ${String(plan.maxSavedScenarios)} escenarios guardados.`,
    },
    {
      label: 'Comparación de escenarios',
      included: true,
      detail: plan.maxComparedScenarios === 1 ? 'Un escenario frente a la base.' : `Hasta ${String(plan.maxComparedScenarios)} escenarios a la vez.`,
    },
    { label: 'Historial de meses', included: plan.fullHistory, detail: plan.fullHistory ? 'Histórico completo.' : 'Mes vigente.' },
    { label: 'Simulación de prepagos de deuda', included: plan.userPrepayments, detail: plan.userPrepayments ? 'Incluida.' : 'No incluida.' },
    { label: 'Hogar: perfiles múltiples y gastos comunes', included: plan.householdSpace, detail: plan.householdSpace ? 'Incluido.' : 'No incluido.' },
  ];
}

/** HU18-HU20, HU30. The plan is activated by the backend after Transbank confirms (rule 6). */
export const subscriptionRoutes: FastifyPluginCallback<SubscriptionRoutesOptions> = (app, options, done) => {
  const { subscriptions, accessTokens } = options;
  const context = async (request: FastifyRequest) => ({ actor: await requireActor(request, accessTokens), ip: request.ip });

  // Webpay may send the browser back with an HTML form post.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 2048 }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.get(
    '/plans',
    {
      schema: {
        summary: 'Planes y sus capacidades (HU18, HU30, Tabla 13)',
        description: 'Sin sesión. El sistema no destaca ningún plan como preferible.',
        tags: TAGS,
        response: { 200: strict({ plans: { type: 'array', items: planSchema } }) },
      },
    },
    async () => {
      const plans = await subscriptions.offers();
      return {
        plans: plans.map((plan) => ({ code: plan.code, name: plan.name, priceClp: plan.priceClp, periodMonths: plan.periodMonths, capabilities: capabilities(plan) })),
      };
    },
  );

  app.get(
    '/subscription',
    {
      schema: {
        summary: 'Mi plan y el estado de mi suscripción (HU18, HU20, Tabla 14)',
        tags: TAGS,
        security,
        response: {
          200: strict({
            plan: strict({ code: { type: 'string', enum: ['free', 'paid', 'family'] }, name: { type: 'string' } }),
            state: { type: 'string', enum: STATES },
            periodEnd: { ...nullable({ type: 'string', format: 'date' }), description: 'Último día de acceso es el anterior a esta fecha.' },
            cancelAtPeriodEnd: { type: 'boolean' },
            capabilities: capabilitiesSchema,
            latestPayment: nullable(
              strict({
                buyOrder: { type: 'string' },
                planCode: { type: 'string' },
                amount: { type: 'integer' },
                status: { type: 'string', enum: ['created', 'authorized', 'rejected', 'aborted', 'amount_mismatch'] },
                createdAt: { type: 'string', format: 'date-time' },
              }),
            ),
          }),
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const status = await subscriptions.status(actor);
      noStore(reply);
      const order = status.latestOrder;
      return {
        plan: { code: status.plan.code, name: status.plan.name },
        state: status.state,
        periodEnd: status.period === null || status.state === 'vencida' ? null : status.period.periodEnd,
        cancelAtPeriodEnd: status.period?.cancelAtPeriodEnd ?? false,
        capabilities: capabilities({ ...status.plan, fullHistory: status.plan.code !== 'free' }),
        latestPayment:
          order === null
            ? null
            : { buyOrder: order.buyOrder, planCode: order.planCode, amount: order.amount, status: order.status, createdAt: order.createdAt.toISOString() },
      };
    },
  );

  app.post<{ Body: { plan: Exclude<PlanCode, 'free'> } }>(
    '/subscription/checkout',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        summary: 'Contratar un plan con Webpay Plus (HU19)',
        description:
          'Crea la orden y la transacción en Webpay (ambiente de integración durante el proyecto). La app redirige al navegador a redirectUrl; el plan se activa cuando el backend confirma con Transbank.',
        tags: TAGS,
        security,
        body: strict({ plan: { type: 'string', enum: ['paid', 'family'] } }),
        response: { 201: strict({ redirectUrl: { type: 'string' }, buyOrder: { type: 'string' } }), 400: badRequestSchema, 401: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await subscriptions.checkout(await context(request), request.body.plan);
      noStore(reply);
      if (!result.ok) return reply.status(409).send({ error: 'not_for_sale', message: 'Este plan no está disponible para contratar.' });
      return reply.status(201).send({ redirectUrl: result.redirectUrl, buyOrder: result.buyOrder });
    },
  );

  app.post(
    '/subscription/cancel',
    {
      schema: {
        summary: 'Cancelar la renovación (Tabla 14, Cancelada)',
        description: 'El acceso continúa hasta el término del período pagado. No se eliminan datos (HU20).',
        tags: TAGS,
        security,
        response: { 200: strict({ cancelled: { type: 'boolean' } }), 401: errorSchema },
      },
    },
    async (request) => {
      const { actor } = await context(request);
      return { cancelled: await subscriptions.cancelRenewal(actor) };
    },
  );

  const handleReturn = async (params: WebpayReturn, reply: FastifyReply) => {
    let outcome: string;
    try {
      outcome = await subscriptions.handleReturn(params);
    } catch (error) {
      // Transbank unreachable: the order stays open for reconciliation (HU26).
      app.log.error({ err: error }, 'webpay return could not be confirmed');
      outcome = 'pendiente';
    }
    noStore(reply);
    return reply.redirect(`${options.appBaseUrl}/#/app/pago/resultado?estado=${outcome}`, 303);
  };
  const returnSchema = (part: 'querystring' | 'body') => ({
    summary: 'Retorno desde Webpay Plus (HU19)',
    description: 'Lo llama el navegador al volver de Transbank. Confirma la transacción desde el servidor y redirige a la app con el resultado.',
    tags: TAGS,
    [part]: webpayReturn,
    response: { 303: { type: 'null', description: 'Redirección a la pantalla de resultado de la app.' } },
  });

  app.get<{ Querystring: WebpayReturn }>(WEBPAY_RETURN_PATH.replace('/v1', ''), { schema: returnSchema('querystring') }, (request, reply) => handleReturn(request.query, reply));
  app.post<{ Body: WebpayReturn }>(WEBPAY_RETURN_PATH.replace('/v1', ''), { schema: returnSchema('body') }, (request, reply) => handleReturn(request.body, reply));

  done();
};
