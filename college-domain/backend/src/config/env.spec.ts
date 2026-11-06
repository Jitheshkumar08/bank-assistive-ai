import { validateEnv } from './env.js'

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app:s3cret-value@localhost:5432/campusguide_dev?schema=public',
  FRONTEND_ORIGIN: 'http://localhost:5173',
}

describe('environment validation', () => {
  it('accepts a minimal development configuration with safe defaults', () => {
    const env = validateEnv(base)
    expect(env).toMatchObject({ PORT: 3000, EMAIL_TRANSPORT: 'none', SESSION_TTL_HOURS: 12, RATE_LIMIT_AUTH: 10, RATE_LIMIT_EMAIL: 5 })
  })

  it.each([
    ['missing DATABASE_URL', { ...base, DATABASE_URL: undefined }, 'DATABASE_URL'],
    ['the .env.example placeholder', { ...base, DATABASE_URL: 'postgresql://USER:PASSWORD@localhost:5432/campusguide_dev' }, 'placeholder'],
    ['a frontend origin with a path', { ...base, FRONTEND_ORIGIN: 'http://localhost:5173/app' }, 'FRONTEND_ORIGIN'],
    ['smtp without SMTP_URL', { ...base, EMAIL_TRANSPORT: 'smtp', EMAIL_FROM: 'a@b.c' }, 'SMTP_URL'],
    ['the dev outbox in production', { ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://campusguide.example', EMAIL_TRANSPORT: 'dev-outbox' }, 'not allowed in production'],
    ['plain http frontend in production', { ...base, NODE_ENV: 'production' }, 'https'],
    ['a localhost frontend in production', { ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://localhost:5173' }, 'not localhost or a private IP'],
    ['a private-network frontend in production', { ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://192.168.1.20' }, 'not localhost or a private IP'],
    ['a loopback frontend in production', { ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://127.0.0.1' }, 'not localhost or a private IP'],
    ['a missing frontend origin', { ...base, FRONTEND_ORIGIN: undefined }, 'FRONTEND_ORIGIN'],
    ['a frontend origin that is not a URL', { ...base, FRONTEND_ORIGIN: 'campusguide' }, 'FRONTEND_ORIGIN'],
  ])('rejects %s', (_label, raw, expected) => {
    expect(() => validateEnv(raw)).toThrow(expected)
  })

  it('accepts a public https origin in production and an explicit local origin in development', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://campusguide.nitte.edu.in' }).FRONTEND_ORIGIN).toBe('https://campusguide.nitte.edu.in')
    expect(validateEnv({ ...base, FRONTEND_ORIGIN: 'http://192.168.1.20:5173' }).FRONTEND_ORIGIN).toBe('http://192.168.1.20:5173')
  })

  it('never echoes configuration values in its error message', () => {
    try {
      validateEnv({ ...base, NODE_ENV: 'production', DATABASE_URL: 'postgresql://app:s3cret-value@db/campusguide' })
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cret-value')
      return
    }
    throw new Error('expected validation to fail')
  })
})
