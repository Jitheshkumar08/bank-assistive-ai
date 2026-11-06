import { useI18n } from '../../i18n/I18nProvider'
import { useMediaQuery } from '../../lib/useMediaQuery'
import BrandMark from '../ui/BrandMark'
import CampusIllustration from '../visual/CampusIllustration'
import CampusVisual from '../visual/CampusVisual'

/** Product identity and the campus visual. The interactive 3D scene only mounts on wide screens. */
export default function BrandPanel() {
  const wide = useMediaQuery('(min-width: 960px)')
  const { t } = useI18n()
  return (
    <aside className="brand-panel" aria-label={t('auth.brandLabel')}>
      <div className="brand-panel__glow" aria-hidden="true" />
      <div className="brand-panel__identity">
        <BrandMark size={44} />
        <span className="brand-panel__name">CampusGuide</span>
      </div>
      <div className="brand-panel__copy">
        <p className="brand-panel__tagline">{t('auth.tagline')}</p>
        <p className="brand-panel__description">{t('auth.brandText')}</p>
      </div>
      <div className="brand-panel__visual">
        {wide ? <CampusVisual /> : <CampusIllustration className="brand-panel__illustration" />}
      </div>
    </aside>
  )
}
