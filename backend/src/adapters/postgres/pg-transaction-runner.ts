import pg from 'pg';
import type { Actor } from '../../modules/shared/actor.ts';
import type { Transaction, TransactionRunner } from '../../modules/shared/ports.ts';

/** Connection pool of one service login role (never the owner role). */
export function createPgPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

interface PgTransaction extends Transaction {
  readonly client: pg.PoolClient;
}

/**
 * Runs each unit of work in one transaction as the given actor. The user id is set with
 * `set_config('app.user_id', ..., true)`, local to the transaction, so Row-Level Security
 * filters every statement and nothing leaks to the next use of a pooled connection.
 */
export function createPgTransactionRunner(pool: pg.Pool): TransactionRunner {
  return {
    async withActor<T>(actor: Actor | null, work: (tx: Transaction) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (actor !== null) {
          await client.query(`SELECT set_config('app.user_id', $1, true)`, [actor.userId]);
        }
        const result = await work({ client } as PgTransaction);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** The pg client behind a transaction handle created by this runner. */
export function clientOf(tx: Transaction): pg.PoolClient {
  return (tx as PgTransaction).client;
}
