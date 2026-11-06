import { normalizeReference } from '../admission/admission.service.js'
import { PasswordService } from './password.service.js'
import { generateToken, hashToken, normalizeEmail, TOKEN_PATTERN } from './tokens.js'

describe('password hashing', () => {
  const passwords = new PasswordService()

  it('uses Argon2id with the configured cost and never stores the plaintext', async () => {
    const hash = await passwords.hash('correct horse battery staple')
    const [, algorithm, version, params] = hash.split('$')
    expect([algorithm, version]).toEqual(['argon2id', 'v=19'])
    expect(Object.fromEntries(params.split(',').map((pair) => pair.split('=')))).toEqual({ m: '19456', t: '2', p: '1' })
    expect(hash).not.toContain('correct horse')
    await expect(passwords.verify(hash, 'correct horse battery staple')).resolves.toBe(true)
    await expect(passwords.verify(hash, 'wrong password')).resolves.toBe(false)
  })

  it('treats a malformed hash as a failed verification', async () => {
    await expect(passwords.verify('not-a-hash', 'anything')).resolves.toBe(false)
  })

  it('dummy verification always fails', async () => {
    await expect(passwords.verifyAgainstDummy('anything')).resolves.toBe(false)
  })
})

describe('tokens and normalisation', () => {
  it('generates 256-bit url-safe tokens and stores only a SHA-256 hash', () => {
    const token = generateToken()
    expect(token).toMatch(TOKEN_PATTERN)
    expect(generateToken()).not.toBe(token)
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('normalises emails and NUCAT references', () => {
    expect(normalizeEmail('  Student@Example.COM ')).toBe('student@example.com')
    expect(normalizeReference(' nu 2026-00 42 ')).toBe('NU2026-0042')
  })
})
