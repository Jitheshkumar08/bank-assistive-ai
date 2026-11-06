import InfoNote from '../../components/app/InfoNote'
import PageHeader from '../../components/app/PageHeader'
import AdmissionTimeline from '../../components/content/AdmissionTimeline'
import { useI18n } from '../../i18n/I18nProvider'

/** Screen 6: numbered admission timeline (general guidance until official content is connected). */
export default function AdmissionProcessPage() {
  const { t } = useI18n()
  return (
    <div className="page-narrow">
      <title>{t('common.pageTitle', { page: t('nav.process') })}</title>
      <PageHeader title={t('nav.process')} />
      <div className="content-card"><AdmissionTimeline /></div>
      <InfoNote>{t('process.note')}</InfoNote>
    </div>
  )
}
