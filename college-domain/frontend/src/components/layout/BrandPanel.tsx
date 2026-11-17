import { useI18n } from '../../i18n/I18nProvider'
import BrandMark from '../ui/BrandMark'

/** Product identity and the real NMAMIT campus photograph (public/images/A06I0266.jpg). */
export default function BrandPanel() {
  const { t } = useI18n()
  return (
    <aside className="brand-panel" aria-label={t('auth.brandLabel')}>
      <div className="brand-panel__identity">
        <BrandMark size={44} />
        <span className="brand-panel__name">CampusGuide</span>
      </div>
      <div className="brand-panel__copy">
        <p className="brand-panel__tagline">{t('auth.tagline')}</p>
        <p className="brand-panel__description">{t('auth.brandText')}</p>
      </div>
      <div className="brand-panel__visual">
        <img className="brand-panel__photo" src="/images/A06I0266.jpg" alt={t('common.campusAlt')} decoding="async" />
      </div>
    </aside>
  )
}
