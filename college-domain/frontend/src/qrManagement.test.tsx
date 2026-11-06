import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceError } from './services/errors'
import { payloadFromScan, parseQrPayload } from './services/qr/qrContext'
import { mockAdmin, mockQrReader, mockSuperAdmin, qrPlacement, sessionFor, users } from './test/adminFixtures'
import { renderWithRouter } from './test/renderWithRouter'

vi.mock('@zxing/browser', () => ({ BrowserQRCodeReader: class { decodeFromConstraints = vi.fn(); decodeFromImageUrl = vi.fn() } }))

const DESK = 'campusguide:college/nmamit?area=admissions-desk'

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:qr-preview')
  URL.revokeObjectURL = vi.fn()
})

describe('Super Admin QR Management', () => {
  it('lists placements with preview, identifiers, status, public URL and PNG/SVG downloads', async () => {
    const superAdmin = mockSuperAdmin()
    renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.superAdmin), superAdmin } })
    const card = await screen.findByRole('article', { name: 'Admission desk' })
    expect(within(card).getByText('Active')).toBeInTheDocument()
    expect(within(card).getByText(DESK)).toBeInTheDocument()
    expect(within(card).getByText('admissions-desk')).toBeInTheDocument()
    expect(await within(card).findByRole('img', { name: 'QR code for Admission desk' })).toHaveAttribute('src', 'blob:qr-preview')
    expect(superAdmin.qrCodes.image).toHaveBeenCalledWith('q-1', 'png')
    expect(screen.getByText(/Codes open/)).toHaveTextContent('https://campusguide.nitte.example/scan')
    await userEvent.click(within(card).getByRole('button', { name: 'Download SVG for Admission desk' }))
    expect(superAdmin.qrCodes.download).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-1' }), 'svg')
    await userEvent.click(within(card).getByRole('button', { name: 'Download PNG for Admission desk' }))
    expect(superAdmin.qrCodes.download).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-1' }), 'png')
    expect(screen.getByRole('link', { name: 'QR Management' })).toHaveAttribute('href', '/super-admin/qr-codes')
  })

  it('warns when codes would point at a development address', async () => {
    const superAdmin = mockSuperAdmin({ qrCodes: { ...mockQrReader([qrPlacement()], 'http://localhost:5173'), create: vi.fn(), setActive: vi.fn() } })
    renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.superAdmin), superAdmin } })
    expect(await screen.findByText('Development address')).toBeInTheDocument()
  })

  it('creates a placement after validating the form, suggesting the location id from the name', async () => {
    const user = userEvent.setup()
    const created = qrPlacement({ id: 'q-2', areaSlug: 'central-library', label: 'Central Library', payload: 'campusguide:college/nmamit?area=central-library' })
    const superAdmin = mockSuperAdmin()
    superAdmin.qrCodes.create = vi.fn().mockResolvedValue(created)
    renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.superAdmin), superAdmin } })
    await user.click(await screen.findByRole('button', { name: /New QR placement/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New QR placement' })
    await user.click(within(dialog).getByRole('button', { name: 'Create placement' }))
    expect(within(dialog).getByText(/Enter where the code will be displayed/)).toBeInTheDocument()
    expect(superAdmin.qrCodes.create).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText('Location name'), 'Central Library')
    expect(within(dialog).getByLabelText('Location id')).toHaveValue('central-library')
    await waitFor(() => expect(within(dialog).getByLabelText('College')).toHaveValue('nmamit'))
    await user.click(within(dialog).getByRole('button', { name: 'Create placement' }))
    expect(superAdmin.qrCodes.create).toHaveBeenCalledWith({ institutionId: 'nmamit', label: 'Central Library', areaSlug: 'central-library' })
    expect(await screen.findByText(/QR placement “Central Library” was created/)).toBeInTheDocument()
  })

  it('shows the server’s duplicate error and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const superAdmin = mockSuperAdmin()
    superAdmin.qrCodes.create = vi.fn().mockRejectedValue(new ServiceError('CONFLICT', 'A QR placement with the location id "admissions-desk" already exists for this college.'))
    renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.superAdmin), superAdmin } })
    await user.click(await screen.findByRole('button', { name: /New QR placement/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New QR placement' })
    await user.type(within(dialog).getByLabelText('Location name'), 'Admissions desk')
    await user.clear(within(dialog).getByLabelText('Location id'))
    await user.type(within(dialog).getByLabelText('Location id'), 'admissions-desk')
    await waitFor(() => expect(within(dialog).getByLabelText('College')).toHaveValue('nmamit'))
    await user.click(within(dialog).getByRole('button', { name: 'Create placement' }))
    expect(await within(dialog).findByText(/already exists for this college/)).toBeInTheDocument()
  })

  it('asks for confirmation before deactivating, then reactivates without a prompt', async () => {
    const user = userEvent.setup()
    const superAdmin = mockSuperAdmin()
    superAdmin.qrCodes.setActive = vi.fn().mockResolvedValue(qrPlacement({ isActive: false }))
    renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.superAdmin), superAdmin } })
    await user.click(await screen.findByRole('button', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate this QR placement?' })
    expect(dialog).toHaveTextContent('every printed copy of this code stops working')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(superAdmin.qrCodes.setActive).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }))
    expect(superAdmin.qrCodes.setActive).toHaveBeenCalledWith('q-1', false)
    expect(await screen.findByText(/was deactivated/)).toBeInTheDocument()
  })

  it('activates an inactive placement and shows recent QR audit events', async () => {
    const user = userEvent.setup()
    const superAdmin = mockSuperAdmin({
      qrCodes: { ...mockQrReader([qrPlacement({ isActive: false })]), create: vi.fn(), setActive: vi.fn().mockResolvedValue(qrPlacement()) },
      auditEvents: vi.fn().mockResolvedValue({ items: [{ id: 'e-1', action: 'QR_PLACEMENT_DEACTIVATED', description: 'Deactivated a QR placement', actorType: 'SUPER_ADMIN', actorName: 'Test Root', entityType: 'InstitutionQrCode', entityId: 'q-1', metadata: { label: 'Admission desk', areaSlug: 'admissions-desk' }, createdAt: '2026-10-27T10:00:00.000Z' }], total: 1, page: 1, pageSize: 10 }),
    })
    renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.superAdmin), superAdmin } })
    const card = await screen.findByRole('article', { name: 'Admission desk' })
    expect(within(card).getByText('Inactive')).toBeInTheDocument()
    expect(await screen.findByText('Deactivated a QR placement')).toBeInTheDocument()
    expect(superAdmin.auditEvents).toHaveBeenCalledWith({ entityType: 'InstitutionQrCode', pageSize: 10 })
    await user.click(within(card).getByRole('button', { name: 'Activate' }))
    expect(superAdmin.qrCodes.setActive).toHaveBeenCalledWith('q-1', true)
    expect(await screen.findByText(/is active again/)).toBeInTheDocument()
  })

  it('shows an error state with retry when the list cannot load', async () => {
    const superAdmin = mockSuperAdmin()
    superAdmin.qrCodes.list = vi.fn().mockRejectedValueOnce(new ServiceError('NETWORK', 'Could not reach CampusGuide.')).mockResolvedValueOnce({ items: [], publicAppUrl: 'https://campusguide.nitte.example' })
    renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.superAdmin), superAdmin } })
    await userEvent.click(await screen.findByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('No QR placements yet')).toBeInTheDocument()
  })
})

describe('College Admin QR Codes', () => {
  it('lists and downloads codes, with no create / activate / deactivate controls', async () => {
    const admin = mockAdmin()
    renderWithRouter({ path: '/admin/qr-codes', services: { session: sessionFor(users.collegeAdmin), admin } })
    const card = await screen.findByRole('article', { name: 'Admission desk' })
    expect(within(card).getByText('Active')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Download PNG for Admission desk' }))
    expect(admin.qrCodes.download).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-1' }), 'png')
    expect(screen.queryByRole('button', { name: /New QR placement|Deactivate|Activate/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'QR Codes' })).toHaveAttribute('href', '/admin/qr-codes')
  })

  it('shows an empty state when the college has no QR codes', async () => {
    const admin = mockAdmin({ qrCodes: { ...mockQrReader([]), download: vi.fn() } })
    renderWithRouter({ path: '/admin/qr-codes', services: { session: sessionFor(users.collegeAdmin), admin } })
    expect(await screen.findByText('No QR codes yet')).toBeInTheDocument()
  })

  it('is English-only even when the Student Portal language is Kannada', async () => {
    localStorage.setItem('campusguide.language', 'kn')
    renderWithRouter({ path: '/admin/qr-codes', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin() } })
    expect(await screen.findByRole('heading', { level: 1, name: 'QR Codes' })).toBeInTheDocument()
  })

  it('a College Admin cannot open the Super Admin QR page', async () => {
    const { router } = renderWithRouter({ path: '/super-admin/qr-codes', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin() } })
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/super-admin/qr-codes'))
  })
})

describe('Student scanning of generated codes', () => {
  const link = `${window.location.origin}/scan?qr=${encodeURIComponent(DESK)}`

  it('reads both the original payload and this app’s scan link; rejects other sites and shapes', () => {
    expect(parseQrPayload(DESK)).toEqual({ collegeId: 'nmamit', area: 'admissions-desk' })
    expect(parseQrPayload(link)).toEqual({ collegeId: 'nmamit', area: 'admissions-desk' })
    for (const bad of [`https://evil.example/scan?qr=${encodeURIComponent(DESK)}`, `${window.location.origin}/login?qr=x`, `${link}&next=x`, `${link}#x`]) {
      expect(() => payloadFromScan(bad)).toThrow(ServiceError)
    }
  })

  it('opening /scan?qr=… from the phone camera validates the code without starting the camera, then continues', async () => {
    const validate = vi.fn().mockResolvedValue({ collegeId: 'nmamit', collegeName: 'NMAM Institute of Technology', area: 'admissions-desk', validatedAt: new Date().toISOString(), validatedBy: 'server' })
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) } })
    const admission = { getDetails: vi.fn().mockRejectedValue(new ServiceError('NO_ADMISSION_RECORD', 'x')) }
    const { router } = renderWithRouter({ path: `/scan?qr=${encodeURIComponent(DESK)}`, services: { qrContext: { validate }, session: sessionFor(users.student), admission } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/admission'))
    expect(validate).toHaveBeenCalledWith(DESK)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('an inactive or invalid linked code shows the scanner error and does not continue', async () => {
    const validate = vi.fn().mockRejectedValue(new ServiceError('INVALID_QR', 'This isn’t an approved CampusGuide QR code. Scan the QR code displayed at the NMAMIT admission desk.'))
    const { router } = renderWithRouter({ path: `/scan?qr=${encodeURIComponent(DESK)}`, services: { qrContext: { validate }, session: sessionFor(users.student) } })
    expect(await screen.findByRole('alert')).toHaveTextContent('approved CampusGuide QR code')
    expect(router.state.location.pathname).toBe('/scan')
    expect(router.state.location.search).toBe('')
  })
})
