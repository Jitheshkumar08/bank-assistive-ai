import { Link } from 'react-router'
import { useI18n } from '../../i18n/I18nProvider'
import SupportIllustration from './SupportIllustration'

/** "Need Further Help?" card (screen 4 and the home side panel). */
export default function HelpCard({ heading }: { heading?: string }) {
  const { t } = useI18n()
  return (
    <section className="help-card" aria-labelledby="help-card-title">
      <h2 id="help-card-title" className="help-card__heading">{heading ?? t('helpCard.heading')}</h2>
      <div className="help-card__body">
        <SupportIllustration className="help-card__art" />
        <div className="help-card__text">
          <p className="help-card__title">{t('helpCard.title')}</p>
          <p className="help-card__description">{t('helpCard.text')}</p>
          <Link to="/assistant" className="button-primary">{t('helpCard.start')}</Link>
        </div>
      </div>
    </section>
  )
}
