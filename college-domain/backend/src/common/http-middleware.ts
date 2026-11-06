import { HttpStatus, Logger } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'

type RequestWithId = Request & { id?: string }

/** Adds a request id (echoed as X-Request-Id) and logs method, path, status and duration — never bodies or headers. */
export function requestContext(logger = new Logger('HTTP')) {
  return (request: RequestWithId, response: Response, next: NextFunction) => {
    request.id = randomUUID()
    response.setHeader('X-Request-Id', request.id)
    const started = process.hrtime.bigint()
    response.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      logger.log(`${request.method} ${request.path} ${response.statusCode} ${ms.toFixed(1)}ms`)
    })
    next()
  }
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Cross-site request protection for cookie-authenticated APIs: a state-changing request that carries an Origin header
 * must come from the configured frontend. (Session cookies are also SameSite=Strict.)
 */
export function originCheck(allowedOrigin: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin
    if (unsafeMethods.has(request.method) && origin && origin !== allowedOrigin) {
      response.status(HttpStatus.FORBIDDEN).json({
        statusCode: HttpStatus.FORBIDDEN, code: 'FORBIDDEN_ORIGIN', message: 'Requests from this site are not allowed.', requestId: (request as RequestWithId).id ?? 'unknown',
      })
      return
    }
    next()
  }
}
