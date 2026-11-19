import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { ConfirmActivityDto } from './dto/confirm-activity.dto';
import type { ActivityHistoryItemView, ConfirmActivityView } from './types/activity.types';

/**
 * Assisted activities: what the assistant guided someone through.
 *
 * THE DISTINCTION THIS CLASS EXISTS TO HOLD. A row here is a confirmed
 * intention, and at most a finished set of instructions. It is never
 * evidence that money moved. This system has no payment execution and
 * cannot observe a counter transaction, so no method here reports
 * success of a payment, and GUIDANCE_COMPLETED must never be read as
 * one.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  private readonly maxAmountMinor: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.maxAmountMinor = config.get<number>('ACTIVITY_MAX_AMOUNT_MINOR', 1_000_000);
  }

  private async loadOwn(userId: string, activityId: string) {
    const activity = await this.prisma.assistedActivity.findFirst({
      where: { id: activityId, userId },
      include: { payee: true },
    });

    if (!activity) {
      throw new ForbiddenException('That activity is no longer available.');
    }

    return activity;
  }

  /** What the review screen shows, by id, after a refresh or a back button. */
  async review(userId: string, activityId: string) {
    const activity = await this.loadOwn(userId, activityId);

    return {
      activityId: activity.id,
      status: activity.status,
      review: {
        kind: activity.kind,
        // An activity's own provenance is itself: it records assistance,
        // never a verified transaction.
        provenance: 'ASSISTED_ACTIVITY' as const,
        isBankVerified: false,
        payee: activity.payee
          ? {
              displayName: activity.payee.displayName,
              fullName: activity.payee.fullName,
              accountLast4: activity.payee.accountLast4,
              trust: activity.payee.trust,
            }
          : null,
        amountMinor: activity.amountMinor,
        currency: activity.currency,
      },
    };
  }

  /**
   * The customer has reviewed the details and agreed to go on.
   *
   * Idempotent: confirming twice returns the same activity rather than
   * opening a second one. That is what makes a double tap, a retry or a
   * refreshed tab harmless.
   *
   * Confirming does NOT pay anyone. It records the customer's choice and
   * hands them to the existing banking assistance.
   */
  async confirm(
    userId: string,
    activityId: string,
    changes: ConfirmActivityDto,
  ): Promise<ConfirmActivityView> {
    const activity = await this.loadOwn(userId, activityId);

    if (activity.status === 'CONFIRMED') {
      return { activityId: activity.id, status: activity.status, handOver: { requestKey: 'PAYMENT' } };
    }

    if (activity.status !== 'STARTED') {
      throw new ConflictException('That activity has already finished.');
    }

    if (changes.amountMinor !== undefined && changes.amountMinor > this.maxAmountMinor) {
      throw new BadRequestException('That amount is higher than this service allows.');
    }

    let payeeId = activity.payeeId;

    if (changes.payeeId !== undefined && changes.payeeId !== activity.payeeId) {
      // Scoped by userId, so an id from anywhere else resolves to
      // nothing rather than to another customer's beneficiary.
      const payee = await this.prisma.payee.findFirst({
        where: { id: changes.payeeId, userId },
        select: { id: true },
      });

      if (!payee) {
        throw new ForbiddenException('That payee is not available.');
      }

      payeeId = payee.id;
    }

    // A second confirmation of the same thing, moments apart, is a retry
    // rather than a second intention.
    const recent = await this.prisma.assistedActivity.findFirst({
      where: {
        userId,
        payeeId,
        kind: activity.kind,
        status: 'CONFIRMED',
        amountMinor: changes.amountMinor ?? activity.amountMinor,
        confirmedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
      select: { id: true, status: true },
    });

    if (recent) {
      await this.prisma.assistedActivity.update({
        where: { id: activity.id },
        data: { status: 'ABANDONED' },
      });

      return { activityId: recent.id, status: recent.status, handOver: { requestKey: 'PAYMENT' } };
    }

    const confirmed = await this.prisma.assistedActivity.update({
      where: { id: activity.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        payeeId,
        amountMinor: changes.amountMinor ?? activity.amountMinor,
      },
    });

    return {
      activityId: confirmed.id,
      status: confirmed.status,
      handOver: { requestKey: 'PAYMENT' },
    };
  }

  /**
   * Follows the workflow the engine is already reporting.
   *
   * The snapshot arrives with every turn, so nothing is polled and the
   * engine is not asked anything new. COMPLETED closes the activity as
   * GUIDANCE_COMPLETED -- the instructions finished, which is all it
   * means -- and CANCELLED closes it as cancelled. Neither records a
   * payment.
   *
   * Failures are swallowed on purpose: the customer's reply is already
   * on screen, and losing it to a bookkeeping error would be the worse
   * outcome.
   */
  async followWorkflow(
    userId: string,
    sessionId: string,
    workflow: { name: string | null; state: string | null },
  ): Promise<void> {
    const status =
      workflow.state === 'completed'
        ? 'GUIDANCE_COMPLETED'
        : workflow.state === 'cancelled'
          ? 'CANCELLED'
          : null;

    if (!status) return;

    try {
      const result = await this.prisma.assistedActivity.updateMany({
        where: { userId, sessionId, status: 'CONFIRMED' },
        data: {
          status,
          completedAt: status === 'GUIDANCE_COMPLETED' ? new Date() : null,
          workflowName: workflow.name,
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Assisted activity ${status} for session ${sessionId} (workflow=${workflow.name ?? 'unknown'})`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not follow workflow state for session ${sessionId}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }

  /** The customer's own record of what they have been helped with. */
  async history(userId: string): Promise<ActivityHistoryItemView[]> {
    const rows = await this.prisma.assistedActivity.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      include: { payee: { select: { displayName: true, accountLast4: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      payee: row.payee
        ? { displayName: row.payee.displayName, accountLast4: row.payee.accountLast4 }
        : null,
      amountMinor: row.amountMinor,
      currency: row.currency,
      occurredAt: row.occurredAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    }));
  }

  /**
   * Forget everything.
   *
   * A real delete, not a flag: offers and activities go, and the payees
   * that only existed because the customer told us about them go with
   * them. Seeded demonstration payees are left, because they belong to
   * the demonstration rather than to the customer.
   */
  async forget(userId: string): Promise<{ deleted: number }> {
    const [offers, activities] = await this.prisma.$transaction([
      this.prisma.suggestionOffer.deleteMany({ where: { userId } }),
      this.prisma.assistedActivity.deleteMany({ where: { userId } }),
      this.prisma.payee.deleteMany({ where: { userId, trust: 'CUSTOMER_PROVIDED' } }),
    ]);

    return { deleted: offers.count + activities.count };
  }
}
