import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, CircleCheck, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { useServices } from '../app/services'
import { useSession } from '../app/session'
import { passwordLimits, resetPasswordSchema, type ResetPasswordInput, type ResetPasswordValues } from '../components/auth/accountSchemas'
import AuthStatusCard from '../components/auth/AuthStatusCard'
import { applyServerFieldErrors } from '../components/auth/formErrors'
import { useLinkToken } from '../components/auth/useLinkToken'
import AuthLayout from '../components/layout/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'
import { useI18n } from '../i18n/I18nProvider'
import { ServiceError } from '../services/errors'
import '../components/auth/LoginForm.css'

/** Target of the emailed link `/reset-password#token=…`. A successful reset signs the account out everywhere. */
export default function ResetPasswordPage() {
  const { account } = useServices()
  const { refresh } = useSession()
  const { t, tv, err, language } = useI18n()
  const token = useLinkToken()
  const [outcome, setOutcome] = useState<'done' | 'unusable' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ResetPasswordInput, unknown, ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function submit({ password }: ResetPasswordValues) {
    if (!token) return
    setFailure(null)
    try {
      await account.resetPassword({ token, password })
      setOutcome('done')
      refresh() // every session, including one in this browser, has just been revoked
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'INVALID_OR_EXPIRED_TOKEN') setOutcome('unusable')
      else if (!applyServerFieldErrors(error, setError, ['password'], language)) setFailure(err(error, 'reset.failed'))
    }
  }

  let content
  if (outcome === 'done') {
    content = (
      <AuthStatusCard icon={CircleCheck} title={t('reset.doneTitle')} description={t('reset.doneText')}>
        <div className="page-card__actions"><Link className="button-primary" to="/login">{t('common.logIn')}</Link></div>
      </AuthStatusCard>
    )
  } else if (!token || outcome === 'unusable') {
    content = (
      <AuthStatusCard icon={KeyRound} title={t('verify.unusableTitle')} description={t('reset.unusableText')}>
        <div className="page-card__actions"><Link className="button-primary" to="/forgot-password">{t('reset.requestNew')}</Link></div>
      </AuthStatusCard>
    )
  } else {
    content = (
      <form className="login-form" onSubmit={(event) => handleSubmit(submit)(event)} noValidate aria-labelledby="reset-title">
        <header className="login-form__header">
          <h1 id="reset-title" className="login-form__title">{t('reset.title')}</h1>
          <p className="login-form__subtitle">{t('reset.subtitle', passwordLimits)}</p>
        </header>
        {failure && <Alert tone="error" title={t('reset.failedTitle')}>{failure}</Alert>}
        <div className="login-form__fields">
          <PasswordField id="reset-password" label={t('reset.newPassword')} autoComplete="new-password" placeholder={t('signup.passwordPlaceholder', passwordLimits)}
            error={tv(errors.password?.message, passwordLimits)} {...register('password')} />
          <PasswordField id="reset-confirm" label={t('reset.confirm')} autoComplete="new-password" placeholder={t('signup.confirmPlaceholder')}
            error={tv(errors.confirmPassword?.message)} {...register('confirmPassword')} />
        </div>
        <Button type="submit" loading={isSubmitting} loadingLabel={t('reset.submitting')} endIcon={<ArrowRight aria-hidden="true" size={18} />}>{t('reset.submit')}</Button>
      </form>
    )
  }

  return (
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('reset.pageTitle') })}</title>
      {content}
      {outcome !== 'done' && <p className="login-page__browse"><Link to="/login"><ArrowLeft aria-hidden="true" size={16} /> {t('common.backToLogin')}</Link></p>}
    </AuthLayout>
  )
}
