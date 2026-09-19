/**
 * The requests most people come to a branch for.
 *
 * One list, so the shortcuts on the welcome screen and the suggestions
 * in an empty conversation always offer the same things, worded the same
 * way. Each request is sent exactly as a typed message would be.
 */
export interface CommonRequest {
  id: 'deposit' | 'withdraw' | 'loan';
  /** Short enough for a tile. */
  label: string;
  /** What is sent to the assistant, in the customer's own voice. */
  request: string;
}

export const COMMON_REQUESTS: readonly CommonRequest[] = [
  { id: 'deposit', label: 'Deposit money', request: 'I want to deposit money' },
  { id: 'withdraw', label: 'Withdraw money', request: 'I want to withdraw money' },
  { id: 'loan', label: 'Apply for a loan', request: 'How do I apply for a loan?' },
];

/**
 * True only for one of the requests above.
 *
 * Navigation state can be written by anything running on the page, so a
 * request handed over that way is sent only if it is one of these.
 */
export function isCommonRequest(value: unknown): value is string {
  return typeof value === 'string' && COMMON_REQUESTS.some((item) => item.request === value);
}
