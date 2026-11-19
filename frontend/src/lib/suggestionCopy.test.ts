import { describe, expect, it } from 'vitest';
import {
  composeSuggestionSpeech,
  formatAmount,
  formatDayOfMonth,
  spokenWayOut,
  suggestionCopy,
} from './suggestionCopy';
import type { Suggestion } from '@/types/suggestions';

/**
 * What the assistant may say out loud about a remembered payment.
 *
 * The rule under test is the privacy one: a customer stands at a
 * counter with strangers beside them, so a figure must never be spoken.
 * Not the amount, not the account, not even the date as digits.
 *
 * The second rule is honesty: a seeded demonstration record must be
 * announced as one, and never described as verified.
 */

const LANGUAGES = ['en', 'kn', 'hi'] as const;

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'offer-1',
    type: 'LAST_PAYMENT',
    kind: 'PAYMENT_GUIDANCE',
    provenance: 'DEMO_HISTORY',
    isBankVerified: false,
    payee: {
      displayName: 'Rahul',
      fullName: 'Rahul Shetty',
      accountLast4: '4821',
      trust: 'DEMO_SEEDED',
    },
    amountMinor: 500_000,
    currency: 'INR',
    lastOccurredAt: '2026-11-11T06:30:00.000Z',
    occurrenceCount: null,
    usualDayOfMonth: null,
    ...overrides,
  };
}

const recurring = () =>
  suggestion({ type: 'RECURRING_TODAY', occurrenceCount: 4, usualDayOfMonth: 16 });

describe('composeSuggestionSpeech', () => {
  it('says nothing when there is nothing to offer', () => {
    for (const language of LANGUAGES) {
      expect(composeSuggestionSpeech({ language, suggestions: [] })).toBeNull();
    }
  });

  it.each(LANGUAGES)('speaks no figure at all in %s', (language) => {
    const spoken = composeSuggestionSpeech({
      language,
      suggestions: [recurring(), suggestion()],
    });

    expect(spoken).not.toBeNull();
    // No amount, no account digits, no date as a number.
    expect(spoken).not.toMatch(/\d/);
    expect(spoken).not.toContain('4821');
    expect(spoken).not.toContain('5000');
  });

  it.each(LANGUAGES)('never speaks a full name in %s', (language) => {
    const spoken = composeSuggestionSpeech({ language, suggestions: [suggestion()] });

    expect(spoken).toContain('Rahul');
    expect(spoken).not.toContain('Rahul Shetty');
  });

  it.each(LANGUAGES)('marks demonstration history once, not per card, in %s', (language) => {
    const marker = {
      en: 'From your demo history:',
      kn: 'ನಿಮ್ಮ ಡೆಮೋ ದಾಖಲೆಯಿಂದ:',
      hi: 'आपके डेमो रिकॉर्ड से:',
    }[language];

    const spoken = composeSuggestionSpeech({
      language,
      suggestions: [recurring(), suggestion()],
    }) as string;

    expect(spoken.split(marker)).toHaveLength(2);
  });

  it('drops the demonstration marker once a record is genuinely bank verified', () => {
    const spoken = composeSuggestionSpeech({
      language: 'en',
      suggestions: [suggestion({ provenance: 'BANK_VERIFIED', isBankVerified: true })],
    });

    expect(spoken).not.toContain('demo');
  });

  it.each(LANGUAGES)('always offers a way out in %s', (language) => {
    const spoken = composeSuggestionSpeech({ language, suggestions: [suggestion()] }) as string;

    expect(spoken.endsWith(spokenWayOut(language))).toBe(true);
  });

  it('falls back to English for a language it does not know', () => {
    const spoken = composeSuggestionSpeech({ language: 'ta', suggestions: [suggestion()] });

    expect(spoken).toContain('your last payment was to Rahul');
  });
});

describe('card copy', () => {
  it.each(LANGUAGES)('never calls a demonstration payee verified in %s', (language) => {
    const copy = suggestionCopy(language);

    expect(copy.demoBadge.length).toBeGreaterThan(0);
    expect(copy.demoExplainer.length).toBeGreaterThan(0);
    // The screen must say the assistant does not move money itself.
    expect(copy.reviewNotice.length).toBeGreaterThan(20);
  });
});

describe('figures, for the screen only', () => {
  it('formats an amount from minor units', () => {
    expect(formatAmount(500_000, 'INR', 'en')).toContain('5,000');
  });

  it('survives a currency code it does not recognise', () => {
    // Intl accepts any three-letter code and prefixes it, so the
    // fallback is for the genuinely malformed ones.
    expect(formatAmount(500_000, 'ZZZ', 'en')).toContain('5,000');
    expect(formatAmount(500_000, 'XX', 'en')).toBe('XX 5000');
  });

  it('writes an English ordinal, and a plain number elsewhere', () => {
    expect(formatDayOfMonth(1, 'en')).toBe('1st');
    expect(formatDayOfMonth(2, 'en')).toBe('2nd');
    expect(formatDayOfMonth(3, 'en')).toBe('3rd');
    expect(formatDayOfMonth(11, 'en')).toBe('11th');
    expect(formatDayOfMonth(16, 'en')).toBe('16th');
    expect(formatDayOfMonth(16, 'kn')).toBe('16');
  });
});
