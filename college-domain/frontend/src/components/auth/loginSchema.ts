import { z } from 'zod'

// Messages are Student Portal catalog keys (src/i18n); forms translate them with tv().

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'validation.emailRequired')
    .max(254, 'validation.emailTooLong')
    .pipe(z.email('validation.emailInvalid')),
  // Passwords are never trimmed or otherwise altered.
  password: z.string().min(1, 'validation.passwordRequired').max(256, 'validation.passwordTooLong'),
  rememberMe: z.boolean(),
})

export type LoginFormInput = z.input<typeof loginSchema>
export type LoginFormValues = z.output<typeof loginSchema>
