import { api } from './client';
import type { Session } from '@/types/session';

export const sessionsApi = {
  /** Establishes branch context, or moves the existing visit to another branch. */
  establish: (branchCode: string) => api.post<Session>('/sessions', { branchCode }),

  active: (signal?: AbortSignal) => api.get<Session | null>('/sessions/active', signal),

  end: (sessionId: string) => api.post<Session>(`/sessions/${sessionId}/end`),
};
