import { useCallback, useEffect, useState } from 'react'
import { errorMessage, ServiceError } from '../services/errors'

export type AsyncState<T> =
  | { status: 'loading'; data?: T }
  | { status: 'error'; message: string; code: string | null; data?: T }
  | { status: 'ready'; data: T }

type Settled<T> = ({ status: 'ready'; data: T } | { status: 'error'; message: string; code: string | null; data?: T }) & { request: object }

/**
 * Runs `load` whenever `deps` change and exposes loading / error / ready, keeping the previous data while reloading
 * (so tables don't flash empty). Responses for an older request are ignored.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  // A new identity per request (inputs changed or reload); "loading" simply means the latest settled result belongs to
  // an older request. Adjusted during render, which React supports for derived state.
  const [request, setRequest] = useState(() => ({ deps, attempt }))
  if (attempt !== request.attempt || deps.length !== request.deps.length || deps.some((value, index) => !Object.is(value, request.deps[index]))) {
    setRequest({ deps, attempt })
  }

  useEffect(() => {
    let active = true
    load().then(
      (data) => { if (active) setSettled({ request, status: 'ready', data }) },
      (error: unknown) => {
        if (!active) return
        setSettled((previous) => ({
          request, status: 'error', message: errorMessage(error, 'This could not be loaded. Please try again.'),
          code: error instanceof ServiceError ? error.code : null, data: previous?.data,
        }))
      },
    )
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `request` changes exactly when the inputs do
  }, [request])

  const state: AsyncState<T> = !settled ? { status: 'loading' }
    : settled.request === request ? settled
    : { status: 'loading', data: settled.data }
  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const setData = useCallback((data: T) => setSettled({ request, status: 'ready', data }), [request])
  return { state, reload, setData }
}
