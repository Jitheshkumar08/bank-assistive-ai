import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AssistantReply } from '../../services/assistant/assistantService'
import { ServiceError } from '../../services/errors'
import { nmamitContext, renderWithRouter } from '../../test/renderWithRouter'

describe('Ask CampusGuide', () => {
  it('needs the NMAMIT QR context first', async () => {
    renderWithRouter({ path: '/assistant', collegeContext: null })
    expect(await screen.findByRole('heading', { name: /Ask CampusGuide needs the NMAMIT QR code/ })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Type your question here...')).not.toBeInTheDocument()
  })

  it('shows the five suggested questions and sends one with the college context', async () => {
    let resolve!: (reply: AssistantReply) => void
    const send = vi.fn(() => new Promise<AssistantReply>((done) => { resolve = done }))
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    const chips = await screen.findAllByRole('button', { name: /\?$|\.$/ })
    expect(chips.map((chip) => chip.textContent)).toEqual(['What is the admission process?', 'What documents do I need?', 'How do I check my result?', 'Tell me about the fee structure.', 'When is the next NUCAT exam?'])
    await user.click(screen.getByRole('button', { name: 'What documents do I need?' }))
    expect(send).toHaveBeenCalledWith({ message: 'What documents do I need?', history: [], collegeId: 'nmamit', area: 'admissions-desk', language: 'en', inputMode: 'text' })
    expect(screen.getByText('CampusGuide is replying…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What is the admission process?' })).toBeDisabled()
    resolve({ text: 'Answer from the CampusGuide server.', steps: ['First step'] })
    expect(await screen.findByText('Answer from the CampusGuide server.')).toBeInTheDocument()
    expect(screen.getByText('First step')).toBeInTheDocument()
  })

  it('types and sends with Enter, keeping conversation history', async () => {
    const send = vi.fn().mockResolvedValue({ text: 'Reply one' })
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    const input = await screen.findByPlaceholderText('Type your question here...')
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
    await user.type(input, 'First question{Enter}')
    await screen.findByText('Reply one')
    await user.type(input, 'Second question{Enter}')
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[1][0].history).toEqual([{ role: 'user', text: 'First question' }, { role: 'assistant', text: 'Reply one' }])
  })

  it('shows a clear not-connected message (no invented answer) and can retry', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ServiceError('BACKEND_NOT_CONNECTED', 'The CampusGuide assistant isn’t connected yet.')).mockResolvedValueOnce({ text: 'Now connected.' })
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    await user.click(await screen.findByRole('button', { name: 'When is the next NUCAT exam?' }))
    const log = screen.getByRole('log')
    expect(await within(log).findByText('The CampusGuide assistant isn’t connected yet.')).toBeInTheDocument()
    await user.click(within(log).getByRole('button', { name: /retry/i }))
    expect(await within(log).findByText('Now connected.')).toBeInTheDocument()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].message).toBe('When is the next NUCAT exam?')
  })

  it('shows the student’s own admission details from the backend; unavailable fields say so, nothing is guessed', async () => {
    const send = vi.fn().mockResolvedValue({
      text: 'Your admission details from the official records are shown below.',
      studentContext: { verified: true, admissionYear: 2026, rank: 145, category: null, allocatedBranch: null, assignedBatch: null, assignedHall: null, admissionStatus: 'Seat allotted', nextStep: null },
    } satisfies AssistantReply)
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    await user.type(await screen.findByPlaceholderText('Type your question here...'), 'What is my rank?{Enter}')
    const card = await screen.findByRole('region', { name: 'Your admission details' })
    const value = (label: string) => within(card).getByText(label).nextElementSibling?.textContent
    expect(value('NUCAT Rank')).toBe('145')
    expect(value('Allocated Branch')).toBe('Not yet allocated')
    expect(value('Status')).toBe('Seat allotted')
    expect(value('Admission Hall')).toBe('Not available yet')
    expect(value('Assigned Batch')).toBe('Not available yet')
    expect(value('Admission Category')).toBe('Not available yet')
    expect(value('Next Step')).toBe('Not available yet')
  })

  it('without a speech service no Listen button is offered (never faked)', async () => {
    const send = vi.fn().mockResolvedValue({ text: 'Plain reply.' })
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    await user.type(await screen.findByPlaceholderText('Type your question here...'), 'Hi{Enter}')
    await screen.findByText('Plain reply.')
    expect(screen.queryByRole('button', { name: /^Listen/ })).not.toBeInTheDocument()
  })

  it('a plain answer shows no admission details card', async () => {
    const send = vi.fn().mockResolvedValue({ text: 'General answer.', studentContext: null })
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    await user.type(await screen.findByPlaceholderText('Type your question here...'), 'Hello{Enter}')
    await screen.findByText('General answer.')
    expect(screen.queryByRole('region', { name: 'Your admission details' })).not.toBeInTheDocument()
  })

  it('shows a clear message when the assistant is unavailable', async () => {
    const send = vi.fn().mockRejectedValue(new ServiceError('ASSISTANT_UNAVAILABLE', 'The CampusGuide assistant is not available right now. Please try again in a moment.'))
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    await user.click(await screen.findByRole('button', { name: 'What documents do I need?' }))
    expect(await within(screen.getByRole('log')).findByText(/not available right now/)).toBeInTheDocument()
  })

  it('Listen reads a reply aloud through the backend; a playback failure is reported, the text stays', async () => {
    const send = vi.fn().mockResolvedValue({ text: 'Spoken reply.' })
    const speak = vi.fn().mockResolvedValue(new Blob(['ID3'], { type: 'audio/mpeg' }))
    const play = vi.fn().mockRejectedValueOnce(new Error('autoplay blocked')).mockResolvedValue(undefined)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send, speak } }, collegeContext: nmamitContext })
    await user.type(await screen.findByPlaceholderText('Type your question here...'), 'Hi{Enter}')
    await screen.findByText('Spoken reply.')
    expect(screen.getByRole('note')).toHaveTextContent('Voice input is not available yet')
    await user.click(screen.getByRole('button', { name: /^Listen/ }))
    expect(speak).toHaveBeenCalledWith('Spoken reply.')
    expect(await screen.findByText(/spoken answer could not be played/)).toBeInTheDocument()
    expect(screen.getByText('Spoken reply.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Listen/ }))
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/spoken answer could not be played/)).not.toBeInTheDocument()
  })
})

