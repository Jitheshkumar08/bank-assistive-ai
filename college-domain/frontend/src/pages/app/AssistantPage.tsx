import ChatPanel from '../../components/assistant/ChatPanel'
import PageHeader from '../../components/app/PageHeader'
import QrGate from '../../components/app/QrGate'
import { useCollegeContext } from '../../app/collegeContext'
import { useI18n } from '../../i18n/I18nProvider'

/** Screen 8: Ask CampusGuide. Personalised guidance needs the NMAMIT college context from the QR scan. */
export default function AssistantPage() {
  const { context } = useCollegeContext()
  const { t } = useI18n()
  return (
    <div className="page-narrow">
      <title>{t('common.pageTitle', { page: t('nav.assistant') })}</title>
      <PageHeader title={t('nav.assistant')} />
      {context ? <div className="content-card"><ChatPanel /></div> : <QrGate feature={t('nav.assistant')} />}
    </div>
  )
}
