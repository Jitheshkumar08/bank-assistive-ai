import { useCallback, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { LinkButton } from '@/components/ui/LinkButton';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useWelcomeGreeting } from '@/hooks/useWelcomeGreeting';
import { useOpenAssistantOnVoiceService } from '@/hooks/useOpenAssistantOnVoiceService';
import { useSuggestions } from '@/hooks/useSuggestions';
import { RequestIcon } from '@/components/requests/RequestIcon';
import { SuggestionList } from '@/components/suggestions/SuggestionList';
import { ASSISTANT_PATH, assistantRouteState } from '@/lib/assistantRoute';
import { COMMON_REQUESTS } from '@/lib/commonRequests';
import { firstName } from '@/lib/greeting';
import { composeSuggestionSpeech } from '@/lib/suggestionCopy';
import { suggestionsApi } from '@/api/suggestions.api';
import type { Suggestion } from '@/types/suggestions';

/**
 * Confirmation screen shown once branch context exists.
 *
 * Three things, in the order someone standing at a counter needs them:
 * that they are checked in and where, a one-tap start on the usual
 * requests, and the way into the assistant for anything else.
 *
 * Everything here is read from the signed-in account and the active
 * visit. Refreshing this page re-reads the existing visit rather than
 * starting a new one, so a customer who reloads mid-task keeps their
 * place.
 */
export function WelcomePage() {
  const { user } = useAuth();
  const { session } = useSession();
  const navigate = useNavigate();

  const language = session?.language ?? user?.preferredLanguage ?? 'en';

  // Remembered payments, if this customer has any. Fetched with a short
  // budget; a slow or failed lookup leaves this screen exactly as it
  // would be for someone with no history at all.
  const { suggestions, settled, dismiss } = useSuggestions(session?.id ?? null);

  const [busyId, setBusyId] = useState<string | null>(null);

  // Speaks the arrival greeting once, if the customer asked for speech,
  // with the offer in the same breath. Called before the early return
  // below so the hook order never changes between renders.
  const greeting = useWelcomeGreeting({
    suffix: composeSuggestionSpeech({ language, suggestions }),
    ready: settled,
  });

  /**
   * Accepting opens a review screen. The request carries no payee and
   * no amount -- the server reads those back from its own offer -- so
   * nothing here can redirect a payment.
   */
  const handleContinue = useCallback(
    async (suggestion: Suggestion): Promise<void> => {
      setBusyId(suggestion.id);

      try {
        const opened = await suggestionsApi.continue(suggestion.id);
        navigate(`/review/${opened.activityId}`);
      } catch {
        // Already paid, expired, or offline. The card goes rather than
        // explaining itself: the tiles below do the same job.
        dismiss(suggestion.id);
      } finally {
        setBusyId(null);
      }
    },
    [dismiss, navigate],
  );

  /** "Not now." Recorded, because twice means stop asking. */
  const handleDecline = useCallback(
    (suggestion: Suggestion): void => {
      dismiss(suggestion.id);
      void suggestionsApi.decline(suggestion.id).catch(() => {});
    },
    [dismiss],
  );

  // Saying a service out loud opens the assistant, like tapping its tile.
  useOpenAssistantOnVoiceService();

  // RequireContext already guarantees both. If that ever changes,
  // sending the customer back to scan beats rendering a screen with
  // blanks where their branch should be.
  if (!session || !user) {
    return <Navigate to="/scan" replace />;
  }

  return (
    <div className="sm:pt-4 lg:pt-10">
      <div className="mx-auto flex w-full max-w-md flex-col">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-full bg-brand-600 text-white"
          >
            <CheckIcon />
          </span>
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">
            Checked in
          </p>
        </div>

        <h1 className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.035em] text-ink-900 sm:text-4xl">
          Welcome, {firstName(user.fullName)}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-500">
          What would you like to do today? Pick a common request, or ask in your own words.
        </p>

        {/* The greeting is spoken automatically, but a browser may refuse
            audio it did not see anyone ask for. This is the way back from
            that, and doubles as "say it again" for anyone who missed it. */}
        {greeting.canSpeak && (
          <button
            type="button"
            onClick={greeting.replay}
            className="mt-4 inline-flex min-h-touch items-center gap-2 self-start rounded-full bg-white px-4 text-sm font-medium text-ink-700 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/80 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            <SpeakerIcon />
            Hear this again
          </button>
        )}

        <section
          aria-labelledby="welcome-branch"
          className="mt-8 flex items-center gap-4 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70"
        >
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"
          >
            <PinIcon />
          </span>

          <div className="min-w-0 flex-1">
            <h2
              id="welcome-branch"
              className="text-xs font-medium tracking-[0.1em] text-ink-500 uppercase"
            >
              Your branch
            </h2>
            <p className="mt-0.5 truncate text-base font-medium text-ink-900">{session.branch.name}</p>
            {session.branch.city && (
              <p className="truncate text-sm text-ink-500">{session.branch.city}</p>
            )}
          </div>

          {/* Short on screen; the full label is what a screen reader hears
              and what voice control users say. */}
          <Link
            to="/scan"
            aria-label="Change location"
            className="inline-flex min-h-touch shrink-0 items-center rounded-xl px-3 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
          >
            Change
          </Link>
        </section>

        <SuggestionList
          suggestions={suggestions}
          language={language}
          busyId={busyId}
          onContinue={(suggestion) => void handleContinue(suggestion)}
          onDecline={handleDecline}
        />

        <section aria-labelledby="welcome-start" className="mt-8">
          <h2 id="welcome-start" className="text-sm font-medium text-ink-900">
            Start with a common request
          </h2>

          <ul className="mt-3 grid grid-cols-3 gap-2.5">
            {COMMON_REQUESTS.map((item) => (
              <li key={item.id}>
                {/* Opens the assistant with the request already on its way,
                    so the usual visit takes one tap instead of typing. */}
                <Link
                  to={ASSISTANT_PATH}
                  state={assistantRouteState(item)}
                  className="flex h-full min-h-28 flex-col items-center justify-center gap-2.5 rounded-2xl bg-white px-2 py-4 text-center shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70 transition-[box-shadow,background-color] hover:bg-ink-50/60 hover:ring-ink-300"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-xl bg-ink-50 text-ink-700 ring-1 ring-ink-200/70"
                  >
                    <RequestIcon id={item.id} />
                  </span>
                  <span className="text-[0.8125rem] leading-tight font-medium text-ink-900">
                    {item.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <LinkButton to="/assistant" className="group mt-8">
          Continue to assistant
          <ArrowIcon />
        </LinkButton>
      </div>
    </div>
  );
}

function Icon({ children, className = 'size-5' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function CheckIcon() {
  return (
    <Icon className="size-3">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth="3" />
    </Icon>
  );
}

function SpeakerIcon() {
  return (
    <Icon className="size-4 text-ink-500">
      <path d="M11 5 6.5 9H4v6h2.5L11 19z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </Icon>
  );
}

function PinIcon() {
  return (
    <Icon>
      <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}

function ArrowIcon() {
  return (
    <Icon className="size-5 transition-transform duration-150 group-hover:translate-x-0.5">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}
