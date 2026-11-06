import { ArrowLeft, Camera, Flashlight, FlashlightOff, ImageUp, LoaderCircle, QrCode, RefreshCcw, SwitchCamera } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useServices } from '../../app/services'
import { useI18n } from '../../i18n/I18nProvider'
import type { CollegeContext } from '../../services/qr/qrContext'
import CampusGuideLogo from '../app/CampusGuideLogo'
import { decodeQrFromFile, useQrCamera } from './useQrCamera'
import './scanner.css'

type QrScannerProps = {
  onValidated: (context: CollegeContext) => void
  onCancel: () => void
  /** Payload from a scan link opened by the phone's own camera app: checked first, without starting the camera. */
  initialPayload?: string | null
}

/** Screen 2: full-screen camera scanner for the NMAMIT QR code, with image-upload fallback. */
export default function QrScanner({ onValidated, onCancel, initialPayload = null }: QrScannerProps) {
  const { qrContext } = useServices()
  const { t, tv, err } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [validating, setValidating] = useState(Boolean(initialPayload))
  const [rejection, setRejection] = useState<string | null>(null)
  const startRef = useRef<() => Promise<void>>(async () => {})
  const latest = useRef({ onValidated, err })
  useEffect(() => { latest.current = { onValidated, err } }, [onValidated, err])

  const handlePayload = useCallback(async (text: string) => {
    setValidating(true)
    setRejection(null)
    try {
      onValidated(await qrContext.validate(text))
    } catch (problem) {
      // The decoded text itself is never shown: it may be anything.
      setRejection(err(problem, 'scanner.checkFailed'))
      void startRef.current()
    } finally {
      setValidating(false)
    }
  }, [onValidated, qrContext, err])

  const camera = useQrCamera(videoRef, (text) => void handlePayload(text))
  useEffect(() => { startRef.current = camera.start }, [camera.start])

  // A scan link already carries the code: check it and leave the camera off (the student can still start it).
  useEffect(() => {
    if (!initialPayload) return
    let active = true
    qrContext.validate(initialPayload)
      .then((context) => { if (active) latest.current.onValidated(context) })
      .catch((problem: unknown) => { if (active) setRejection(latest.current.err(problem, 'scanner.checkFailed')) })
      .finally(() => { if (active) setValidating(false) })
    return () => { active = false }
  }, [initialPayload, qrContext])

  const startCamera = camera.start
  useEffect(() => { if (!initialPayload) void startCamera() }, [startCamera, initialPayload])

  async function onUpload(file: File | undefined) {
    if (!file) return
    camera.stop('paused')
    setRejection(null)
    try {
      await handlePayload(await decodeQrFromFile(file))
    } catch {
      setRejection(t('scanner.uploadFailed'))
    }
  }

  const message = rejection ?? tv(camera.error ?? undefined) ?? null
  const scanning = camera.status === 'scanning'

  return (
    <div className="scanner">
      <header className="scanner__top">
        <span className="scanner__brand"><CampusGuideLogo size={30} /><span><strong>CampusGuide</strong><small>{t('common.nmamitName')}</small></span></span>
      </header>
      <div className="scanner__title-row">
        <button type="button" className="scanner__back" onClick={onCancel} aria-label={t('scanner.back')}><ArrowLeft size={20} /></button>
        <h1>{t('dest.scan.title')}</h1>
      </div>

      <div className="scanner__stage">
        <div className={`scanner__viewport${scanning ? ' is-live' : ''}`}>
          <video ref={videoRef} className="scanner__video" muted playsInline aria-label={t('scanner.preview')} />
          {!scanning && (
            <div className="scanner__placeholder" aria-hidden="true">
              {camera.status === 'starting' ? <LoaderCircle className="spin" size={34} /> : <QrCode size={46} />}
            </div>
          )}
          <div className="scanner__frame" aria-hidden="true">
            <span /><span /><span /><span />
            {scanning && <i className="scanner__laser" />}
          </div>
          <p className="scanner__instruction">{t('scanner.instruction')}</p>
        </div>

        <div className="scanner__status" aria-live="polite">
          {validating && <p className="scanner__pill"><LoaderCircle className="spin" size={16} aria-hidden="true" /> {t('scanner.checking')}</p>}
          {camera.status === 'starting' && !validating && <p className="scanner__pill"><Camera size={16} aria-hidden="true" /> {t('scanner.starting')}</p>}
          {camera.status === 'paused' && !message && <p className="scanner__pill">{t('scanner.paused')}</p>}
        </div>
        {message && (
          <div className="scanner__error" role="alert">
            <p>{message}</p>
            {camera.status !== 'scanning' && <button type="button" onClick={() => { setRejection(null); void camera.start() }}><RefreshCcw size={15} aria-hidden="true" /> {t('scanner.retryCamera')}</button>}
          </div>
        )}

        <div className="scanner__controls">
          <button type="button" className="scanner__control" onClick={() => void camera.toggleTorch()} disabled={!camera.torchSupported}
            aria-pressed={camera.torchOn} aria-label={camera.torchSupported ? (camera.torchOn ? t('scanner.torchOff') : t('scanner.torchOn')) : t('scanner.torchUnsupported')}>
            {camera.torchOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
          </button>
          <button type="button" className="scanner__control" onClick={() => fileRef.current?.click()} aria-label={t('scanner.upload')}>
            <ImageUp size={20} />
          </button>
          <button type="button" className="scanner__control" onClick={camera.switchCamera} disabled={!camera.canSwitchCamera}
            aria-label={camera.canSwitchCamera ? t('scanner.switch') : t('scanner.oneCamera')}>
            <SwitchCamera size={20} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { void onUpload(event.target.files?.[0]); event.target.value = '' }} />
        </div>

        <button type="button" className="scanner__cancel" onClick={onCancel}>{t('common.cancel')}</button>
        <p className="scanner__privacy">{t('scanner.privacy')}</p>
      </div>
    </div>
  )
}
