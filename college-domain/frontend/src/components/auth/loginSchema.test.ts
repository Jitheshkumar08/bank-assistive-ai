import { describe, expect, it } from 'vitest'
import { translate } from '../../i18n/catalog'
import { loginSchema } from './loginSchema'

const parse = (values: Partial<{ email: string; password: string; rememberMe: boolean }>) =>
  loginSchema.safeParse({ email: '', password: '', rememberMe: false, ...values })

// Schema messages are Student Portal catalog keys; the forms show them translated.
describe('loginSchema', () => {
  it('accepts a valid email and password and trims the email only', () => {
    const result = parse({ email: '  student@college.edu ', password: '  secret  ', rememberMe: true })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ email: 'student@college.edu', password: '  secret  ', rememberMe: true })
  })

  it('requires an email address', () => {
    const message = parse({ password: 'x' }).error?.issues[0].message
    expect(message).toBe('validation.emailRequired')
    expect(translate('en', 'validation.emailRequired')).toBe('Enter your email address.')
  })

  it.each(['student', 'student@', '@college.edu', 'student@college', 'stu dent@college.edu'])('rejects the malformed email %s', (email) => {
    expect(parse({ email, password: 'x' }).error?.issues[0].message).toBe('validation.emailInvalid')
  })

  it('requires a password', () => {
    expect(parse({ email: 'student@college.edu' }).error?.issues[0].message).toBe('validation.passwordRequired')
    expect(translate('en', 'validation.passwordRequired')).toBe('Enter your password.')
  })
})
