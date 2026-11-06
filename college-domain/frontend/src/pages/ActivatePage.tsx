import { ArrowLeft, ArrowRight, CircleCheck, KeyRound, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { roleLabel } from '../app/roles'
import { LanguageScope } from '../i18n/I18nProvider'
import { useServices } from '../app/services'
import AuthStatusCard from '../components/auth/AuthStatusCard'
import { useLinkToken } from '../components/auth/useLinkToken'
import AuthLayout from '../components/layout/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'
import type { InvitationInfo } from '../services/auth/invitationService'
import { errorMessage, ServiceError } from '../services/errors'
import '../components/auth/LoginForm.css'

type State = { kind: 'checking' } | { kind: 'ready'; info: InvitationInfo } | { kind: 'invalid'; message: string } | { kind: 'done'; info: InvitationInfo }

/**
 * Target of the staff invitation email `/activate#token=…`. Shows who the invitation is for (without using up the
 * link), then sets the password. The role is fixed by the invitation on the server — nothing here can choose it.
 */
/** Staff activation is part of the English-only staff portals. */
export default function ActivatePage() {
  return <LanguageScope language="en"><ActivateStaffAccount /></LanguageScope>
}

function ActivateStaffAccount() {
  const { invitations } = useServices()
  const token = useLinkToken()
  const [state, setState] = useState<State>(() => (token ? { kind: 'checking' } : { kind: 'invalid', message: 'This activation link is incomplete.' }))
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    invitations.inspect(token).then(
      (info) => { if (active) setState({ kind: 'ready', info }) },
      (error: unknown) => { if (active) setState({ kind: 'invalid', message: errorMessage(error, 'This activation link can’t be used.') }) },
    )
    return () => { active = false }
  }, [invitations, token])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (state.kind !== 'ready' || !token || busy) return
    const min = state.info.passwordMinLength
    const problems: typeof errors = {}
    if (password.length < min) problems.password = `Use at least ${min} characters.`
    else if (password.length > 128) problems.password = 'Use at most 128 characters.'
    if (confirm !== password) problems.confirm = 'The passwords don’t match.'
    setErrors(problems)
    if (Object.keys(problems).length) return
    setBusy(true)
    setFailure(null)
    try {
      await invitations.accept(token, password)
      setState({ kind: 'done', info: state.info })
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'INVALID_OR_EXPIRED_TOKEN') setState({ kind: 'invalid', message: error.message })
      else if (error instanceof ServiceError && error.code === 'VALIDATION_FAILED' && error.details?.length) setErrors({ password: error.details[0].messages[0] })
      else setFailure(errorMessage(error, 'Your account could not be activated. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  let content
  if (state.kind === 'checking') content = <p role="status">Checking your activation link…</p>
  else if (state.kind === 'invalid') {
    content = <AuthStatusCard icon={KeyRound} title="This link can’t be used" description={state.message} notice="Ask the CampusGuide Super Admin to resend your invitation." noticeTitle="What to do" />
  } else if (state.kind === 'done') {
    content = (
      <AuthStatusCard icon={CircleCheck} title="Account activated" description={`Your ${roleLabel[state.info.role]} account for ${state.info.email} is ready. Log in with your new password.`}>
        <div className="page-card__actions"><Link className="button-primary" to="/login">Log in</Link></div>
      </AuthStatusCard>
    )
  } else {
    const { info } = state
    content = (
      <form className="login-form" onSubmit={submit} noValidate aria-labelledby="activate-title">
        <header className="login-form__header">
          <h1 id="activate-title" className="login-form__title">Activate your account</h1>
          <p className="login-form__subtitle">
            {info.displayName}, you’ve been given <strong>{roleLabel[info.role]}</strong> access{info.collegeName ? ` for ${info.collegeName}` : ''}. Choose a password for <strong>{info.email}</strong>.
          </p>
        </header>
        {failure && <Alert tone="error" title="We couldn’t activate your account">{failure}</Alert>}
        <div className="login-form__fields">
          <PasswordField id="activate-password" label="New password" autoComplete="new-password" placeholder={`At least ${info.passwordMinLength} characters`}
            value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} />
          <PasswordField id="activate-confirm" label="Confirm new password" autoComplete="new-password" placeholder="Enter the password again"
            value={confirm} onChange={(event) => setConfirm(event.target.value)} error={errors.confirm} />
        </div>
        <Button type="submit" loading={busy} loadingLabel="Activating…" endIcon={<ArrowRight aria-hidden="true" size={18} />}>Activate account</Button>
        <p className="login-form__privacy"><ShieldCheck aria-hidden="true" size={16} /><span>This link works once and expires {new Date(info.expiresAt).toLocaleString('en-IN')}. Nobody else, including the Super Admin, sees your password.</span></p>
      </form>
    )
  }

  return (
    <AuthLayout languageSelector={false}>
      <title>Activate your account · CampusGuide</title>
      {content}
      {state.kind !== 'done' && <p className="login-page__browse"><Link to="/login"><ArrowLeft aria-hidden="true" size={16} /> Back to log in</Link></p>}
    </AuthLayout>
  )
}
