import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSISTANCE_INACTIVITY_MS } from '@/lib/assistanceConfig';
import type { MicrophoneStatus } from '@/hooks/useMicrophone';
import type { AssistanceOffer, AssistantClient, WorkflowSnapshot } from '@/types/assistant';
import type { VoiceActivity } from '@/types/voice';

export interface ProactiveAssistanceOptions {
  sessionId: string | null;
  workflow: WorkflowSnapshot | null;
  isSending: boolean;
  ended: boolean;
  /** 'idle' when there is no voice at all. */
  voiceActivity: VoiceActivity;
  micStatus?: MicrophoneStatus | null;
  /**
   * Changes whenever a turn lands -- typically the number of messages. A
   * new turn starts a new quiet spell.
   */
  turnKey: number;
  client: Pick<AssistantClient, 'requestAssistance'>;
  /** Called once per offer, e.g. to read it aloud. */
  onOffer?: (offer: AssistanceOffer) => void;
  thresholdMs?: number;
}

export interface ProactiveAssistance {
  /** The latest offer, shown until the next turn or workflow change. */
  offer: AssistanceOffer | null;
  /**
   * The customer did something -- typed, tapped, pressed a control. Starts
   * a new quiet spell, so one offer can follow it.
   */
  noteActivity: () => void;
  dismiss: () => void;
}

/**
 * Offers help, once, when a customer has been quiet on a step.
 *
 * WHEN. Only while a workflow is ACTIVE on a step and the customer is not
 * doing anything: not sending, not speaking or being recorded, not
 * listening to a reply. The quiet spell is measured from the moment all of
 * that became true, so the assistant finishing a sentence starts the clock,
 * not the turn before it.
 *
 * HOW OFTEN. At most one offer per quiet spell. After an offer -- or an
 * answer of "no offer" -- nothing more is asked until the customer does
 * something or the workflow moves. There is no polling and no retry.
 *
 * WHAT. Decided by the assistant from its own state (service/assistance.py
 * in the engine): it refuses while a confirmation or a switch question is
 * waiting, and words the offer for the step's field in the visit's
 * language. Nothing here sends a turn: silence never confirms, completes or
 * moves anything.
 *
 * Every timer and request is cancelled when the spell ends, the visit
 * changes or ends, or the component unmounts.
 */
export function useProactiveAssistance({
  sessionId,
  workflow,
  isSending,
  ended,
  voiceActivity,
  micStatus,
  turnKey,
  client,
  onOffer,
  thresholdMs = ASSISTANCE_INACTIVITY_MS,
}: ProactiveAssistanceOptions): ProactiveAssistance {
  const [offer, setOffer] = useState<AssistanceOffer | null>(null);
  // A new quiet spell. Bumped by activity, turns and workflow changes.
  const [spell, setSpell] = useState(0);
  // Whether this spell may still produce an offer.
  const [armed, setArmed] = useState(true);

  const canAsk = typeof client.requestAssistance === 'function';
  const micBusy = micStatus === 'starting' || micStatus === 'recording';

  const eligible =
    canAsk &&
    Boolean(sessionId) &&
    !ended &&
    workflow?.state === 'active' &&
    workflow.step !== null &&
    !isSending &&
    voiceActivity === 'idle' &&
    !micBusy;

  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  const spellRef = useRef(spell);
  spellRef.current = spell;

  const lastPromptRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const onOfferRef = useRef(onOffer);
  onOfferRef.current = onOffer;
  const clientRef = useRef(client);
  clientRef.current = client;

  const abortRequest = useCallback((): void => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const newSpell = useCallback((): void => {
    setSpell((current) => current + 1);
    setArmed(true);
  }, []);

  // A turn landing, or the workflow moving, is a new spell -- and makes
  // any offer on screen about a step that may no longer be current.
  const workflowKey = workflow
    ? `${workflow.name ?? ''}|${workflow.state}|${workflow.step ?? ''}`
    : 'none';

  useEffect(() => {
    newSpell();
    setOffer(null);
    abortRequest();
  }, [turnKey, workflowKey, newSpell, abortRequest]);

  // A different visit starts from nothing. The cleanup also aborts a
  // request in flight when the screen unmounts.
  useEffect(() => {
    lastPromptRef.current = null;
    setOffer(null);
    return abortRequest;
  }, [sessionId, abortRequest]);

  // The customer started doing something: whatever was being fetched is
  // no longer wanted.
  useEffect(() => {
    if (!eligible) abortRequest();
  }, [eligible, abortRequest]);

  useEffect(() => {
    if (!eligible || !armed || !sessionId) return;

    const timer = setTimeout(() => {
      // One request per spell, whatever it answers.
      setArmed(false);

      const request = clientRef.current.requestAssistance;
      if (typeof request !== 'function') return;

      abortRequest();
      const controller = new AbortController();
      requestRef.current = controller;
      const askedIn = spellRef.current;

      request(sessionId, lastPromptRef.current, controller.signal)
        .then((answer) => {
          const stale =
            controller.signal.aborted || spellRef.current !== askedIn || !eligibleRef.current;

          if (stale || !answer.offered || !answer.text) return;

          lastPromptRef.current = answer.promptId;
          setOffer(answer);
          onOfferRef.current?.(answer);
        })
        .catch(() => {
          // A busy assistant (409) or a dropped connection is simply no
          // offer this time. Never retried.
        })
        .finally(() => {
          if (requestRef.current === controller) requestRef.current = null;
        });
    }, thresholdMs);

    return () => clearTimeout(timer);
  }, [eligible, armed, spell, sessionId, thresholdMs, abortRequest]);

  const noteActivity = useCallback((): void => {
    abortRequest();
    newSpell();
  }, [abortRequest, newSpell]);

  const dismiss = useCallback((): void => setOffer(null), []);

  return { offer, noteActivity, dismiss };
}
