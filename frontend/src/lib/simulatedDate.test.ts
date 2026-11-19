import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  datePresets,
  describeMoment,
  fromDateInputValue,
  localNoonIso,
  shiftDays,
  toDateInputValue,
} from './simulatedDate';

/**
 * The simulated present.
 *
 * Local noon throughout is not a detail: a date pinned to midnight can
 * slide into the previous day once a timezone is applied, which would
 * move an entire payment pattern and make the detector look wrong.
 *
 * February and month ends get the most attention here, because they are
 * precisely what the recurring detector's two readings of a month exist
 * to survive.
 */

describe('localNoonIso', () => {
  it('lands on midday local time, not midnight', () => {
    const iso = localNoonIso(2027, 2, 28);
    const date = new Date(iso);

    expect(date.getHours()).toBe(12);
    expect(date.getDate()).toBe(28);
    expect(date.getMonth()).toBe(1);
    expect(date.getFullYear()).toBe(2027);
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 2, 28],
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('knows %i-%i has %i days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});

describe('the date input round trip', () => {
  it('survives a round trip on the same calendar day', () => {
    const iso = localNoonIso(2026, 11, 17);

    expect(toDateInputValue(iso)).toBe('2026-11-17');
    expect(fromDateInputValue('2026-11-17')).toBe(iso);
  });

  it('pads single-digit months and days', () => {
    expect(toDateInputValue(localNoonIso(2027, 3, 5))).toBe('2027-03-05');
  });

  it('refuses a day that does not exist in that month', () => {
    // 30 February is the kind of thing a date input can emit when typed.
    expect(fromDateInputValue('2026-02-30')).toBeNull();
    expect(fromDateInputValue('2026-13-01')).toBeNull();
    expect(fromDateInputValue('2026-00-10')).toBeNull();
  });

  it('accepts 29 February only in a leap year', () => {
    expect(fromDateInputValue('2028-02-29')).not.toBeNull();
    expect(fromDateInputValue('2027-02-29')).toBeNull();
  });

  it('refuses anything that is not a date at all', () => {
    expect(fromDateInputValue('')).toBeNull();
    expect(fromDateInputValue('tomorrow')).toBeNull();
    expect(toDateInputValue('not-a-date')).toBe('');
  });
});

describe('shiftDays', () => {
  it('steps one day at a time and stays at noon', () => {
    const next = shiftDays(localNoonIso(2026, 11, 17), 1);

    expect(toDateInputValue(next)).toBe('2026-11-18');
    expect(new Date(next).getHours()).toBe(12);
  });

  it('crosses a month boundary backwards', () => {
    expect(toDateInputValue(shiftDays(localNoonIso(2026, 3, 1), -1))).toBe('2026-02-28');
  });

  it('crosses a leap day', () => {
    expect(toDateInputValue(shiftDays(localNoonIso(2028, 3, 1), -1))).toBe('2028-02-29');
  });

  it('crosses a year boundary', () => {
    expect(toDateInputValue(shiftDays(localNoonIso(2026, 12, 31), 1))).toBe('2027-01-01');
  });
});

describe('datePresets', () => {
  it('offers the real present as an option that stops simulating', () => {
    const [first] = datePresets(new Date(2026, 10, 17, 12));

    expect(first.iso).toBeNull();
    expect(first.label).toMatch(/real/i);
  });

  it('offers the 1st, the 15th and the actual last day of the month', () => {
    const presets = datePresets(new Date(2026, 10, 17, 12));
    const byKey = new Map(presets.map((preset) => [preset.key, preset]));

    expect(toDateInputValue(byKey.get('first')!.iso!)).toBe('2026-11-01');
    expect(toDateInputValue(byKey.get('fifteenth')!.iso!)).toBe('2026-11-15');
    // November has 30 days, not 31.
    expect(toDateInputValue(byKey.get('last')!.iso!)).toBe('2026-11-30');
    expect(byKey.get('last')!.label).toContain('30');
  });

  it('uses February of this year while February is still ahead', () => {
    const presets = datePresets(new Date(2026, 0, 10, 12));
    const february = presets.find((preset) => preset.key === 'february')!;

    expect(toDateInputValue(february.iso!)).toBe('2026-02-28');
  });

  it('moves to next February once this one has passed', () => {
    const presets = datePresets(new Date(2027, 10, 17, 12));
    const february = presets.find((preset) => preset.key === 'february')!;

    // 2028 is a leap year, so the awkward 29th is what gets offered.
    expect(toDateInputValue(february.iso!)).toBe('2028-02-29');
    expect(february.hint).toMatch(/leap/i);
  });
});

describe('describeMoment', () => {
  it('says when a date is simulated', () => {
    expect(describeMoment(localNoonIso(2026, 11, 17), true)).toContain('simulated');
    expect(describeMoment(localNoonIso(2026, 11, 17), false)).toContain('now');
  });

  it('does not throw on an unreadable date', () => {
    expect(describeMoment('nonsense', true)).toBe('an unreadable date');
  });
});
