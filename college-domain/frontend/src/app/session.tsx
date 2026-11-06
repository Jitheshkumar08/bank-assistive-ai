/* eslint-disable react-refresh/only-export-components -- provider and its hook belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ServiceError } from '../services/errors'
import type { SessionUser } from '../services/auth/sessionService'
import { onUnauthenticated } from '../services/http'
import { useServices } from './services'

export type SessionState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signed-out'; expired?: boolean }
  | { status: 'signed-in'; user: SessionUser }
  | { status: 'error'; message: string }

type SessionContextValue = {
  session: SessionState
  refresh: () => void
  /** Records the student returned by a successful POST /auth/login (the cookie itself is HttpOnly). */
  signIn: (user: SessionUser) => void
  logout: () => Promise<void>
}

const Ctx = createContext<SessionContextValue | null>(null)

/**
 * Restores the server session with GET /auth/me; 'unavailable' means the backend is not connected, never "signed in".
 * Any UNAUTHENTICATED answer from the backend (expired or revoked session) signs the student out here too.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { session: service } = useServices()
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    service.getSession().then((user) => {
      if (active) setSession(user ? { status: 'signed-in', user } : { status: 'signed-out' })
    }).catch((error: unknown) => {
      if (!active) return
      if (error instanceof ServiceError && error.code === 'BACKEND_NOT_CONNECTED') setSession({ status: 'unavailable' })
      else setSession({ status: 'error', message: error instanceof ServiceError ? error.message : 'Could not check your sign-in.' })
    })
    return () => { active = false }
  }, [service, attempt])

  useEffect(() => onUnauthenticated(() => {
    setSession((current) => current.status === 'signed-in' ? { status: 'signed-out', expired: true } : current)
  }), [])

  const refresh = useCallback(() => setAttempt((value) => value + 1), [])
  const signIn = useCallback((user: SessionUser) => setSession({ status: 'signed-in', user }), [])
  const logout = useCallback(async () => {
    try {
      await service.logout()
      setSession((current) => current.status === 'unavailable' ? current : { status: 'signed-out' })
    } catch {
      // The server may still hold the session (e.g. network failure): re-read it instead of pretending it ended.
      refresh()
    }
  }, [service, refresh])
  const value = useMemo(() => ({ session, refresh, signIn, logout }), [session, refresh, signIn, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const value = useContext(Ctx)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}

/** First name to greet the account with, or null — the UI then shows the translated word for "Student". */
export function displayNameOf(session: SessionState) {
  if (session.status !== 'signed-in') return null
  return session.user.displayName?.split(/\s+/)[0] || null
}
