export type EmailMessage = { to: string; subject: string; text: string }

/** Pluggable email delivery. `null` provider = email not configured (callers must report that honestly). */
export interface EmailSender {
  readonly kind: 'smtp' | 'dev-outbox' | 'memory'
  send(message: EmailMessage): Promise<void>
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER')
