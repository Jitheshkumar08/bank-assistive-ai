import { QrCode } from 'lucide-react'
import { Link } from 'react-router'
import { useI18n } from '../../i18n/I18nProvider'

/** Shown in place of personalised features until a valid NMAMIT QR code has been scanned. `feature` is translated text. */
export default function QrGate({ feature, compact = false }: { feature: string; compact?: boolean }) {
  const { t } = useI18n()
  return (
    <section className={`qr-gate${compact ? ' qr-gate--compact' : ''}`} aria-labelledby="qr-gate-title">
      <span className="qr-gate__icon" aria-hidden="true"><QrCode size={compact ? 22 : 28} /></span>
      <div className="qr-gate__text">
        <h2 id="qr-gate-title">{compact ? t('qrGate.compactTitle') : t('qrGate.title', { feature })}</h2>
        <p>{compact ? t('qrGate.compactText') : t('qrGate.text')}</p>
      </div>
      <Link to="/scan" className="button-primary qr-gate__button"><QrCode size={17} aria-hidden="true" /> {t('qrGate.scan')}</Link>
    </section>
  )
}
