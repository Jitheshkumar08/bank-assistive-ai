import { Link } from 'react-router'
import PageHeader from '../../components/app/PageHeader'
import { useCollegeContext } from '../../app/collegeContext'
import { useSession } from '../../app/session'
import { useI18n } from '../../i18n/I18nProvider'

/** My Profile: account and college-context status. Shows only what the server session provides. */
export default function ProfilePage() {
  const { session, refresh } = useSession()
  const { context, clearContext } = useCollegeContext()
  const { t, language } = useI18n()
  return (
    <div className="page-narrow stack">
      <title>{t('common.pageTitle', { page: t('nav.profile') })}</title>
      <PageHeader title={t('nav.profile')} />
      <section className="content-card" aria-labelledby="profile-account">
        <h2 id="profile-account">{t('profile.account')}</h2>
        {session.status === 'signed-in' ? (
          <dl className="detail-list">
            <div><dt>{t('profile.email')}</dt><dd>{session.user.email}</dd></div>
            <div><dt>{t('profile.emailVerification')}</dt><dd>{t('profile.verified')}</dd></div>
          </dl>
        ) : session.status === 'loading' ? <p role="status">{t('common.checkingSignIn')}</p> : (
          <>
            <p>
              {session.status === 'unavailable' && t('profile.notConnected')}
              {session.status === 'signed-out' && t('profile.signedOut')}
              {session.status === 'error' && (language === 'en' ? session.message : t('error.signInCheck'))}
            </p>
            {session.status === 'error' ? <button type="button" className="button-outline" onClick={refresh}>{t('common.tryAgain')}</button> : <Link to="/login" className="button-primary">{t('common.logIn')}</Link>}
          </>
        )}
      </section>
      <section className="content-card" aria-labelledby="profile-college">
        <h2 id="profile-college">{t('profile.collegeContext')}</h2>
        {context ? (
          <>
            <dl className="detail-list">
              <div><dt>{t('profile.college')}</dt><dd>{t('common.nmamitName')}</dd></div>
              <div><dt>{t('profile.scanned')}</dt><dd>{new Date(context.validatedAt).toLocaleString(`${language}-IN`)}</dd></div>
            </dl>
            <button type="button" className="button-outline" onClick={clearContext}>{t('profile.clearContext')}</button>
          </>
        ) : (
          <>
            <p>{t('profile.noContext')}</p>
            <Link to="/scan" className="button-primary">{t('profile.scan')}</Link>
          </>
        )}
      </section>
    </div>
  )
}
