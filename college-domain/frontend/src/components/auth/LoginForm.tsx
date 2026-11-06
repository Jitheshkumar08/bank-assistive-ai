import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { useI18n } from '../../i18n/I18nProvider'
import { AuthError, type AuthService, type AuthSession } from '../../services/auth/types'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import PasswordField from '../ui/PasswordField'
import TextField from '../ui/TextField'
import { loginSchema, type LoginFormInput, type LoginFormValues } from './loginSchema'
import './LoginForm.css'

type LoginFormProps = {
  /** Injected so the form stays independent of how authentication is implemented. */
  authService: AuthService
  onAuthenticated?: (session: AuthSession) => void
}

export default function LoginForm({ authService, onAuthenticated }: LoginFormProps) {
  const { t, tv, err } = useI18n()
  const [authError, setAuthError] = useState<{ message: string; unverified: boolean } | null>(null)
  // Guards against a second submit slipping in before React re-renders the disabled button.
  const inFlight = useRef(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormInput, unknown, LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', rememberMe: false },
  })

  async function submit(values: LoginFormValues) {
    if (inFlight.current) return
    inFlight.current = true
    setAuthError(null)
    try {
      const session = await authService.login(values)
      onAuthenticated?.(session)
    } catch (error) {
      setAuthError({ message: err(error, 'login.genericFailure'), unverified: error instanceof AuthError && error.code === 'EMAIL_NOT_VERIFIED' })
    } finally {
      inFlight.current = false
    }
  }

  return (
    <form className="login-form" onSubmit={(event) => handleSubmit(submit)(event)} noValidate aria-labelledby="login-title">
      <header className="login-form__header">
        <h1 id="login-title" className="login-form__title">{t('login.title')}</h1>
        <p className="login-form__subtitle">{t('login.subtitle')}</p>
      </header>

      {authError && (
        <Alert tone="error" title={t('login.failedTitle')}>
          {authError.message}
          {authError.unverified && <> <Link className="login-form__inline-link" to="/verify-email">{t('login.resend')}</Link></>}
        </Alert>
      )}

      <div className="login-form__fields">
        <TextField
          id="login-email"
          label={t('auth.email')}
          icon={Mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@example.com"
          error={tv(errors.email?.message)}
          {...register('email')}
        />
        <PasswordField
          id="login-password"
          label={t('auth.password')}
          autoComplete="current-password"
          placeholder={t('login.passwordPlaceholder')}
          error={tv(errors.password?.message)}
          {...register('password')}
        />
      </div>

      <div className="login-form__options">
        <Checkbox id="login-remember" label={t('login.remember')} {...register('rememberMe')} />
        <Link className="login-form__link" to="/forgot-password">{t('login.forgot')}</Link>
      </div>

      <Button type="submit" loading={isSubmitting} loadingLabel={t('login.submitting')} endIcon={<ArrowRight aria-hidden="true" size={18} />}>
        {t('common.logIn')}
      </Button>

      <p className="login-form__signup">
        {t('login.newHere')} <Link className="login-form__link" to="/signup">{t('login.createAccount')}</Link>
      </p>

      <p className="login-form__privacy">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>{t('login.privacy')}</span>
      </p>
    </form>
  )
}
