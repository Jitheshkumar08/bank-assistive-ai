import { useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
import { RequestIcon } from '@/components/requests/RequestIcon';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useConversation } from '@/context/useConversation';
import { useOptionalVoice } from '@/context/useVoice';
import { COMMON_REQUESTS, isCommonRequest } from '@/lib/commonRequests';
import { firstName } from '@/lib/greeting';

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
  const { session } = useSession();
  const { messages, isSending, error, isEmpty, canRetry, send, retry } = useConversation();
  const voice = useOptionalVoice();
  const location = useLocation();
  const navigate = useNavigate();

  // A shortcut on the welcome screen arrives with its request attached.
  // It is sent once, and only if it is one of the known requests.
  const handedOver = (location.state as { request?: unknown } | null)?.request;
  const handedOverSentRef = useRef(false);

  useEffect(() => {
    if (handedOverSentRef.current || !session || !user || !isCommonRequest(handedOver)) return;

    handedOverSentRef.current = true;
    // Cleared from history, so reloading or coming Back does not ask the
    // same question a second time.
    navigate(location.pathname, { replace: true, state: null });
    void send(handedOver);
  }, [handedOver, session, user, send, navigate, location.pathname]);

  // RequireAuth and RequireContext already guarantee both. Rendering a
  // conversation with no idea where the customer is standing would be
  // worse than sending them back to scan.
  if (!session || !user) {
    return <Navigate to="/scan" replace />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Banking assistant conversation</h1>

      {isEmpty && !isSending ? (
        // Near the bottom on a phone, where the thumb already is; centred
        // on a larger screen, where there is room to breathe.
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-7 overflow-y-auto pt-4 pb-5 sm:justify-center">
          <div className="flex flex-col items-center text-center">
            <BrandMark size="lg" elevated />
            <p className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink-900">
              Hello, {firstName(user.fullName)}
            </p>
            <p className="mt-1.5 max-w-xs text-[0.9375rem] leading-relaxed text-ink-500">
              Tell me what you would like to do, and I will guide you step by step.
            </p>
          </div>

          <div>
            <p
              id="suggestions-label"
              className="px-1 text-xs font-medium tracking-[0.1em] text-ink-500 uppercase"
            >
              Common requests
            </p>
            <ul
              aria-labelledby="suggestions-label"
              className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
            >
              {COMMON_REQUESTS.map(({ id, label, request }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => void send(request)}
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
        <MessageList messages={messages} isSending={isSending} />
      )}

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

      <Composer onSend={(content) => void send(content)} isSending={isSending} voice={voice} />
    </div>
  );
}
