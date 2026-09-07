import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { sessionsApi } from '@/api/sessions.api';
import { useAuth } from '@/context/useAuth';
import { ApiError } from '@/types/api';
import type { Session } from '@/types/session';

export interface SessionContextValue {
  session: Session | null;
  /** True while the active visit is being looked up. */
  isLoading: boolean;
  hasContext: boolean;
  /**
   * Set when the lookup itself failed.
   *
   * Deliberately separate from `session === null`. "You have no active
   * visit" and "we could not find out whether you have one" call for
   * different screens: the first sends the customer to scan, the second
   * has to say what went wrong and offer to try again.
   */
  error: string | null;
  /** Re-runs the lookup. Used by the retry action on the error screen. */
  refresh: () => Promise<void>;
  establish: (branchCode: string) => Promise<Session>;
  endSession: () => Promise<void>;

  /**
   * Set the moment a scan or a typed code establishes context, and
   * cleared once something has acted on it.
   *
   * A one-shot signal rather than a remembered fact, because "has this
   * customer arrived here before" is the wrong question: they arrive
   * every time they scan, including at the branch they just left and
   * came back to. Restoring an existing visit on reload is not an
   * arrival and leaves this null.
   */
  arrivalAt: number | null;
  acknowledgeArrival: () => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [arrivalAt, setArrivalAt] = useState<number | null>(null);

  const loadActiveSession = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const active = await sessionsApi.active(signal);

      if (signal?.aborted) return;

      setSession(active);
    } catch (caught) {
      // An abort is our own cleanup unmounting the provider, not a
      // failure the customer should ever see. Without this check a
      // StrictMode double-mount reports a phantom error.
      if (signal?.aborted) return;

      if (!(caught instanceof ApiError)) throw caught;

      setSession(null);
      setError(caught.message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  // The visit belongs to the account, so it is re-read when the signed-in
  // user changes and dropped entirely on sign-out.
  useEffect(() => {
    if (!isAuthenticated) {
      setSession(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadActiveSession(controller.signal);

    return () => controller.abort();
  }, [isAuthenticated, loadActiveSession]);

  const refresh = useCallback(async (): Promise<void> => {
    await loadActiveSession();
  }, [loadActiveSession]);

  const establish = useCallback(async (branchCode: string): Promise<Session> => {
    const next = await sessionsApi.establish(branchCode);

    setSession(next);
    setError(null);
    // Every successful scan or typed code is an arrival, even the second
    // one at the same counter.
    setArrivalAt(Date.now());

    return next;
  }, []);

  const acknowledgeArrival = useCallback((): void => setArrivalAt(null), []);

  const endSession = useCallback(async (): Promise<void> => {
    if (!session) return;

    try {
      await sessionsApi.end(session.id);
    } catch {
      // Best effort. If the call fails the server-side visit stays open
      // and will be reused on the next scan, which is harmless.
    }

    setSession(null);
    setError(null);
    setArrivalAt(null);
  }, [session]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isLoading,
      hasContext: session !== null,
      error,
      refresh,
      establish,
      endSession,
      arrivalAt,
      acknowledgeArrival,
    }),
    [session, isLoading, error, refresh, establish, endSession, arrivalAt, acknowledgeArrival],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
