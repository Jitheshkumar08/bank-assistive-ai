import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

interface LoginBody {
  email?: unknown;
}

/**
 * Stricter limit for credential submission.
 *
 * Keyed on client address AND the email being tried, so an attacker
 * spreading guesses across many accounts is limited per account, and a
 * shared branch network is not locked out for everyone because one
 * person mistyped their password.
 *
 * Argon2id already makes each guess expensive. That slows an attacker,
 * but it also means a flood of login attempts is an effective denial of
 * service against our own CPU -- so this guard protects availability as
 * much as it protects credentials.
 */
@Injectable()
export class LoginThrottleGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const body = req.body as LoginBody | undefined;

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : 'no-email';

    return `${address}:${email}`;
  }
}
