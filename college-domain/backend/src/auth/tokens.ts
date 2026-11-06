import { createHash, randomBytes } from 'node:crypto'

/** 256-bit random token, base64url (43 chars). Only its hash is ever stored. */
export const generateToken = () => randomBytes(32).toString('base64url')

export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex')

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Emails are compared and stored trimmed and lower-cased. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()
