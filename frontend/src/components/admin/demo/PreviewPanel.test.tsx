import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewPanel, explainLast, explainRecurringFinding } from './PreviewPanel';
import type { DemoPreview, RecurringFinding } from '@/types/adminDemo';

/**
 * The read-only preview.
 *
 * Two things are being pinned down. A silence must be EXPLAINED, with
 * the numbers that caused it -- "no card" alone is no more use than the
 * welcome screen itself. And this component must never present a
 * demonstration record as something a bank confirmed, nor offer any way
 * to act on one: it is a verdict, not an offer.
 */

const THRESHOLDS = {
  lookbackDays: 180,
  minOccurrences: 3,
  clusterToleranceDays: 3,
  todayToleranceDays: 2,
};

function finding(overrides: Partial<RecurringFinding> = {}): RecurringFinding {
  return {
    payeeId: 'payee-rahul',
    displayName: 'Rahul',
    verdict: 'MATCHED',
    paymentCount: 5,
    distinctMonths: 5,
    spread: 0,
    modal: 16,
    fromEnd: false,
    todayValue: 16,
    representativeDates: ['2026-10-16T06:30:00.000Z'],
    ...overrides,
  };
}

function preview(overrides: Partial<DemoPreview> = {}): DemoPreview {
  return {
    customer: {
      userId: 'u1',
      email: 'demo@bankassist.local',
      fullName: 'Demo Customer',
      preferredLanguage: 'en',
      suggestionsEnabled: true,
      demoPaymentCount: 6,
      demoPayeeCount: 2,
      lastDemoPaymentAt: '2026-11-11T06:30:00.000Z',
    },
    evaluatedAt: '2026-11-16T12:00:00.000Z',
    isSimulated: true,
    lookbackStart: '2026-05-20T12:00:00.000Z',
    gating: {
      suggestionsEnabledGlobally: true,
      accountOptedIn: true,
      demoHistoryEnabled: true,
      wouldAppearOnWelcome: true,
    },
    historyTotal: 6,
    historyUsed: 5,
    excludedByStatus: 1,
    excludedByWindow: 0,
    excludedAsFuture: 0,
    recurring: {
      verdict: 'MATCHED',
      thresholds: THRESHOLDS,
      findings: [finding()],
      candidate: {
        type: 'RECURRING_TODAY',
        payeeId: 'payee-rahul',
        displayName: 'Rahul',
        accountLast4: '4821',
        amountMinor: 500_000,
        currency: 'INR',
        lastOccurredAt: '2026-10-16T06:30:00.000Z',
        provenance: 'DEMO_HISTORY',
        isBankVerified: false,
        occurrenceCount: 5,
        usualDayOfMonth: 16,
      },
    },
    last: {
      verdict: 'MATCHED',
      thresholds: { maxAgeDays: 60, minAgeHours: 24 },
      latestOccurredAt: '2026-11-11T06:30:00.000Z',
      latestPayeeId: 'payee-priya',
      latestPayeeName: 'Priya',
      ageHours: 120,
      candidate: {
        type: 'LAST_PAYMENT',
        payeeId: 'payee-priya',
        displayName: 'Priya',
        accountLast4: '7310',
        amountMinor: 125_000,
        currency: 'INR',
        lastOccurredAt: '2026-11-11T06:30:00.000Z',
        provenance: 'DEMO_HISTORY',
        isBankVerified: false,
        occurrenceCount: null,
        usualDayOfMonth: null,
      },
    },
    wouldOffer: [
      {
        type: 'RECURRING_TODAY',
        payeeId: 'payee-rahul',
        displayName: 'Rahul',
        accountLast4: '4821',
        amountMinor: 500_000,
        currency: 'INR',
        lastOccurredAt: '2026-10-16T06:30:00.000Z',
        provenance: 'DEMO_HISTORY',
        isBankVerified: false,
        occurrenceCount: 5,
        usualDayOfMonth: 16,
      },
    ],
    suppressed: [],
    unresolvedPayeeIds: [],
    ...overrides,
  };
}

describe('explainRecurringFinding', () => {
  it('explains a match with the months and the spread', () => {
    const text = explainRecurringFinding(finding(), THRESHOLDS);

    expect(text).toContain('Rahul');
    expect(text).toContain('5 separate months');
  });

  it('explains too few months, and why a busy week is not a habit', () => {
    const text = explainRecurringFinding(
      finding({ verdict: 'DISTINCT_MONTHS_TOO_FEW', paymentCount: 3, distinctMonths: 1 }),
      THRESHOLDS,
    );

    expect(text).toContain('only 1 calendar month');
    expect(text).toContain('3 different months');
    expect(text).toMatch(/busy week/i);
  });

  it('explains a cluster that is too wide, with the measured spread', () => {
    const text = explainRecurringFinding(
      finding({ verdict: 'CLUSTER_TOO_WIDE', spread: 12 }),
      THRESHOLDS,
    );

    expect(text).toContain('12 days');
    expect(text).toContain('3-day tolerance');
  });

  it('explains how far the simulated date is from the usual day', () => {
    const text = explainRecurringFinding(
      finding({ verdict: 'TODAY_OUTSIDE_WINDOW', modal: 16, todayValue: 1 }),
      THRESHOLDS,
    );

    expect(text).toContain('day 16');
    expect(text).toContain('reads 1');
    expect(text).toContain('±2-day window');
  });

  it('describes a month-end habit from the end of the month', () => {
    const text = explainRecurringFinding(
      finding({ verdict: 'TODAY_OUTSIDE_WINDOW', fromEnd: true, modal: 0, todayValue: 5 }),
      THRESHOLDS,
    );

    expect(text).toContain('before month end');
  });

  it('explains the already-paid silence as a duplicate-payment guard', () => {
    const text = explainRecurringFinding(
      finding({ verdict: 'ALREADY_PAID_THIS_MONTH' }),
      THRESHOLDS,
    );

    expect(text).toMatch(/already paid/i);
    expect(text).toMatch(/twice/i);
  });
});

describe('explainLast', () => {
  it('explains the quiet period rather than just refusing', () => {
    const text = explainLast({
      verdict: 'TOO_RECENT',
      thresholds: { maxAgeDays: 60, minAgeHours: 24 },
      latestOccurredAt: '2026-11-16T09:00:00.000Z',
      latestPayeeId: 'payee-priya',
      latestPayeeName: 'Priya',
      ageHours: 3,
      candidate: null,
    });

    expect(text).toContain('3 hours ago');
    expect(text).toContain('24-hour quiet period');
    expect(text).toMatch(/duplicate payment/i);
  });

  it('explains an expired payment in days', () => {
    const text = explainLast({
      verdict: 'TOO_OLD',
      thresholds: { maxAgeDays: 60, minAgeHours: 24 },
      latestOccurredAt: '2026-08-01T09:00:00.000Z',
      latestPayeeId: 'payee-priya',
      latestPayeeName: 'Priya',
      ageHours: 24 * 71,
      candidate: null,
    });

    expect(text).toContain('71 days ago');
    expect(text).toContain('60-day limit');
  });
});

describe('PreviewPanel', () => {
  it('invites a choice before anything is selected', () => {
    render(<PreviewPanel preview={null} loading={false} />);

    expect(screen.getByText(/choose a customer/i)).toBeInTheDocument();
  });

  it('shows both detector results with their verdicts', () => {
    render(<PreviewPanel preview={preview()} loading={false} />);

    expect(screen.getByText(/today's frequent payment/i)).toBeInTheDocument();
    expect(screen.getByText(/last payment/i)).toBeInTheDocument();
    expect(screen.getAllByText(/card offered/i)).toHaveLength(2);
  });

  it('says plainly that nothing is recorded', () => {
    render(<PreviewPanel preview={preview()} loading={false} />);

    expect(screen.getByText(/no suggestion offer is created/i)).toBeInTheDocument();
    expect(screen.getByText(/session is untouched/i)).toBeInTheDocument();
  });

  it('labels a demonstration record and never calls it verified', () => {
    render(<PreviewPanel preview={preview()} loading={false} />);

    expect(screen.getAllByText(/demo history/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/bank verified/i)).not.toBeInTheDocument();
  });

  it('offers no way to act on a suggestion', () => {
    // This is a verdict, not an offer. A Continue button here would be
    // an admin acting on a customer's behalf.
    render(<PreviewPanel preview={preview()} loading={false} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/^continue$/i)).not.toBeInTheDocument();
  });

  it('shows the row arithmetic so the counts on screen add up', () => {
    render(<PreviewPanel preview={preview()} loading={false} />);

    expect(screen.getByText(/rows on file/i)).toBeInTheDocument();
    expect(screen.getByText(/read by detectors/i)).toBeInTheDocument();
    expect(screen.getByText(/not completed/i)).toBeInTheDocument();
  });

  it('warns when the rules offer a card the welcome screen would suppress', () => {
    render(
      <PreviewPanel
        preview={preview({
          gating: {
            suggestionsEnabledGlobally: true,
            accountOptedIn: false,
            demoHistoryEnabled: true,
            wouldAppearOnWelcome: false,
          },
        })}
        loading={false}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/turned remembered payments off/i);
    expect(screen.getByText(/plain welcome greeting/i)).toBeInTheDocument();
  });

  it('reports a suppressed suggestion as a past refusal, not a rule', () => {
    render(
      <PreviewPanel
        preview={preview({
          suppressed: [
            { type: 'LAST_PAYMENT', payeeId: 'payee-priya', displayName: 'Priya', declineCount: 2 },
          ],
        })}
        loading={false}
      />,
    );

    expect(screen.getByText(/silenced by past refusals/i)).toBeInTheDocument();
    expect(screen.getByText(/declined 2 times/i)).toBeInTheDocument();
  });

  it('explains an empty window instead of showing nothing', () => {
    render(
      <PreviewPanel
        preview={preview({
          recurring: { verdict: 'NO_HISTORY_IN_WINDOW', thresholds: THRESHOLDS, findings: [], candidate: null },
        })}
        loading={false}
      />,
    );

    expect(screen.getByText(/no completed payments inside the 180-day window/i)).toBeInTheDocument();
  });
});
