import { ChevronRight, Lock } from 'lucide-react'
import { Link } from 'react-router'
import type { LinkCard } from '../../content/types'
import { useI18n } from '../../i18n/I18nProvider'
import IconTile from './IconTile'

type Variant = 'feature' | 'compact' | 'row'

/**
 * Navigation card in the three sizes used by the reference:
 * 'feature' (home quick access, solid icon), 'compact' (post-scan dashboard), 'row' (resources list).
 */
export default function QuickAccessCard({ card, variant = 'feature', locked = false, className }: { card: LinkCard; variant?: Variant; locked?: boolean; className?: string }) {
  const { t } = useI18n()
  return (
    <Link to={card.path} className={['qa-card', `qa-card--${variant}`, className].filter(Boolean).join(' ')}>
      <IconTile icon={card.icon} tone={card.tone} variant={variant === 'feature' ? 'solid' : 'soft'} size={variant === 'compact' ? 'sm' : variant === 'row' ? 'md' : 'lg'} />
      <span className="qa-card__text">
        <span className="qa-card__title">{t(card.title)}</span>{' '}
        <span className="qa-card__description">{t(card.description)}</span>
      </span>
      {locked
        ? <Lock className="qa-card__end" size={16} aria-label={t('nav.requiresQr')} />
        : variant !== 'compact' && <ChevronRight className="qa-card__end" size={18} aria-hidden="true" />}
    </Link>
  )
}
