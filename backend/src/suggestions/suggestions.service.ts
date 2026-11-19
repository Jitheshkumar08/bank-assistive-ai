import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Payee, SuggestionOffer } from '@prisma/client';
import { isEnabled } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { analyseLastPayment } from './detectors/last-payment.detector';
import { analyseRecurringToday } from './detectors/recurring-today.detector';
import {
  DAY_MS,
  RECURRING_LOOKBACK_DAYS,
  type LastPaymentAnalysis,
  type PaymentHistoryItem,
  type RecurringAnalysis,
  type SuggestionCandidate,
} from './detectors/types';
import {
  PAYMENT_HISTORY_SOURCES,
  type PaymentHistorySource,
} from './history/history-source.interface';
import type {
  ContinueSuggestionView,
  SuggestionListView,
  SuggestionPayeeView,
  SuggestionView,
} from './types/suggestions.types';

/** Never more than two, spoken or shown. */
const MAX_SUGGESTIONS = 2;

/** An offer is a moment, not a standing invitation. */
const OFFER_TTL_MINUTES = 15;

/** Declined twice is an answer. */
const DECLINE_LIMIT = 2;
const DECLINE_SUPPRESSION_DAYS = 90;

/** One candidate that survived every rule, with its payee resolved. */
export interface EvaluatedCandidate {
  candidate: SuggestionCandidate;
  payee: Payee;
}

/**
 * Everything the rules concluded for one customer at one moment.
 *
 * `offerable` is what `list()` turns into offers. The rest is the
 * reasoning, which production discards and the testing dashboard
 * reads. Returning both from one call is what keeps the two callers
 * incapable of disagreeing.
 */
export interface SuggestionEvaluation {
  /** Deduped, unsuppressed, payee resolved, capped. In priority order. */
  offerable: EvaluatedCandidate[];
  recurring: RecurringAnalysis;
  last: LastPaymentAnalysis;
  /** Silenced by past refusals rather than by the rules. */
  suppressed: Array<{
    type: SuggestionCandidate['type'];
    payeeId: string;
    declineCount: number;
  }>;
  /** Named a payee that no longer resolves for this customer. */
  unresolvedPayeeIds: string[];
  /** Payments the sources supplied for the window. */
  historyCount: number;
}

@Injectable()
export class SuggestionsService {
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    @Inject(PAYMENT_HISTORY_SOURCES)
    private readonly sources: PaymentHistorySource[],
    config: ConfigService,
  ) {
    this.enabled = isEnabled(config.get<string>('SUGGESTIONS_ENABLED'));
  }

  /**
   * The same ownership rule the assistant uses: a customer can only ever
   * act inside their own open visit, and a wrong id is indistinguishable
   * from someone else's.
   */
  private async resolveSession(userId: string, sessionId: string) {
    const active = await this.sessions.findActive(userId);

    if (!active || active.id !== sessionId) {
      throw new ForbiddenException('That session is no longer available. Please scan again.');
    }

    return active;
  }

  private async gatherHistory(userId: string, now: Date): Promise<PaymentHistoryItem[]> {
    const since = new Date(now.getTime() - RECURRING_LOOKBACK_DAYS * DAY_MS);
    const batches = await Promise.all(
      this.sources.map((source) => source.paymentsFor(userId, since)),
    );

    return batches.flat();
  }

  /**
   * How many times this exact suggestion has been refused recently.
   * Two is an answer, and `DECLINE_LIMIT` is what reads it that way.
   *
   * `now` is a parameter rather than the clock so the window is
   * measured from whichever moment is being evaluated. Production
   * passes the real time; a simulated evaluation stays self-consistent
   * instead of mixing a pretend present with a real ninety days.
   */
  private async declineCount(
    userId: string,
    candidate: SuggestionCandidate,
    now: Date,
  ): Promise<number> {
    const since = new Date(now.getTime() - DECLINE_SUPPRESSION_DAYS * DAY_MS);

    return this.prisma.suggestionOffer.count({
      where: {
        userId,
        payeeId: candidate.payeeId,
        type: candidate.type,
        outcome: 'DECLINED',
        respondedAt: { gte: since },
      },
    });
  }

  private payeeView(payee: Payee): SuggestionPayeeView {
    return {
      displayName: payee.displayName,
      fullName: payee.fullName,
      accountLast4: payee.accountLast4,
      trust: payee.trust,
    };
  }

  private suggestionView(
    offer: SuggestionOffer,
    candidate: SuggestionCandidate,
    payee: Payee,
  ): SuggestionView {
    return {
      id: offer.id,
      type: candidate.type,
      kind: 'PAYMENT_GUIDANCE',
      provenance: candidate.provenance,
      // Nothing this version can write is a bank record.
      isBankVerified: candidate.provenance === 'BANK_VERIFIED',
      payee: this.payeeView(payee),
      amountMinor: candidate.amountMinor,
      currency: 'INR',
      lastOccurredAt: candidate.lastOccurredAt.toISOString(),
      occurrenceCount: candidate.type === 'RECURRING_TODAY' ? candidate.occurrenceCount : null,
      usualDayOfMonth: candidate.type === 'RECURRING_TODAY' ? candidate.usualDayOfMonth : null,
    };
  }

  /**
   * Applies every rule and WRITES NOTHING.
   *
   * This is the whole of the decision: gather the history, ask both
   * detectors, drop a duplicate payee, drop what has been refused
   * twice, resolve each payee against this customer, and stop at two.
   *
   * It takes `now` rather than reading the clock, which is what lets a
   * testing dashboard evaluate another date without a clock
   * abstraction and without any chance of reaching a real visit. It
   * creates no offer and touches no session, so calling it is always
   * safe.
   */
  async evaluate(userId: string, now: Date): Promise<SuggestionEvaluation> {
    const history = await this.gatherHistory(userId, now);

    const recurring = analyseRecurringToday(history, now);
    const last = analyseLastPayment(history, now);

    // Recurring first: it is the more specific claim, and it is about
    // today. If both point at the same payee it is one suggestion, not
    // two ways of saying the same thing.
    const candidates: SuggestionCandidate[] = [];

    if (recurring.candidate) candidates.push(recurring.candidate);
    if (last.candidate && last.candidate.payeeId !== recurring.candidate?.payeeId) {
      candidates.push(last.candidate);
    }

    const offerable: EvaluatedCandidate[] = [];
    const suppressed: SuggestionEvaluation['suppressed'] = [];
    const unresolvedPayeeIds: string[] = [];

    for (const candidate of candidates) {
      if (offerable.length >= MAX_SUGGESTIONS) break;

      const declineCount = await this.declineCount(userId, candidate, now);

      if (declineCount >= DECLINE_LIMIT) {
        suppressed.push({ type: candidate.type, payeeId: candidate.payeeId, declineCount });
        continue;
      }

      // Scoped by userId: a payee id from anywhere else resolves to
      // nothing rather than to someone else's beneficiary.
      const payee = await this.prisma.payee.findFirst({
        where: { id: candidate.payeeId, userId },
      });

      if (!payee) {
        unresolvedPayeeIds.push(candidate.payeeId);
        continue;
      }

      offerable.push({ candidate, payee });
    }

    return {
      offerable,
      recurring,
      last,
      suppressed,
      unresolvedPayeeIds,
      historyCount: history.length,
    };
  }

  /**
   * The remembered payments for this visit: at most two, strongest
   * first.
   *
   * The rules live in `evaluate()`; this adds the two things only a
   * real visit may do -- check it is a real visit, and record each
   * offer so that accepting one can be trusted later.
   *
   * Every refusal returns an empty list rather than an error. A welcome
   * screen that cannot think of anything to offer is not a failure, and
   * must look exactly like a welcome screen for someone with no
   * history at all.
   */
  async list(userId: string, sessionId: string): Promise<SuggestionListView> {
    const visit = await this.resolveSession(userId, sessionId);

    if (!this.enabled) return { suggestions: [] };

    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { suggestionsEnabled: true },
    });

    if (!account?.suggestionsEnabled) return { suggestions: [] };

    const now = new Date();
    const { offerable } = await this.evaluate(userId, now);

    const expiresAt = new Date(now.getTime() + OFFER_TTL_MINUTES * 60 * 1000);
    const views: SuggestionView[] = [];

    for (const { candidate, payee } of offerable) {
      const offer = await this.prisma.suggestionOffer.create({
        data: {
          userId,
          sessionId: visit.id,
          type: candidate.type,
          provenance: candidate.provenance,
          kind: 'PAYMENT_GUIDANCE',
          payeeId: payee.id,
          amountMinor: candidate.amountMinor,
          expiresAt,
        },
      });

      views.push(this.suggestionView(offer, candidate, payee));
    }

    return { suggestions: views };
  }

  private async loadOwnOffer(userId: string, offerId: string) {
    const offer = await this.prisma.suggestionOffer.findFirst({
      where: { id: offerId, userId },
      include: { payee: true },
    });

    if (!offer) {
      // Same answer whether it belongs to someone else or never
      // existed, so an id cannot be probed.
      throw new ForbiddenException('That suggestion is no longer available.');
    }

    return offer;
  }

  /**
   * Accepts a suggestion and opens an activity for review.
   *
   * The request body is empty by design. Who is being paid, and how
   * much, are read back from this server's own offer row -- never from
   * the browser -- so a tampered client cannot name a destination.
   *
   * Nothing here moves money, and accepting is not confirming: it opens
   * a review screen the customer still has to agree with.
   */
  async continueOffer(userId: string, offerId: string): Promise<ContinueSuggestionView> {
    const offer = await this.loadOwnOffer(userId, offerId);

    if (offer.expiresAt.getTime() < Date.now()) {
      await this.prisma.suggestionOffer.update({
        where: { id: offer.id },
        data: { outcome: 'EXPIRED', respondedAt: new Date() },
      });

      throw new HttpException('That suggestion has expired. Please start again.', HttpStatus.GONE);
    }

    if (offer.outcome !== 'SHOWN') {
      throw new HttpException(
        'That suggestion has already been answered.',
        HttpStatus.GONE,
      );
    }

    if (!offer.payee) {
      throw new UnprocessableEntityException('That payee is no longer available.');
    }

    // The already-paid guard, re-checked at the moment of acceptance.
    // The list may have been drawn minutes ago, and the point of this
    // card is that the payment has NOT been made yet.
    if (offer.type === 'RECURRING_TODAY') {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const history = await this.gatherHistory(userId, now);

      const paidThisCycle = history.some(
        (item) =>
          item.payeeId === offer.payeeId && item.occurredAt.getTime() >= monthStart.getTime(),
      );

      if (paidThisCycle) {
        await this.prisma.suggestionOffer.update({
          where: { id: offer.id },
          data: { outcome: 'SUPERSEDED', respondedAt: now },
        });

        throw new ConflictException('That payment has already been made this month.');
      }
    }

    const visit = await this.sessions.findActive(userId);

    const activity = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assistedActivity.create({
        data: {
          userId,
          payeeId: offer.payeeId,
          sessionId: visit?.id ?? null,
          branchId: visit?.branch?.id ?? null,
          kind: 'PAYMENT_GUIDANCE',
          status: 'STARTED',
          amountMinor: offer.amountMinor,
          occurredAt: new Date(),
        },
      });

      await tx.suggestionOffer.update({
        where: { id: offer.id },
        data: { outcome: 'ACCEPTED', respondedAt: new Date() },
      });

      return created;
    });

    return {
      activityId: activity.id,
      review: {
        kind: 'PAYMENT_GUIDANCE',
        provenance: offer.provenance,
        isBankVerified: offer.provenance === 'BANK_VERIFIED',
        payee: this.payeeView(offer.payee),
        amountMinor: activity.amountMinor,
        currency: activity.currency,
      },
    };
  }

  /** "Not now." Recorded, because two of them means stop asking. */
  async decline(userId: string, offerId: string): Promise<void> {
    const offer = await this.loadOwnOffer(userId, offerId);

    if (offer.outcome !== 'SHOWN') return;

    await this.prisma.suggestionOffer.update({
      where: { id: offer.id },
      data: { outcome: 'DECLINED', respondedAt: new Date() },
    });
  }
}
