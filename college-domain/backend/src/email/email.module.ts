import { Global, Logger, Module } from '@nestjs/common'
import { AppConfig } from '../config/app-config.service.js'
import { DevOutboxEmailSender, SmtpEmailSender } from './email-senders.js'
import { EMAIL_SENDER, type EmailSender } from './email.types.js'

@Global()
@Module({
  providers: [{
    provide: EMAIL_SENDER,
    inject: [AppConfig],
    useFactory: (config: AppConfig): EmailSender | null => {
      const logger = new Logger('Email')
      switch (config.env.EMAIL_TRANSPORT) {
        case 'smtp':
          return new SmtpEmailSender(config.env.SMTP_URL, config.env.EMAIL_FROM)
        case 'dev-outbox':
          // Config validation already rejects this in production; double-check anyway.
          if (config.isProduction) throw new Error('dev-outbox email transport is not allowed in production')
          logger.warn('Using the DEVELOPMENT email outbox (./.dev-outbox). Emails are not delivered.')
          return new DevOutboxEmailSender()
        default:
          logger.warn('No email provider configured: registration and password reset will return 503.')
          return null
      }
    },
  }],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
