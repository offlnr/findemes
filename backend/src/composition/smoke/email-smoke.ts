// Smoke test of the email test environment: sends one message through Mailpit (docker compose
// service `mail`) and checks it arrived. Open http://localhost:8025 to read it.
//   pnpm smoke:email
import { randomBytes } from 'node:crypto';
import { createSmtpEmailSender } from '../../adapters/email/smtp-email-sender.ts';
import { loadEmailConfig } from '../email-config.ts';

const config = loadEmailConfig({ ...process.env, EMAIL_TRANSPORT: 'smtp' }, 'development');
if (config.transport !== 'smtp') throw new Error('unreachable');
const marker = randomBytes(6).toString('hex');
await createSmtpEmailSender(config.smtp).send({
  to: 'prueba@findemes.local',
  subject: `Prueba del entorno de correo ${marker}`,
  text: 'Este mensaje lo envió pnpm smoke:email y solo existe en Mailpit.',
});
const response = await fetch(`http://127.0.0.1:8025/api/v1/search?query=${marker}`);
const found = ((await response.json()) as { messages_count?: number }).messages_count ?? 0;
process.stdout.write(found > 0 ? `Correo recibido en Mailpit (${marker}). Ver en http://localhost:8025\n` : 'El correo no llegó a Mailpit.\n');
if (found === 0) process.exitCode = 1;
