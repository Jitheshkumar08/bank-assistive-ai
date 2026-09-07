import { Navigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
import { useAuth } from '@/context/useAuth';
import { useSession } from '@/context/useSession';
import { useConversation } from '@/context/useConversation';

/** Openers that cover most of what people come to a branch to do. */
const SUGGESTIONS = ['I want to deposit money', 'I want to withdraw money', 'How do I apply for a loan?'];

/**
 * The conversation screen.
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

  // RequireAuth and RequireContext already guarantee both. Rendering a
  // conversation with no idea where the customer is standing would be
  // worse than sending them back to scan.
  if (!session || !user) {
    return <Navigate to="/scan" replace />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <h1 className="sr-only">Banking assistant conversation</h1>

      {/* Requirement of the screen, not decoration: the customer should
          always be able to see which context the answers are coming
          from. */}
      <p className="text-sm text-ink-500">
        Helping <span className="font-semibold text-ink-700">{user.fullName}</span> at{' '}
        <span className="font-semibold text-ink-700">{session.branch.name}</span>
      </p>

      {isEmpty && !isSending ? (
        <div className="flex flex-1 flex-col justify-center gap-5 py-6">
          <div>
            <p className="text-xl font-bold text-ink-900">
              Hello, {user.fullName.trim().split(/\s+/)[0]}
            </p>
            <p className="mt-1 text-base text-ink-600">
              Tell me what you would like to do and I will take you through it step by step. You
              can also ask a question about banking services.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink-500" id="suggestions-label">
              Common requests
            </p>
            <ul className="flex flex-col gap-2" aria-labelledby="suggestions-label">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <Button variant="secondary" onClick={() => void send(suggestion)}>
                    {suggestion}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <MessageList messages={messages} isSending={isSending} />
      )}

      {error && (
        <Alert tone="error" className="flex flex-col gap-3">
          <span>{error}</span>
          {canRetry && (
            <Button variant="secondary" onClick={() => void retry()} disabled={isSending}>
              Try sending again
            </Button>
          )}
        </Alert>
      )}

      <Composer onSend={(content) => void send(content)} isSending={isSending} />
    </div>
  );
}
