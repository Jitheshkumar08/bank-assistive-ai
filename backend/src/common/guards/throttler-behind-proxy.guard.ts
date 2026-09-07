import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate-limit key for a request.
 *
 * Behind a reverse proxy every request appears to come from the proxy,
 * so limiting on the socket address alone would throttle all customers
 * as if they were one client. `req.ip` reflects the forwarded client
 * address once Express is told to trust the proxy (see main.ts);
 * without that setting a client could spoof X-Forwarded-For and slip
 * the limit, which is why the two changes belong together.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }
}
