import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaymentHistoryItem } from '../detectors/types';
import type { PaymentHistorySource } from './history-source.interface';

/**
 * Payments the assistant guided a customer through.
 *
 * Two filters carry the whole meaning of this source:
 *
 *   PAYMENT_GUIDANCE only. A deposit or a loan enquiry is an assisted
 *   activity, not a payment, and must never produce a remembered
 *   payment suggestion.
 *
 *   GUIDANCE_COMPLETED only. An abandoned or cancelled flow leaves no
 *   trace in anyone's history.
 *
 * Note what this is NOT: evidence that money moved. It records that a
 * set of instructions finished at a branch. That is why its items are
 * stamped ASSISTED_ACTIVITY and never BANK_VERIFIED.
 */
@Injectable()
export class AssistedActivitySource implements PaymentHistorySource {
  readonly provenance = 'ASSISTED_ACTIVITY' as const;

  constructor(private readonly prisma: PrismaService) {}

  async paymentsFor(userId: string, since: Date): Promise<PaymentHistoryItem[]> {
    const rows = await this.prisma.assistedActivity.findMany({
      where: {
        userId,
        kind: 'PAYMENT_GUIDANCE',
        status: 'GUIDANCE_COMPLETED',
        occurredAt: { gte: since },
        payeeId: { not: null },
        amountMinor: { not: null },
      },
      select: { payeeId: true, amountMinor: true, occurredAt: true },
    });

    return rows.map((row) => ({
      payeeId: row.payeeId as string,
      amountMinor: row.amountMinor as number,
      occurredAt: row.occurredAt,
      provenance: this.provenance,
    }));
  }
}
