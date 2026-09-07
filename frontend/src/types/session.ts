import type { Branch } from './context';

export type SessionStatus = 'ACTIVE' | 'ENDED';

/**
 * One visit: a signed-in customer, at a branch, from arrival until
 * they explicitly leave.
 *
 * Distinct from the assistant's conversation state. Finishing a banking
 * task does not end a visit -- only signing out does.
 */
export interface Session {
  id: string;
  status: SessionStatus;
  language: string;
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  branch: Pick<Branch, 'id' | 'code' | 'name' | 'city'>;
}
