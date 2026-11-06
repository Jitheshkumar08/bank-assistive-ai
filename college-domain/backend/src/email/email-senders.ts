import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import type { EmailMessage, EmailSender } from './email.types.js'

export class SmtpEmailSender implements EmailSender {
  readonly kind = 'smtp' as const
  private readonly transport: Transporter

  constructor(smtpUrl: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(smtpUrl)
  }

  async send(message: EmailMessage) {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text })
  }
}

/**
 * DEVELOPMENT ONLY (refused in production by config validation): writes each message to ./.dev-outbox so a developer
 * can open the verification / reset link locally. Links are never logged or returned by the API.
 */
export class DevOutboxEmailSender implements EmailSender {
  readonly kind = 'dev-outbox' as const

  constructor(private readonly directory = join(process.cwd(), '.dev-outbox')) {}

  async send(message: EmailMessage) {
    await mkdir(this.directory, { recursive: true })
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, '_')
    const file = join(this.directory, `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeTo}.txt`)
    await writeFile(file, `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`, { encoding: 'utf8', mode: 0o600 })
  }
}

/** For automated tests: keeps messages in memory. Never selected by configuration. */
export class InMemoryEmailSender implements EmailSender {
  readonly kind = 'memory' as const
  readonly sent: EmailMessage[] = []

  async send(message: EmailMessage) {
    this.sent.push(message)
  }
}
