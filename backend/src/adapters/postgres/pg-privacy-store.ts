import type pg from 'pg';
import type { Consent, ConsentKind, ConsentStore, PersonalDataStore } from '../../modules/privacy/ports/privacy-ports.ts';
import type { TransactionRunner, WriteContext } from '../../modules/shared/ports.ts';
import { clientOf } from './pg-transaction-runner.ts';

/**
 * Sections of the export: one query per table of individual data, filtered by owner and run as
 * the actor (RLS). Secrets are left out: password hash, encrypted bank tokens and token hashes.
 */
const EXPORT_SECTIONS: readonly (readonly [string, string])[] = [
  [
    'cuenta',
    `SELECT jsonb_build_object('correo', email, 'alias', display_name, 'correo_verificado', email_verified_at,
            'creada', created_at, 'registro_inicial_iniciado', onboarding_started_at, 'registro_inicial_completado', onboarding_completed_at)
       FROM app.users WHERE id = $1`,
  ],
  ['saldo_inicial', `SELECT to_jsonb(t) - 'owner_id' FROM app.financial_profiles t WHERE owner_id = $1`],
  ['ingresos', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' ORDER BY created_at), '[]') FROM app.incomes t WHERE owner_id = $1`],
  ['gastos', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' ORDER BY created_at), '[]') FROM app.expenses t WHERE owner_id = $1`],
  ['deudas', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' ORDER BY created_at), '[]') FROM app.debts t WHERE owner_id = $1`],
  ['cuotas', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' ORDER BY debt_id, month), '[]') FROM app.debt_installments t WHERE owner_id = $1`],
  ['escenarios', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' ORDER BY created_at), '[]') FROM app.scenarios t WHERE owner_id = $1`],
  [
    'hogar',
    `SELECT jsonb_build_object('nombre_en_el_hogar', m.display_name, 'rol', m.role, 'desde', m.joined_at,
            'gastos_comunes_registrados', (SELECT coalesce(jsonb_agg(jsonb_build_object('nombre', e.label, 'monto', e.amount, 'creado', e.created_at)), '[]')
                                             FROM app.household_expenses e WHERE e.created_by = $1))
       FROM app.household_members m WHERE m.user_id = $1`,
  ],
  ['suscripcion', `SELECT to_jsonb(t) - 'user_id' FROM app.subscriptions t WHERE user_id = $1`],
  [
    'pagos',
    `SELECT coalesce(jsonb_agg(jsonb_build_object('orden', buy_order, 'plan', plan_code, 'monto', amount, 'estado', status, 'creada', created_at) ORDER BY created_at), '[]')
       FROM app.payment_orders WHERE user_id = $1`,
  ],
  ['consentimientos', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' - 'id' ORDER BY accepted_at), '[]') FROM app.consents t WHERE owner_id = $1`],
  [
    'conexiones_bancarias',
    `SELECT coalesce(jsonb_agg(jsonb_build_object('institucion', institution_name, 'proveedor', provider, 'origen', origin, 'estado', status,
            'creada', created_at, 'ultima_sincronizacion', last_synced_at) ORDER BY created_at), '[]')
       FROM app.bank_links WHERE owner_id = $1`,
  ],
  ['cuentas_bancarias', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' ORDER BY name), '[]') FROM app.bank_accounts t WHERE owner_id = $1`],
  ['movimientos_bancarios', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'owner_id' ORDER BY posted_on), '[]') FROM app.bank_movements t WHERE owner_id = $1`],
];

async function audit(client: pg.PoolClient, context: WriteContext, action: string) {
  await client.query(
    `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, origin_ip, occurred_at, prev_hash, hash, seq)
     VALUES ('user', $1, $2, 'user', $1, $3::inet, now(), '\\x00', '\\x00', 0)`,
    [context.actor.userId, action, context.ip],
  );
}

/** HU21 over PostgreSQL. Everything runs as the actor, so only their own rows are reachable. */
export function createPgPrivacyStore(runner: TransactionRunner): PersonalDataStore & ConsentStore {
  return {
    async exportForActor(actor) {
      return runner.withActor(actor, async (tx) => {
        const client = clientOf(tx);
        const result: Record<string, unknown> = { formato: 'Fin de Mes, exportación de datos personales (HU21)', generado: new Date().toISOString() };
        for (const [section, sql] of EXPORT_SECTIONS) {
          const { rows } = await client.query<{ value: unknown }>(`SELECT (${sql}) AS value`, [actor.userId]);
          result[section] = rows[0]?.value ?? null;
        }
        return result;
      });
    },

    async eraseForActor(context) {
      await runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        // The entry keeps only the pseudonymous id, which no longer resolves to a person.
        await audit(client, context, 'privacy.account_erased');
        await client.query('DELETE FROM app.users WHERE id = $1', [context.actor.userId]);
      });
    },

    async updateDisplayName(context, displayName) {
      await runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        await client.query('UPDATE app.users SET display_name = $2, updated_at = now() WHERE id = $1', [context.actor.userId, displayName]);
        await audit(client, context, 'privacy.account_rectified');
      });
    },

    async listForActor(actor) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<{ kind: ConsentKind; document_version: string; accepted_at: Date; withdrawn_at: Date | null }>(
          'SELECT kind, document_version, accepted_at, withdrawn_at FROM app.consents WHERE owner_id = $1 ORDER BY accepted_at, kind',
          [actor.userId],
        );
        return rows.map((row): Consent => ({ kind: row.kind, documentVersion: row.document_version, acceptedAt: row.accepted_at, withdrawnAt: row.withdrawn_at }));
      });
    },

    async accept(context, kind, documentVersion) {
      await runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        await client.query('UPDATE app.consents SET withdrawn_at = now() WHERE owner_id = $1 AND kind = $2 AND withdrawn_at IS NULL', [context.actor.userId, kind]);
        await client.query('INSERT INTO app.consents (owner_id, kind, document_version) VALUES ($1, $2, $3)', [context.actor.userId, kind, documentVersion]);
        await audit(client, context, `privacy.consent_${kind}_accepted`);
      });
    },

    async withdraw(context, kind) {
      return runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        const { rowCount } = await client.query('UPDATE app.consents SET withdrawn_at = now() WHERE owner_id = $1 AND kind = $2 AND withdrawn_at IS NULL', [
          context.actor.userId,
          kind,
        ]);
        if (rowCount === 0) return false;
        await audit(client, context, `privacy.consent_${kind}_withdrawn`);
        return true;
      });
    },
  };
}
