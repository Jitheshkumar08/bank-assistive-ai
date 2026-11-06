import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppProviders from '../../app/AppProviders'
import QrScanner from './QrScanner'

const zxing = vi.hoisted(() => ({
  decodeFromConstraints: vi.fn(),
  decodeFromImageUrl: vi.fn(),
}))
vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints = zxing.decodeFromConstraints
    decodeFromImageUrl = zxing.decodeFromImageUrl
  },
}))

const validPayload = 'campusguide:college/nmamit?area=admissions-desk'

function setup() {
  const onValidated = vi.fn()
  const onCancel = vi.fn()
  const view = render(<AppProviders><QrScanner onValidated={onValidated} onCancel={onCancel} /></AppProviders>)
  return { onValidated, onCancel, ...view }
}

describe('QrScanner', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(), enumerateDevices: vi.fn().mockResolvedValue([{ kind: 'videoinput' }]) } })
    URL.createObjectURL = vi.fn(() => 'blob:qr')
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => vi.clearAllMocks())

  it('explains a denied camera permission and keeps the upload fallback', async () => {
    zxing.decodeFromConstraints.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera permission was denied')
    expect(screen.getByRole('button', { name: 'Upload a photo of the QR code' })).toBeEnabled()
    expect(screen.getByText('Position the NMAMIT QR code within the frame.')).toBeInTheDocument()
  })

  it('explains when the browser has no camera API at all', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent(/secure \(HTTPS\) page/)
  })

  it('validates a decoded NMAMIT QR, then stops the camera and continues', async () => {
    const stop = vi.fn()
    zxing.decodeFromConstraints.mockImplementation(async (_constraints, _video, callback) => {
      setTimeout(() => callback({ getText: () => validPayload }), 0)
      return { stop }
    })
    const { onValidated } = setup()
    await waitFor(() => expect(onValidated).toHaveBeenCalledWith(expect.objectContaining({ collegeId: 'nmamit', area: 'admissions-desk' })))
    expect(stop).toHaveBeenCalled()
  })

  it('rejects a non-NMAMIT QR without showing its content and keeps scanning', async () => {
    let calls = 0
    zxing.decodeFromConstraints.mockImplementation(async (_constraints, _video, callback) => {
      calls += 1
      if (calls === 1) setTimeout(() => callback({ getText: () => 'https://evil.example/login?user=STUDENT-9' }), 0)
      return { stop: vi.fn() }
    })
    const { onValidated } = setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t an NMAMIT CampusGuide QR code')
    expect(document.body).not.toHaveTextContent('evil.example')
    expect(document.body).not.toHaveTextContent('STUDENT-9')
    expect(onValidated).not.toHaveBeenCalled()
    await waitFor(() => expect(calls).toBeGreaterThan(1))
  })

  it('decodes an uploaded image and releases the temporary URL', async () => {
    zxing.decodeFromConstraints.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }))
    zxing.decodeFromImageUrl.mockResolvedValue({ getText: () => validPayload })
    const { onValidated, container } = setup()
    await screen.findByRole('alert')
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['png'], 'qr.png', { type: 'image/png' }))
    await waitFor(() => expect(onValidated).toHaveBeenCalled())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr')
  })

  it('reports an unreadable uploaded image', async () => {
    zxing.decodeFromConstraints.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }))
    zxing.decodeFromImageUrl.mockRejectedValue(new Error('NotFoundException'))
    const { container } = setup()
    await screen.findByRole('alert')
    await userEvent.upload(container.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'blurry.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText(/No QR code could be read from that image/)).toBeInTheDocument()
  })

  it('stops the camera on unmount and cancels on request', async () => {
    const stop = vi.fn()
    zxing.decodeFromConstraints.mockResolvedValue({ stop })
    const { onCancel, unmount } = setup()
    await waitFor(() => expect(screen.getByLabelText('Camera preview').closest('.scanner__viewport')).toHaveClass('is-live'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('disables the flashlight when the device does not support it', async () => {
    zxing.decodeFromConstraints.mockResolvedValue({ stop: vi.fn() })
    setup()
    expect(await screen.findByRole('button', { name: 'Flashlight not supported on this device' })).toBeDisabled()
  })
})
