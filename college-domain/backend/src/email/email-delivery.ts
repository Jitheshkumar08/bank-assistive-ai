import { HttpStatus, type Logger } from '@nestjs/common'
import { ApiError } from '../common/api-error.js'
import type { EmailMessage, EmailSender } from './email.types.js'

/** Fails before any change is made when no email provider is configured — callers never pretend an email was sent. */
export function requireEmailSender(sender: EmailSender | null, action = 'this action'): EmailSender {
  if (!sender) {
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'EMAIL_PROVIDER_NOT_CONFIGURED',
      `Email delivery is not set up on this CampusGuide server yet, so ${action} is unavailable.`)
  }
  return sender
}

/** Sends one message; delivery failures become EMAIL_DELIVERY_FAILED without leaking provider details. */
export async function deliverEmail(sender: EmailSender, message: EmailMessage, logger: Logger) {
  try {
    await sender.send(message)
  } catch (error) {
    logger.error(`Email delivery failed (${sender.kind})`, error instanceof Error ? error.message : undefined)
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'EMAIL_DELIVERY_FAILED', 'We could not send the email right now. Please try again in a few minutes.')
  }
}
