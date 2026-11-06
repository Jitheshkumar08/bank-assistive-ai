import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, Mail, MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { useServices } from '../app/services'
import { passwordLimits, signUpSchema, type SignUpInput, type SignUpValues } from '../components/auth/accountSchemas'
import AuthStatusCard from '../components/auth/AuthStatusCard'
import { applyServerFieldErrors } from '../components/auth/formErrors'
import AuthLayout from '../components/layout/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import PasswordField from '../components/ui/PasswordField'
import TextField from '../components/ui/TextField'
import { useI18n } from '../i18n/I18nProvider'
import '../components/auth/LoginForm.css'

/** Registration. Success only means the backend accepted the request and sent (or will send) a verification email. */
export default function SignUpPage() {
  const { account } = useServices()
  const { t, tv, err, language } = useI18n()
  const [sent, setSent] = useState<{ email: string; message: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<SignUpInput, unknown, SignUpValues>({
    resolver: zodResolver(signUpSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', confirmPassword: '' },
  })

  async function submit({ email, password }: SignUpValues) {
    setFailure(null)
    try {
      const { message } = await account.register({ email, password })
      setSent({ email, message: language === 'en' ? message : t('signup.sentGeneric') })
    } catch (error) {
      if (!applyServerFieldErrors(error, setError, ['email', 'password'], language)) setFailure(err(error, 'signup.failed'))
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <title>{t('common.pageTitle', { page: t('signup.sentTitle') })}</title>
        <AuthStatusCard icon={MailCheck} title={t('signup.sentTitle')} description={sent.message} noticeTitle={t('signup.nextStep')}
          notice={t('signup.nextStepText', { email: sent.email })}>
          <div className="page-card__actions">
            <Link className="button-primary" to="/login">{t('signup.goToLogin')}</Link>
            <Link className="login-form__link" to="/verify-email">{t('signup.noEmail')}</Link>
          </div>
        </AuthStatusCard>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('signup.pageTitle') })}</title>
      <form className="login-form" onSubmit={(event) => handleSubmit(submit)(event)} noValidate aria-labelledby="signup-title">
        <header className="login-form__header">
          <h1 id="signup-title" className="login-form__title">{t('signup.title')}</h1>
          <p className="login-form__subtitle">{t('signup.subtitle')}</p>
        </header>

        {failure && <Alert tone="error" title={t('signup.failedTitle')}>{failure}</Alert>}

        <div className="login-form__fields">
          <TextField id="signup-email" label={t('auth.email')} icon={Mail} type="email" inputMode="email" autoComplete="email"
            autoCapitalize="none" spellCheck={false} placeholder="you@example.com" error={tv(errors.email?.message)} {...register('email')} />
          <PasswordField id="signup-password" label={t('auth.password')} autoComplete="new-password" placeholder={t('signup.passwordPlaceholder', passwordLimits)}
            error={tv(errors.password?.message, passwordLimits)} {...register('password')} />
          <PasswordField id="signup-confirm" label={t('signup.confirm')} autoComplete="new-password" placeholder={t('signup.confirmPlaceholder')}
            error={tv(errors.confirmPassword?.message)} {...register('confirmPassword')} />
        </div>

        <Button type="submit" loading={isSubmitting} loadingLabel={t('signup.submitting')} endIcon={<ArrowRight aria-hidden="true" size={18} />}>
          {t('signup.submit')}
        </Button>

        <p className="login-form__signup">
          {t('signup.haveAccount')} <Link className="login-form__link" to="/login">{t('common.logIn')}</Link>
        </p>
      </form>
      <p className="login-page__browse"><Link to="/login"><ArrowLeft aria-hidden="true" size={16} /> {t('common.backToLogin')}</Link></p>
    </AuthLayout>
  )
}
