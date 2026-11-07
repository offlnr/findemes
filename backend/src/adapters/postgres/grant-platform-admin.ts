import pg from 'pg';
import type { SealedToken } from '../../modules/aggregation/ports/aggregation-ports.ts';

/**
 * Grants the platform administrator role (migration 0009) with the owner role, like the migrator:
 * no service role can create administrators. The account must exist and be verified. The grant
 * is recorded in the audit trail as a system action.
 */
export async function grantPlatformAdmin(ownerUrl: string, email: string, sealedTotp: SealedToken): Promise<'granted' | 'no_verified_account'> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>('SELECT id FROM app.users WHERE email = $1 AND email_verified_at IS NOT NULL', [email]);
    const userId = rows[0]?.id;
    if (userId === undefined) {
      await client.query('ROLLBACK');
      return 'no_verified_account';
    }
    await client.query(
      `INSERT INTO app.platform_admins (user_id, totp_secret_ciphertext, totp_nonce, totp_key_version) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET totp_secret_ciphertext = EXCLUDED.totp_secret_ciphertext, totp_nonce = EXCLUDED.totp_nonce,
         totp_key_version = EXCLUDED.totp_key_version`,
      [userId, Buffer.from(sealedTotp.ciphertext), Buffer.from(sealedTotp.nonce), sealedTotp.keyVersion],
    );
    await client.query(
      `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, occurred_at, prev_hash, hash, seq)
       VALUES ('system', NULL, 'admin.role_granted', 'user', $1, now(), '\\x00', '\\x00', 0)`,
      [userId],
    );
    await client.query('COMMIT');
    return 'granted';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
