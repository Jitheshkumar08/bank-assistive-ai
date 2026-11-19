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
  /**
   * The engine workflow this request starts, as the engine names it: the
   * intent label ("deposit money"), which its loader resolves to
   * deposit.json. Replies report this name, not the file's.
   */
  workflow: 'deposit money' | 'withdraw money' | 'apply for loan';
}

export const COMMON_REQUESTS: readonly CommonRequest[] = [
  {
    id: 'deposit',
    label: 'Deposit money',
    request: 'I want to deposit money',
    workflow: 'deposit money',
  },
  {
    id: 'withdraw',
    label: 'Withdraw money',
    request: 'I want to withdraw money',
    workflow: 'withdraw money',
  },
  {
    id: 'loan',
    label: 'Apply for a loan',
    request: 'How do I apply for a loan?',
    workflow: 'apply for loan',
  },
];

/**
 * A workflow name reduced to the engine's own identity for it.
 *
 * Mirrors WorkflowLoader.resolve_filename in the language engine: case and
 * a trailing " money" do not matter, and spaces and underscores are the
 * same. "Deposit money", "deposit" and "deposit_money" are one workflow.
 */
function workflowKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ money$/, '')
    .trim()
    .replace(/[\s_]+/g, '_');
}

/**
 * Phrases a remembered-payment card hands over with.
 *
 * Keyed by what the SERVER decided, never by anything typed on the
 * page, and worded in English exactly as the tiles above are: the
 * engine's intent detection is what turns a phrase into a workflow, and
 * these go through the same door as every other request rather than a
 * special one of their own.
 */
export const HAND_OVER_REQUESTS = {
  PAYMENT: 'I want to make a payment',
  DEPOSIT: 'I want to deposit money',
  WITHDRAWAL: 'I want to withdraw money',
  LOAN: 'How do I apply for a loan?',
} as const;

export type HandOverRequestKey = keyof typeof HAND_OVER_REQUESTS;

/**
 * True only for one of the requests above.
 *
 * Navigation state can be written by anything running on the page, so a
 * request handed over that way is sent only if it is one of these --
 * the common tiles, or a phrase the server chose for a remembered
 * payment. Never arbitrary text.
 */
export function isCommonRequest(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  return (
    COMMON_REQUESTS.some((item) => item.request === value) ||
    Object.values(HAND_OVER_REQUESTS).some((phrase) => phrase === value)
  );
}

/** The common request whose workflow the engine reports, or null. */
export function requestForWorkflow(name: string | null | undefined): CommonRequest | null {
  if (!name) return null;

  const key = workflowKey(name);
  return COMMON_REQUESTS.find((item) => workflowKey(item.workflow) === key) ?? null;
}
