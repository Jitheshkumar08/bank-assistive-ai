import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversation } from '@/context/useConversation';
import { ASSISTANT_PATH, assistantRouteState } from '@/lib/assistantRoute';
import { requestForWorkflow } from '@/lib/commonRequests';

/**
 * Opens the assistant once a spoken request starts one of the common
 * services -- the voice equivalent of tapping that service's shortcut.
 *
 * The engine decides the intent, never this hook: it acts only on the
 * workflow a reply reports as active. An ambiguous request comes back as a
 * clarifying question with no workflow, and a general question as an
 * answer with none, so both stay on this screen exactly as before.
 *
 * Driven by the reply announcement rather than the conversation's state,
 * so arriving here with a workflow already running -- coming Back from the
 * assistant -- does not bounce the customer straight back out.
 *
 * The request is not handed over: it has already reached the assistant,
 * which has already started the workflow. The assistant page reads it from
 * the shared conversation, along with the visit, branch and language.
 */
export function useOpenAssistantOnVoiceService(): void {
  const { subscribeToReplies } = useConversation();
  const navigate = useNavigate();
  // One navigation per visit to this screen, however many replies arrive.
  const openedRef = useRef(false);

  useEffect(
    () =>
      subscribeToReplies(({ input, workflow }) => {
        if (openedRef.current || input !== 'voice') return;
        if (workflow?.state !== 'active' || !requestForWorkflow(workflow.name)) return;

        openedRef.current = true;
        navigate(ASSISTANT_PATH, { state: assistantRouteState() });
      }),
    [subscribeToReplies, navigate],
  );
}
