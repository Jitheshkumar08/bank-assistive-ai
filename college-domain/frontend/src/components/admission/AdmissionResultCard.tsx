import { CalendarDays, CircleAlert, CircleCheck, ExternalLink, IndianRupee, Info, LoaderCircle, Network, QrCode, RefreshCcw, Trophy, UserRound } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useCollegeContext } from '../../app/collegeContext'
import { useServices } from '../../app/services'
import { officialFeeDocument } from '../../content/fees'
import type { MessageKey } from '../../i18n/catalog'
import { useI18n } from '../../i18n/I18nProvider'
import type { AdmissionDetails, FeeDetails } from '../../services/admission/admissionService'
import { ServiceError } from '../../services/errors'
import './admission.css'

type View =
  | { kind: 'loading' }
  | { kind: 'details'; details: AdmissionDetails }
  | { kind: 'no-record' }
  | { kind: 'ambiguous' }
  | { kind: 'invalid-qr' }
  | { kind: 'session-expired' }
  | { kind: 'unavailable' }
  | { kind: 'error'; error: unknown }

function viewForError(error: unknown): View {
  if (error instanceof ServiceError) {
    if (error.code === 'NO_ADMISSION_RECORD') return { kind: 'no-record' }
    if (error.code === 'AMBIGUOUS_ADMISSION_RECORD') return { kind: 'ambiguous' }
    if (error.code === 'INVALID_QR') return { kind: 'invalid-qr' }
    if (error.code === 'UNAUTHENTICATED') return { kind: 'session-expired' }
    if (error.code === 'BACKEND_NOT_CONNECTED') return { kind: 'unavailable' }
  }
  return { kind: 'error', error }
}

const rupees = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)

/**
 * Screen 3 "Your Admission Details". Shown right after a valid QR scan with no further prompt: the backend finds the
 * signed-in student's record by the session account's email. Values are rendered only from that response; the QR
 * context only says which college (and desk) to ask about. An expired session is reported here and handled by the
 * existing sign-in guard.
 */
export default function AdmissionResultCard({ context }: { context: { collegeId: string; area: string | null } }) {
  const { admission } = useServices()
  const { clearContext } = useCollegeContext()
  const navigate = useNavigate()
  const { t, err } = useI18n()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const { collegeId, area } = context

  useEffect(() => {
    let active = true
    admission.getDetails({ collegeId, area })
      .then((details) => { if (active) setView({ kind: 'details', details }) })
      .catch((error: unknown) => { if (active) setView(viewForError(error)) })
    return () => { active = false }
  }, [admission, collegeId, area, attempt])

  const retry = useCallback(() => { setView({ kind: 'loading' }); setAttempt((value) => value + 1) }, [])
  const message = (tone: 'info' | 'error' | 'plain', title: MessageKey, text: MessageKey, role: 'status' | 'alert' = 'status') => (
    <div className={`result-card__message${tone === 'plain' ? '' : ` result-card__message--${tone}`}`} role={role}>
      <p><strong>{t(title)}</strong> {t(text)}</p>
    </div>
  )

  return (
    <section className="result-card" aria-labelledby="result-card-title" aria-busy={view.kind === 'loading'}>
      <div className="result-card__head">
        <h2 id="result-card-title">{t('result.cardTitle')}</h2>
        {view.kind === 'details'
          ? <span className="badge badge--green"><CircleCheck size={13} aria-hidden="true" /> {t('result.verified')}</span>
          : <span className="badge badge--muted">{t('result.notVerified')}</span>}
      </div>

      {view.kind === 'loading' && <p className="result-card__status" role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /> {t('result.checking')}</p>}
      {view.kind === 'details' && (
        <>
          <DetailFields details={view.details} />
          <FeeSection fee={view.details.fee} />
        </>
      )}
      {view.kind === 'no-record' && message('info', 'result.noRecordTitle', 'result.noRecordText')}
      {view.kind === 'ambiguous' && message('info', 'result.ambiguousTitle', 'result.ambiguousText')}
      {view.kind === 'session-expired' && message('info', 'result.sessionExpiredTitle', 'result.sessionExpiredText', 'alert')}
      {view.kind === 'invalid-qr' && (
        <div className="result-card__message result-card__message--error" role="alert">
          <p><strong>{t('result.invalidQrTitle')}</strong> {t('result.invalidQrText')}</p>
          <button type="button" className="button-outline" onClick={() => { clearContext(); navigate('/scan') }}><QrCode size={15} aria-hidden="true" /> {t('result.scanAgain')}</button>
        </div>
      )}
      {view.kind === 'unavailable' && (
        <>
          <DetailFields details={null} />
          <div className="result-card__message result-card__message--info" role="status">
            <p><strong>{t('result.unavailableTitle')}</strong> {t('result.unavailableText')}</p>
            <button type="button" className="button-outline" onClick={retry}><RefreshCcw size={15} aria-hidden="true" /> {t('result.checkAgain')}</button>
          </div>
        </>
      )}
      {view.kind === 'error' && (
        <div className="result-card__message result-card__message--error" role="alert">
          <p>{err(view.error, 'result.loadError')}</p>
          <button type="button" className="button-outline" onClick={retry}><RefreshCcw size={15} aria-hidden="true" /> {t('common.tryAgain')}</button>
        </div>
      )}

      <p className="result-card__footnote"><Info size={16} aria-hidden="true" /> {t('result.footnote')}</p>
    </section>
  )
}

/** Name / rank / branch / year layout from the reference. `null` renders an empty layout with dashes (nothing invented). */
function DetailFields({ details }: { details: AdmissionDetails | null }) {
  const { t } = useI18n()
  // Official values (name, branch, status text) are shown exactly as recorded — never translated.
  const rank = details ? (details.nucatRank === null ? t('result.notPublished') : details.nucatRank.toLocaleString('en-IN')) : '—'
  const branch = details ? details.allocatedBranch ?? t('result.notAllocated') : '—'
  return (
    <dl className={`result-fields${details ? '' : ' result-fields--empty'}`}>
      <div className="result-fields__name">
        <span className="result-fields__avatar" aria-hidden="true"><UserRound size={22} /></span>
        <div><dt>{t('result.name')}</dt><dd>{details ? details.studentName : '—'}</dd></div>
      </div>
      <div className="result-fields__tile">
        <span className="result-fields__icon tone-orange" aria-hidden="true"><Trophy size={20} /></span>
        <div><dt>{t('result.rank')}</dt><dd className="result-fields__rank">{rank}</dd></div>
      </div>
      <div className="result-fields__tile">
        <span className="result-fields__icon tone-blue" aria-hidden="true"><Network size={20} /></span>
        <div><dt>{t('result.branch')}</dt><dd>{branch}</dd></div>
      </div>
      {details?.admissionYear != null && (
        <div className="result-fields__tile">
          <span className="result-fields__icon tone-teal" aria-hidden="true"><CalendarDays size={20} /></span>
          <div><dt>{t('result.year')}</dt><dd>{details.admissionYear}</dd></div>
        </div>
      )}
      {details?.admissionStatus && <div className="result-fields__status"><dt>{t('result.status')}</dt><dd>{details.admissionStatus}</dd></div>}
    </dl>
  )
}

/**
 * Shows only the final payable amount calculated by the backend; without a confirmed amount no figure is shown at all.
 * No breakdown, fee category or scholarship detail is displayed (the API does not send any).
 */
function FeeSection({ fee }: { fee: FeeDetails }) {
  const { t } = useI18n()
  const officialLink = <a className="fee-summary__source" href={officialFeeDocument.url} target="_blank" rel="noopener noreferrer">{t('fee.officialSource')} <ExternalLink size={13} aria-hidden="true" /></a>
  return (
    <section className="fee-summary" aria-labelledby="fee-summary-title">
      <h3 id="fee-summary-title"><IndianRupee size={16} aria-hidden="true" /> {t('fee.cardTitle')}</h3>
      {fee.status === 'CONFIRMED' ? (
        <>
          <dl className="fee-summary__rows">
            <div className="fee-summary__total"><dt>{t('fee.finalPayable')}</dt><dd>{rupees(fee.finalPayableAmount)}</dd></div>
          </dl>
          {officialLink}
        </>
      ) : (
        <div className="fee-summary__unconfirmed" role="status">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <p><strong>{t('fee.unconfirmedTitle')}</strong> {t('fee.unconfirmedHelp')}</p>
            {officialLink}
          </div>
        </div>
      )}
    </section>
  )
}
