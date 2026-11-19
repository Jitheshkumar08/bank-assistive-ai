import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DemoPaymentHistory, DemoPaymentStatus, Payee, User } from '@prisma/client';
import { isEnabled } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  DAY_MS,
  RECURRING_LOOKBACK_DAYS,
  type LastPaymentAnalysis,
  type RecurringAnalysis,
  type SuggestionCandidate,
} from '../suggestions/detectors/types';
import {
  SuggestionsService,
  type SuggestionEvaluation,
} from '../suggestions/suggestions.service';
import { buildDemoFixture } from './demo-fixture';
import type { CreateDemoPaymentDto } from './dto/create-demo-payment.dto';
import type { UpdateDemoPaymentDto } from './dto/update-demo-payment.dto';
import type {
  DemoCustomerSummary,
  DemoPayeeView,
  DemoPaymentRow,
  DemoPaymentWritten,
  DemoPaymentsView,
  DemoPreviewView,
  DemoResetView,
  DemoRestoreView,
  IgnoredReason,
  PreviewCandidateView,
  RecurringFindingView,
} from './types/admin-demo.types';

/** A simulated date may wander, but not arbitrarily far. */
const MAX_SIMULATION_YEARS = 3;

/** Below a rupee is not a payment anyone would demonstrate. */
const MIN_DEMO_AMOUNT_MINOR = 100;

@Injectable()
export class AdminDemoService {
  private readonly logger = new Logger(AdminDemoService.name);

  /** All four conditions met. Checked per call, not merely at boot. */
  private readonly enabled: boolean;
  private readonly demoHistoryEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestions: SuggestionsService,
    private readonly config: ConfigService,
  ) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    const dashboard = isEnabled(config.get<string>('DEMO_DASHBOARD_ENABLED'));

    this.demoHistoryEnabled = isEnabled(config.get<string>('DEMO_HISTORY_ENABLED'));

    // Production is refused here as well as by the module never being
    // registered. Belt and braces on purpose: if someone later
    // registers this module unconditionally, it still refuses rather
    // than quietly exposing demo management on a live system.
    this.enabled = dashboard && this.demoHistoryEnabled && !isProduction;

    if (isProduction && dashboard) {
      this.logger.error(
        'DEMO_DASHBOARD_ENABLED=true was REFUSED because NODE_ENV=production. ' +
          'The personalisation testing dashboard is never served in production. ' +
          'Remove the variable from this environment.',
      );
    } else if (this.enabled) {
      this.logger.warn(
        'DEMO_DASHBOARD_ENABLED=true: the personalisation testing dashboard is served ' +
          'at /api/admin/demo for ADMIN accounts. It manages seeded demonstration data ' +
          'only. Never enable this outside development.',
      );
    } else if (dashboard && !this.demoHistoryEnabled) {
      this.logger.warn(
        'DEMO_DASHBOARD_ENABLED=true but DEMO_HISTORY_ENABLED is not "true", so the ' +
          'testing dashboard is OFF. Managing history that no suggestion may read would ' +
          'only mislead. Set both to use it.',
      );
    }
  }

  /**
   * Nothing here exists unless all four conditions hold.
   *
   * Deliberately a 404 rather than a 403: an admin on a system where
   * this is switched off learns that there is no such feature, which is
   * the same answer production gives by not registering the routes.
   */
  private assertAvailable(): void {
    if (!this.enabled) {
      throw new NotFoundException('Not found.');
    }
  }

  /**
   * The moment to evaluate against.
   *
   * Bounded so a typo cannot silently produce a nonsense window --
   * "20267" instead of "2026" would otherwise look like a detector bug
   * rather than a mistyped year.
   */
  private resolveMoment(at: string | undefined): { moment: Date; isSimulated: boolean } {
    if (!at) return { moment: new Date(), isSimulated: false };

    const moment = new Date(at);

    if (Number.isNaN(moment.getTime())) {
      throw new UnprocessableEntityException('That is not a date this dashboard can read.');
    }

    const limit = MAX_SIMULATION_YEARS * 365 * DAY_MS;

    if (Math.abs(moment.getTime() - Date.now()) > limit) {
      throw new UnprocessableEntityException(
        `A simulated date must be within ${MAX_SIMULATION_YEARS} years of today.`,
      );
    }

    return { moment, isSimulated: true };
  }

  /**
   * A customer this dashboard may look at.
   *
   * Customers only. An ADMIN account is never a subject here, so demo
   * management can never be pointed at staff.
   */
  private async loadCustomer(userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'CUSTOMER' },
    });

    if (!user) {
      throw new NotFoundException('No such demo customer.');
    }

    return user;
  }

  private summary(
    user: User,
    counts: { payments: number; payees: number; lastAt: Date | null },
  ): DemoCustomerSummary {
    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      preferredLanguage: user.preferredLanguage,
      suggestionsEnabled: user.suggestionsEnabled,
      demoPaymentCount: counts.payments,
      demoPayeeCount: counts.payees,
      lastDemoPaymentAt: counts.lastAt?.toISOString() ?? null,
    };
  }

  /** Every customer, with how much demonstration history each one has. */
  async listCustomers(): Promise<DemoCustomerSummary[]> {
    this.assertAvailable();

    const users = await this.prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      orderBy: { createdAt: 'asc' },
    });

    const [paymentGroups, payeeGroups] = await Promise.all([
      this.prisma.demoPaymentHistory.groupBy({
        by: ['userId'],
        _count: { _all: true },
        _max: { occurredAt: true },
      }),
      this.prisma.payee.groupBy({
        by: ['userId'],
        where: { trust: 'DEMO_SEEDED' },
        _count: { _all: true },
      }),
    ]);

    const payments = new Map(paymentGroups.map((row) => [row.userId, row]));
    const payees = new Map(payeeGroups.map((row) => [row.userId, row._count._all]));

    return users
      .map((user) =>
        this.summary(user, {
          payments: payments.get(user.id)?._count._all ?? 0,
          payees: payees.get(user.id) ?? 0,
          lastAt: payments.get(user.id)?._max.occurredAt ?? null,
        }),
      )
      // The accounts worth testing on first, then alphabetically.
      .sort(
        (a, b) =>
          b.demoPaymentCount - a.demoPaymentCount || a.email.localeCompare(b.email),
      );
  }

  private async summaryFor(user: User): Promise<DemoCustomerSummary> {
    const [payments, payees] = await Promise.all([
      this.prisma.demoPaymentHistory.aggregate({
        where: { userId: user.id },
        _count: { _all: true },
        _max: { occurredAt: true },
      }),
      this.prisma.payee.count({ where: { userId: user.id, trust: 'DEMO_SEEDED' } }),
    ]);

    return this.summary(user, {
      payments: payments._count._all,
      payees,
      lastAt: payments._max.occurredAt,
    });
  }

  /**
   * Why a row is or is not part of the history the detectors read.
   *
   * These are the three filters that sit between the table and a
   * detector: the status filter in DemoHistorySource, the lookback
   * window, and both detectors ignoring anything dated after `now`.
   */
  private classify(
    row: DemoPaymentHistory,
    moment: Date,
    lookbackStart: Date,
  ): IgnoredReason | null {
    if (row.status !== 'COMPLETED') return 'NOT_COMPLETED';
    if (row.occurredAt.getTime() > moment.getTime()) return 'FUTURE_DATED';
    if (row.occurredAt.getTime() < lookbackStart.getTime()) return 'OUTSIDE_LOOKBACK';

    return null;
  }

  private lookbackStart(moment: Date): Date {
    return new Date(moment.getTime() - RECURRING_LOOKBACK_DAYS * DAY_MS);
  }

  /** One customer's demonstration history, annotated against a moment. */
  async listPayments(userId: string, at: string | undefined): Promise<DemoPaymentsView> {
    this.assertAvailable();

    const user = await this.loadCustomer(userId);
    const { moment, isSimulated } = this.resolveMoment(at);
    const lookbackStart = this.lookbackStart(moment);

    const rows = await this.prisma.demoPaymentHistory.findMany({
      where: { userId },
      include: { payee: true },
      orderBy: { occurredAt: 'desc' },
    });

    const payments: DemoPaymentRow[] = rows.map((row) => {
      const ignoredReason = this.classify(row, moment, lookbackStart);

      return {
        id: row.id,
        payee: this.payeeView(row.payee),
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        occurredAt: row.occurredAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        countsTowardSuggestions: ignoredReason === null,
        ignoredReason,
      };
    });

    return {
      customer: await this.summaryFor(user),
      evaluatedAt: moment.toISOString(),
      isSimulated,
      lookbackStart: lookbackStart.toISOString(),
      payments,
    };
  }

  private candidateView(
    candidate: SuggestionCandidate,
    payee: Payee | undefined,
  ): PreviewCandidateView {
    return {
      type: candidate.type,
      payeeId: candidate.payeeId,
      displayName: payee?.displayName ?? '(unknown payee)',
      accountLast4: payee?.accountLast4 ?? null,
      amountMinor: candidate.amountMinor,
      // INR throughout this version, as the customer's own card is.
      currency: 'INR',
      lastOccurredAt: candidate.lastOccurredAt.toISOString(),
      provenance: candidate.provenance,
      isBankVerified: candidate.provenance === 'BANK_VERIFIED',
      occurrenceCount: candidate.type === 'RECURRING_TODAY' ? candidate.occurrenceCount : null,
      usualDayOfMonth: candidate.type === 'RECURRING_TODAY' ? candidate.usualDayOfMonth : null,
    };
  }

  private findingViews(
    analysis: RecurringAnalysis,
    names: Map<string, Payee>,
  ): RecurringFindingView[] {
    return analysis.findings.map((finding) => ({
      payeeId: finding.payeeId,
      displayName: names.get(finding.payeeId)?.displayName ?? '(unknown payee)',
      verdict: finding.verdict,
      paymentCount: finding.paymentCount,
      distinctMonths: finding.distinctMonths,
      spread: finding.spread,
      modal: finding.modal,
      fromEnd: finding.fromEnd,
      todayValue: finding.todayValue,
      representativeDates: finding.representativeDates.map((date) => date.toISOString()),
    }));
  }

  private lastView(
    analysis: LastPaymentAnalysis,
    names: Map<string, Payee>,
  ): DemoPreviewView['last'] {
    const payeeId = analysis.latestPayeeId;

    return {
      verdict: analysis.verdict,
      thresholds: analysis.thresholds,
      latestOccurredAt: analysis.latestOccurredAt?.toISOString() ?? null,
      latestPayeeId: payeeId,
      latestPayeeName: payeeId ? names.get(payeeId)?.displayName ?? null : null,
      ageHours: analysis.ageHours,
      candidate: analysis.candidate
        ? this.candidateView(analysis.candidate, payeeId ? names.get(payeeId) : undefined)
        : null,
    };
  }

  /**
   * What the personalisation engine would conclude, and why.
   *
   * Reuses SuggestionsService.evaluate() -- the same code path the
   * welcome screen takes -- so the explanation shown here cannot drift
   * from the decision a customer receives. It creates no suggestion
   * offer, reads no session and writes nothing at all.
   */
  async preview(userId: string, at: string | undefined): Promise<DemoPreviewView> {
    this.assertAvailable();

    const user = await this.loadCustomer(userId);
    const { moment, isSimulated } = this.resolveMoment(at);
    const lookbackStart = this.lookbackStart(moment);

    const evaluation: SuggestionEvaluation = await this.suggestions.evaluate(user.id, moment);

    // Names for every payee mentioned anywhere in the evaluation.
    const payeeRows = await this.prisma.payee.findMany({ where: { userId: user.id } });
    const names = new Map(payeeRows.map((payee) => [payee.id, payee]));

    // What the detectors never saw, and why. Counted from the table
    // rather than inferred, so the arithmetic on screen adds up.
    const rows = await this.prisma.demoPaymentHistory.findMany({ where: { userId: user.id } });

    let excludedByStatus = 0;
    let excludedByWindow = 0;
    let excludedAsFuture = 0;

    for (const row of rows) {
      switch (this.classify(row, moment, lookbackStart)) {
        case 'NOT_COMPLETED':
          excludedByStatus += 1;
          break;
        case 'FUTURE_DATED':
          excludedAsFuture += 1;
          break;
        case 'OUTSIDE_LOOKBACK':
          excludedByWindow += 1;
          break;
        default:
          break;
      }
    }

    const wouldOffer = evaluation.offerable.map(({ candidate, payee }) =>
      this.candidateView(candidate, payee),
    );

    const suggestionsEnabledGlobally = isEnabled(
      this.config.get<string>('SUGGESTIONS_ENABLED'),
    );

    return {
      customer: await this.summaryFor(user),
      evaluatedAt: moment.toISOString(),
      isSimulated,
      lookbackStart: lookbackStart.toISOString(),
      gating: {
        suggestionsEnabledGlobally,
        accountOptedIn: user.suggestionsEnabled,
        demoHistoryEnabled: this.demoHistoryEnabled,
        wouldAppearOnWelcome:
          suggestionsEnabledGlobally && user.suggestionsEnabled && wouldOffer.length > 0,
      },
      historyTotal: rows.length,
      historyUsed: evaluation.historyCount,
      excludedByStatus,
      excludedByWindow,
      excludedAsFuture,
      recurring: {
        verdict: evaluation.recurring.verdict,
        thresholds: evaluation.recurring.thresholds,
        findings: this.findingViews(evaluation.recurring, names),
        candidate: evaluation.recurring.candidate
          ? this.candidateView(
              evaluation.recurring.candidate,
              names.get(evaluation.recurring.candidate.payeeId),
            )
          : null,
      },
      last: this.lastView(evaluation.last, names),
      wouldOffer,
      suppressed: evaluation.suppressed.map((item) => ({
        type: item.type,
        payeeId: item.payeeId,
        displayName: names.get(item.payeeId)?.displayName ?? '(unknown payee)',
        declineCount: item.declineCount,
      })),
      unresolvedPayeeIds: evaluation.unresolvedPayeeIds,
    };
  }

  // --- Writes -------------------------------------------------------
  //
  // Everything below touches exactly two tables: demo_payment_history,
  // and payees ONLY to add a DEMO_SEEDED one. Assisted activities,
  // suggestion offers, sessions and accounts are read-only to this
  // module, and no write here creates a payment of any kind -- a
  // demonstration row is a record of something that is pretended to
  // have happened, not an instruction to make it happen.

  private payeeView(payee: Payee): DemoPayeeView {
    return {
      id: payee.id,
      displayName: payee.displayName,
      fullName: payee.fullName,
      accountLast4: payee.accountLast4,
      trust: payee.trust,
    };
  }

  private written(row: DemoPaymentHistory & { payee: Payee }): DemoPaymentWritten {
    return {
      id: row.id,
      payee: this.payeeView(row.payee),
      amountMinor: row.amountMinor,
      currency: row.currency,
      status: row.status,
      occurredAt: row.occurredAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * The same ceiling the customer's own review screen applies.
   *
   * Taken from ACTIVITY_MAX_AMOUNT_MINOR on purpose. A demonstration
   * row above that limit would produce a card that looks perfectly
   * normal, open a review screen, and then be REFUSED at the moment the
   * customer confirms it -- a broken demonstration rather than a useful
   * one. Sharing the limit keeps anything seeded here completable.
   *
   * Both bounds are re-checked here as well as in the DTO, so the
   * service is correct whether or not it is reached through the pipe.
   */
  private assertAmount(amountMinor: number): void {
    if (!Number.isInteger(amountMinor) || amountMinor < MIN_DEMO_AMOUNT_MINOR) {
      throw new UnprocessableEntityException('The amount must be at least ₹1, in whole paise.');
    }

    // Whole rupees. Not a tidiness rule: formatAmount renders with no
    // decimal places, so 4999 paise would appear as "₹50" on the
    // welcome card, on the review screen and in this dashboard while
    // the stored value stayed 4999. Seeding an amount the interface
    // cannot show faithfully would make every screen disagree with the
    // database.
    if (amountMinor % 100 !== 0) {
      throw new UnprocessableEntityException(
        'The amount must be a whole number of rupees — paise are not displayed anywhere.',
      );
    }

    const ceiling = this.config.get<number>('ACTIVITY_MAX_AMOUNT_MINOR', 1_000_000);

    if (amountMinor > ceiling) {
      throw new UnprocessableEntityException(
        `The amount must be at most ₹${Math.floor(ceiling / 100).toLocaleString('en-IN')}, ` +
          'which is the limit the customer review screen also enforces.',
      );
    }
  }

  /**
   * A date for a demonstration payment.
   *
   * Future dates are ALLOWED: the history table marks them
   * FUTURE_DATED and both detectors ignore anything after the moment
   * being evaluated, so "a payment dated next week" is a legitimate
   * thing to demonstrate rather than an error.
   */
  private resolveDate(iso: string): Date {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
      throw new UnprocessableEntityException('That is not a date this dashboard can read.');
    }

    const limit = MAX_SIMULATION_YEARS * 365 * DAY_MS;

    if (Math.abs(date.getTime() - Date.now()) > limit) {
      throw new UnprocessableEntityException(
        `A demonstration payment must be dated within ${MAX_SIMULATION_YEARS} years of today.`,
      );
    }

    return date;
  }

  /**
   * An existing beneficiary this dashboard is allowed to use.
   *
   * THE ISOLATION RULE. `trust: 'DEMO_SEEDED'` is part of the lookup,
   * not a check afterwards, so a payee a real customer entered
   * (CUSTOMER_PROVIDED) or one a bank confirmed (BANK_VERIFIED)
   * resolves to nothing at all. Demonstration history cannot be hung
   * off a genuine beneficiary, and no edit here can reach one.
   */
  private async loadDemoPayee(userId: string, payeeId: string): Promise<Payee> {
    const payee = await this.prisma.payee.findFirst({
      where: { id: payeeId, userId, trust: 'DEMO_SEEDED' },
    });

    if (!payee) {
      throw new UnprocessableEntityException(
        'That payee is not a demonstration beneficiary of this customer.',
      );
    }

    return payee;
  }

  /** Scoped by userId, so a row id from another customer is simply absent. */
  private async loadOwnPayment(userId: string, paymentId: string) {
    const row = await this.prisma.demoPaymentHistory.findFirst({
      where: { id: paymentId, userId },
      include: { payee: true },
    });

    if (!row) {
      throw new NotFoundException('No such demonstration payment.');
    }

    return row;
  }

  private async resolvePayeeForCreate(
    userId: string,
    dto: CreateDemoPaymentDto,
  ): Promise<Payee> {
    const hasExisting = dto.payeeId !== undefined;
    const hasNew = dto.newPayee !== undefined;

    if (hasExisting === hasNew) {
      throw new UnprocessableEntityException(
        'Choose an existing payee or enter a new one — exactly one of the two.',
      );
    }

    if (dto.payeeId !== undefined) {
      return this.loadDemoPayee(userId, dto.payeeId);
    }

    const details = dto.newPayee!;

    return this.prisma.payee.create({
      data: {
        userId,
        displayName: details.displayName,
        fullName: details.fullName ?? null,
        accountLast4: details.accountLast4,
        // Never anything else. A payee created here is demonstration
        // data, and there is no request field that could ask for a
        // trust level that would make it look bank verified.
        trust: 'DEMO_SEEDED',
      },
    });
  }

  async createPayment(
    userId: string,
    dto: CreateDemoPaymentDto,
  ): Promise<DemoPaymentWritten> {
    this.assertAvailable();

    const user = await this.loadCustomer(userId);

    this.assertAmount(dto.amountMinor);

    const occurredAt = this.resolveDate(dto.occurredAt);
    const payee = await this.resolvePayeeForCreate(user.id, dto);

    const row = await this.prisma.demoPaymentHistory.create({
      data: {
        userId: user.id,
        payeeId: payee.id,
        amountMinor: dto.amountMinor,
        // Fixed, never read from the request: INR is the only currency
        // this version supports end to end.
        currency: 'INR',
        status: dto.status,
        occurredAt,
      },
      include: { payee: true },
    });

    this.logger.log(
      `Demonstration payment ${row.id} added for customer ${user.id} (${row.status}).`,
    );

    return this.written(row);
  }

  async updatePayment(
    userId: string,
    paymentId: string,
    dto: UpdateDemoPaymentDto,
  ): Promise<DemoPaymentWritten> {
    this.assertAvailable();

    const user = await this.loadCustomer(userId);
    const existing = await this.loadOwnPayment(user.id, paymentId);

    const data: {
      payeeId?: string;
      amountMinor?: number;
      occurredAt?: Date;
      status?: DemoPaymentStatus;
    } = {};

    if (dto.payeeId !== undefined) {
      const payee = await this.loadDemoPayee(user.id, dto.payeeId);
      data.payeeId = payee.id;
    }

    if (dto.amountMinor !== undefined) {
      this.assertAmount(dto.amountMinor);
      data.amountMinor = dto.amountMinor;
    }

    if (dto.occurredAt !== undefined) {
      data.occurredAt = this.resolveDate(dto.occurredAt);
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    if (Object.keys(data).length === 0) {
      throw new UnprocessableEntityException('Nothing to change.');
    }

    const row = await this.prisma.demoPaymentHistory.update({
      where: { id: existing.id },
      data,
      include: { payee: true },
    });

    this.logger.log(
      `Demonstration payment ${row.id} changed for customer ${user.id} (${row.status}).`,
    );

    return this.written(row);
  }

  /**
   * Removes one demonstration row.
   *
   * The payee is left alone even when its last payment goes: it may be
   * wanted again in a moment, and clearing beneficiaries is what the
   * reset action is for.
   */
  async deletePayment(userId: string, paymentId: string): Promise<void> {
    this.assertAvailable();

    const user = await this.loadCustomer(userId);
    const existing = await this.loadOwnPayment(user.id, paymentId);

    await this.prisma.demoPaymentHistory.delete({ where: { id: existing.id } });

    this.logger.log(
      `Demonstration payment ${existing.id} deleted for customer ${user.id}.`,
    );
  }

  // --- Clearing and restoring ---------------------------------------

  /**
   * Removes a customer's demonstration history.
   *
   * Two tables and no others. Payments go first and payees second, so
   * the deletion is explicit rather than left to a cascade, and
   * `trust: 'DEMO_SEEDED'` is part of the WHERE clause rather than a
   * check beforehand -- a beneficiary the customer entered themselves
   * cannot be reached by this query at all.
   *
   * A DEMO_SEEDED payee that an assisted activity or a suggestion offer
   * still refers to is KEPT and counted. Both of those relations are
   * `onDelete: SetNull`, so deleting such a payee would blank a column
   * in a table this module promises never to write: a branch visit
   * would forget who it was about, and a refusal would stop
   * suppressing. An unused beneficiary row is the cheaper of the two.
   */
  private async clear(userId: string): Promise<Omit<DemoResetView, 'customer'>> {
    const payees = await this.prisma.payee.findMany({
      where: { userId, trust: 'DEMO_SEEDED' },
      select: { id: true, _count: { select: { activities: true, offers: true } } },
    });

    const deletable = payees
      .filter((payee) => payee._count.activities === 0 && payee._count.offers === 0)
      .map((payee) => payee.id);

    // One transaction, so a failure part way through cannot leave
    // payments pointing at beneficiaries that are already gone.
    const [payments, removed] = await this.prisma.$transaction([
      this.prisma.demoPaymentHistory.deleteMany({ where: { userId } }),
      this.prisma.payee.deleteMany({
        where: { userId, trust: 'DEMO_SEEDED', id: { in: deletable } },
      }),
    ]);

    return {
      paymentsDeleted: payments.count,
      payeesDeleted: removed.count,
      payeesRetained: payees.length - deletable.length,
    };
  }

  /** Clears one customer's demonstration history. */
  async resetHistory(userId: string): Promise<DemoResetView> {
    this.assertAvailable();

    const user = await this.loadCustomer(userId);
    const cleared = await this.clear(user.id);

    this.logger.warn(
      `Demonstration history CLEARED for customer ${user.id}: ` +
        `${cleared.paymentsDeleted} payments, ${cleared.payeesDeleted} beneficiaries ` +
        `(${cleared.payeesRetained} kept because something still refers to them).`,
    );

    return { customer: await this.summaryFor(user), ...cleared };
  }

  /**
   * Puts the seeded demonstration history back.
   *
   * The fixture comes from demo-fixture.ts, which is also what
   * prisma/seed.ts writes -- so "restored" means the state a freshly
   * seeded machine starts in, not an approximation of it. Its dates are
   * computed from today, so the monthly habit is due today however long
   * ago the database was created.
   */
  async restoreFixture(userId: string): Promise<DemoRestoreView> {
    this.assertAvailable();

    const user = await this.loadCustomer(userId);
    const fixture = buildDemoFixture();

    // Checked BEFORE anything is deleted. A deployment that lowered
    // ACTIVITY_MAX_AMOUNT_MINOR below a fixture amount would otherwise
    // clear the history and then refuse to write it back, which is the
    // one outcome worse than refusing outright.
    for (const payment of fixture.payments) {
      this.assertAmount(payment.amountMinor);
    }

    const cleared = await this.clear(user.id);

    const payeeIds = new Map<string, string>();
    let payeesCreated = 0;
    let payeesReused = 0;

    for (const payee of fixture.payees) {
      // A beneficiary the clear had to keep is reused rather than
      // duplicated, so restoring twice leaves one Rahul and not two.
      const existing = await this.prisma.payee.findFirst({
        where: {
          userId: user.id,
          trust: 'DEMO_SEEDED',
          displayName: payee.displayName,
          accountLast4: payee.accountLast4,
        },
      });

      if (existing) {
        payeeIds.set(payee.key, existing.id);
        payeesReused += 1;
        continue;
      }

      const created = await this.prisma.payee.create({
        data: {
          userId: user.id,
          displayName: payee.displayName,
          fullName: payee.fullName,
          accountLast4: payee.accountLast4,
          // Never anything else, exactly as createPayment insists.
          trust: 'DEMO_SEEDED',
        },
      });

      payeeIds.set(payee.key, created.id);
      payeesCreated += 1;
    }

    const written = await this.prisma.demoPaymentHistory.createMany({
      data: fixture.payments.map((payment) => {
        const payeeId = payeeIds.get(payment.payeeKey);

        if (!payeeId) {
          throw new UnprocessableEntityException(
            'The demonstration fixture refers to a beneficiary it did not define.',
          );
        }

        return {
          userId: user.id,
          payeeId,
          amountMinor: payment.amountMinor,
          // Fixed, as everywhere else in this module.
          currency: 'INR',
          status: payment.status,
          occurredAt: payment.occurredAt,
        };
      }),
    });

    this.logger.warn(
      `Demonstration history RESTORED for customer ${user.id}: ` +
        `${written.count} payments across ${payeesCreated + payeesReused} beneficiaries ` +
        `(${cleared.paymentsDeleted} payments cleared first).`,
    );

    return {
      customer: await this.summaryFor(user),
      cleared,
      payeesCreated,
      payeesReused,
      paymentsCreated: written.count,
    };
  }
}
