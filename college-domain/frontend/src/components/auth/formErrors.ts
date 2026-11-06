import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import type { Language, MessageKey } from '../../i18n/catalog'
import { ServiceError } from '../../services/errors'

const fieldKeys: Record<string, MessageKey> = { email: 'validation.emailInvalid', password: 'validation.passwordMin' }

/**
 * Copies the backend's per-field VALIDATION_FAILED details onto the matching form fields.
 * Returns true when at least one field was marked, so the caller can skip a duplicate banner.
 */
export function applyServerFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[], language: Language = 'en') {
  if (!(error instanceof ServiceError) || error.code !== 'VALIDATION_FAILED' || !error.details) return false
  let applied = false
  for (const detail of error.details) {
    const field = fields.find((name) => name === detail.field)
    if (field && detail.messages[0]) {
      setError(field, { type: 'server', message: language === 'en' || !fieldKeys[field] ? sentence(detail.messages[0]) : fieldKeys[field] })
      applied = true
    }
  }
  return applied
}

const sentence = (text: string) => {
  const trimmed = text.trim()
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? '' : '.'}`
}

/** Reads the single-use token from an emailed link's fragment (`#token=…`); anything malformed counts as missing. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}
