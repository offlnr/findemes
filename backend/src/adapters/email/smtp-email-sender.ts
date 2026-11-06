import nodemailer from 'nodemailer';
import type { EmailMessage, EmailSender } from '../../modules/notifications/ports/notification-ports.ts';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  /** true: TLS from the start (465). false: STARTTLS when the server offers it (587, Mailpit). */
  readonly secure: boolean;
  /** Amazon SES SMTP credentials in production; any value works with Mailpit. */
  readonly user?: string;
  readonly password?: string;
  /** Verified sender, e.g. "Fin de Mes <no-responder@findemes.cl>". */
  readonly from: string;
  /** Require TLS (production with SES). Mailpit in development runs without it. */
  readonly requireTls: boolean;
}

/**
 * Transactional email over SMTP (rule 7). The same adapter talks to Mailpit, the local test
 * environment, and to the SMTP interface of Amazon SES. Messages carry one-time links, so
 * nothing about them is logged here (CLAUDE.md, Datos).
 */
export function createSmtpEmailSender(config: SmtpConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    ...(config.user === undefined ? {} : { auth: { user: config.user, pass: config.password ?? '' } }),
    logger: false,
    connectionTimeout: 10_000,
  });
  return {
    async send(message: EmailMessage) {
      await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text });
    },
  };
}
