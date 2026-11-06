import HelpCard from '../../components/app/HelpCard'
import QuickAccessCard from '../../components/app/QuickAccessCard'
import { useCollegeContext } from '../../app/collegeContext'
import { resourceDestinations } from '../../content/destinations'
import { useI18n } from '../../i18n/I18nProvider'

/** Screen 4: more admission resources and the "Need Further Help?" call to action. */
export default function ResourcesPage() {
  const { context } = useCollegeContext()
  const { t } = useI18n()
  return (
    <div className="page-narrow">
      <title>{t('common.pageTitle', { page: t('dest.resources.title') })}</title>
      <h1 className="page-title">{t('dest.resources.title')}</h1>
      <div className="qa-list">
        {resourceDestinations.map((card) => <QuickAccessCard key={card.id} card={card} variant="row" locked={card.requiresQr && !context} />)}
      </div>
      <div className="panel resources-help"><HelpCard /></div>
    </div>
  )
}
