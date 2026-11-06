import { z } from 'zod'
import { loginSchema } from './loginSchema'

// Mirrors the backend's RegisterDto / ResetPasswordDto limits so students see the rule before submitting.
// Messages are catalog keys; render them with tv(message, passwordLimits).
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128
export const passwordLimits = { min: PASSWORD_MIN, max: PASSWORD_MAX }

const email = loginSchema.shape.email
// Passwords are never trimmed or otherwise altered.
const newPassword = z.string()
  .min(1, 'validation.choosePassword')
  .min(PASSWORD_MIN, 'validation.passwordMin')
  .max(PASSWORD_MAX, 'validation.passwordMax')
const confirmPassword = z.string().min(1, 'validation.confirmRequired')
const passwordsMatch = { path: ['confirmPassword'], message: 'validation.passwordsMismatch' }

export const signUpSchema = z.object({ email, password: newPassword, confirmPassword })
  .refine((values) => values.password === values.confirmPassword, passwordsMatch)

export const emailOnlySchema = z.object({ email })

export const resetPasswordSchema = z.object({ password: newPassword, confirmPassword })
  .refine((values) => values.password === values.confirmPassword, passwordsMatch)

export type SignUpInput = z.input<typeof signUpSchema>
export type SignUpValues = z.output<typeof signUpSchema>
export type EmailOnlyInput = z.input<typeof emailOnlySchema>
export type EmailOnlyValues = z.output<typeof emailOnlySchema>
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>
export type ResetPasswordValues = z.output<typeof resetPasswordSchema>
