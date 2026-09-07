import { Navigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/LinkButton';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useWelcomeGreeting } from '@/hooks/useWelcomeGreeting';
import { firstName } from '@/lib/greeting';

/**
 * Confirmation screen shown once branch context exists.
 *
 * Everything here is read from the signed-in account and the active
 * visit. Refreshing this page re-reads the existing visit rather than
 * starting a new one, so a customer who reloads mid-task keeps their
 * place.
 */
export function WelcomePage() {
  const { user } = useAuth();
  const { session } = useSession();

  // Speaks the arrival greeting once, if the customer asked for speech.
  // Called before the early return below so the hook order never
  // changes between renders.
  const greeting = useWelcomeGreeting();

  // RequireContext already guarantees both. If that ever changes,
  // sending the customer back to scan beats rendering a screen with
  // blanks where their branch should be.
  if (!session || !user) {
    return <Navigate to="/scan" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">
          Welcome, {firstName(user.fullName)}
        </h1>
        <p className="mt-1 text-base text-ink-600">
          You are checked in. I can guide you through deposits, withdrawals and loan
          applications, or answer questions about banking services.
        </p>
      </div>

      <Card className="flex flex-col gap-5">
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-sm font-semibold text-ink-500">Branch</dt>
            <dd className="text-lg font-semibold text-ink-900">
              {session.branch.name}
              {session.branch.city && (
                <span className="block text-base font-normal text-ink-600">
                  {session.branch.city}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <LinkButton to="/assistant">Continue to Assistant</LinkButton>

        {/* The greeting is spoken automatically, but a browser may
            refuse audio it did not see anyone ask for. This is the way
            back from that, and doubles as "say it again" for anyone who
            missed it. */}
        {greeting.canSpeak && (
          <button
            type="button"
            onClick={greeting.replay}
            className="min-h-touch text-sm font-semibold text-brand-700 underline"
          >
            Hear this again
          </button>
        )}
      </Card>

      <div className="flex flex-col gap-2">
        <LinkButton to="/scan" variant="secondary">
          Change location
        </LinkButton>
        <p className="text-center text-sm text-ink-500">
          Moved to a different counter? Scan the code there to update your guidance.
        </p>
      </div>
    </div>
  );
}
