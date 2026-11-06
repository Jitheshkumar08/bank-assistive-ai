import { CircleCheck } from 'lucide-react'
import { Link } from 'react-router'
import AnnouncementPanel from '../../components/app/AnnouncementPanel'
import HelpCard from '../../components/app/HelpCard'
import QrGate from '../../components/app/QrGate'
import QuickAccessCard from '../../components/app/QuickAccessCard'
import WelcomeBanner from '../../components/app/WelcomeBanner'
import { useCollegeContext } from '../../app/collegeContext'
import { displayNameOf, useSession } from '../../app/session'
import { destinations } from '../../content/destinations'
import { useI18n } from '../../i18n/I18nProvider'

/** Screen 1: student home. General information is open; personalised features wait for the NMAMIT QR scan. */
export default function HomePage() {
  const { session } = useSession()
  const { t } = useI18n()
  const { context } = useCollegeContext()
  const locked = !context
  return (
    <div className="home-grid">
      <title>{t('common.pageTitle', { page: t('home.title') })}</title>
      <div>
        <WelcomeBanner name={displayNameOf(session) ?? t('common.student')} />
        {locked
          ? <QrGate feature={t('qrGate.feature.personal')} compact />
          : (
            <p className="context-chip" role="status">
              <CircleCheck size={16} aria-hidden="true" /> {t('home.contextActive')}
              <Link to="/admission">{t('home.openDashboard')}</Link>
            </p>
          )}
        <h2 className="section-title">{t('home.quickAccess')}</h2>
        <div className="qa-grid">
          <QuickAccessCard card={destinations.documents} />
          <QuickAccessCard card={destinations.process} />
          <QuickAccessCard card={destinations.fees} />
          <QuickAccessCard card={destinations.result} locked={locked} />
          <QuickAccessCard card={destinations.assistant} locked={locked} className="qa-card--wide qa-card--highlight" />
        </div>
      </div>
      <aside className="home-side" aria-label={t('home.sideLabel')}>
        <AnnouncementPanel />
        <div className="panel"><HelpCard heading={t('home.needHelp')} /></div>
      </aside>
    </div>
  )
}
