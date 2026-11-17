import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceRecorder } from './useVoiceRecorder'

/**
 * Phase 7 — the browser recorder for spoken questions, with stand-ins for getUserMedia, MediaRecorder and Web Audio
 * (scripted input levels). Fake timers: windows are counted in 100 ms frames.
 */
const FRAME = 100
let levels: number[] = []
let track: { stop: ReturnType<typeof vi.fn> }
let getUserMedia: ReturnType<typeof vi.fn>

class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  static last: FakeRecorder | null = null
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_stream: unknown, options?: { mimeType?: string }) { this.mimeType = options?.mimeType ?? ''; FakeRecorder.last = this }
  start() { this.state = 'recording' }
  stop() {
    if (this.state === 'inactive') throw new Error('InvalidStateError')
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

/** One analyser read per frame returns the next scripted level (dBFS) as a constant-amplitude window. */
class FakeAudioContext {
  state = 'running'
  createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
  createAnalyser() {
    return {
      fftSize: 0,
      disconnect: vi.fn(),
      getFloatTimeDomainData(buffer: Float32Array) {
        const db = levels.length ? levels.shift()! : -70
        buffer.fill(db <= -100 ? 0 : 10 ** (db / 20))
      },
    }
  }
  close() { return Promise.resolve() }
}

beforeEach(() => {
  vi.useFakeTimers()
  levels = []
  track = { stop: vi.fn() }
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const frames = (count: number, db: number) => Array.from({ length: count }, () => db)
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

async function startWith(script: number[], options: Partial<Parameters<typeof useVoiceRecorder>[0]> = {}) {
  levels = script
  const onRecorded = vi.fn()
  const hook = renderHook(() => useVoiceRecorder({ onRecorded, ...options }))
  await act(() => hook.result.current.start())
  return { hook, onRecorded }
}

describe('useVoiceRecorder (Phase 7)', () => {
  it('sends once, by itself, after speech followed by 3 s of silence — not before', async () => {
    // Warm-up zeros (ignored), room calibration, 1 s of speech, then quiet room.
    const { hook, onRecorded } = await startWith([-100, -100, ...frames(3, -60), ...frames(10, -30), ...frames(40, -60)])
    expect(hook.result.current.state).toBe('recording')
    advance(FRAME * (2 + 3 + 10) + 3000 - FRAME) // just short of 3 s of silence
    expect(onRecorded).not.toHaveBeenCalled()
    advance(FRAME * 2)
    expect(onRecorded).toHaveBeenCalledTimes(1)
    expect(onRecorded.mock.calls[0][0].type).toBe('audio/webm')
    expect(hook.result.current.state).toBe('idle')
    expect(track.stop).toHaveBeenCalled()
  })

  it('a pause shorter than 3 s mid-question does not end it', async () => {
    const { onRecorded } = await startWith([...frames(3, -60), ...frames(8, -30), ...frames(20, -60), ...frames(8, -30), ...frames(40, -60)])
    advance(FRAME * (3 + 8 + 20 + 8)) // through the 2 s pause and the second burst
    expect(onRecorded).not.toHaveBeenCalled()
    advance(3000 + FRAME)
    expect(onRecorded).toHaveBeenCalledTimes(1)
  })

  it('nothing said within the no-speech window is dropped, never sent, and reported', async () => {
    const { hook, onRecorded } = await startWith(frames(200, -60))
    advance(10_000 + FRAME)
    expect(onRecorded).not.toHaveBeenCalled()
    expect(hook.result.current.state).toBe('idle')
    expect(hook.result.current.problem).toBe('no_speech')
    expect(track.stop).toHaveBeenCalled()
  })

  it('a tap stops and sends what was recorded', async () => {
    const { hook, onRecorded } = await startWith(frames(200, -30))
    advance(FRAME * 5)
    act(() => hook.result.current.stop())
    expect(onRecorded).toHaveBeenCalledTimes(1)
  })

  it('cancel discards the recording and releases the microphone', async () => {
    const { hook, onRecorded } = await startWith(frames(200, -30))
    act(() => hook.result.current.cancel())
    expect(onRecorded).not.toHaveBeenCalled()
    expect(hook.result.current.state).toBe('idle')
    expect(track.stop).toHaveBeenCalled()
  })

  it('a refused microphone is reported as denied, and nothing is recorded', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    const { hook } = await startWith([])
    expect(hook.result.current.problem).toBe('denied')
    expect(hook.result.current.state).toBe('idle')
    expect(FakeRecorder.last?.state ?? 'inactive').toBe('inactive')
  })

  it('unmounting while recording releases the microphone and emits nothing', async () => {
    const { hook, onRecorded } = await startWith(frames(200, -30))
    hook.unmount()
    expect(track.stop).toHaveBeenCalled()
    expect(onRecorded).not.toHaveBeenCalled()
  })
})
