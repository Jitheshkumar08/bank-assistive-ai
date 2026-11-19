import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEnabled } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaymentHistoryItem } from '../detectors/types';
import type { PaymentHistorySource } from './history-source.interface';

/**
 * Seeded demonstration payment history.
 *
 * NOT customer data and NOT a bank record. It exists so the remembered
 * payment cards have something to find on a demonstration machine.
 *
 * Disabled unless DEMO_HISTORY_ENABLED is exactly "true", and the
 * default is false, so a deployment that merely forgets to set it reads
 * nothing. When it IS on, that is announced at boot: a system willing
 * to build suggestions out of invented history should say so in its own
 * log rather than leave someone to discover it from a screenshot.
 */
@Injectable()
export class DemoHistorySource implements PaymentHistorySource {
  readonly provenance = 'DEMO_HISTORY' as const;

  private readonly logger = new Logger(DemoHistorySource.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const requested = isEnabled(config.get<string>('DEMO_HISTORY_ENABLED'));
    const isProduction = config.get<string>('NODE_ENV') === 'production';

    // Production cannot turn this on, flag or no flag.
    //
    // "False unless a demonstration environment says otherwise" is not
    // quite enough: it leaves a single stray environment variable
    // between invented history and a real customer being told "you
    // usually pay Rahul". So production refuses outright, and says so
    // loudly rather than failing quietly in a way nobody notices.
    this.enabled = requested && !isProduction;

    if (requested && isProduction) {
      this.logger.error(
        'DEMO_HISTORY_ENABLED=true was REFUSED because NODE_ENV=production. ' +
          'Demonstration payment history is never readable in production. ' +
          'Remove the variable from this environment.',
      );
    } else if (this.enabled) {
      this.logger.warn(
        'DEMO_HISTORY_ENABLED=true: suggestions may be built from seeded demonstration ' +
          'payment history. These are not bank records. Never enable this outside a demo.',
      );
    }
  }

  /**
   * COMPLETED only.
   *
   * A failed or pending payment is not evidence of anything: offering
   * to repeat one would have the assistant inviting a customer to make
   * a payment that never actually went through. Filtered here rather
   * than in a detector, so no amount of history a detector is handed
   * can contain one -- and so the testing dashboard's preview, which
   * reads through this same source, cannot disagree with the welcome
   * screen about which rows count.
   *
   * This mirrors AssistedActivitySource, which has always required
   * GUIDANCE_COMPLETED.
   */
  async paymentsFor(userId: string, since: Date): Promise<PaymentHistoryItem[]> {
    if (!this.enabled) return [];

    const rows = await this.prisma.demoPaymentHistory.findMany({
      where: { userId, occurredAt: { gte: since }, status: 'COMPLETED' },
      select: { payeeId: true, amountMinor: true, occurredAt: true },
    });

    return rows.map((row) => ({ ...row, provenance: this.provenance }));
  }
}
