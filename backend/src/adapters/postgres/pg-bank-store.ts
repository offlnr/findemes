import type pg from 'pg';
import { formatYearMonth } from '../../core/index.ts';
import type { BankProvider, BankStore, DataOrigin, StoredAccount, StoredLink, StoredMovement } from '../../modules/aggregation/ports/aggregation-ports.ts';
import type { TransactionRunner, WriteContext } from '../../modules/shared/ports.ts';
import { scheduleColumns, toDate } from './pg-registry-store.ts';
import { clientOf } from './pg-transaction-runner.ts';

interface LinkRow {
  id: string;
  provider: BankProvider;
  provider_link_id: string;
  institution_name: string;
  origin: DataOrigin;
  status: 'active' | 'revoked';
  created_at: Date;
  last_synced_at: Date | null;
  token_ciphertext: Buffer;
  token_nonce: Buffer;
  token_key_version: number;
}

const LINK_COLUMNS = 'id, provider, provider_link_id, institution_name, origin, status, created_at, last_synced_at, token_ciphertext, token_nonce, token_key_version';

const toLink = (row: LinkRow): StoredLink => ({
  id: row.id,
  provider: row.provider,
  providerLinkId: row.provider_link_id,
  institutionName: row.institution_name,
  origin: row.origin,
  status: row.status,
  createdAt: row.created_at,
  lastSyncedAt: row.last_synced_at,
  sealedToken: { ciphertext: new Uint8Array(row.token_ciphertext), nonce: new Uint8Array(row.token_nonce), keyVersion: row.token_key_version },
});

interface MovementRow {
  id: string;
  account_id: string;
  posted_on: string;
  amount: string;
  description: string;
  origin: DataOrigin;
  confirmed_as: 'income' | 'expense' | null;
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.account_id, to_char(m.posted_on, 'YYYY-MM-DD') AS posted_on, m.amount, m.description, m.origin,
         CASE WHEN EXISTS (SELECT 1 FROM app.incomes i WHERE i.source_movement_id = m.id) THEN 'income'
              WHEN EXISTS (SELECT 1 FROM app.expenses e WHERE e.source_movement_id = m.id) THEN 'expense' END AS confirmed_as
    FROM app.bank_movements m`;

const toMovement = (row: MovementRow): StoredMovement => ({
  id: row.id,
  accountId: row.account_id,
  postedOn: row.posted_on,
  amount: Number(row.amount),
  description: row.description,
  origin: row.origin,
  confirmedAs: row.confirmed_as,
});

async function audit(client: pg.PoolClient, context: WriteContext, action: string, targetType: string, targetId: string | null) {
  // Identifiers only: never tokens, balances or descriptions (HU25).
  await client.query(
    `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, origin_ip, occurred_at, prev_hash, hash, seq)
     VALUES ('user', $1, $2, $3, $4, $5::inet, now(), '\\x00', '\\x00', 0)`,
    [context.actor.userId, action, targetType, targetId, context.ip],
  );
}

/** Bank data in PostgreSQL (migration 0007): owner only under RLS, tokens stored encrypted. */
export function createPgBankStore(runner: TransactionRunner): BankStore {
  const write = <T>(context: WriteContext, work: (client: pg.PoolClient) => Promise<T>) => runner.withActor(context.actor, (tx) => work(clientOf(tx)));

  return {
    async listLinks(actor) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<LinkRow>(`SELECT ${LINK_COLUMNS} FROM app.bank_links WHERE owner_id = $1 ORDER BY created_at, id`, [actor.userId]);
        return rows.map(toLink);
      });
    },

    async findLink(actor, linkId) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<LinkRow>(`SELECT ${LINK_COLUMNS} FROM app.bank_links WHERE id = $1 AND owner_id = $2`, [linkId, actor.userId]);
        const row = rows[0];
        return row === undefined ? null : toLink(row);
      });
    },

    async upsertLink(context, link) {
      return write(context, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.bank_links (owner_id, provider, provider_link_id, institution_name, token_ciphertext, token_nonce, token_key_version, origin)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (owner_id, provider, provider_link_id) DO UPDATE
             SET institution_name = EXCLUDED.institution_name, token_ciphertext = EXCLUDED.token_ciphertext,
                 token_nonce = EXCLUDED.token_nonce, token_key_version = EXCLUDED.token_key_version, status = 'active'
           RETURNING id`,
          [
            context.actor.userId,
            link.provider,
            link.providerLinkId,
            link.institutionName,
            Buffer.from(link.sealedToken.ciphertext),
            Buffer.from(link.sealedToken.nonce),
            link.sealedToken.keyVersion,
            link.origin,
          ],
        );
        const id = rows[0]?.id ?? '';
        await audit(client, context, 'bank.link_connected', 'bank_link', id);
        return id;
      });
    },

    async deleteLink(context, linkId) {
      return write(context, async (client) => {
        const { rowCount } = await client.query('DELETE FROM app.bank_links WHERE id = $1 AND owner_id = $2', [linkId, context.actor.userId]);
        if (rowCount === 0) return false;
        await audit(client, context, 'bank.link_disconnected', 'bank_link', linkId);
        return true;
      });
    },

    async saveSync(context, linkId, accounts, movements) {
      await write(context, async (client) => {
        const ids = new Map<string, string>();
        for (const account of accounts) {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO app.bank_accounts (owner_id, link_id, external_id, name, account_type, available_balance, origin)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (link_id, external_id) DO UPDATE
               SET name = EXCLUDED.name, account_type = EXCLUDED.account_type, available_balance = EXCLUDED.available_balance, updated_at = now()
             RETURNING id`,
            [context.actor.userId, linkId, account.externalId, account.name, account.type, account.availableBalance, account.origin],
          );
          if (rows[0] !== undefined) ids.set(account.externalId, rows[0].id);
        }
        const rows = movements.filter((movement) => ids.has(movement.accountExternalId));
        if (rows.length > 0) {
          await client.query(
            `INSERT INTO app.bank_movements (owner_id, account_id, external_id, posted_on, amount, description, origin)
             SELECT $1, a, e, p::date, m, d, o FROM unnest($2::uuid[], $3::text[], $4::text[], $5::bigint[], $6::text[], $7::text[]) AS t(a, e, p, m, d, o)
             ON CONFLICT (account_id, external_id) DO UPDATE
               SET posted_on = EXCLUDED.posted_on, amount = EXCLUDED.amount, description = EXCLUDED.description`,
            [
              context.actor.userId,
              rows.map((movement) => ids.get(movement.accountExternalId)),
              rows.map((movement) => movement.externalId),
              rows.map((movement) => movement.postedOn),
              rows.map((movement) => movement.amount),
              rows.map((movement) => movement.description),
              rows.map((movement) => movement.origin),
            ],
          );
        }
        await client.query('UPDATE app.bank_links SET last_synced_at = now() WHERE id = $1', [linkId]);
        await audit(client, context, 'bank.link_synced', 'bank_link', linkId);
      });
    },

    async listAccounts(actor) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<{ id: string; link_id: string; external_id: string; name: string; account_type: string; available_balance: string; origin: DataOrigin }>(
          'SELECT id, link_id, external_id, name, account_type, available_balance, origin FROM app.bank_accounts WHERE owner_id = $1 ORDER BY name, id',
          [actor.userId],
        );
        return rows.map(
          (row): StoredAccount => ({
            id: row.id,
            linkId: row.link_id,
            externalId: row.external_id,
            name: row.name,
            type: row.account_type,
            availableBalance: Number(row.available_balance),
            origin: row.origin,
          }),
        );
      });
    },

    async listMovements(actor, filter) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<MovementRow>(
          `${MOVEMENT_SELECT} WHERE m.owner_id = $1 AND m.posted_on >= $2::date AND ($3::uuid IS NULL OR m.account_id = $3)
           ORDER BY m.posted_on DESC, m.external_id LIMIT 2000`,
          [actor.userId, filter.since, filter.accountId ?? null],
        );
        return rows.map(toMovement);
      });
    },

    async findMovement(actor, movementId) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<MovementRow>(`${MOVEMENT_SELECT} WHERE m.id = $1 AND m.owner_id = $2`, [movementId, actor.userId]);
        const row = rows[0];
        return row === undefined ? null : toMovement(row);
      });
    },

    async confirmRecurring(context, movementId, entry) {
      return write(context, async (client) => {
        const [kind, interval, from, until] = scheduleColumns(entry.schedule);
        const table = entry.kind === 'income' ? 'incomes' : 'expenses';
        // The entry takes its origin from the movement, so test and demo data stay labelled.
        const { rowCount } = await client.query(
          `INSERT INTO app.${table} (id, owner_id, label, amount, schedule_kind, interval_months, from_month, until_month, origin, source_movement_id${table === 'expenses' ? ', nature' : ''})
           SELECT $1, m.owner_id, $3, $4, $5, $6, ${toDate('$7')}, ${toDate('$8')}, m.origin, m.id${table === 'expenses' ? ', $9' : ''}
             FROM app.bank_movements m WHERE m.id = $2 AND m.owner_id = $${table === 'expenses' ? '10' : '9'}`,
          [entry.id, movementId, entry.label, entry.amount, kind, interval, from, until, ...(table === 'expenses' ? [entry.nature] : []), context.actor.userId],
        );
        if (rowCount === 0) return false;
        await audit(client, context, `registry.${entry.kind}_created`, entry.kind, entry.id);
        return true;
      });
    },

    async openingBalanceFromAccount(context, accountId, month) {
      return write(context, async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO app.financial_profiles (owner_id, opening_balance, balance_month, origin, source_account_id)
           SELECT a.owner_id, a.available_balance, ${toDate('$2')}, a.origin, a.id FROM app.bank_accounts a WHERE a.id = $1 AND a.owner_id = $3
           ON CONFLICT (owner_id) DO UPDATE
             SET opening_balance = EXCLUDED.opening_balance, balance_month = EXCLUDED.balance_month,
                 origin = EXCLUDED.origin, source_account_id = EXCLUDED.source_account_id, updated_at = now()`,
          [accountId, formatYearMonth(month), context.actor.userId],
        );
        if (rowCount === 0) return false;
        await audit(client, context, 'registry.opening_balance_set', 'financial_profile', context.actor.userId);
        return true;
      });
    },
  };
}
