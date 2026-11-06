import InfoNote from '../../components/app/InfoNote'
import PageHeader from '../../components/app/PageHeader'
import DocumentChecklist from '../../components/content/DocumentChecklist'
import { useI18n } from '../../i18n/I18nProvider'

/** Screen 5: available to everyone, before or after the QR scan. */
export default function DocumentsPage() {
  const { t } = useI18n()
  return (
    <div className="page-narrow">
      <title>{t('common.pageTitle', { page: t('nav.documents') })}</title>
      <PageHeader title={t('nav.documents')} />
      <div className="content-card"><DocumentChecklist /></div>
      <InfoNote>{t('documents.note')}</InfoNote>
    </div>
  )
}
