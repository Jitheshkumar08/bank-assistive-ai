import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { backendPendingAuthService } from '../../services/auth/authService'
import { AuthError, type AuthService, type AuthSession } from '../../services/auth/types'
import { renderWithRouter } from '../../test/renderWithRouter'
import LoginForm from './LoginForm'

function deferred() {
  let resolve!: (session: AuthSession) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<AuthSession>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(authService: AuthService = { login: vi.fn() }, onAuthenticated = vi.fn()) {
  const user = userEvent.setup()
  renderWithRouter({ element: <LoginForm authService={authService} onAuthenticated={onAuthenticated} /> })
  return {
    user,
    onAuthenticated,
    email: screen.getByLabelText('Email address'),
    password: screen.getByLabelText('Password'),
    remember: screen.getByRole('checkbox', { name: 'Remember me' }),
    submit: screen.getByRole('button', { name: /log in/i }),
  }
}

describe('LoginForm', () => {
  it('renders the heading, labelled fields and navigation links', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Log in to continue your admission journey.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup')
  })

  it('shows inline errors, marks fields invalid and focuses the first problem when submitted empty', async () => {
    const login = vi.fn()
    const { user, email, password, submit } = setup({ login })
    await user.click(submit)
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription('Enter your email address.')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveFocus()
    expect(login).not.toHaveBeenCalled()
  })

  it('validates the email format when the field is left', async () => {
    const { user, email } = setup()
    await user.type(email, 'not-an-email')
    await user.tab()
    expect(await screen.findByText(/valid email address/)).toBeInTheDocument()
    await user.clear(email)
    await user.type(email, 'student@college.edu')
    await waitFor(() => expect(screen.queryByText(/valid email address/)).not.toBeInTheDocument())
  })

  it('toggles password visibility with an accessible control', async () => {
    const { user, password } = setup()
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(password).toHaveAttribute('type', 'password')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('submits trimmed credentials and the remember-me choice with the Enter key', async () => {
    const pending = deferred()
    const login = vi.fn(() => pending.promise)
    const { user, email, password, remember, onAuthenticated } = setup({ login })
    await user.type(email, ' student@college.edu ')
    await user.click(remember)
    await user.type(password, 'correct horse{Enter}')
    expect(login).toHaveBeenCalledWith({ email: 'student@college.edu', password: 'correct horse', rememberMe: true })
    pending.resolve({ user: { id: 'u1', email: 'student@college.edu' } })
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ user: { id: 'u1', email: 'student@college.edu' } }))
  })

  it('shows a loading state and ignores repeated submissions while a request is in flight', async () => {
    const pending = deferred()
    const login = vi.fn(() => pending.promise)
    const { user, email, password, submit } = setup({ login })
    await user.type(email, 'student@college.edu')
    await user.type(password, 'secret')
    await user.click(submit)
    const busy = await screen.findByRole('button', { name: /logging in/i })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    await user.click(busy)
    await user.type(password, '{Enter}')
    expect(login).toHaveBeenCalledTimes(1)
    pending.reject(new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
    expect(screen.getByRole('button', { name: /log in/i })).toBeEnabled()
  })

  it('reports that the backend is not connected and never claims a successful login', async () => {
    const onAuthenticated = vi.fn()
    const { user, email, password, submit } = setup(backendPendingAuthService, onAuthenticated)
    await user.type(email, 'student@college.edu')
    await user.type(password, 'secret')
    await user.click(submit)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Sign-in is not available yet')
    expect(alert).toHaveTextContent('you have not been signed in')
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('shows a generic message for unexpected failures without leaking details', async () => {
    const { user, email, password, submit } = setup({ login: vi.fn().mockRejectedValue(new Error('ECONNRESET at 10.0.0.5:5432')) })
    await user.type(email, 'student@college.edu')
    await user.type(password, 'secret')
    await user.click(submit)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong while signing you in.')
    expect(alert).not.toHaveTextContent('ECONNRESET')
  })
})
