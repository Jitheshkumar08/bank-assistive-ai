import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, CircleCheck, Mail, MailCheck, MailWarning } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { useServices } from '../app/services'
import { emailOnlySchema, type EmailOnlyInput, type EmailOnlyValues } from '../components/auth/accountSchemas'
import AuthStatusCard from '../components/auth/AuthStatusCard'
import { applyServerFieldErrors } from '../components/auth/formErrors'
import { useLinkToken } from '../components/auth/useLinkToken'
import AuthLayout from '../components/layout/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import TextField from '../components/ui/TextField'
import { useI18n } from '../i18n/I18nProvider'
import { ServiceError } from '../services/errors'
import '../components/auth/LoginForm.css'

type State = { kind: 'ready' } | { kind: 'verifying' } | { kind: 'verified' } | { kind: 'failed'; expired: boolean; error: unknown }

/**
 * Target of the emailed link `/verify-email#token=…`. Confirmation needs a click, so link scanners that open the page
 * cannot use up the single-use token. Without a (valid) token the page offers a new link instead.
 */
export default function VerifyEmailPage() {
  const { account } = useServices()
  const { t, err } = useI18n()
  const token = useLinkToken()
  const [state, setState] = useState<State>({ kind: 'ready' })

  async function confirm() {
    if (!token || state.kind === 'verifying') return
    setState({ kind: 'verifying' })
    try {
      await account.verifyEmail(token)
      setState({ kind: 'verified' })
    } catch (error) {
      const expired = error instanceof ServiceError && (error.code === 'INVALID_OR_EXPIRED_TOKEN' || error.code === 'VALIDATION_FAILED')
      setState({ kind: 'failed', expired, error })
    }
  }

  let content
  if (state.kind === 'verified') {
    content = (
      <AuthStatusCard icon={CircleCheck} title={t('verify.confirmedTitle')} description={t('verify.confirmedText')}>
        <div className="page-card__actions"><Link className="button-primary" to="/login">{t('common.logIn')}</Link></div>
      </AuthStatusCard>
    )
  } else if (!token || (state.kind === 'failed' && state.expired)) {
    content = (
      <AuthStatusCard icon={MailWarning} title={token ? t('verify.unusableTitle') : t('verify.confirmTitle')}
        description={token ? t('verify.unusableText') : t('verify.noTokenText')}>
        <ResendForm />
      </AuthStatusCard>
    )
  } else {
    content = (
      <AuthStatusCard icon={MailCheck} title={t('verify.confirmTitle')} description={t('verify.confirmText')}
        tone="error" noticeTitle={t('verify.failedTitle')} notice={state.kind === 'failed' ? err(state.error, 'verify.failed') : undefined}>
        <Button type="button" onClick={confirm} loading={state.kind === 'verifying'} loadingLabel={t('verify.submitting')} endIcon={<ArrowRight aria-hidden="true" size={18} />}>
          {t('verify.submit')}
        </Button>
      </AuthStatusCard>
    )
  }

  return (
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('verify.pageTitle') })}</title>
      {content}
      {state.kind !== 'verified' && <p className="login-page__browse"><Link to="/login"><ArrowLeft aria-hidden="true" size={16} /> {t('common.backToLogin')}</Link></p>}
    </AuthLayout>
  )
}

/** Sends a fresh verification link. The answer is the same whether or not the address has an unverified account. */
function ResendForm() {
  const { account } = useServices()
  const { t, tv, err, language } = useI18n()
  const [sent, setSent] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<EmailOnlyInput, unknown, EmailOnlyValues>({
    resolver: zodResolver(emailOnlySchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  })

  async function submit({ email }: EmailOnlyValues) {
    setFailure(null)
    try {
      const { message } = await account.resendVerification(email)
      setSent(language === 'en' ? message : t('signup.sentGeneric'))
    } catch (error) {
      if (!applyServerFieldErrors(error, setError, ['email'], language)) setFailure(err(error, 'verify.resendFailed'))
    }
  }

  if (sent) return <Alert tone="info" title={t('signup.sentTitle')}>{sent}</Alert>
  return (
    <form className="login-form" onSubmit={(event) => handleSubmit(submit)(event)} noValidate aria-label={t('verify.resendLabel')}>
      {failure && <Alert tone="error" title={t('verify.resendFailedTitle')}>{failure}</Alert>}
      <TextField id="resend-email" label={t('auth.email')} icon={Mail} type="email" inputMode="email" autoComplete="email"
        autoCapitalize="none" spellCheck={false} placeholder="you@example.com" error={tv(errors.email?.message)} {...register('email')} />
      <Button type="submit" loading={isSubmitting} loadingLabel={t('forgot.submitting')}>{t('verify.resendLabel')}</Button>
    </form>
  )
}
