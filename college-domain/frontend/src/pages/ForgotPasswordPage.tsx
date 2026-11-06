import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, Mail, MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { useServices } from '../app/services'
import { emailOnlySchema, type EmailOnlyInput, type EmailOnlyValues } from '../components/auth/accountSchemas'
import AuthStatusCard from '../components/auth/AuthStatusCard'
import { applyServerFieldErrors } from '../components/auth/formErrors'
import AuthLayout from '../components/layout/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import TextField from '../components/ui/TextField'
import { useI18n } from '../i18n/I18nProvider'
import '../components/auth/LoginForm.css'

/** Requests a reset link. The backend answers the same way for every address, so this page does too. */
export default function ForgotPasswordPage() {
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
      const { message } = await account.forgotPassword(email)
      setSent(language === 'en' ? message : t('forgot.sentGeneric'))
    } catch (error) {
      if (!applyServerFieldErrors(error, setError, ['email'], language)) setFailure(err(error, 'forgot.failed'))
    }
  }

  return (
    <AuthLayout>
      <title>{t('common.pageTitle', { page: t('forgot.pageTitle') })}</title>
      {sent ? (
        <AuthStatusCard icon={MailCheck} title={t('signup.sentTitle')} description={sent} noticeTitle={t('signup.nextStep')}
          notice={t('forgot.sentText')}>
          <Link className="page-card__back" to="/login"><ArrowLeft aria-hidden="true" size={18} /> {t('common.backToLogin')}</Link>
        </AuthStatusCard>
      ) : (
        <>
          <form className="login-form" onSubmit={(event) => handleSubmit(submit)(event)} noValidate aria-labelledby="forgot-title">
            <header className="login-form__header">
              <h1 id="forgot-title" className="login-form__title">{t('forgot.title')}</h1>
              <p className="login-form__subtitle">{t('forgot.subtitle')}</p>
            </header>
            {failure && <Alert tone="error" title={t('forgot.failedTitle')}>{failure}</Alert>}
            <TextField id="forgot-email" label={t('auth.email')} icon={Mail} type="email" inputMode="email" autoComplete="email"
              autoCapitalize="none" spellCheck={false} placeholder="you@example.com" error={tv(errors.email?.message)} {...register('email')} />
            <Button type="submit" loading={isSubmitting} loadingLabel={t('forgot.submitting')} endIcon={<ArrowRight aria-hidden="true" size={18} />}>
              {t('forgot.submit')}
            </Button>
          </form>
          <p className="login-page__browse"><Link to="/login"><ArrowLeft aria-hidden="true" size={16} /> {t('common.backToLogin')}</Link></p>
        </>
      )}
    </AuthLayout>
  )
}
