import { api } from './client';
import type { ContinueSuggestion, SuggestionList } from '@/types/suggestions';

/**
 * Remembered payments for the current visit.
 *
 * `continue` sends no body on purpose: who is being paid, and how much,
 * are read back from the server's own offer row, so nothing the page
 * could be tricked into holding can name a destination.
 */
export const suggestionsApi = {
  list: (sessionId: string, signal?: AbortSignal) =>
    api.get<SuggestionList>(
      `/assistant/suggestions?sessionId=${encodeURIComponent(sessionId)}`,
      signal,
    ),

  continue: (offerId: string, signal?: AbortSignal) =>
    api.post<ContinueSuggestion>(
      `/assistant/suggestions/${encodeURIComponent(offerId)}/continue`,
      undefined,
      signal,
    ),

  decline: (offerId: string, signal?: AbortSignal) =>
    api.post<void>(
      `/assistant/suggestions/${encodeURIComponent(offerId)}/decline`,
      undefined,
      signal,
    ),
};
