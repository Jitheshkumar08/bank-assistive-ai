import type { EmailMessage } from '../email/email.types.js'

const roleLabel = { COLLEGE_ADMIN: 'College Admin', SUPER_ADMIN: 'Super Admin', STUDENT: 'Student' } as const

// The activation token travels in the URL fragment (#token=…), never in a query string or a server log.
export const staffInvitationEmail = (input: {
  to: string; displayName: string; role: keyof typeof roleLabel; collegeName: string | null; origin: string; token: string; expiresAt: Date
}): EmailMessage => ({
  to: input.to,
  subject: `Your CampusGuide ${roleLabel[input.role]} access`,
  text: [
    `Hello ${input.displayName},`,
    '',
    `You have been given ${roleLabel[input.role]} access to CampusGuide${input.collegeName ? ` for ${input.collegeName}` : ''}.`,
    'Open this link to set your password and activate your account:',
    `${input.origin}/activate#token=${input.token}`,
    '',
    `The link can be used once and expires on ${input.expiresAt.toUTCString()}.`,
    'If you did not expect this email, ignore it — no account is created until the link is used.',
  ].join('\n'),
})
