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
    expect(send).toHaveBeenCalledWith({ message: 'What documents do I need?', history: [], collegeId: 'nmamit', language: 'en', inputMode: 'text' })
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
})
