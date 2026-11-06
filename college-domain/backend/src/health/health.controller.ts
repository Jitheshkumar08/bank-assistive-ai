import { Controller, Get, HttpStatus, Res } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { SkipRateLimit } from '../common/rate-limit.js'
import { PrismaService } from '../prisma/prisma.service.js'

@ApiTags('health')
@Controller('health')
@SkipRateLimit()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and database connectivity' })
  @ApiOkResponse({ schema: { example: { status: 'ok', database: 'ok' } } })
  @ApiServiceUnavailableResponse({ schema: { example: { status: 'degraded', database: 'unavailable' } } })
  async health(@Res({ passthrough: true }) response: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ok', database: 'ok' }
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE)
      return { status: 'degraded', database: 'unavailable' }
    }
  }
}
