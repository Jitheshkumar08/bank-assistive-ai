import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SessionService, SessionUser } from './services/auth/sessionService'
import { AuthError, type AccountService, type AuthService } from './services/auth/types'
import { ServiceError } from './services/errors'
import { renderWithRouter } from './test/renderWithRouter'

const student: SessionUser = { id: 'student-1', email: 'student@example.com', displayName: null, role: 'STUDENT' }
const token = 'k'.repeat(43)

function sessionService(user: SessionUser | null = null): SessionService & { logout: ReturnType<typeof vi.fn> } {
  return { getSession: vi.fn().mockResolvedValue(user), logout: vi.fn().mockResolvedValue(undefined) }
}

function accountService(overrides: Partial<AccountService> = {}): AccountService {
  return {
    register: vi.fn().mockResolvedValue({ message: 'If this email can be used, we have sent a message with the next step. Check your inbox.' }),
    resendVerification: vi.fn().mockResolvedValue({ message: 'If this email can be used, we have sent a message with the next step. Check your inbox.' }),
    verifyEmail: vi.fn().mockResolvedValue(undefined),
    forgotPassword: vi.fn().mockResolvedValue({ message: 'If an account uses this email, we have sent a password reset link.' }),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function fillSignUp(user: ReturnType<typeof userEvent.setup>, password: string, confirm = password) {
  await user.type(await screen.findByLabelText('Email address'), 'student@example.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.type(screen.getByLabelText('Confirm password'), confirm)
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('sign-up', () => {
  it('registers with the backend and shows its generic “check your email” answer', async () => {
    const user = userEvent.setup()
    const account = accountService()
    renderWithRouter({ path: '/signup', services: { account, session: sessionService() } })
    await fillSignUp(user, 'a long passphrase')
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText(/If this email can be used/)).toBeInTheDocument()
    expect(account.register).toHaveBeenCalledWith({ email: 'student@example.com', password: 'a long passphrase' })
  })

  it('checks the password rules before contacting the server', async () => {
    const user = userEvent.setup()
    const account = accountService()
    renderWithRouter({ path: '/signup', services: { account, session: sessionService() } })
    await fillSignUp(user, 'short', 'different')
    expect(await screen.findByText(/Use at least 12 characters/)).toBeInTheDocument()
    expect(screen.getByText('The passwords don’t match.')).toBeInTheDocument()
    expect(account.register).not.toHaveBeenCalled()
  })

  it('never reports success when the backend cannot send email', async () => {
    const user = userEvent.setup()
    const account = accountService({
      register: vi.fn().mockRejectedValue(new ServiceError('EMAIL_PROVIDER_NOT_CONFIGURED', 'Email delivery is not configured, so no account email can be sent right now.')),
    })
    renderWithRouter({ path: '/signup', services: { account, session: sessionService() } })
    await fillSignUp(user, 'a long passphrase')
    expect(await screen.findByRole('alert')).toHaveTextContent('Email delivery is not configured')
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument()
  })

  it('shows the server’s field errors on the matching field', async () => {
    const user = userEvent.setup()
    const account = accountService({
      register: vi.fn().mockRejectedValue(new ServiceError('VALIDATION_FAILED', 'Check the highlighted fields.', [{ field: 'email', messages: ['email must be a valid email address'] }])),
    })
    renderWithRouter({ path: '/signup', services: { account, session: sessionService() } })
    await fillSignUp(user, 'a long passphrase')
    expect(await screen.findByText('Email must be a valid email address.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('login, session and logout', () => {
  it('sends signed-out students from a protected page to log in, then back to that page', async () => {
    const user = userEvent.setup()
    const auth: AuthService = { login: vi.fn().mockResolvedValue({ user: { id: student.id, email: student.email } }) }
    const { router } = renderWithRouter({ path: '/result', services: { auth, session: sessionService() } })
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    await user.type(screen.getByLabelText('Email address'), student.email)
    await user.type(screen.getByLabelText('Password'), 'a long passphrase{Enter}')
    expect(await screen.findByRole('heading', { level: 1, name: 'Check My Result' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/result')
  })

  it.each(['/result', '/profile'])('protects %s from signed-out students', async (path) => {
    const { router } = renderWithRouter({ path, services: { session: sessionService() } })
    await screen.findByRole('heading', { name: 'Welcome back' })
    expect(router.state.location.pathname).toBe('/login')
  })

  it('keeps public information open to signed-out students', async () => {
    renderWithRouter({ path: '/documents', services: { session: sessionService() } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Required Documents' })).toBeInTheDocument()
  })

  it('offers a new verification link when the account is not verified yet', async () => {
    const user = userEvent.setup()
    const auth: AuthService = { login: vi.fn().mockRejectedValue(new AuthError('EMAIL_NOT_VERIFIED', 'Confirm your email address before signing in.')) }
    const { router } = renderWithRouter({ path: '/login', services: { auth, session: sessionService() } })
    await user.type(await screen.findByLabelText('Email address'), student.email)
    await user.type(screen.getByLabelText('Password'), 'a long passphrase{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Confirm your email address before signing in.')
    expect(within(alert).getByRole('link', { name: 'Send a new verification link' })).toHaveAttribute('href', '/verify-email')
    expect(router.state.location.pathname).toBe('/login')
  })

  it('restores an existing server session on load', async () => {
    const user = userEvent.setup()
    renderWithRouter({ path: '/profile', services: { session: sessionService(student) } })
    expect(await screen.findByText('student@example.com', { selector: 'dd' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open profile menu/ }))
    expect(within(screen.getByRole('menu', { name: 'Profile' })).getByText('student@example.com')).toBeInTheDocument()
  })

  it('sends a signed-in student away from the login page', async () => {
    const { router } = renderWithRouter({ path: '/login', services: { session: sessionService(student) } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('logs out on the server and returns to the login page', async () => {
    const user = userEvent.setup()
    const session = sessionService(student)
    const { router } = renderWithRouter({ path: '/home', services: { session } })
    await user.click(await screen.findByRole('button', { name: /open profile menu/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Logout/ }))
    expect(session.logout).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })
})

describe('emailed links', () => {
  it('confirms an email only after a click, and removes the token from the address', async () => {
    const user = userEvent.setup()
    const account = accountService()
    const { router } = renderWithRouter({ path: `/verify-email#token=${token}`, services: { account, session: sessionService() } })
    await screen.findByRole('heading', { name: 'Confirm your email address' })
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(account.verifyEmail).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm my email' }))
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument()
    expect(account.verifyEmail).toHaveBeenCalledWith(token)
  })

  it('explains an expired verification link and offers a new one', async () => {
    const user = userEvent.setup()
    const account = accountService({ verifyEmail: vi.fn().mockRejectedValue(new ServiceError('INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired.')) })
    renderWithRouter({ path: `/verify-email#token=${token}`, services: { account, session: sessionService() } })
    await user.click(await screen.findByRole('button', { name: 'Confirm my email' }))
    expect(await screen.findByRole('heading', { name: 'This link can’t be used' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email address'), student.email)
    await user.click(screen.getByRole('button', { name: 'Send a new verification link' }))
    expect(await screen.findByText(/If this email can be used/)).toBeInTheDocument()
    expect(account.resendVerification).toHaveBeenCalledWith(student.email)
  })

  it('requests a reset link with the same answer for every address', async () => {
    const user = userEvent.setup()
    const account = accountService()
    renderWithRouter({ path: '/forgot-password', services: { account, session: sessionService() } })
    await user.type(await screen.findByLabelText('Email address'), student.email)
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText('If an account uses this email, we have sent a password reset link.')).toBeInTheDocument()
  })

  it('sets a new password with the token from the link', async () => {
    const user = userEvent.setup()
    const account = accountService()
    renderWithRouter({ path: `/reset-password#token=${token}`, services: { account, session: sessionService() } })
    await user.type(await screen.findByLabelText('New password'), 'a new long passphrase')
    await user.type(screen.getByLabelText('Confirm new password'), 'a new long passphrase')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument()
    expect(account.resetPassword).toHaveBeenCalledWith({ token, password: 'a new long passphrase' })
  })

  it('refuses a reset page opened without a valid token', async () => {
    renderWithRouter({ path: '/reset-password', services: { account: accountService(), session: sessionService() } })
    expect(await screen.findByRole('heading', { name: 'This link can’t be used' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
  })
})
