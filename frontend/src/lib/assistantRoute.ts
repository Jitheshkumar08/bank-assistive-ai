import type { CommonRequest } from '@/lib/commonRequests';

/**
 * The one way into the assistant from another screen.
 *
 * Shared by the welcome screen's shortcuts and its voice control, so both
 * open the same route with the same, typed navigation state.
 */
export const ASSISTANT_PATH = '/assistant';

/** Navigation state the assistant page reads on arrival. */
export interface AssistantRouteState {
  /** A common request for the assistant page to send, once. */
  request?: CommonRequest['request'];
}

/**
 * State that opens the assistant.
 *
 * With a request, the assistant page sends it -- a shortcut's tap. Without
 * one, the page simply shows the shared conversation: a spoken request has
 * already reached the assistant and started its workflow, and sending it
 * again would start that workflow twice.
 */
export function assistantRouteState(request?: CommonRequest): AssistantRouteState | null {
  return request ? { request: request.request } : null;
}
