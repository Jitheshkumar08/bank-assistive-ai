/**
 * Dates for the testing dashboard's simulated present.
 *
 * Everything lands on LOCAL NOON. The detectors read a calendar the way
 * a customer does -- the 1st is the 1st wherever the server is -- and a
 * date pinned to midnight can slide into the previous day once a
 * timezone is applied, which would quietly move a whole pattern.
 *
 * Pure functions, so the awkward cases (February, month ends) are
 * testable without rendering anything.
 */

/** Local noon on the given calendar day, as an ISO instant. */
export function localNoonIso(year: number, month1to12: number, day: number): string {
  return new Date(year, month1to12 - 1, day, 12, 0, 0, 0).toISOString();
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/** `YYYY-MM-DD` for an `<input type="date">`, in local time. */
export function toDateInputValue(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return '';

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/** `YYYY-MM-DD` from the date input back to local noon. Null if unusable. */
export function fromDateInputValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return localNoonIso(year, month, day);
}

/** Moves a simulated date by whole days, staying at local noon. */
export function shiftDays(iso: string, delta: number): string {
  const date = new Date(iso);
  const moved = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, 12, 0, 0, 0);

  return moved.toISOString();
}

export interface DatePreset {
  key: string;
  label: string;
  /** Null means "stop simulating and use the real present". */
  iso: string | null;
  hint: string;
}

/**
 * The cases worth one tap, chosen for what they break rather than for
 * being round numbers.
 *
 * February is the reason the recurring detector reads dates from both
 * ends of the month, so it gets its own button -- and the next February
 * with a 29th, since that is the awkward one.
 */
export function datePresets(reference: Date = new Date()): DatePreset[] {
  const year = reference.getFullYear();
  const month = reference.getMonth() + 1;
  const lastDay = daysInMonth(year, month);

  // The next February, and whether that year has a 29th.
  const februaryYear = month <= 2 ? year : year + 1;
  const februaryLast = daysInMonth(februaryYear, 2);

  return [
    { key: 'now', label: 'Today (real)', iso: null, hint: 'Stop simulating' },
    {
      key: 'first',
      label: '1st',
      iso: localNoonIso(year, month, 1),
      hint: 'Start of this month',
    },
    {
      key: 'fifteenth',
      label: '15th',
      iso: localNoonIso(year, month, 15),
      hint: 'Mid month',
    },
    {
      key: 'last',
      label: `Last day (${lastDay})`,
      iso: localNoonIso(year, month, lastDay),
      hint: 'Month end, read from the end of the month',
    },
    {
      key: 'february',
      label: `${februaryLast} Feb ${februaryYear}`,
      iso: localNoonIso(februaryYear, 2, februaryLast),
      hint: februaryLast === 29 ? 'Leap year month end' : 'Short month end',
    },
  ];
}

/** A plain-language rendering of the moment being evaluated. */
export function describeMoment(iso: string, isSimulated: boolean): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return 'an unreadable date';

  const text = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return isSimulated ? `${text} (simulated)` : `${text} (now)`;
}
