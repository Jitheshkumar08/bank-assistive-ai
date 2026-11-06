import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthService } from './services/auth/types'
import { ServiceError } from './services/errors'
import { awaitingBatch, dashboard, importRows, mockAdmin, mockSuperAdmin, recordDetail, sessionFor, users } from './test/adminFixtures'
import { renderWithRouter } from './test/renderWithRouter'

const loginAs = (user: typeof users.student): AuthService => ({ login: vi.fn().mockResolvedValue({ user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName ?? undefined } }) })

async function submitLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email address'), 'someone@example.com')
  await user.type(screen.getByLabelText('Password'), 'a long passphrase{Enter}')
}

describe('common login and role-based redirects', () => {
  it.each([
    ['student', '/home'],
    ['collegeAdmin', '/admin/dashboard'],
    ['superAdmin', '/super-admin/dashboard'],
  ] as const)('sends a %s to %s after the one shared login form', async (who, destination) => {
    const user = userEvent.setup()
    const { router } = renderWithRouter({ path: '/login', services: { auth: loginAs(users[who]), session: sessionFor(null), admin: mockAdmin({ dashboard: vi.fn().mockResolvedValue(dashboard) }), superAdmin: mockSuperAdmin() } })
    expect(screen.queryByRole('combobox', { name: /role/i })).not.toBeInTheDocument()
    await submitLogin(user)
    await waitFor(() => expect(router.state.location.pathname).toBe(destination))
  })

  it.each([
    ['student', '/home'],
    ['collegeAdmin', '/admin/dashboard'],
    ['superAdmin', '/super-admin/dashboard'],
  ] as const)('restores an existing %s session on /login and opens %s', async (who, destination) => {
    const { router } = renderWithRouter({ path: '/login', services: { session: sessionFor(users[who]), admin: mockAdmin({ dashboard: vi.fn().mockResolvedValue(dashboard) }), superAdmin: mockSuperAdmin() } })
    await waitFor(() => expect(router.state.location.pathname).toBe(destination))
  })

  it('never sends an account to another role’s portal, even when that was the requested page', async () => {
    const user = userEvent.setup()
    const { router } = renderWithRouter({ path: '/admin/students', services: { auth: loginAs(users.student), session: sessionFor(null) } })
    await screen.findByRole('heading', { name: 'Welcome back' })
    await submitLogin(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('returns a College Admin to the admin page they asked for', async () => {
    const user = userEvent.setup()
    const admin = mockAdmin({ records: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }) })
    const { router } = renderWithRouter({ path: '/admin/students', services: { auth: loginAs(users.collegeAdmin), session: sessionFor(null), admin } })
    await submitLogin(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/students'))
  })

  it.each([
    ['/admin/dashboard', 'student', '/home'],
    ['/super-admin/dashboard', 'student', '/home'],
    ['/super-admin/college-admins', 'collegeAdmin', '/admin/dashboard'],
    ['/admin/students', 'superAdmin', '/super-admin/dashboard'],
    ['/result', 'collegeAdmin', '/admin/dashboard'],
    ['/dashboard', 'collegeAdmin', '/admin/dashboard'],
    ['/dashboard', 'student', '/home'],
  ] as const)('guards %s: a %s is sent to %s', async (path, who, destination) => {
    const { router } = renderWithRouter({ path, services: { session: sessionFor(users[who]), admin: mockAdmin({ dashboard: vi.fn().mockResolvedValue(dashboard) }), superAdmin: mockSuperAdmin() } })
    await waitFor(() => expect(router.state.location.pathname).toBe(destination))
  })

  it('sends signed-out visitors of staff portals to the login page', async () => {
    const { router } = renderWithRouter({ path: '/super-admin/dashboard', services: { session: sessionFor(null) } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})

describe('College Admin dashboard', () => {
  it('shows the backend’s real totals, years, imports and activity', async () => {
    renderWithRouter({ path: '/admin/dashboard', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin({ dashboard: vi.fn().mockResolvedValue(dashboard) }) } })
    expect(await screen.findByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('56 verified by students')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /2024 600, 2025 634/ })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Recent Imports' })).getByRole('link', { name: 'test_2025.xlsx' })).toHaveAttribute('href', '/admin/imports/imp-1')
    expect(screen.getByText('Imported admission records')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByText('Test Staff')).toBeInTheDocument()
  })

  it('shows an error with retry when the dashboard cannot load', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockRejectedValueOnce(new ServiceError('NETWORK', 'Could not reach CampusGuide.')).mockResolvedValue(dashboard)
    renderWithRouter({ path: '/admin/dashboard', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin({ dashboard: load }) } })
    expect(await screen.findByText('Could not reach CampusGuide.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('1,234')).toBeInTheDocument()
  })

  it('shows an empty state instead of invented numbers when there are no records', async () => {
    const empty = { ...dashboard, totals: { records: 0, verifiedByStudents: 0, admissionYears: 0 }, byYear: [], imports: { ...dashboard.imports, latest: null, recent: [] }, recentActivity: [] }
    renderWithRouter({ path: '/admin/dashboard', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin({ dashboard: vi.fn().mockResolvedValue(empty) }) } })
    expect(await screen.findByText('No admission records yet')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Recent Imports' })).getByText('No imports yet')).toBeInTheDocument()
  })
})

describe('Student Records', () => {
  it('lists records from the API and searches by name or reference', async () => {
    const user = userEvent.setup()
    const records = vi.fn().mockResolvedValue({ items: [{ ...recordDetail, verifiedByStudent: false }], total: 1, page: 1, pageSize: 20 })
    renderWithRouter({ path: '/admin/students', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin({ records }) } })
    expect(await screen.findByRole('link', { name: 'TST-1' })).toHaveAttribute('href', '/admin/students/rec-1')
    expect(screen.getByText('Showing 1 to 1 of 1 records')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search'), 'Test')
    await waitFor(() => expect(records).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Test', page: 1 })))
    await user.selectOptions(screen.getByLabelText('Admission Year'), '2024')
    await waitFor(() => expect(records).toHaveBeenLastCalledWith(expect.objectContaining({ admissionYear: 2024 })))
    await user.click(screen.getByRole('button', { name: /^Rank/ }))
    await waitFor(() => expect(records).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'nucatRank', order: 'asc' })))
  })

  it('edits a record only after a reason and an explicit confirmation of the changes', async () => {
    const user = userEvent.setup()
    const updateRecord = vi.fn().mockResolvedValue({ ...recordDetail, nucatRank: 11, updatedAt: '2026-10-23T09:00:00.000Z' })
    renderWithRouter({ path: '/admin/students/rec-1', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin({ record: vi.fn().mockResolvedValue(recordDetail), updateRecord }) } })
    await user.click(await screen.findByRole('button', { name: /Edit Record/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit TST-1' })
    const rank = within(dialog).getByLabelText('NUCAT rank')
    await user.clear(rank)
    await user.type(rank, '11')
    await user.click(within(dialog).getByRole('button', { name: 'Review changes' }))
    expect(await within(dialog).findByText(/Explain the correction/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Reason for the correction'), 'Rank corrected by office')
    await user.click(within(dialog).getByRole('button', { name: 'Review changes' }))
    const confirm = await screen.findByRole('dialog', { name: 'Confirm changes' })
    expect(within(confirm).getByRole('row', { name: /NUCAT rank 12 11/ })).toBeInTheDocument()
    expect(updateRecord).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Confirm and save' }))
    expect(updateRecord).toHaveBeenCalledWith('rec-1', { expectedUpdatedAt: recordDetail.updatedAt, reason: 'Rank corrected by office', nucatRank: 11 })
    expect(await screen.findByText(/The record was updated/)).toBeInTheDocument()
  })
})

describe('Admission import wizard', () => {
  it('rejects unsupported files before uploading anything', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const admin = mockAdmin()
    renderWithRouter({ path: '/admin/imports/new', services: { session: sessionFor(users.collegeAdmin), admin } })
    await user.upload(await screen.findByTestId('import-file-input'), new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByText('Choose an .xlsx or .csv file.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Validate file' })).toBeDisabled()
    expect(admin.previewImport).not.toHaveBeenCalled()
  })

  it('uploads for the chosen year, reviews, and confirms with an explicit duplicate policy', async () => {
    const user = userEvent.setup()
    const committed = { ...awaitingBatch, status: 'partial' as const, duplicatePolicy: 'UPDATE_EXISTING' as const, appliedAt: '2026-10-23T09:10:00.000Z', counts: { ...awaitingBatch.counts, inserted: 2, updated: 1, rejected: 2 } }
    const admin = mockAdmin({
      previewImport: vi.fn().mockResolvedValue(awaitingBatch),
      importDetail: vi.fn().mockResolvedValue(awaitingBatch),
      importRows: vi.fn().mockResolvedValue({ items: importRows, total: 2, page: 1, pageSize: 25 }),
      commitImport: vi.fn().mockResolvedValue(committed),
    })
    const { router } = renderWithRouter({ path: '/admin/imports/new', services: { session: sessionFor(users.collegeAdmin), admin } })
    await user.selectOptions(await screen.findByLabelText('Admission year'), '2025')
    const file = new File(['NUCAT Reference,Student Name\nTST-1,Test Student A\n'], 'test_2025.csv', { type: 'text/csv' })
    await user.upload(screen.getByTestId('import-file-input'), file)
    await user.click(screen.getByRole('button', { name: 'Validate file' }))
    expect(admin.previewImport).toHaveBeenCalledWith(file, 2025)
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/imports/batch-1'))

    expect(await screen.findByRole('heading', { name: 'Import Results' })).toBeInTheDocument()
    expect(await screen.findByText('Missing NUCAT reference.')).toBeInTheDocument()
    expect(screen.getByText(/Ignored \(not recognised\): Remarks/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to review' }))
    await user.click(await screen.findByRole('radio', { name: /Update existing records/ }))
    expect(within(screen.getByLabelText('Proposed changes')).getByText('Records to update').nextSibling).toHaveTextContent('1')
    expect(admin.commitImport).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Confirm import/ }))
    expect(admin.commitImport).toHaveBeenCalledWith('batch-1', 'UPDATE_EXISTING')
    expect(await screen.findByText('Import completed with rejected rows.')).toBeInTheDocument()
    expect(screen.getByText(/2 inserted · 1 updated/)).toBeInTheDocument()
  })

  it('reports a stale preview honestly and does not claim success', async () => {
    const user = userEvent.setup()
    const admin = mockAdmin({
      importDetail: vi.fn().mockResolvedValue(awaitingBatch),
      importRows: vi.fn().mockResolvedValue({ items: importRows, total: 2, page: 1, pageSize: 25 }),
      commitImport: vi.fn().mockRejectedValue(new ServiceError('IMPORT_STALE', 'Admission records changed after the preview. No records were changed.')),
    })
    renderWithRouter({ path: '/admin/imports/batch-1', services: { session: sessionFor(users.collegeAdmin), admin } })
    await user.click(await screen.findByRole('button', { name: 'Continue to review' }))
    await user.click(screen.getByRole('button', { name: /Confirm import/ }))
    expect(await screen.findByText(/No records were changed/)).toBeInTheDocument()
    expect(screen.queryByText(/Import completed/)).not.toBeInTheDocument()
  })
})
