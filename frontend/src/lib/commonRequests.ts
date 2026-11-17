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
 * True only for one of the requests above.
 *
 * Navigation state can be written by anything running on the page, so a
 * request handed over that way is sent only if it is one of these.
 */
export function isCommonRequest(value: unknown): value is string {
  return typeof value === 'string' && COMMON_REQUESTS.some((item) => item.request === value);
}

/** The common request whose workflow the engine reports, or null. */
export function requestForWorkflow(name: string | null | undefined): CommonRequest | null {
  if (!name) return null;

  const key = workflowKey(name);
  return COMMON_REQUESTS.find((item) => workflowKey(item.workflow) === key) ?? null;
}
