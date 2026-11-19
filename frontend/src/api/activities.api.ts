import { api } from './client';
import type {
  ActivityHistoryItem,
  ActivityReviewResponse,
  ConfirmActivityResponse,
} from '@/types/suggestions';

/**
 * Assisted activities: the review screen, and the customer's own record.
 *
 * Nothing here moves money. `confirm` records that the customer agreed
 * with the details and wants to go on; the response says which existing
 * request they are handed over with.
 */
export const activitiesApi = {
  review: (activityId: string, signal?: AbortSignal) =>
    api.get<ActivityReviewResponse>(
      `/assistant/activities/${encodeURIComponent(activityId)}`,
      signal,
    ),

  confirm: (activityId: string, changes: { amountMinor?: number }, signal?: AbortSignal) =>
    api.post<ConfirmActivityResponse>(
      `/assistant/activities/${encodeURIComponent(activityId)}/confirm`,
      changes,
      signal,
    ),

  history: (signal?: AbortSignal) => api.get<ActivityHistoryItem[]>('/me/activities', signal),

  forget: (signal?: AbortSignal) => api.delete<{ deleted: number }>('/me/activities', signal),
};
