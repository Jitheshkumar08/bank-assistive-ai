import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Records one spoken question in the browser (Phase 7), for the CampusGuide assistant.
 *
 * Tap to start; the recording ends by itself once the student has spoken and then been quiet for `endSilenceMs`
 * (3 s), or when they tap again. Nothing said within `noSpeechMs` is dropped (never sent), and `maxMs` caps a
 * recording. The audio is handed to `onRecorded` once and not kept here.
 *
 * End-of-speech detection is level-based, against the room's own noise floor (measured as the MEDIAN of the first
 * frames). The zero-filled frames of a microphone that is still warming up are ignored: counted as silence they pull
 * the floor so low that ordinary room noise then counts as speech that never ends (the defect the Banking assistant
 * fixed in its own recorder). A browser without Web Audio still records, and stops on the second tap or at `maxMs`.
 */
export type RecorderState = 'idle' | 'starting' | 'recording'
/** Why the last attempt produced nothing. */
export type RecorderProblem = 'denied' | 'unavailable' | 'no_speech' | null

export type VoiceRecorderOptions = {
  onRecorded: (audio: Blob) => void
  endSilenceMs?: number
  noSpeechMs?: number
  maxMs?: number
  frameMs?: number
}

export const VOICE_END_SILENCE_MS = 3_000
export const VOICE_NO_SPEECH_MS = 10_000
export const VOICE_MAX_MS = 30_000

/** dBFS of a window of pure digital silence. */
const SILENCE_DB = -100
const CALIBRATION_FRAMES = 3
const START_MARGIN_DB = 12
const CONTINUE_MARGIN_DB = 6
const ABSOLUTE_FLOOR_DB = -55

/** Recording formats the backend accepts, in order of preference. */
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

/** True when this browser can record audio at all (secure context, getUserMedia, MediaRecorder). */
export function voiceInputSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext !== false
    && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof window.MediaRecorder === 'function'
}

function chooseType(): string | undefined {
  const isTypeSupported = window.MediaRecorder?.isTypeSupported
  if (typeof isTypeSupported !== 'function') return undefined
  return PREFERRED_TYPES.find((type) => isTypeSupported.call(window.MediaRecorder, type))
}

function rmsDb(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / (samples.length || 1))
  return rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

type AudioContextClass = new () => AudioContext

/** A level meter on the microphone stream, or null when the browser has no Web Audio. Analysis only: never audible. */
function createMeter(stream: MediaStream): { read: () => number | null; close: () => void } | null {
  const Context = (window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext
  if (typeof Context !== 'function') return null
  try {
    const context = new Context()
    if (context.state === 'suspended') void context.resume?.().catch(() => undefined)
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    const buffer = new Float32Array(analyser.fftSize)
    source.connect(analyser)
    let heard = false
    return {
      read() {
        if (context.state !== 'running') return null
        analyser.getFloatTimeDomainData(buffer)
        const level = rmsDb(buffer)
        // Still the zero-filled window of a warming-up microphone: unknown, not silent.
        if (!heard && level <= SILENCE_DB) return null
        heard = true
        return level
      },
      close() {
        try { source.disconnect(); analyser.disconnect() } catch { /* already disconnected */ }
        void context.close?.().catch(() => undefined)
      },
    }
  } catch {
    return null
  }
}

export function useVoiceRecorder({
  onRecorded,
  endSilenceMs = VOICE_END_SILENCE_MS,
  noSpeechMs = VOICE_NO_SPEECH_MS,
  maxMs = VOICE_MAX_MS,
  frameMs = 100,
}: VoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle')
  const [problem, setProblem] = useState<RecorderProblem>(null)
  // The latest callback, for a recording that finishes after later renders.
  const onRecordedRef = useRef(onRecorded)
  useEffect(() => { onRecordedRef.current = onRecorded }, [onRecorded])

  // The current attempt; every asynchronous callback checks it, so a cancelled attempt can never emit.
  const runRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const meterRef = useRef<ReturnType<typeof createMeter>>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const discardRef = useRef(false)

  const release = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = null
    meterRef.current?.close()
    meterRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  /** Ends the recording; its audio is emitted once (unless discarded). */
  const finish = useCallback((discard: boolean) => {
    const recorder = recorderRef.current
    discardRef.current = discard
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = null
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); return } catch { /* fall through */ }
    }
    recorderRef.current = null
    release()
    setState('idle')
  }, [release])

  const stop = useCallback(() => finish(false), [finish])

  /** Abandons the attempt: nothing is emitted. While the permission prompt is still open, the late stream is closed. */
  const cancel = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') { finish(true); return }
    runRef.current += 1
    recorderRef.current = null
    release()
    setState('idle')
  }, [finish, release])

  const start = useCallback(async () => {
    if (state !== 'idle') return
    setProblem(null)
    if (!voiceInputSupported()) { setProblem('unavailable'); return }
    const run = ++runRef.current
    setState('starting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (error) {
      if (runRef.current !== run) return
      const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
      setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
      setState('idle')
      return
    }
    if (runRef.current !== run) { stream.getTracks().forEach((track) => track.stop()); return }

    let recorder: MediaRecorder
    try {
      const mimeType = chooseType()
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      setProblem('unavailable')
      setState('idle')
      return
    }
    streamRef.current = stream
    recorderRef.current = recorder
    discardRef.current = false
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (event: BlobEvent) => { if (runRef.current === run && event.data?.size) chunks.push(event.data) }
    recorder.onstop = () => {
      if (runRef.current !== run) return
      recorderRef.current = null
      release()
      setState('idle')
      if (discardRef.current || !chunks.length) return
      onRecordedRef.current(new Blob(chunks, { type: (recorder.mimeType || 'audio/webm').split(';')[0] }))
    }
    try {
      recorder.start()
    } catch {
      release()
      recorderRef.current = null
      setProblem('unavailable')
      setState('idle')
      return
    }
    setState('recording')

    // End-of-speech detection, counted in frames so a throttled timer can only make a window longer, never shorter.
    const meter = createMeter(stream)
    meterRef.current = meter
    const endSilenceFrames = Math.max(1, Math.round(endSilenceMs / frameMs))
    const noSpeechFrames = Math.max(1, Math.round(noSpeechMs / frameMs))
    const maxFrames = Math.max(1, Math.round(maxMs / frameMs))
    const calibration: number[] = []
    let floor = ABSOLUTE_FLOOR_DB
    let elapsed = 0
    let spoke = false
    let speechRun = 0
    let silence = 0

    timerRef.current = setInterval(() => {
      if (runRef.current !== run) return
      elapsed += 1
      if (elapsed >= maxFrames) { finish(!spoke && meter !== null); return }
      const level = meter?.read() ?? null
      if (level === null) {
        // Unmeasurable is not silence; without a meter the student stops by tapping (or at maxMs).
        return
      }
      if (calibration.length < CALIBRATION_FRAMES) {
        calibration.push(level)
        if (calibration.length === CALIBRATION_FRAMES) floor = median(calibration)
        return
      }
      if (!spoke) {
        speechRun = level >= Math.max(ABSOLUTE_FLOOR_DB, floor + START_MARGIN_DB) ? speechRun + 1 : 0
        if (speechRun >= 2) { spoke = true; silence = 0; return }
        if (elapsed >= noSpeechFrames) { setProblem('no_speech'); cancel() }
        return
      }
      silence = level >= Math.max(ABSOLUTE_FLOOR_DB, floor + CONTINUE_MARGIN_DB) ? 0 : silence + 1
      if (silence >= endSilenceFrames) finish(false)
    }, frameMs)
  }, [state, endSilenceMs, noSpeechMs, maxMs, frameMs, finish, cancel, release])

  // The microphone never outlives the component that opened it.
  useEffect(() => () => {
    runRef.current += 1
    discardRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop() } catch { /* already stopped */ } }
    release()
  }, [release])

  return { state, problem, start, stop, cancel, supported: voiceInputSupported() }
}
