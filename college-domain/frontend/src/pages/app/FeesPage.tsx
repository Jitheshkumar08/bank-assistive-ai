import IconTile from '../../components/app/IconTile'
import PageHeader from '../../components/app/PageHeader'
import FeeStructureCard from '../../components/content/FeeStructureCard'
import { feeInfoSections } from '../../content/fees'
import { useI18n } from '../../i18n/I18nProvider'

/** Screen 7: official fee PDF link plus general pointers. Available before or after the QR scan. */
export default function FeesPage() {
  const { t } = useI18n()
  return (
    <div className="page-narrow">
      <title>{t('common.pageTitle', { page: t('nav.fees') })}</title>
      <PageHeader title={t('nav.fees')} />
      <FeeStructureCard />
      <section className="fee-info" aria-labelledby="fee-info-title">
        <h2 id="fee-info-title">{t('fees.additional')}</h2>
        <ul className="fee-info__list">
          {feeInfoSections.map((section) => (
            <li key={section.id} className="fee-info__item">
              <IconTile icon={section.icon} tone={section.tone} size="sm" />
              <div><strong>{t(section.title)}</strong><span>{t(section.text)}</span></div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
