import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useCollegeContext } from '../../app/collegeContext'
import QrScanner from '../../components/scanner/QrScanner'
import { useDocumentLanguage, useI18n } from '../../i18n/I18nProvider'

/**
 * Screen 2. A valid NMAMIT QR establishes the college context and continues to the NMAMIT dashboard.
 * Printed codes generated in QR Management open /scan?qr=<payload> directly from the phone's camera app.
 */
export default function ScanPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // Read the scan-link payload once, then remove it from the address bar.
  const [linkPayload] = useState(() => params.get('qr'))
  useEffect(() => { if (params.has('qr')) setParams({}, { replace: true }) }, [params, setParams])
  const { setContext } = useCollegeContext()
  const { t } = useI18n()
  useDocumentLanguage()
  return (
    <>
      <title>{t('common.pageTitle', { page: t('dest.scan.title') })}</title>
      <QrScanner
        initialPayload={linkPayload}
        onValidated={(context) => { setContext(context); navigate('/admission', { state: { justScanned: true } }) }}
        onCancel={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/home'))}
      />
    </>
  )
}
