import { mkdir, writeFile } from 'node:fs/promises';
import type { EmailMessage, EmailSender } from '../../modules/notifications/ports/notification-ports.ts';

/**
 * Local development only: writes each email to a file in `directory` (git-ignored) instead of
 * sending it, so links and codes can be opened without a mail provider. Never used outside
 * development, because emails carry tokens and logs must not (CLAUDE.md, Datos).
 */
export function createDevOutboxEmailSender(directory: URL): EmailSender {
  let sequence = 0;
  return {
    async send(message: EmailMessage) {
      await mkdir(directory, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(++sequence)}.txt`;
      await writeFile(new URL(name, directory), `Para: ${message.to}\nAsunto: ${message.subject}\n\n${message.text}\n`, 'utf8');
    },
  };
}
