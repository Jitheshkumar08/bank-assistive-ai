import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { nmamitContext, renderWithRouter } from './test/renderWithRouter'

describe('routes and navigation', () => {
  it('opens the student home at the site root', async () => {
    const { router } = renderWithRouter({ path: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back, Student!' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/home')
  })

  it.each([
    ['/home', 'Welcome back, Student!'],
    ['/documents', 'Required Documents'],
    ['/admission-process', 'Admission Process'],
    ['/fees', 'Fee Structure'],
    ['/resources', 'More Admission Resources'],
    ['/admission', 'NMAMIT Dashboard'],
    ['/result', 'Check My Result'],
    ['/assistant', 'Ask CampusGuide'],
    ['/profile', 'My Profile'],
    ['/help', 'Help & Support'],
    ['/scan', 'Scan NMAMIT QR Code'],
    ['/login', 'Welcome back'],
  ])('%s renders its page', async (path, heading) => {
    renderWithRouter({ path })
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  })

  it('navigates with the sidebar and marks the active item', async () => {
    const user = userEvent.setup()
    const { router } = renderWithRouter({ path: '/home' })
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Fee Structure' }))
    expect(router.state.location.pathname).toBe('/fees')
    expect(within(nav).getByRole('link', { name: 'Fee Structure' })).toHaveClass('is-active')
    await user.click(within(nav).getByRole('link', { name: 'Required Documents' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Required Documents' })).toBeInTheDocument()
  })

  it('navigates from the quick-access cards and banner shortcuts', async () => {
    const user = userEvent.setup()
    const { router } = renderWithRouter({ path: '/home' })
    await user.click(await screen.findByRole('link', { name: /Admission Process Step-by-step guide/ }))
    expect(router.state.location.pathname).toBe('/admission-process')
    await user.click(await screen.findByRole('button', { name: 'Go back' }))
    expect(router.state.location.pathname).toBe('/home')
    await user.click(within(await screen.findByRole('navigation', { name: 'Shortcuts' })).getByRole('link', { name: 'Fee Structure' }))
    expect(router.state.location.pathname).toBe('/fees')
  })

  it('locks result and assistant until the NMAMIT QR is scanned, and explains why', async () => {
    renderWithRouter({ path: '/home', collegeContext: null })
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getAllByLabelText('Requires NMAMIT QR scan')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: /Scan the NMAMIT QR code to unlock personal guidance/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Required Documents View the list/ })).toHaveAttribute('href', '/documents')
  })

  it('unlocks them once a college context exists', async () => {
    renderWithRouter({ path: '/home', collegeContext: nmamitContext })
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).queryAllByLabelText('Requires NMAMIT QR scan')).toHaveLength(0)
    expect(screen.getByText('NMAMIT college context active.')).toBeInTheDocument()
  })

  it('links the fee PDF to the official Nitte document in a new tab', async () => {
    renderWithRouter({ path: '/fees' })
    const download = await screen.findByRole('link', { name: /Download PDF/ })
    expect(download).toHaveAttribute('href', 'https://nitte.edu.in/fee/BTECH.pdf')
    expect(download).toHaveAttribute('target', '_blank')
    expect(download).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: /B.Tech Fee Structure Official document from Nitte/ })).toHaveAttribute('href', 'https://nitte.edu.in/fee/BTECH.pdf')
  })

  it('searches app content from the top bar', async () => {
    const user = userEvent.setup()
    const { router } = renderWithRouter({ path: '/home' })
    await user.type(await screen.findByRole('combobox', { name: 'Search admission information' }), 'identity')
    await user.click(await screen.findByRole('option', { name: /Identity proof/ }))
    expect(router.state.location.pathname).toBe('/documents')
    expect(router.state.location.hash).toBe('#identity')
  })

  it('shows sign-in status honestly in the profile menu', async () => {
    const user = userEvent.setup()
    renderWithRouter({ path: '/home' })
    await user.click(await screen.findByRole('button', { name: /open profile menu/ }))
    expect(await screen.findByText(/Not signed in · sign-in not connected yet/)).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Log in/ })).toHaveAttribute('href', '/login')
  })

  it('shows a not-found page for unknown addresses', async () => {
    renderWithRouter({ path: '/does-not-exist' })
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('links from the login page to public admission information', async () => {
    renderWithRouter({ path: '/login' })
    expect(await screen.findByRole('link', { name: 'Browse admission information without logging in' })).toHaveAttribute('href', '/home')
  })
})
