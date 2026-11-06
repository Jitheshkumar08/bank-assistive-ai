import { Link, Navigate, useLocation } from 'react-router'
import { useServices } from '../app/services'
import { useSession } from '../app/session'
import LoginForm from '../components/auth/LoginForm'
import { safeReturnPath } from '../components/auth/returnPath'
import AuthLayout from '../components/layout/AuthLayout'
import Alert from '../components/ui/Alert'
import { useI18n } from '../i18n/I18nProvider'

export default function LoginPage() {
  const { auth } = useServices()
  const { session, signIn } = useSession()
  const location = useLocation()
  const { t } = useI18n()
  // Already signed in (restored session or a successful login just now): continue to where the account was going, if
  // its role may go there, otherwise to the role's own dashboard. The role comes from the backend, never from a choice.
  if (session.status === 'signed-in') {
    return <Navigate to={safeReturnPath((location.state as { from?: unknown } | null)?.from, session.user.role)} replace />
  }

  return (
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('common.logIn') })}</title>
      {session.status === 'signed-out' && session.expired && (
        <Alert tone="info" title={t('auth.signedOutTitle')} className="login-page__notice">{t('auth.signedOutText')}</Alert>
      )}
      <LoginForm authService={auth} onAuthenticated={({ user }) => signIn({ id: user.id, email: user.email, displayName: user.displayName ?? null, role: user.role ?? 'STUDENT' })} />
      <p className="login-page__browse"><Link to="/home">{t('auth.browse')}</Link></p>
    </AuthLayout>
  )
}
