import type { IScannerControls } from '@zxing/browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageKey } from '../../i18n/catalog'

export type CameraStatus = 'idle' | 'starting' | 'scanning' | 'paused' | 'error'

/** Catalog key explaining a camera failure (permission, hardware, insecure page); the scanner shows it translated. */
export function describeCameraError(error: unknown): MessageKey {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'camera.denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'camera.notFound'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'camera.busy'
    case 'SecurityError':
    case 'NotSupportedError':
      return 'camera.insecure'
    default:
      return 'camera.failed'
  }
}

/**
 * Starts the rear camera into `videoRef` and decodes QR codes until one is found.
 * Every exit path (decode, stop, unmount, tab hidden, camera switch) stops the camera tracks.
 */
export function useQrCamera(videoRef: React.RefObject<HTMLVideoElement | null>, onDecode: (text: string) => void) {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [cameraCount, setCameraCount] = useState(0)
  const controls = useRef<IScannerControls | null>(null)
  const generation = useRef(0)
  const facing = useRef<'environment' | 'user'>('environment')
  const onDecodeRef = useRef(onDecode)
  useEffect(() => { onDecodeRef.current = onDecode }, [onDecode])

  const stop = useCallback((next: CameraStatus = 'idle') => {
    generation.current += 1
    controls.current?.stop()
    controls.current = null
    setTorchOn(false)
    setTorchSupported(false)
    setStatus(next)
  }, [])

  // Camera sessions share one <video>; zxing's stop() clears it. Starts therefore run one at a time, and a start that
  // has been superseded (e.g. React StrictMode remount, double tap on "switch camera") never opens the camera.
  const inflight = useRef<Promise<void>>(Promise.resolve())

  const open = useCallback(async (run: number) => {
    const video = videoRef.current
    if (!video) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError(describeCameraError(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })))
      return
    }
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 })
      const started = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: facing.current } }, audio: false },
        video,
        (result) => {
          if (!result || run !== generation.current) return
          stop('idle')
          onDecodeRef.current(result.getText())
        },
      )
      if (run !== generation.current) { started.stop(); return }
      controls.current = started
      setTorchSupported(typeof started.switchTorch === 'function')
      setStatus('scanning')
      navigator.mediaDevices.enumerateDevices?.().then((devices) => {
        if (run === generation.current) setCameraCount(devices.filter((device) => device.kind === 'videoinput').length)
      }).catch(() => {})
    } catch (problem) {
      if (run !== generation.current) return
      controls.current = null
      setStatus('error')
      setError(describeCameraError(problem))
    }
  }, [stop, videoRef])

  const start = useCallback(() => {
    stop('starting')
    const run = generation.current
    setError(null)
    const task = inflight.current.then(() => (run === generation.current ? open(run) : undefined))
    inflight.current = task.catch(() => {})
    return task
  }, [open, stop])

  const toggleTorch = useCallback(async () => {
    const switchTorch = controls.current?.switchTorch
    if (!switchTorch) return
    try {
      await switchTorch(!torchOn)
      setTorchOn(!torchOn)
    } catch {
      setTorchSupported(false)
    }
  }, [torchOn])

  const switchCamera = useCallback(() => {
    facing.current = facing.current === 'environment' ? 'user' : 'environment'
    void start()
  }, [start])

  // Release the camera when the tab is hidden; the user resumes explicitly.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden && controls.current) stop('paused') }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [stop])

  useEffect(() => () => {
    generation.current += 1
    controls.current?.stop()
    controls.current = null
  }, [])

  return { status, error, setError, start, stop, torchSupported, torchOn, toggleTorch, canSwitchCamera: cameraCount > 1, switchCamera }
}

/** Decodes a QR code from an uploaded image file; the temporary object URL is always released. */
export async function decodeQrFromFile(file: File): Promise<string> {
  const { BrowserQRCodeReader } = await import('@zxing/browser')
  const url = URL.createObjectURL(file)
  try {
    return (await new BrowserQRCodeReader().decodeFromImageUrl(url)).getText()
  } finally {
    URL.revokeObjectURL(url)
  }
}
