import AdmissionResultCard from '../../components/admission/AdmissionResultCard'
import InfoNote from '../../components/app/InfoNote'
import PageHeader from '../../components/app/PageHeader'
import QrGate from '../../components/app/QrGate'
import { useCollegeContext } from '../../app/collegeContext'
import { useI18n } from '../../i18n/I18nProvider'

/** Check My Result: dedicated result-verification page (same card as the NMAMIT dashboard). */
export default function ResultPage() {
  const { context } = useCollegeContext()
  const { t } = useI18n()
  return (
    <div className="page-narrow">
      <title>{t('common.pageTitle', { page: t('nav.result') })}</title>
      <PageHeader title={t('nav.result')} />
      {context ? (
        <>
          <AdmissionResultCard context={context} />
          <InfoNote>{t('result.note')}</InfoNote>
        </>
      ) : <QrGate feature={t('nav.result')} />}
    </div>
  )
}
