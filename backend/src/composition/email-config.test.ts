import { describe, expect, it } from 'vitest';
import { loadEmailConfig } from './email-config.ts';

describe('loadEmailConfig', () => {
  it('writes to the outbox in development and to Mailpit when asked', () => {
    expect(loadEmailConfig({}, 'development')).toEqual({ transport: 'outbox' });
    const mailpit = loadEmailConfig({ EMAIL_TRANSPORT: 'smtp' }, 'development');
    expect(mailpit).toMatchObject({ transport: 'smtp', smtp: { host: '127.0.0.1', port: 1025, secure: false, requireTls: false } });
  });

  it('requires TLS in development as soon as the server takes credentials (a real mailbox)', () => {
    const gmail = loadEmailConfig({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'a@gmail.com', SMTP_PASSWORD: 'app' }, 'development');
    expect(gmail).toMatchObject({ transport: 'smtp', smtp: { host: 'smtp.gmail.com', port: 587, requireTls: true, user: 'a@gmail.com' } });
  });

  it('requires SES SMTP credentials and TLS in production and never the outbox', () => {
    expect(() => loadEmailConfig({}, 'production')).toThrow('SMTP_USER, SMTP_PASSWORD');
    expect(() => loadEmailConfig({ EMAIL_TRANSPORT: 'outbox' }, 'production')).toThrow('EMAIL_TRANSPORT');
    const ses = loadEmailConfig(
      { SMTP_HOST: 'email-smtp.us-east-1.amazonaws.com', SMTP_PORT: '587', SMTP_USER: 'AKIA', SMTP_PASSWORD: 'secret' },
      'production',
    );
    expect(ses).toMatchObject({ transport: 'smtp', smtp: { host: 'email-smtp.us-east-1.amazonaws.com', port: 587, requireTls: true } });
  });
});
