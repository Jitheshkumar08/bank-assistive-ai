/* eslint-disable react-refresh/only-export-components -- provider and its hook belong together */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { approvedColleges, type CollegeContext } from '../services/qr/qrContext'

const storageKey = 'campusguide.collegeContext'
// The college context is not sensitive, but it is kept per browser tab and expires so a stale scan is not reused.
const maxAgeMs = 12 * 60 * 60 * 1000

function readStored(): CollegeContext | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as CollegeContext | null
    if (!value || !Object.hasOwn(approvedColleges, value.collegeId)) return null
    if (Date.now() - Date.parse(value.validatedAt) > maxAgeMs) return null
    return value
  } catch {
    return null
  }
}

type CollegeContextValue = {
  context: CollegeContext | null
  setContext: (context: CollegeContext) => void
  clearContext: () => void
}

const Ctx = createContext<CollegeContextValue | null>(null)

/** Holds the college context established by a validated QR scan. It never represents the student's identity. */
export function CollegeContextProvider({ children, initial }: { children: ReactNode; initial?: CollegeContext | null }) {
  const [context, setState] = useState<CollegeContext | null>(() => initial !== undefined ? initial : readStored())
  const setContext = useCallback((next: CollegeContext) => {
    setState(next)
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* storage unavailable: keep in memory */ }
  }, [])
  const clearContext = useCallback(() => {
    setState(null)
    try { sessionStorage.removeItem(storageKey) } catch { /* ignore */ }
  }, [])
  const value = useMemo(() => ({ context, setContext, clearContext }), [context, setContext, clearContext])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCollegeContext() {
  const value = useContext(Ctx)
  if (!value) throw new Error('useCollegeContext must be used inside CollegeContextProvider')
  return value
}
