import { ChevronRight, ExternalLink } from 'lucide-react'
import { officialFeeDocument } from '../../content/fees'
import { useI18n } from '../../i18n/I18nProvider'

function PdfIcon() {
  return (
    <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true" focusable="false">
      <path d="M4 1h18l11 11v24a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3z" fill="#ef4444" />
      <path d="M22 1v8a3 3 0 0 0 3 3h8z" fill="#fca5a5" />
      <text x="15" y="31" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" fontFamily="Inter Variable, sans-serif">PDF</text>
    </svg>
  )
}

/** Screen 7 card linking to the official Nitte B.Tech fee PDF. No payment happens in CampusGuide. */
export default function FeeStructureCard() {
  const { t } = useI18n()
  const external = { href: officialFeeDocument.url, target: '_blank', rel: 'noopener noreferrer' } as const
  return (
    <section className="fee-card" aria-labelledby="fee-card-title">
      <h2 id="fee-card-title">{t('fees.cardTitle')}</h2>
      <p className="fee-card__intro">{t('fees.intro')}</p>
      <a className="fee-card__document" {...external}>
        <PdfIcon />
        <span className="fee-card__document-text">
          <strong>{t(officialFeeDocument.title)}</strong>{' '}
          <span>{t(officialFeeDocument.source)}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
        <span className="visually-hidden"> {t('fees.opensPdf')}</span>
      </a>
      <a className="button-outline fee-card__download" {...external} download>
        {t('fees.download')} <ExternalLink size={14} aria-hidden="true" />
        <span className="visually-hidden"> {t('fees.downloadHint')}</span>
      </a>
      <p className="fee-card__source">{t('fees.source', { source: 'nitte.edu.in' })}</p>
    </section>
  )
}
