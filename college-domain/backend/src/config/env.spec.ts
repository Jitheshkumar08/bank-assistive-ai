import { validateEnv } from './env.js'

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app:s3cret-value@localhost:5432/campusguide_dev?schema=public',
  FRONTEND_ORIGIN: 'http://localhost:5173',
}

/** Synthetic 48-character token in the secrets.token_urlsafe alphabet. Not a real credential. */
const TOKEN = 'synthetic-test-token_0123456789abcdefghijklmnopqr'
const production = { ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://campusguide.example', AI_ENGINE_COLLEGE_TOKEN: TOKEN }

describe('AI_ENGINE_COLLEGE_TOKEN (Phase 7A: production startup fails without a valid token)', () => {
  it.each([
    ['missing', { ...production, AI_ENGINE_COLLEGE_TOKEN: undefined }, 'AI_ENGINE_COLLEGE_TOKEN: is required in production'],
    ['empty', { ...production, AI_ENGINE_COLLEGE_TOKEN: '' }, 'AI_ENGINE_COLLEGE_TOKEN: is required in production'],
    ['only whitespace', { ...production, AI_ENGINE_COLLEGE_TOKEN: '   ' }, 'AI_ENGINE_COLLEGE_TOKEN: is required in production'],
    ['too short (31 characters)', { ...production, AI_ENGINE_COLLEGE_TOKEN: 'a'.repeat(31) }, 'AI_ENGINE_COLLEGE_TOKEN: must be at least 32 characters'],
    ['short once trimmed', { ...production, AI_ENGINE_COLLEGE_TOKEN: `  ${'a'.repeat(30)}  ` }, 'at least 32 characters'],
    ['containing a space', { ...production, AI_ENGINE_COLLEGE_TOKEN: `${'a'.repeat(20)} ${'b'.repeat(20)}` }, 'AI_ENGINE_COLLEGE_TOKEN: must contain only'],
    ['containing a control character', { ...production, AI_ENGINE_COLLEGE_TOKEN: `${'a'.repeat(40)}\n` + 'b' }, 'must contain only'],
  ])('refuses production with a token that is %s', (_label, raw, expected) => {
    expect(() => validateEnv(raw)).toThrow(expected)
  })

  it('accepts production with a valid token, trimmed as the engine trims its copy', () => {
    expect(validateEnv(production).AI_ENGINE_COLLEGE_TOKEN).toBe(TOKEN)
    expect(validateEnv({ ...production, AI_ENGINE_COLLEGE_TOKEN: ` ${TOKEN}\n` }).AI_ENGINE_COLLEGE_TOKEN).toBe(TOKEN)
    expect(validateEnv({ ...production, AI_ENGINE_COLLEGE_TOKEN: 'a'.repeat(32) }).AI_ENGINE_COLLEGE_TOKEN).toHaveLength(32)
  })

  it('development may run without a token (engine in no-token mode); a malformed one is still refused', () => {
    expect(validateEnv(base).AI_ENGINE_COLLEGE_TOKEN).toBe('')
    expect(validateEnv({ ...base, AI_ENGINE_COLLEGE_TOKEN: 'short-dev-token' }).AI_ENGINE_COLLEGE_TOKEN).toBe('short-dev-token')
    expect(() => validateEnv({ ...base, AI_ENGINE_COLLEGE_TOKEN: 'has a space' })).toThrow('must contain only')
  })

  it('never echoes the token in its error message', () => {
    const secret = 'Secret Token Value With Spaces 0123456789'
    for (const value of [secret, 'tooShortSecretValue']) {
      try {
        validateEnv({ ...production, AI_ENGINE_COLLEGE_TOKEN: value })
      } catch (error) {
        expect((error as Error).message).toContain('AI_ENGINE_COLLEGE_TOKEN')
        expect((error as Error).message).not.toContain(value)
        continue
      }
      throw new Error('expected validation to fail')
    }
  })
})

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
    expect(validateEnv({ ...production, FRONTEND_ORIGIN: 'https://campusguide.nitte.edu.in' }).FRONTEND_ORIGIN).toBe('https://campusguide.nitte.edu.in')
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
