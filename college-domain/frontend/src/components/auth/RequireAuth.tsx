import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { homeFor } from '../../app/roles'
import { useSession } from '../../app/session'
import { useI18n } from '../../i18n/I18nProvider'
import type { AccountRole } from '../../services/auth/sessionService'

/**
 * Guards signed-in pages. Signed-out visitors go to /login and come back afterwards; a signed-in account with another
 * role is sent to its own dashboard. This is navigation only — the backend authorises every API call itself.
 * While the backend is not connected ('unavailable') a student page renders its own honest "not connected" state;
 * staff portals require a real session.
 */
export default function RequireAuth({ children, roles = ['STUDENT'] }: { children: ReactNode; roles?: AccountRole[] }) {
  const { session, refresh } = useSession()
  const location = useLocation()
  const { t, language } = useI18n()
  if (session.status === 'signed-in') return roles.includes(session.user.role) ? children : <Navigate to={homeFor(session.user.role)} replace />
  if (session.status === 'unavailable' && roles.includes('STUDENT')) return children
  if (session.status === 'loading') return <p className="page-narrow" role="status">{t('common.checkingSignIn')}</p>
  if (session.status === 'error') {
    return (
      <div className="page-narrow content-card" role="alert">
        <p>{language === 'en' ? session.message : t('error.signInCheck')}</p>
        <button type="button" className="button-outline" onClick={refresh}>{t('common.tryAgain')}</button>
      </div>
    )
  }
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
}

/** `/dashboard`: sends each signed-in account to its own portal. */
export function RoleHomeRedirect() {
  const { session } = useSession()
  const { t } = useI18n()
  if (session.status === 'loading') return <p className="page-narrow" role="status">{t('common.checkingSignIn')}</p>
  if (session.status === 'signed-in') return <Navigate to={homeFor(session.user.role)} replace />
  return <Navigate to={session.status === 'unavailable' ? '/home' : '/login'} replace state={{ from: '/dashboard' }} />
}
