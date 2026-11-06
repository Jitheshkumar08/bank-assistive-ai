import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AdmissionService } from './services/admission/admissionService'
import type { AuthService } from './services/auth/types'
import { sessionFor, users } from './test/adminFixtures'
import { nmamitContext, renderWithRouter } from './test/renderWithRouter'

// A private-data service that must never be called by public pages.
const admissionSpy = (): AdmissionService => ({ getDetails: vi.fn().mockRejectedValue(new Error('private')) })

describe('public Student Portal', () => {
  it('opens the public home page at the portal entry with Log in and Sign up, while signed out', async () => {
    const { router } = renderWithRouter({ path: '/', services: { session: sessionFor(null) } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back, Student!' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/home')
    const account = await screen.findByRole('navigation', { name: 'Account' })
    expect(within(account).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(within(account).getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup')
  })

  it.each([
    ['/documents', 'Required Documents'],
    ['/fees', 'Fee Structure'],
  ])('%s opens directly (and on reload) without login and without private APIs', async (path, heading) => {
    for (let load = 0; load < 2; load += 1) { // a second fresh render = a browser refresh of the same URL
      const admission = admissionSpy()
      const { router, unmount } = renderWithRouter({ path, services: { session: sessionFor(null), admission } })
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(path)
      expect(admission.getDetails).not.toHaveBeenCalled()
      expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('keeps the official fee source link', async () => {
    renderWithRouter({ path: '/fees', services: { session: sessionFor(null) } })
    expect(await screen.findByRole('link', { name: /Download PDF/ })).toHaveAttribute('href', 'https://nitte.edu.in/fee/BTECH.pdf')
  })

  it('navigates between home, Required Documents and Fee Structure while signed out', async () => {
    const user = userEvent.setup()
    const { router } = renderWithRouter({ path: '/home', services: { session: sessionFor(null) } })
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Required Documents' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Required Documents' })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Fee Structure' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Fee Structure' })).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Home' }))
    expect(router.state.location.pathname).toBe('/home')
  })
})

describe('protected student services', () => {
  it.each(['/result', '/profile', '/admission', '/assistant'])('%s sends a signed-out visitor to /login', async (path) => {
    const { router } = renderWithRouter({ path, collegeContext: nmamitContext, services: { session: sessionFor(null), admission: admissionSpy() } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.state).toEqual({ from: path })
  })

  it('returns the student to the requested personalised page after login', async () => {
    const user = userEvent.setup()
    const auth: AuthService = { login: vi.fn().mockResolvedValue({ user: { id: users.student.id, email: users.student.email, role: 'STUDENT' } }) }
    const admission: AdmissionService = { getDetails: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'NO_ADMISSION_RECORD' })) }
    const { router } = renderWithRouter({ path: '/admission', collegeContext: nmamitContext, services: { auth, session: sessionFor(null), admission } })
    await user.type(await screen.findByLabelText('Email address'), users.student.email)
    await user.type(screen.getByLabelText('Password'), 'a long passphrase{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/admission'))
  })

  it('shows signed-in students no Log in / Sign up buttons and keeps the result behind login', async () => {
    renderWithRouter({ path: '/home', services: { session: sessionFor(users.student) } })
    await screen.findByRole('heading', { level: 1, name: 'Welcome back, Student!' })
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Account' })).not.toBeInTheDocument())
  })
})
