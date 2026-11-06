import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { ApiError } from './api-error.js'

export type RateLimitRule = {
  /** Requests allowed per window per client; a function is read on every request (configurable limits). */
  limit: number | (() => number)
  windowMs: number
}

const RULE_KEY = 'campusguide:rate-limit'
const SKIP_KEY = 'campusguide:rate-limit-skip'
const DEFAULT_RULE: RateLimitRule = { limit: 120, windowMs: 60_000 }

/** Per-route limit (replaces the global default of 120 requests per minute per client). */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RULE_KEY, rule)
export const SkipRateLimit = () => SetMetadata(SKIP_KEY, true)

/**
 * Fixed-window rate limiting per client IP and route, kept in memory. Suitable for a single API instance; a shared
 * store (e.g. Redis) is needed when running several instances.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, { count: number; resetAt: number }>()
  private checks = 0

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(SKIP_KEY, targets)) return true
    const rule = this.reflector.getAllAndOverride<RateLimitRule>(RULE_KEY, targets) ?? DEFAULT_RULE
    const limit = typeof rule.limit === 'function' ? rule.limit() : rule.limit
    const http = context.switchToHttp()
    const request = http.getRequest<Request>()
    const now = Date.now()
    if (++this.checks % 1000 === 0) this.prune(now)

    const key = `${context.getClass().name}.${context.getHandler().name}:${request.ip ?? 'unknown'}`
    const window = this.windows.get(key)
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs })
      return true
    }
    window.count += 1
    if (window.count > limit) {
      http.getResponse<Response>().setHeader('Retry-After', Math.ceil((window.resetAt - now) / 1000))
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many requests. Please wait a few minutes and try again.')
    }
    return true
  }

  private prune(now: number) {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key)
  }
}
