import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  database: {
    reachable: boolean;
    latencyMs: number | null;
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reports liveness together with a real database round-trip, so a
   * green health check proves the API can actually serve requests
   * rather than merely that the process is running.
   */
  async check(): Promise<HealthReport> {
    const startedAt = Date.now();
    let reachable = false;
    let latencyMs: number | null = null;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      reachable = true;
      latencyMs = Date.now() - startedAt;
    } catch {
      reachable = false;
    }

    return {
      status: reachable ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      database: { reachable, latencyMs },
      timestamp: new Date().toISOString(),
    };
  }
}
