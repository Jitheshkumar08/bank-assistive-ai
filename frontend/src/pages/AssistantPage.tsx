import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { AssistanceCard } from '@/components/chat/AssistanceCard';
import { InterpreterPanel } from '@/components/interpreter/InterpreterPanel';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
import { WorkflowProgress } from '@/components/chat/WorkflowProgress';
import { RequestIcon } from '@/components/requests/RequestIcon';
import { VoiceConsole } from '@/components/voice/VoiceConsole';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useConversation } from '@/context/useConversation';
import { useOptionalVoice } from '@/context/useVoice';
import { useProactiveAssistance } from '@/hooks/useProactiveAssistance';
import type { AssistantRouteState } from '@/lib/assistantRoute';
import { COMMON_REQUESTS, isCommonRequest } from '@/lib/commonRequests';
import { firstName } from '@/lib/greeting';
import { assistantClient } from '@/services/assistant';
import type { AssistanceOffer, ConversationMessage, WorkflowSnapshot } from '@/types/assistant';

/**
 * What the Help control sends: the word the assistant's own offers tell the
 * customer to say, in the visit's language. Each is an exact `help` phrase
 * in the engine's control tier, so help is answered deterministically.
 */
const HELP_WORD: Record<string, string> = { en: 'help', kn: 'ಸಹಾಯ', hi: 'मदद' };

/**
 * The task waiting while the customer talks to staff, in a sentence, or
 * null when nothing is under way.
 */
function savedTaskNote(workflow: WorkflowSnapshot | null): string | null {
  if (!workflow?.name || (workflow.state !== 'active' && workflow.state !== 'suspended')) return null;

  const task = workflow.name.charAt(0).toUpperCase() + workflow.name.slice(1);
  const where =
    workflow.step !== null
      ? ` at step ${workflow.step}${workflow.totalSteps !== null ? ` of ${workflow.totalSteps}` : ''}`
      : '';

  return `${task} is saved${where}. Return to AI to carry on from there.`;
}

function latest(messages: ConversationMessage[], author: ConversationMessage['author']): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.author === author && message.status !== 'sending') return message.content;
  }
  return null;
}

/**
 * The conversation screen.
 *
 * Laid out like a messaging app on a phone: the conversation fills the
 * screen, and the composer sits at the bottom within reach of a thumb.
 * Who is being helped, and at which branch, is in the header above, so
 * it is not repeated here.
 *
 * Rendering only. The conversation itself belongs to
 * ConversationProvider, one level above the router, so the voice control
 * on other screens speaks into the same conversation this page renders.
 * What answers lives behind the assistant client; neither the mock nor
 * any reply text appears in this file.
 */
export function AssistantPage() {
  const { user } = useAuth();
  const { session, endSession } = useSession();
  const { messages, isSending, error, isEmpty, canRetry, workflow, ended, send, retry } =
    useConversation();
  const [isLeaving, setIsLeaving] = useState(false);
  // The face-to-face interpreter, in place of the conversation. The
  // conversation and its workflow are not touched while it is open.
  const [interpreting, setInterpreting] = useState(false);
  const voice = useOptionalVoice();
  const location = useLocation();
  const navigate = useNavigate();

  // A shortcut on the welcome screen arrives with its request attached.
  // It is sent once, and only if it is one of the known requests.
  const handedOver: unknown = (location.state as AssistantRouteState | null)?.request;
  const handedOverSentRef = useRef(false);

  useEffect(() => {
    if (handedOverSentRef.current || !session || !user || !isCommonRequest(handedOver)) return;

    handedOverSentRef.current = true;
    // Cleared from history, so reloading or coming Back does not ask the
    // same question a second time.
    navigate(location.pathname, { replace: true, state: null });
    void send(handedOver);
  }, [handedOver, session, user, send, navigate, location.pathname]);

  // Spoken aloud only when the customer has voice on; speak() checks.
  const speakOffer = useCallback(
    (offer: AssistanceOffer): void => {
      if (offer.text) void voice?.speak(offer.text);
    },
    [voice],
  );

  const assistance = useProactiveAssistance({
    sessionId: session?.id ?? null,
    workflow,
    isSending,
    ended,
    voiceActivity: voice?.activity ?? 'idle',
    micStatus: voice?.micStatus ?? null,
    turnKey: messages.length,
    client: assistantClient,
    onOffer: speakOffer,
    paused: interpreting,
  });

  const { noteActivity } = assistance;

  const askForHelp = useCallback((): void => {
    noteActivity();
    void send(HELP_WORD[session?.language ?? 'en'] ?? HELP_WORD.en);
  }, [noteActivity, send, session?.language]);

  /**
   * Sets the assistant aside for the interpreter.
   *
   * Its voice session is stopped first -- hands-free listening, a recording
   * or a reply being read -- so the interpreter's microphone is the only one
   * open. Nothing is sent: the workflow stays exactly where it is.
   */
  const openInterpreter = useCallback((): void => {
    voice?.reset();
    setInterpreting(true);
  }, [voice]);

  const closeInterpreter = useCallback((): void => {
    setInterpreting(false);
    // Back to the assistant is activity: a new quiet spell starts here.
    noteActivity();
  }, [noteActivity]);

  /**
   * Closes the visit after the assistant has said goodbye.
   *
   * The customer asked to leave, so this is the same explicit exit as any
   * other: the visit is ended on the server, which releases the
   * assistant's side of the conversation too. It waits for the customer
   * rather than happening by itself, so the goodbye stays readable -- and
   * audible -- until they are done with it.
   */
  async function handleFinish(): Promise<void> {
    setIsLeaving(true);
    await endSession();
    navigate('/scan', { replace: true });
  }

  // RequireAuth and RequireContext already guarantee both. Rendering a
  // conversation with no idea where the customer is standing would be
  // worse than sending them back to scan.
  if (!session || !user) {
    return <Navigate to="/scan" replace />;
  }

  const lastReply = latest(messages, 'assistant');
  const lastHeard = latest(messages, 'user');
  const stepInProgress = !ended && workflow?.state === 'active';

  // With voice available, the console holds every voice control; the
  // composer below stays the text alternative and carries no second mic.
  const voiceConsole = (variant: 'hero' | 'compact') =>
    voice && (
      <VoiceConsole
        voice={voice}
        variant={variant}
        isSending={isSending}
        ended={ended}
        lastReply={lastReply}
        lastHeard={lastHeard}
        onHelp={askForHelp}
        onActivity={noteActivity}
      />
    );

  if (interpreting) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <h1 className="sr-only">Face-to-face interpreter</h1>
        <InterpreterPanel
          sessionId={session.id}
          customerLanguage={session.language}
          savedTask={savedTaskNote(workflow)}
          onReturn={closeInterpreter}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Banking assistant conversation</h1>

      {isEmpty && !isSending ? (
        // Near the bottom on a phone, where the thumb already is; centred
        // on a larger screen, where there is room to breathe.
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-7 overflow-y-auto pt-4 pb-5 sm:justify-center">
          {voice ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="text-2xl font-semibold tracking-[-0.03em] text-ink-900">
                Hello, {firstName(user.fullName)}
              </p>
              {voiceConsole('hero')}
              <p className="max-w-xs text-[0.9375rem] leading-relaxed text-ink-500">
                Say what you would like to do — for example, “I want to withdraw money” — and I
                will guide you step by step.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <BrandMark size="lg" elevated />
              <p className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink-900">
                Hello, {firstName(user.fullName)}
              </p>
              <p className="mt-1.5 max-w-xs text-[0.9375rem] leading-relaxed text-ink-500">
                Tell me what you would like to do, and I will guide you step by step.
              </p>
            </div>
          )}

          <div>
            <p
              id="suggestions-label"
              className="px-1 text-xs font-medium tracking-[0.1em] text-ink-500 uppercase"
            >
              Common requests
              {voice && <span className="sr-only"> (or choose one instead of speaking)</span>}
            </p>
            <ul
              aria-labelledby="suggestions-label"
              className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
            >
              {COMMON_REQUESTS.map(({ id, label, request }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      noteActivity();
                      void send(request);
                    }}
                    className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[0.9375rem] font-medium text-ink-900 transition-colors hover:bg-ink-50 focus-visible:-outline-offset-2"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink-50 text-ink-700 ring-1 ring-ink-200/70"
                    >
                      <RequestIcon id={id} className="size-[1.125rem]" />
                    </span>
                    <span className="min-w-0 flex-1">{label}</span>
                    <svg
                      className="size-4 shrink-0 text-ink-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <>
          <WorkflowProgress workflow={workflow} />
          {voiceConsole('compact')}
          <MessageList messages={messages} isSending={isSending} />
        </>
      )}

      {!ended && (
        // Talking to the person at the counter, through the phone. Offered
        // throughout a visit: staff are part of every banking task.
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={openInterpreter}
            disabled={isSending}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-semibold text-ink-800 ring-1 ring-ink-200 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span aria-hidden="true">⇄</span>
            Speak with staff
          </button>
        </div>
      )}

      <AssistanceCard
        offer={assistance.offer}
        stepInProgress={stepInProgress}
        // Without voice there is no console, so the card carries Help.
        onHelp={voice || isSending ? undefined : askForHelp}
        onDismiss={assistance.dismiss}
      />

      {error && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-2xl bg-danger-50 px-4 py-2.5 text-sm leading-relaxed text-danger-700 ring-1 ring-danger-500/20"
        >
          <span className="min-w-0">{error}</span>
          {canRetry && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={isSending}
              className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-white px-3.5 text-sm font-semibold text-danger-700 ring-1 ring-danger-500/25 transition-colors hover:bg-danger-50 disabled:opacity-50"
            >
              Try sending again
            </button>
          )}
        </div>
      )}

      {ended ? (
        <div
          role="status"
          className="flex flex-col items-center gap-3 rounded-2xl bg-white px-4 py-4 text-center shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
        >
          <p className="text-[0.9375rem] text-ink-700">This visit has ended.</p>
          <button
            type="button"
            onClick={() => void handleFinish()}
            disabled={isLeaving}
            className="inline-flex min-h-11 items-center rounded-full bg-brand-600 px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {isLeaving ? 'Finishing…' : 'Finish'}
          </button>
        </div>
      ) : (
        <Composer
          onSend={(content) => void send(content)}
          isSending={isSending}
          voice={null}
          onActivity={noteActivity}
        />
      )}
    </div>
  );
}
