import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from './env.js'

/** Live rate-limit values read by @RateLimit rules (resolved per request from validated config). */
export const rateLimits = { auth: 10, email: 5, imports: 30 }

/** Typed, validated configuration. Inject this instead of reading process.env. */
@Injectable()
export class AppConfig {
  readonly env: Env

  constructor(config: ConfigService) {
    const get = <K extends keyof Env>(key: K) => config.get(key) as Env[K]
    this.env = {
      NODE_ENV: get('NODE_ENV'), PORT: get('PORT'), DATABASE_URL: get('DATABASE_URL'), FRONTEND_ORIGIN: get('FRONTEND_ORIGIN'),
      SESSION_TTL_HOURS: get('SESSION_TTL_HOURS'), REMEMBER_ME_DAYS: get('REMEMBER_ME_DAYS'),
      EMAIL_TRANSPORT: get('EMAIL_TRANSPORT'), SMTP_URL: get('SMTP_URL'), EMAIL_FROM: get('EMAIL_FROM'),
      SWAGGER_ENABLED: get('SWAGGER_ENABLED'), RATE_LIMIT_AUTH: get('RATE_LIMIT_AUTH'), RATE_LIMIT_EMAIL: get('RATE_LIMIT_EMAIL'), RATE_LIMIT_IMPORT: get('RATE_LIMIT_IMPORT'),
      ADMISSION_IMPORT_COLUMN_ALIASES: get('ADMISSION_IMPORT_COLUMN_ALIASES') ?? {},
    }
    rateLimits.auth = this.env.RATE_LIMIT_AUTH
    rateLimits.email = this.env.RATE_LIMIT_EMAIL
    rateLimits.imports = this.env.RATE_LIMIT_IMPORT
  }

  get isProduction() { return this.env.NODE_ENV === 'production' }
  get frontendOrigin() { return this.env.FRONTEND_ORIGIN.replace(/\/$/, '') }
  get swaggerEnabled() { return this.env.SWAGGER_ENABLED ?? !this.isProduction }
}
