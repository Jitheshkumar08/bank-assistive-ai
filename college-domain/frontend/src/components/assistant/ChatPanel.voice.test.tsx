import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceError } from '../../services/errors'
import { nmamitContext, renderWithRouter } from '../../test/renderWithRouter'

/**
 * Phase 7 — asking CampusGuide by voice. The recorder is replaced by a controllable stand-in (its own behaviour is
 * covered in lib/useVoiceRecorder.test.ts); the assistant service is a fake. SYNTHETIC values.
 */
const recorder = vi.hoisted(() => ({
  supported: true,
  state: 'idle' as 'idle' | 'starting' | 'recording',
  problem: null as null | 'denied' | 'unavailable' | 'no_speech',
  onRecorded: null as null | ((audio: Blob) => void),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('../../lib/useVoiceRecorder', async () => {
  const { useState } = await import('react')
  return {
    useVoiceRecorder: ({ onRecorded }: { onRecorded: (audio: Blob) => void }) => {
      const [, rerender] = useState(0)
      recorder.onRecorded = onRecorded
      recorder.start.mockImplementation(async () => { recorder.state = 'recording'; rerender((n) => n + 1) })
      recorder.stop.mockImplementation(() => { recorder.state = 'idle'; rerender((n) => n + 1) })
      return { ...recorder }
    },
  }
})

/** The student finishes speaking (end-of-speech detection hands over the recording). */
const finishSpeaking = () => act(() => {
  recorder.state = 'idle'
  recorder.onRecorded!(new Blob([new Uint8Array(32)], { type: 'audio/webm' }))
})

beforeEach(() => {
  recorder.supported = true
  recorder.state = 'idle'
  recorder.problem = null
  recorder.onRecorded = null
  recorder.start.mockReset()
  recorder.stop.mockReset()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

const send = vi.fn()

describe('Ask CampusGuide by voice (Phase 7)', () => {
  it('records, shows what was heard as the student’s message, answers, and reads the answer aloud', async () => {
    const sendVoice = vi.fn().mockResolvedValue({ text: 'Bring your NUCAT admit card.', transcript: 'Which certificates should I bring?', studentContext: null })
    const speak = vi.fn().mockResolvedValue(new Blob(['ID3'], { type: 'audio/mpeg' }))
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send, sendVoice, speak } }, collegeContext: nmamitContext })

    expect(await screen.findByRole('note')).toHaveTextContent('Tap the microphone to ask by voice')
    await user.click(screen.getByRole('button', { name: 'Ask by voice' }))
    expect(recorder.start).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Listening…/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop and send' })).toHaveAttribute('aria-pressed', 'true')

    finishSpeaking()
    await waitFor(() => expect(sendVoice).toHaveBeenCalledTimes(1))
    const [request] = sendVoice.mock.calls[0]
    expect(request).toMatchObject({ collegeId: 'nmamit', area: 'admissions-desk', language: 'en' })
    expect(Object.keys(request).sort()).toEqual(['area', 'audio', 'collegeId', 'language'])

    const log = screen.getByRole('log')
    expect(await within(log).findByText('Which certificates should I bring?')).toBeInTheDocument()
    expect(within(log).getByText('Bring your NUCAT admit card.')).toBeInTheDocument()
    await waitFor(() => expect(speak).toHaveBeenCalledWith('Bring your NUCAT admit card.'))
    expect(send).not.toHaveBeenCalled()
  })

  it('a spoken admission-status question shows the student’s own details card', async () => {
    const studentContext = { verified: true, admissionYear: 2026, rank: 145, category: null, allocatedBranch: 'Synthetic Engineering', assignedBatch: null, assignedHall: null, admissionStatus: 'Seat allotted', nextStep: null }
    const sendVoice = vi.fn().mockResolvedValue({ text: 'Your admission details are shown below.', transcript: 'What is my admission status?', studentContext })
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send, sendVoice } }, collegeContext: nmamitContext })
    await user.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    finishSpeaking()
    const card = await screen.findByRole('region', { name: 'Your admission details' })
    expect(within(card).getByText('145')).toBeInTheDocument()
  })

  it('a second tap stops the recording (and sends it)', async () => {
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send, sendVoice: vi.fn() } }, collegeContext: nmamitContext })
    await user.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    await user.click(screen.getByRole('button', { name: 'Stop and send' }))
    expect(recorder.stop).toHaveBeenCalledTimes(1)
  })

  it('"could not hear" is shown in the chat; there is no text Retry for a spoken question', async () => {
    const sendVoice = vi.fn().mockRejectedValue(new ServiceError('VOICE_NOT_UNDERSTOOD', 'Sorry, I could not hear that clearly. Please try again, or type your question.'))
    const user = userEvent.setup()
    renderWithRouter({ path: '/assistant', services: { assistant: { send, sendVoice } }, collegeContext: nmamitContext })
    await user.click(await screen.findByRole('button', { name: 'Ask by voice' }))
    finishSpeaking()
    const log = screen.getByRole('log')
    expect(await within(log).findByText(/could not hear that clearly/)).toBeInTheDocument()
    expect(within(log).getByText('(voice question)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask by voice' })).toBeEnabled()
  })

  it('a blocked microphone is explained, and typing still works', async () => {
    recorder.problem = 'denied'
    renderWithRouter({ path: '/assistant', services: { assistant: { send, sendVoice: vi.fn() } }, collegeContext: nmamitContext })
    expect(await screen.findByText(/Microphone access was blocked/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type your question here...')).toBeEnabled()
  })

  it('without a voice service, or a browser that cannot record, no microphone is offered (never faked)', async () => {
    const { unmount } = renderWithRouter({ path: '/assistant', services: { assistant: { send } }, collegeContext: nmamitContext })
    await screen.findByPlaceholderText('Type your question here...')
    expect(screen.queryByRole('button', { name: 'Ask by voice' })).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('not available yet')
    unmount()

    recorder.supported = false
    renderWithRouter({ path: '/assistant', services: { assistant: { send, sendVoice: vi.fn() } }, collegeContext: nmamitContext })
    await screen.findByPlaceholderText('Type your question here...')
    expect(screen.queryByRole('button', { name: 'Ask by voice' })).not.toBeInTheDocument()
  })
})
