// Grants the platform administrator role to an existing, verified account and prints the TOTP
// secret for its authenticator app (RNF22). Runs with the owner role, like the migrator.
//   pnpm admin:create correo@dominio.cl
import { createAesGcmTokenCipher } from '../adapters/crypto/aes-gcm-token-cipher.ts';
import { newTotpSecret, otpauthUri } from '../adapters/crypto/totp.ts';
import { grantPlatformAdmin } from '../adapters/postgres/grant-platform-admin.ts';
import { loadAdminConfig } from './admin-config.ts';

const email = process.argv[2]?.trim().toLowerCase();
const ownerUrl = process.env['MIGRATION_DATABASE_URL'];
const adminConfig = loadAdminConfig(process.env);
if (email === undefined || email === '' || ownerUrl === undefined || adminConfig === null) {
  throw new Error('Usage: pnpm admin:create <email> (needs MIGRATION_DATABASE_URL, ADMIN_DATABASE_URL, ADMIN_JWT_SECRET and ADMIN_TOTP_KEY)');
}

const secret = newTotpSecret();
const sealed = createAesGcmTokenCipher(new Map([[1, adminConfig.totpKey]]), 1).encrypt(secret);
if ((await grantPlatformAdmin(ownerUrl, email, sealed)) === 'no_verified_account') {
  process.stderr.write('No hay una cuenta verificada con ese correo. Regístrala y confírmala en la app primero.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Rol de administrador asignado a ${email}.\n`);
  process.stdout.write(`Agrega esta cuenta en tu app de autenticación (Google Authenticator, 1Password, etc.):\n  ${otpauthUri(secret, email)}\n`);
  process.stdout.write(`Clave manual: ${secret}\n`);
}
