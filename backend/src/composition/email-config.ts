import { z } from 'zod';
import type { SmtpConfig } from '../adapters/email/smtp-email-sender.ts';

const emailSchema = z.object({
  // outbox: files in backend/.outbox (development only). smtp: Mailpit locally, Amazon SES in AWS.
  EMAIL_TRANSPORT: z.enum(['outbox', 'smtp']).optional(),
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default('Fin de Mes <no-responder@findemes.cl>'),
});

export type EmailConfig = { readonly transport: 'outbox' } | { readonly transport: 'smtp'; readonly smtp: SmtpConfig };

/**
 * Email settings. Development defaults to the file outbox; outside development the SMTP
 * transport (Amazon SES) with credentials and TLS is mandatory, so emails are never silently
 * dropped. Errors name the variable but never echo its value.
 */
export function loadEmailConfig(env: NodeJS.ProcessEnv, environment: 'development' | 'test' | 'production'): EmailConfig {
  const pick = (key: string) => (env[key] === undefined || env[key] === '' ? undefined : env[key]);
  const parsed = emailSchema.safeParse(
    Object.fromEntries(['EMAIL_TRANSPORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'].map((key) => [key, pick(key)])),
  );
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Invalid email configuration in environment variables: ${variables}`);
  }
  const data = parsed.data;
  const transport = data.EMAIL_TRANSPORT ?? (environment === 'development' ? 'outbox' : 'smtp');
  if (transport === 'outbox') {
    if (environment !== 'development') throw new Error('Invalid email configuration in environment variables: EMAIL_TRANSPORT');
    return { transport };
  }
  const production = environment === 'production';
  if (production && (data.SMTP_USER === undefined || data.SMTP_PASSWORD === undefined)) {
    throw new Error('Invalid email configuration in environment variables: SMTP_USER, SMTP_PASSWORD');
  }
  return {
    transport,
    smtp: {
      host: data.SMTP_HOST,
      port: data.SMTP_PORT,
      secure: data.SMTP_SECURE === 'true',
      // Credentials never travel in clear text: any authenticated server (SES, Gmail) requires TLS.
      requireTls: production || data.SMTP_USER !== undefined,
      from: data.EMAIL_FROM,
      ...(data.SMTP_USER === undefined ? {} : { user: data.SMTP_USER }),
      ...(data.SMTP_PASSWORD === undefined ? {} : { password: data.SMTP_PASSWORD }),
    },
  };
}
