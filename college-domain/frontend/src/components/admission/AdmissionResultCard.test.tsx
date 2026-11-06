import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { translate } from '../../i18n/catalog'
import type { AdmissionDetails, AdmissionService } from '../../services/admission/admissionService'
import { ServiceError } from '../../services/errors'
import { sessionFor, users } from '../../test/adminFixtures'
import { nmamitContext, renderWithRouter } from '../../test/renderWithRouter'

const fromServer: AdmissionDetails = {
  studentName: 'Asha Rao', nucatRank: 1523, allocatedBranch: 'Computer Science', admissionStatus: 'Allotted', admissionYear: 2026,
  fee: { status: 'CONFIRMED', finalPayableAmount: 360000 },
}
const service = (getDetails: AdmissionService['getDetails']): AdmissionService => ({ getDetails })

function renderCard(admission: AdmissionService, path = '/result') {
  const rendered = renderWithRouter({ path, services: { admission, session: sessionFor(users.student) }, collegeContext: nmamitContext })
  return { ...rendered, card: screen.findByRole('region', { name: translate((localStorage.getItem('campusguide.language') ?? 'en') as 'en', 'result.cardTitle') }) }
}

describe('AdmissionResultCard (QR → automatic admission details)', () => {
  it('right after the scan, shows the signed-in student’s details and fees with no extra prompt', async () => {
    const getDetails = vi.fn().mockResolvedValue(fromServer)
    const card = await renderCard(service(getDetails), '/admission').card
    expect(await within(card).findByText('Asha Rao')).toBeInTheDocument()
    expect(getDetails).toHaveBeenCalledWith({ collegeId: 'nmamit', area: 'admissions-desk' })
    expect(within(card).getByText('1,523')).toBeInTheDocument()
    expect(within(card).getByText('Computer Science')).toBeInTheDocument()
    expect(within(card).getByText('2026')).toBeInTheDocument()
    expect(within(card).getByText('Verified Record')).toBeInTheDocument()
    const fees = within(card).getByRole('region', { name: 'Fees to be paid' })
    // Only the final payable amount, exactly as calculated by the backend.
    expect(within(fees).getByText('Final payable amount').nextSibling).toHaveTextContent('₹3,60,000')
    expect(fees.textContent!.match(/₹/g)).toHaveLength(1)
    expect(fees).not.toHaveTextContent(/scholarship|category|general|tuition|exam fee|deduction|original|breakdown|NRI|total for/i)
    expect(within(fees).getByRole('link', { name: /Official fee structure/ })).toHaveAttribute('href', 'https://nitte.edu.in/fee/BTECH.pdf')
    // No login form, email field or reference prompt anywhere in the flow.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password|email|NUCAT reference/i)).not.toBeInTheDocument()
    expect(fees).not.toHaveTextContent(/remaining|balance due|outstanding/i)
  })

  it('shows "fee information requires confirmation" instead of any amount when the backend cannot confirm the fee', async () => {
    const card = await renderCard(service(vi.fn().mockResolvedValue({ ...fromServer, nucatRank: null, allocatedBranch: null, fee: { status: 'REQUIRES_CONFIRMATION' } }))).card
    expect(await within(card).findByText('Not published')).toBeInTheDocument()
    expect(within(card).getByText('Not yet allocated')).toBeInTheDocument()
    const fees = within(card).getByRole('region', { name: 'Fees to be paid' })
    expect(within(fees).getByRole('status')).toHaveTextContent('Fee information requires confirmation. Please check the official fee structure or contact the admission office.')
    expect(fees).not.toHaveTextContent(/₹|Final payable amount/)
    expect(within(fees).getByRole('link', { name: /Official fee structure/ })).toHaveAttribute('href', 'https://nitte.edu.in/fee/BTECH.pdf')
  })

  it.each([
    ['NO_ADMISSION_RECORD', 'No admission record found for your account.'],
    ['AMBIGUOUS_ADMISSION_RECORD', 'Your record needs to be checked.'],
  ])('%s: explains the situation and shows no record values', async (code, text) => {
    const card = await renderCard(service(vi.fn().mockRejectedValue(new ServiceError(code as 'NO_ADMISSION_RECORD', 'x')))).card
    expect(await within(card).findByText(text)).toBeInTheDocument()
    expect(within(card).getByText('Not verified yet')).toBeInTheDocument()
    expect(within(card).queryByRole('region', { name: 'Fees to be paid' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('a deactivated QR placement sends the student back to scanning', async () => {
    const { router, card } = renderCard(service(vi.fn().mockRejectedValue(new ServiceError('INVALID_QR', 'x'))))
    expect(await within(await card).findByText('This QR code is no longer active.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Scan again' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/scan'))
  })

  it('an expired session shows a session-ended message — no login form in the card', async () => {
    const card = await renderCard(service(vi.fn().mockRejectedValue(new ServiceError('UNAUTHENTICATED', 'Sign in to continue.')))).card
    expect(await within(card).findByRole('alert')).toHaveTextContent('Your session has ended.')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('without a backend, shows an honest not-connected state and no values', async () => {
    const card = await renderCard(service(vi.fn().mockRejectedValue(new ServiceError('BACKEND_NOT_CONNECTED', 'x')))).card
    expect(await within(card).findByText('Admission details aren’t connected yet.')).toBeInTheDocument()
    expect(within(card).getAllByText('—')).toHaveLength(3)
    expect(card).not.toHaveTextContent(/Demo Student|1245|Sample data|₹/)
  })

  it('offers a retry after a network error', async () => {
    const getDetails = vi.fn().mockRejectedValueOnce(new ServiceError('NETWORK', 'Could not reach CampusGuide.')).mockResolvedValueOnce(fromServer)
    const card = await renderCard(service(getDetails)).card
    await userEvent.click(await within(card).findByRole('button', { name: /try again/i }))
    await waitFor(() => expect(within(card).getByText('Asha Rao')).toBeInTheDocument())
    expect(getDetails).toHaveBeenCalledTimes(2)
  })

  it('requires the NMAMIT QR context before any request is made', async () => {
    const getDetails = vi.fn()
    renderWithRouter({ path: '/result', services: { admission: service(getDetails), session: sessionFor(users.student) }, collegeContext: null })
    expect(await screen.findByRole('heading', { name: /needs the NMAMIT QR code/ })).toBeInTheDocument()
    expect(getDetails).not.toHaveBeenCalled()
  })

  it.each([
    ['kn', 'ನಿಮ್ಮ ಪ್ರವೇಶ ವಿವರಗಳು', 'ಪಾವತಿಸಬೇಕಾದ ಶುಲ್ಕ', 'ಪಾವತಿಸಬೇಕಾದ ಅಂತಿಮ ಮೊತ್ತ', 'ಶುಲ್ಕ ಮಾಹಿತಿಯನ್ನು ದೃಢೀಕರಿಸಬೇಕಾಗಿದೆ.'],
    ['hi', 'आपके प्रवेश विवरण', 'देय शुल्क', 'देय अंतिम राशि', 'शुल्क जानकारी की पुष्टि आवश्यक है।'],
  ])('is fully translated in %s (official values stay as recorded)', async (language, title, feeTitle, finalLabel, unconfirmed) => {
    localStorage.setItem('campusguide.language', language)
    const first = renderCard(service(vi.fn().mockResolvedValue(fromServer)))
    const card = await screen.findByRole('region', { name: title })
    expect(await within(card).findByText('Asha Rao')).toBeInTheDocument()
    expect(within(card).getByText('Computer Science')).toBeInTheDocument()
    const fees = within(card).getByRole('region', { name: feeTitle })
    expect(within(fees).getByText(finalLabel).nextSibling).toHaveTextContent('₹3,60,000')
    expect(card).not.toHaveTextContent(/Final payable amount|Fees to be paid|Admission Year/)
    first.unmount()
    renderCard(service(vi.fn().mockResolvedValue({ ...fromServer, fee: { status: 'REQUIRES_CONFIRMATION' } })))
    expect(await screen.findByText(unconfirmed)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: title })).not.toHaveTextContent('requires confirmation')
  })
})
