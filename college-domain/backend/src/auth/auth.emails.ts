import type { EmailMessage } from '../email/email.types.js'

// Tokens travel in the URL fragment (#token=…) so browsers never send them to servers or in Referer headers.

export const verificationEmail = (to: string, origin: string, token: string): EmailMessage => ({
  to,
  subject: 'Verify your CampusGuide email address',
  text: `Welcome to CampusGuide.\n\nConfirm your email address to finish creating your account:\n${origin}/verify-email#token=${token}\n\nThis link expires in 24 hours and can be used once. If you did not create a CampusGuide account, ignore this email.`,
})

export const alreadyRegisteredEmail = (to: string, origin: string): EmailMessage => ({
  to,
  subject: 'CampusGuide sign-up attempt',
  text: `Someone tried to create a CampusGuide account with this email address, but you already have one.\n\nSign in: ${origin}/login\nForgot your password? ${origin}/forgot-password\n\nIf this wasn't you, no action is needed.`,
})

export const passwordResetEmail = (to: string, origin: string, token: string): EmailMessage => ({
  to,
  subject: 'Reset your CampusGuide password',
  text: `We received a request to reset your CampusGuide password.\n\nChoose a new password:\n${origin}/reset-password#token=${token}\n\nThis link expires in 30 minutes and can be used once. Resetting signs you out everywhere. If you did not ask for this, ignore this email — your password will not change.`,
})
