// Creates backend/.env.local from .env.example with fresh random secrets, for a new local setup.
//   pnpm env:init
// Never overwrites an existing .env.local. Prints only the names of the variables it filled.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const TARGET = '.env.local';
const SECRETS = ['JWT_SECRET', 'IDENTITY_HMAC_KEY', 'BANK_TOKEN_KEY', 'ADMIN_JWT_SECRET', 'ADMIN_TOTP_KEY'];

if (existsSync(TARGET)) {
  process.stdout.write(`${TARGET} ya existe; no se modificó.\n`);
} else {
  const filled: string[] = [];
  const content = readFileSync('.env.example', 'utf8')
    .split(/\r?\n/)
    .map((line) => {
      const name = SECRETS.find((key) => line === `${key}=`);
      if (name === undefined) return line;
      filled.push(name);
      return `${name}=${randomBytes(32).toString('base64url')}`;
    })
    .join('\n');
  writeFileSync(TARGET, content, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(
    `${TARGET} creado. Secretos generados: ${filled.join(', ')}.\nFintoc queda vacío (solo banco de demostración) hasta agregar llaves sk_test_/pk_test_.\n`,
  );
}
