import { Outlet } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { SessionProvider } from '@/context/SessionContext';
import { ConversationProvider } from '@/context/ConversationContext';
import { VoiceProvider } from '@/context/VoiceContext';
import { VOICE_ENDPOINTING, VOICE_RELISTEN_DELAY_MS } from '@/lib/voiceTiming';

/**
 * Sits above every route so the providers live inside the router
 * context.
 *
 * The nesting is the dependency order, and each layer needs the one
 * above it:
 *
 *   Auth          who the customer is
 *   Session       which visit, which branch, which language
 *   Conversation  the single conversation, reachable from any screen
 *   Voice         preference and activity; speaks into that conversation
 *
 * Voice is outermost of the two new ones because it depends on the
 * conversation. Nothing depends on voice, which is what keeps a second
 * assistant from ever forming.
 */
export function RootLayout() {
  return (
    <AuthProvider>
      <SessionProvider>
        <ConversationProvider>
          <VoiceProvider relistenDelayMs={VOICE_RELISTEN_DELAY_MS} endpointing={VOICE_ENDPOINTING}>
            <Outlet />
          </VoiceProvider>
        </ConversationProvider>
      </SessionProvider>
    </AuthProvider>
  );
}
