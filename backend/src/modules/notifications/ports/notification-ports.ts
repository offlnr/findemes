export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Transactional email (verification, password reset, notices). */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
