import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { InvitationService } from './services/auth/invitationService'
import { ServiceError } from './services/errors'
import { mockSuperAdmin, sessionFor, users } from './test/adminFixtures'
import { renderWithRouter } from './test/renderWithRouter'

const account = { id: 'acc-1', displayName: 'Test Staff', email: 'staff@example.com', status: 'active' as const, college: { id: 'nmamit', shortName: 'NMAMIT' }, createdAt: '2026-10-22T08:00:00.000Z', lastActiveAt: null }

describe('Super Admin portal', () => {
  it('shows the overview from the API', async () => {
    renderWithRouter({ path: '/super-admin/dashboard', services: { session: sessionFor(users.superAdmin), superAdmin: mockSuperAdmin() } })
    expect(await screen.findByText('1 active · 0 suspended')).toBeInTheDocument()
    expect(screen.getByText('No administrative activity yet')).toBeInTheDocument()
  })

  it('invites a College Admin by name and email, validating first', async () => {
    const user = userEvent.setup()
    const superAdmin = mockSuperAdmin({ invite: vi.fn().mockResolvedValue({ id: 'inv-1', email: 'new.staff@example.com', displayName: 'New Staff', expiresAt: '2026-10-26T00:00:00.000Z' }) })
    renderWithRouter({ path: '/super-admin/college-admins', services: { session: sessionFor(users.superAdmin), superAdmin } })
    await user.click(await screen.findByRole('button', { name: /Invite College Admin/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Invite a College Admin' })
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(within(dialog).getByText('Enter the staff member’s full name.')).toBeInTheDocument()
    expect(superAdmin.invite).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText('Full name'), 'New Staff')
    await user.type(within(dialog).getByLabelText('Email address'), 'new.staff@example.com')
    await waitFor(() => expect(within(dialog).getByLabelText('College')).toHaveValue('nmamit'))
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(superAdmin.invite).toHaveBeenCalledWith({ displayName: 'New Staff', email: 'new.staff@example.com', institutionId: 'nmamit' })
    expect(await screen.findByText(/Invitation sent to new.staff@example.com/)).toBeInTheDocument()
  })

  it('reports a missing email provider instead of pretending the invitation was sent', async () => {
    const user = userEvent.setup()
    const superAdmin = mockSuperAdmin({ invite: vi.fn().mockRejectedValue(new ServiceError('EMAIL_PROVIDER_NOT_CONFIGURED', 'Email delivery is not set up on this CampusGuide server yet, so inviting staff is unavailable.')) })
    renderWithRouter({ path: '/super-admin/college-admins?invite=1', services: { session: sessionFor(users.superAdmin), superAdmin } })
    const dialog = await screen.findByRole('dialog', { name: 'Invite a College Admin' })
    await user.type(within(dialog).getByLabelText('Full name'), 'New Staff')
    await user.type(within(dialog).getByLabelText('Email address'), 'new.staff@example.com')
    await waitFor(() => expect(within(dialog).getByLabelText('College')).toHaveValue('nmamit'))
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(await within(dialog).findByText(/Email delivery is not set up/)).toBeInTheDocument()
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument()
  })

  it('suspends access only after confirmation, with an optional reason', async () => {
    const user = userEvent.setup()
    const superAdmin = mockSuperAdmin({ collegeAdmins: vi.fn().mockResolvedValue({ accounts: [account], invitations: [] }), suspend: vi.fn().mockResolvedValue({ id: 'acc-1', status: 'suspended' }) })
    renderWithRouter({ path: '/super-admin/college-admins', services: { session: sessionFor(users.superAdmin), superAdmin } })
    await user.click(await screen.findByRole('button', { name: 'Suspend access' }))
    const dialog = await screen.findByRole('dialog', { name: 'Suspend access?' })
    expect(superAdmin.suspend).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText(/Reason/), 'Left the office')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend access' }))
    expect(superAdmin.suspend).toHaveBeenCalledWith('acc-1', 'Left the office')
    expect(await screen.findByText('Test Staff’s access was suspended.')).toBeInTheDocument()
  })
})

describe('staff invitation activation', () => {
  const token = 't'.repeat(43)
  const invitation = { email: 'new.staff@example.com', displayName: 'New Staff', role: 'COLLEGE_ADMIN' as const, collegeName: 'NMAM Institute of Technology', expiresAt: '2026-10-26T00:00:00.000Z', passwordMinLength: 12 }

  it('shows who the link is for, enforces the minimum length and activates the account', async () => {
    const user = userEvent.setup()
    const invitations: InvitationService = { inspect: vi.fn().mockResolvedValue(invitation), accept: vi.fn().mockResolvedValue({ role: 'COLLEGE_ADMIN' }) }
    const { router } = renderWithRouter({ path: `/activate#token=${token}`, services: { invitations, session: sessionFor(null) } })
    expect(await screen.findByText(/new.staff@example.com/)).toBeInTheDocument()
    expect(screen.getByText('College Administrator')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Confirm new password'), 'short')
    await user.click(screen.getByRole('button', { name: /Activate account/ }))
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(invitations.accept).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('New password'))
    await user.clear(screen.getByLabelText('Confirm new password'))
    await user.type(screen.getByLabelText('New password'), 'a long staff passphrase')
    await user.type(screen.getByLabelText('Confirm new password'), 'a long staff passphrase')
    await user.click(screen.getByRole('button', { name: /Activate account/ }))
    expect(invitations.accept).toHaveBeenCalledWith(token, 'a long staff passphrase')
    expect(await screen.findByRole('heading', { name: 'Account activated' })).toBeInTheDocument()
  })

  it('explains an invalid or used link', async () => {
    const invitations: InvitationService = { inspect: vi.fn().mockRejectedValue(new ServiceError('INVALID_OR_EXPIRED_TOKEN', 'This activation link is invalid, has expired or was already used.')), accept: vi.fn() }
    renderWithRouter({ path: `/activate#token=${token}`, services: { invitations, session: sessionFor(null) } })
    expect(await screen.findByRole('heading', { name: 'This link can’t be used' })).toBeInTheDocument()
    expect(screen.getByText(/already used/)).toBeInTheDocument()
  })
})
