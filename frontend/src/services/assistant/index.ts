import type { AssistantClient } from '@/types/assistant';
import { HttpAssistantClient } from './httpAssistantClient';

/**
 * The assistant implementation the app talks to.
 *
 * This is the single swap point, and it has now been swapped: the mock
 * that carried the UI through earlier phases is gone from production,
 * replaced by the real engine behind the Node API. Nothing else changed
 * -- not the hook, not the components, not the contract -- which is what
 * the seam existed to make possible.
 *
 * MockAssistantClient is still exported for tests and for demonstrating
 * the UI without the Python service running.
 */
export const assistantClient: AssistantClient = new HttpAssistantClient();

export { HttpAssistantClient } from './httpAssistantClient';
export { MockAssistantClient } from './mockAssistantClient';
export type { AssistantClient };
