import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import AdmissionResultCard from '../../components/admission/AdmissionResultCard'
import CampusGuideLogo from '../../components/app/CampusGuideLogo'
import CampusImage from '../../components/app/CampusImage'
import PageHeader from '../../components/app/PageHeader'
import QrGate from '../../components/app/QrGate'
import QuickAccessCard from '../../components/app/QuickAccessCard'
import { useCollegeContext } from '../../app/collegeContext'
import { compactDestinations } from '../../content/destinations'
import { useI18n } from '../../i18n/I18nProvider'
import '../../components/admission/admission.css'

/** Screen 3: NMAMIT dashboard after a valid QR scan, with the student's (backend-verified) result. */
export default function AdmissionDashboardPage() {
  const { context, clearContext } = useCollegeContext()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [bannerOpen, setBannerOpen] = useState(Boolean((location.state as { justScanned?: boolean } | null)?.justScanned))

  if (!context) {
    return (
      <div className="page-narrow">
        <title>{t('common.pageTitle', { page: t('dashboard.title') })}</title>
        <PageHeader title={t('dashboard.title')} />
        <QrGate feature={t('qrGate.feature.dashboard')} />
      </div>
    )
  }
  return (
    <div className="page-narrow">
      <title>{t('common.pageTitle', { page: t('dashboard.title') })}</title>
      <h1 className="visually-hidden">{t('dashboard.title')}</h1>
      {bannerOpen && (
        <div className="scan-banner" role="status">
          <span className="scan-banner__icon" aria-hidden="true"><Check size={18} strokeWidth={3} /></span>
          <span className="scan-banner__text">
            <strong>{t('dashboard.detected')}</strong>
            <span>{context.validatedBy === 'server' ? t('dashboard.viewingVerified') : t('dashboard.viewing')}</span>
          </span>
          <button type="button" className="scan-banner__close" onClick={() => setBannerOpen(false)} aria-label={t('common.dismiss')}><X size={18} /></button>
        </div>
      )}
      <section className="college-strip" aria-label={t('dashboard.college')}>
        <CampusImage className="college-strip__image" />
        <CampusGuideLogo size={38} className="college-strip__logo" />
        <div className="college-strip__text">
          <strong>{t('common.nmamitName')}</strong>
          <span>{t('college.parent')}</span>
        </div>
        <button type="button" className="college-strip__change" onClick={() => { clearContext(); navigate('/scan') }}>{t('dashboard.scanAgain')}</button>
      </section>
      <AdmissionResultCard context={context} />
      <div className="dashboard-grid">
        {compactDestinations.map((card) => <QuickAccessCard key={card.id} card={card} variant="compact" />)}
      </div>
    </div>
  )
}
