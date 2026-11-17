import { z } from 'zod'

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true')

/** Same minimum as the engine (language_engine/service/domains.py MIN_PRODUCTION_TOKEN_LENGTH). */
export const MIN_PRODUCTION_TOKEN_LENGTH = 32
/** Header-safe token characters (URL-safe and standard base64, hex). */
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/

const importFields = ['nucatReference', 'studentName', 'admissionYear', 'nucatRank', 'allocatedBranch', 'admissionStatus', 'officialEmail', 'feeCategory'] as const
const columnAliases = z.string().optional().transform((value, ctx): Partial<Record<(typeof importFields)[number], string[]>> => {
  if (!value?.trim()) return {}
  try {
    const parsed = z.partialRecord(z.enum(importFields), z.array(z.string().min(1).max(80)).max(20)).parse(JSON.parse(value))
    return parsed
  } catch {
    ctx.addIssue({ code: 'custom', message: `must be JSON like {"nucatReference":["Appl No"]} using the fields ${importFields.join(', ')}` })
    return z.NEVER
  }
})

/** localhost, *.localhost, loopback, private, link-local and unspecified addresses. */
export function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith('fe80:')) return true
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (!ip) return false
  const [a, b] = [Number(ip[1]), Number(ip[2])]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * Environment schema, checked once at startup. Unsafe combinations are rejected so that development conveniences
 * (e.g. the email outbox) can never become production behaviour.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a postgresql:// connection string').refine((value) => !/USER:PASSWORD@/.test(value), 'still contains the .env.example placeholder'),
  // Also the public app URL printed in QR codes and emails. The refinement also runs when z.url() already failed.
  FRONTEND_ORIGIN: z.url().refine((value) => {
    try { return new URL(value).origin === value.replace(/\/$/, '') } catch { return false }
  }, 'must be an origin such as http://localhost:5173 (no path)'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  REMEMBER_ME_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  EMAIL_TRANSPORT: z.enum(['none', 'smtp', 'dev-outbox']).default('none'),
  SMTP_URL: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default(''),
  /** Unset = on in development/test, off in production. */
  SWAGGER_ENABLED: booleanString.optional(),
  /** Requests per 15 minutes per client for login / verification / reset endpoints. */
  RATE_LIMIT_AUTH: z.coerce.number().int().min(1).max(1000).default(10),
  /** Requests per 15 minutes per client for endpoints that send email (register, resend, forgot-password). */
  RATE_LIMIT_EMAIL: z.coerce.number().int().min(1).max(1000).default(5),
  /** Admission file uploads (previews) per 15 minutes per client. */
  RATE_LIMIT_IMPORT: z.coerce.number().int().min(1).max(1000).default(30),
  /** Extra spreadsheet header aliases for admission imports (until the official column layout is confirmed). */
  ADMISSION_IMPORT_COLUMN_ALIASES: columnAliases,
  /** Shared language engine (internal service; never exposed to the browser). */
  AI_ENGINE_URL: z.url().default('http://127.0.0.1:8000'),
  /**
   * College's own engine token (the engine's AI_ENGINE_COLLEGE_TOKEN). Never the Banking token; never sent to the browser.
   * Trimmed, as the engine trims its copy. Required in production (see superRefine); optional in development, where the
   * engine may run without tokens. When set, it must be header-safe (e.g. secrets.token_urlsafe output).
   */
  AI_ENGINE_COLLEGE_TOKEN: z.string().optional().default('').transform((value) => value.trim())
    .refine((value) => value === '' || TOKEN_PATTERN.test(value), 'must contain only letters, digits and - _ . ~ + / = (no spaces)'),
  /** Budget for one engine call (an LLM answer can take several seconds). */
  AI_ENGINE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
}).superRefine((env, ctx) => {
  // Phase 7A: production refuses to start without College's own engine token, instead of answering every assistant
  // question with 503 at runtime.
  if (env.NODE_ENV === 'production' && !env.AI_ENGINE_COLLEGE_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['AI_ENGINE_COLLEGE_TOKEN'], message: 'is required in production' })
  } else if (env.NODE_ENV === 'production' && env.AI_ENGINE_COLLEGE_TOKEN.length < MIN_PRODUCTION_TOKEN_LENGTH) {
    ctx.addIssue({ code: 'custom', path: ['AI_ENGINE_COLLEGE_TOKEN'], message: `must be at least ${MIN_PRODUCTION_TOKEN_LENGTH} characters in production` })
  }
  if (env.EMAIL_TRANSPORT === 'smtp') {
    if (!/^smtps?:\/\//.test(env.SMTP_URL)) ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'is required (smtp:// or smtps://) when EMAIL_TRANSPORT=smtp' })
    if (!env.EMAIL_FROM.trim()) ctx.addIssue({ code: 'custom', path: ['EMAIL_FROM'], message: 'is required when EMAIL_TRANSPORT=smtp' })
  }
  if (env.EMAIL_TRANSPORT === 'dev-outbox' && env.NODE_ENV === 'production') {
    ctx.addIssue({ code: 'custom', path: ['EMAIL_TRANSPORT'], message: 'dev-outbox is not allowed in production' })
  }
  if (env.NODE_ENV === 'production' && !env.FRONTEND_ORIGIN.startsWith('https://')) {
    ctx.addIssue({ code: 'custom', path: ['FRONTEND_ORIGIN'], message: 'must use https:// in production' })
  }
  if (env.NODE_ENV === 'production' && isLocalHost(new URL(env.FRONTEND_ORIGIN).hostname)) {
    ctx.addIssue({ code: 'custom', path: ['FRONTEND_ORIGIN'], message: 'must be the public address of the deployed app in production (it is printed in QR codes and emails), not localhost or a private IP' })
  }
})

export type Env = z.infer<typeof envSchema>

/** Validates process env for ConfigModule. Error messages name the variable but never echo its value. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.') || 'environment'}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}\nSee .env.example.`)
  }
  return result.data
}
