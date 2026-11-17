import { AuthError } from '../services/auth/types'
import { ServiceError } from '../services/errors'
import { en, type Catalog, type MessageKey } from './en'
import { hi } from './hi'
import { kn } from './kn'

export type Language = 'en' | 'kn' | 'hi'
export type { MessageKey }

/**
 * Student Portal languages. Names are shown in their own script. `speechTag` is the BCP-47 tag a speech engine would
 * use; no speech engine is wired up yet (see README), so it is metadata only.
 */
export const languages: { code: Language; name: string; speechTag: string }[] = [
  { code: 'en', name: 'English', speechTag: 'en-IN' },
  { code: 'kn', name: 'ಕನ್ನಡ', speechTag: 'kn-IN' },
  { code: 'hi', name: 'हिन्दी', speechTag: 'hi-IN' },
]

export const catalogs: Record<Language, Catalog> = { en, kn, hi }
export const isLanguage = (value: unknown): value is Language => value === 'en' || value === 'kn' || value === 'hi'
export const isMessageKey = (value: unknown): value is MessageKey => typeof value === 'string' && Object.hasOwn(en, value)

export type Vars = Record<string, string | number>

export function translate(language: Language, key: MessageKey, vars?: Vars) {
  const template = catalogs[language][key]
  return vars ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : template
}

/** Server/service error codes → catalog keys, so failures read in the selected language. */
const errorKeys: Partial<Record<string, MessageKey>> = {
  NETWORK: 'error.network',
  BACKEND_NOT_CONNECTED: 'error.notConnected',
  INVALID_CREDENTIALS: 'error.invalidCredentials',
  EMAIL_NOT_VERIFIED: 'error.emailNotVerified',
  ACCOUNT_DISABLED: 'error.accountDisabled',
  RATE_LIMITED: 'error.rateLimited',
  EMAIL_PROVIDER_NOT_CONFIGURED: 'error.emailNotConfigured',
  EMAIL_DELIVERY_FAILED: 'error.emailDeliveryFailed',
  INVALID_OR_EXPIRED_TOKEN: 'error.invalidToken',
  REFERENCE_MISMATCH: 'error.referenceMismatch',
  NO_ADMISSION_RECORD: 'error.noAdmissionRecord',
  AMBIGUOUS_ADMISSION_RECORD: 'error.ambiguousAdmissionRecord',
  INVALID_QR: 'error.invalidQr',
  NOT_FOUND: 'error.notFound',
  INVALID_RESPONSE: 'error.invalidResponse',
  VALIDATION_FAILED: 'error.validation',
  ASSISTANT_UNAVAILABLE: 'error.assistantUnavailable',
  VOICE_NOT_UNDERSTOOD: 'error.voiceNotUnderstood',
}

/**
 * Student-facing text for an error. In English the server's own (more specific) message is kept; in Kannada and Hindi
 * the message is chosen by error code from the catalog, so screens never mix in English server text.
 */
export function errorText(language: Language, error: unknown, fallback: MessageKey) {
  const coded = error instanceof ServiceError || error instanceof AuthError ? error : null
  if (coded && language === 'en') return coded.message
  if (coded?.code === 'BACKEND_NOT_CONNECTED' && error instanceof AuthError) return translate(language, 'login.notConnected')
  const key = coded ? errorKeys[coded.code] : undefined
  return translate(language, key ?? fallback)
}
