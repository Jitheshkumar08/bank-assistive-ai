"""
Microphone capture for the Smart Banking Voice Assistant.

Recording boundaries are decided by a local Voice Activity
Detector (Silero VAD) instead of a fixed timer. The recorder
waits for the customer to actually start speaking, keeps
recording for as long as they keep speaking, and finalizes a
short moment after they stop.

    microphone
        v
    VAD  ->  wait for speech
        v
    record while speech continues
        v
    end-of-speech silence detected
        v
    temp_recording.wav  ->  existing Whisper STT

Everything downstream is unchanged: the same 16 kHz mono
float32 WAV file is written to the same path and handed to the
same SpeechToText.transcribe().

IMPORTANT -- silence carries no meaning here.

When nothing was said, record() returns None. That is a
recording-layer outcome and nothing more. It is never a
workflow completion, a cancellation, a pause or a session
exit; the pipeline simply listens again and the conversation
state is left exactly as it was.
"""

import os
from collections import deque
from dataclasses import dataclass

import numpy as np
import sounddevice as sd
from scipy.io.wavfile import write


# =========================================================
# CONFIGURATION
#
# Every tunable lives here, in one place, so no VAD constant
# is ever buried inside a method. Each value can be overridden
# from the environment (VAD_END_SILENCE_MS=1200, ...) without
# touching the code.
# =========================================================

@dataclass(frozen=True)
class VadConfig:
    """
    Recording-boundary settings.

    sample_rate
        16000 Hz. This is what Whisper wants and one of the two
        rates Silero supports, so audio reaches both models with
        no resampling anywhere in the path.

    frame_samples
        512 samples = 32 ms. NOT a free choice: Silero v5/v6 at
        16 kHz accepts exactly 512-sample frames and raises on
        anything else. It is stated here so the constraint is
        visible rather than surprising.

    start_threshold
        0.5 speech probability. Silero's own documented default
        and a good balance -- ordinary room noise, a fan or a
        keyboard sit well below it.

    continue_threshold
        0.35 = start_threshold - 0.15, the same hysteresis gap
        Silero's reference VADIterator uses. Once someone is
        speaking it takes less evidence to believe they still
        are, so quiet phonemes and stop consonants inside a word
        do not chop the recording in half.

    start_frames
        2 consecutive speech frames (64 ms) before recording
        starts. Rejects single-frame transients while costing
        almost no latency, and the pre-roll below means nothing
        is lost while we wait.

    pre_roll_ms
        320 ms (10 frames) of audio kept from *before* speech was
        confirmed. VAD always fires slightly into the first word,
        so without this the leading consonant of "withdraw" gets
        clipped and Whisper hears "ithdraw".

    end_silence_ms
        800 ms of silence ends the turn. Long enough to survive
        the natural pauses in "I want to withdraw ... money" and a
        customer glancing down at a form mid-sentence; short
        enough that the assistant still feels responsive.

    min_speech_ms
        300 ms of accumulated speech is required before a capture
        counts as an utterance. Shorter than the shortest real
        word a customer says ("yes" is ~350-500 ms), longer than a
        keyboard click, a chair scrape or a microphone pop
        (all well under 100 ms).

    max_recording_ms
        30 s hard ceiling, measured from speech onset. A safety
        limit only -- it exists so a stuck-open microphone cannot
        record forever, NOT as a speaking window. 30 s is also
        Whisper's native context, so even a capture that hits the
        ceiling still fits in one segment.

    max_wait_ms
        15 s of waiting for speech to begin before giving up and
        reporting "no speech". Returning control to the caller,
        and nothing else -- see the module docstring.
    """

    sample_rate: int = 16000
    frame_samples: int = 512
    start_threshold: float = 0.5
    continue_threshold: float = 0.35
    start_frames: int = 2
    pre_roll_ms: int = 320
    end_silence_ms: int = 800
    min_speech_ms: int = 300
    max_recording_ms: int = 30000
    max_wait_ms: int = 15000

    # -----------------------------------------------------
    # Derived values
    # -----------------------------------------------------

    @property
    def frame_ms(self):
        return self.frame_samples * 1000.0 / self.sample_rate

    def frames_for(self, milliseconds):
        """Number of whole frames covering `milliseconds`."""
        return max(1, int(round(milliseconds / self.frame_ms)))

    @property
    def pre_roll_frames(self):
        return self.frames_for(self.pre_roll_ms)

    @property
    def end_silence_frames(self):
        return self.frames_for(self.end_silence_ms)

    @property
    def min_speech_frames(self):
        return self.frames_for(self.min_speech_ms)

    @property
    def max_recording_frames(self):
        return self.frames_for(self.max_recording_ms)

    @property
    def max_wait_frames(self):
        return self.frames_for(self.max_wait_ms)

    # -----------------------------------------------------
    # Validation
    #
    # Silero is strict about frame size. Failing here with a
    # readable message beats failing later inside a TorchScript
    # interpreter traceback.
    # -----------------------------------------------------

    def validate(self):

        supported = {16000: 512, 8000: 256}

        expected = supported.get(self.sample_rate)

        if expected is None:
            raise ValueError(
                f"VAD_SAMPLE_RATE={self.sample_rate} is not supported "
                f"by Silero VAD. Use one of {sorted(supported)}."
            )

        if self.frame_samples != expected:
            raise ValueError(
                f"VAD_FRAME_SAMPLES must be {expected} at "
                f"{self.sample_rate} Hz (got {self.frame_samples}). "
                f"Silero VAD accepts no other frame size."
            )

        if not 0.0 < self.continue_threshold <= self.start_threshold < 1.0:
            raise ValueError(
                "Require 0 < VAD_CONTINUE_THRESHOLD <= "
                "VAD_START_THRESHOLD < 1."
            )

        if self.max_recording_ms < self.min_speech_ms:
            raise ValueError(
                "VAD_MAX_RECORDING_MS must not be smaller than "
                "VAD_MIN_SPEECH_MS."
            )

        return self

    # -----------------------------------------------------
    # Environment overrides
    # -----------------------------------------------------

    @classmethod
    def from_env(cls, environ=None):
        """
        Builds a config from VAD_* environment variables, falling
        back to the defaults above for anything unset. A value
        that cannot be parsed is reported rather than silently
        ignored.
        """

        source = os.environ if environ is None else environ

        integers = (
            "sample_rate",
            "frame_samples",
            "start_frames",
            "pre_roll_ms",
            "end_silence_ms",
            "min_speech_ms",
            "max_recording_ms",
            "max_wait_ms",
        )

        floats = (
            "start_threshold",
            "continue_threshold",
        )

        values = {}

        for name in integers + floats:

            raw = source.get(f"VAD_{name.upper()}")

            if raw is None or raw.strip() == "":
                continue

            caster = int if name in integers else float

            try:
                values[name] = caster(raw.strip())

            except ValueError:
                expected = "an integer" if caster is int else "a number"

                raise ValueError(
                    f"VAD_{name.upper()} must be {expected}, "
                    f"got {raw!r}."
                ) from None

        return cls(**values).validate()


DEFAULT_CONFIG = VadConfig()


# =========================================================
# ERRORS
# =========================================================

class RecorderError(RuntimeError):
    """
    Raised when audio could not be captured at all -- no usable
    microphone, no VAD, or a stream that died before any speech
    was recorded.

    The pipeline already treats a failure to produce text as one
    lost turn, so this costs the customer a repeat and never the
    session or an in-progress workflow.
    """


# =========================================================
# VAD MODEL -- LOADED ONCE, REUSED FOREVER
#
# Silero ships its weights inside the installed package
# (silero_vad/data/silero_vad.jit, ~2 MB), so this touches the
# local filesystem only: no download, no network call, and
# nothing is ever sent anywhere to decide whether the customer
# is speaking.
# =========================================================

_VAD_MODEL = None
_VAD_LOAD_COUNT = 0


def load_vad_model():
    """
    Returns the process-wide Silero VAD model, loading it on
    first use. Every AudioRecorder and every utterance shares
    this one instance.
    """

    global _VAD_MODEL, _VAD_LOAD_COUNT

    if _VAD_MODEL is None:

        from silero_vad import load_silero_vad

        _VAD_MODEL = load_silero_vad()
        _VAD_LOAD_COUNT += 1

    return _VAD_MODEL


def vad_load_count():
    """How many times the VAD model has actually been built."""
    return _VAD_LOAD_COUNT


# =========================================================
# RECORDER
# =========================================================

class AudioRecorder:
    """
    VAD-driven microphone capture.

    The public surface is the one the pipeline already used:

        recorder = AudioRecorder()
        path = recorder.record()      # None when nothing was said
        recorder.cleanup()
    """

    # Outcome labels for `last_reason`, used by logging and tests.
    SPEECH_ENDED = "speech_ended"
    MAX_DURATION = "max_duration"
    NO_SPEECH_TIMEOUT = "no_speech_timeout"
    TOO_SHORT = "too_short"
    INTERRUPTED = "interrupted"

    def __init__(
        self,
        config=None,
        vad=None,
        stream_factory=None,
        filename="temp_recording.wav",
        preload=True,
    ):

        self.config = (config or VadConfig.from_env()).validate()
        self.filename = filename

        # Injection points. Left at None in production; the tests
        # pass deterministic fakes so recorder behaviour can be
        # verified without a microphone or a neural network.
        self._vad = vad
        self._stream_factory = stream_factory or self._open_microphone

        self.last_reason = None
        self.last_speech_ms = 0.0

        # Warm the model at construction so the first customer
        # turn is not slowed by a model load. A failure here is
        # not fatal: record() retries and reports properly.
        if preload and self._vad is None:

            try:
                self._vad = load_vad_model()

            except Exception as error:
                print(
                    f"WARNING: VAD not ready yet "
                    f"({type(error).__name__}: {error}). "
                    f"Retrying on first recording."
                )

    # -----------------------------------------------------
    # Backwards-compatible attribute
    # -----------------------------------------------------

    @property
    def fs(self):
        return self.config.sample_rate

    # -----------------------------------------------------
    # Collaborators
    # -----------------------------------------------------

    def _ensure_vad(self):

        if self._vad is None:

            try:
                self._vad = load_vad_model()

            except Exception as error:
                raise RecorderError(
                    f"Voice activity detection is unavailable "
                    f"({type(error).__name__}: {error})."
                ) from error

        return self._vad

    def _open_microphone(self):

        return sd.InputStream(
            samplerate=self.config.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=self.config.frame_samples,
        )

    # -----------------------------------------------------
    # RECORD -- one utterance
    # -----------------------------------------------------

    def record(self):
        """
        Waits for speech, captures it, and writes it to
        self.filename.

        Returns the path to the recording, or None when no
        meaningful speech was heard. None means exactly "nothing
        was said" -- the caller listens again and no conversation
        or workflow state changes.
        """

        vad = self._ensure_vad()

        # Silero is a stateful recurrent model. Clearing it
        # between utterances keeps turn N-1's audio from biasing
        # turn N, and is what makes reusing one model instance
        # across the whole session correct as well as cheap.
        if hasattr(vad, "reset_states"):
            vad.reset_states()

        self.last_reason = None
        self.last_speech_ms = 0.0

        try:
            stream = self._stream_factory()

        except Exception as error:
            raise RecorderError(
                f"Microphone unavailable "
                f"({type(error).__name__}: {error})."
            ) from error

        print("\nListening... speak whenever you are ready")

        try:
            with stream:
                captured, reason, speech_frames = self._capture(stream, vad)

        except RecorderError:
            raise

        except KeyboardInterrupt:
            # The customer or operator interrupted. main() owns
            # this; do not turn it into a recording outcome.
            raise

        except Exception as error:
            raise RecorderError(
                f"Recording failed "
                f"({type(error).__name__}: {error})."
            ) from error

        return self._finalize(captured, reason, speech_frames)

    # -----------------------------------------------------
    # CAPTURE LOOP
    #
    #   WAITING_FOR_SPEECH --(speech confirmed)--> RECORDING
    #   RECORDING --(end-of-speech silence)--> done
    #   RECORDING --(safety ceiling)--> done
    #
    # Progress is counted in frames rather than wall-clock time,
    # so the behaviour is identical whether the audio comes from
    # a live microphone or from a scripted test stream.
    # -----------------------------------------------------

    def _capture(self, stream, vad):

        config = self.config

        pre_roll = deque(maxlen=config.pre_roll_frames)
        captured = []

        recording = False
        speech_run = 0
        speech_frames = 0
        silence_run = 0
        waited_frames = 0
        recorded_frames = 0

        reported_overflow = False

        while True:

            try:
                frame = self._read_frame(stream)

            except _StreamOverflow:
                if not reported_overflow:
                    print("WARNING: audio input overflow -- frames dropped")
                    reported_overflow = True
                continue

            except Exception as error:

                # A stream that dies mid-sentence should not throw
                # away what the customer already said.
                if recording and speech_frames >= config.min_speech_frames:
                    print(
                        f"WARNING: audio stream interrupted "
                        f"({type(error).__name__}) -- keeping what "
                        f"was captured"
                    )
                    return captured, self.INTERRUPTED, speech_frames

                raise

            if frame is None:
                # The stream ended (a finite test stream, or a
                # device that closed). Finalize with whatever is
                # in hand; _finalize decides if it is enough.
                return (
                    captured,
                    self.SPEECH_ENDED if recording
                    else self.NO_SPEECH_TIMEOUT,
                    speech_frames,
                )

            probability = self._speech_probability(vad, frame)

            # ---------------------------------------------
            # WAITING FOR SPEECH
            #
            # Silence here is free: it is never counted against
            # the customer's speaking time, and the pre-roll
            # buffer means the moment they do start, the audio
            # just before the trigger is already saved.
            # ---------------------------------------------

            if not recording:

                pre_roll.append(frame)

                if probability >= config.start_threshold:
                    speech_run += 1
                else:
                    speech_run = 0

                if speech_run >= config.start_frames:

                    recording = True
                    captured = list(pre_roll)
                    recorded_frames = len(captured)
                    speech_frames = speech_run
                    silence_run = 0

                    print("Speech detected -- recording")
                    continue

                waited_frames += 1

                if waited_frames >= config.max_wait_frames:
                    return captured, self.NO_SPEECH_TIMEOUT, speech_frames

                continue

            # ---------------------------------------------
            # RECORDING
            # ---------------------------------------------

            captured.append(frame)
            recorded_frames += 1

            if probability >= config.continue_threshold:
                speech_frames += 1
                silence_run = 0
            else:
                silence_run += 1

                if silence_run >= config.end_silence_frames:
                    return captured, self.SPEECH_ENDED, speech_frames

            # ---------------------------------------------
            # SAFETY CEILING
            #
            # Not a speaking window. Natural speech runs until
            # the customer stops; this only prevents an
            # unbounded recording.
            # ---------------------------------------------

            if recorded_frames >= config.max_recording_frames:
                return captured, self.MAX_DURATION, speech_frames

    # -----------------------------------------------------
    # FRAME IO
    # -----------------------------------------------------

    def _read_frame(self, stream):
        """
        Reads exactly one VAD frame as mono float32.

        Returns None when the stream has no more audio to give.
        """

        block = stream.read(self.config.frame_samples)

        # sounddevice returns (data, overflowed); a plain array is
        # accepted too so test streams stay simple.
        overflowed = False

        if isinstance(block, tuple):
            block, overflowed = block

        if overflowed:
            raise _StreamOverflow()

        if block is None:
            return None

        data = np.asarray(block, dtype=np.float32)

        if data.ndim > 1:
            data = data[:, 0]

        if data.size == 0:
            return None

        if data.size != self.config.frame_samples:
            # Short final block: pad so the VAD still gets the
            # exact frame size it requires.
            data = np.pad(
                data,
                (0, self.config.frame_samples - data.size)
            )

        return np.ascontiguousarray(data, dtype=np.float32)

    def _speech_probability(self, vad, frame):

        import torch

        with torch.no_grad():
            return float(
                vad(
                    torch.from_numpy(frame),
                    self.config.sample_rate
                ).item()
            )

    # -----------------------------------------------------
    # FINALIZE
    # -----------------------------------------------------

    def _finalize(self, captured, reason, speech_frames):

        config = self.config

        speech_ms = speech_frames * config.frame_ms

        self.last_speech_ms = speech_ms

        # ---------------------------------------------
        # Nothing meaningful was said.
        #
        # A door slam, a cough on the next counter or a
        # keyboard click lands here, and so does plain silence.
        # None goes back to the pipeline, which listens again.
        # ---------------------------------------------

        if not captured or speech_frames < config.min_speech_frames:

            if reason == self.NO_SPEECH_TIMEOUT and speech_frames == 0:
                self.last_reason = self.NO_SPEECH_TIMEOUT
                print("No speech detected")

            else:
                self.last_reason = self.TOO_SHORT
                print(
                    f"Ignored a {speech_ms:.0f} ms sound "
                    f"(below the {config.min_speech_ms} ms "
                    f"speech minimum)"
                )

            return None

        if reason == self.MAX_DURATION:
            print(
                f"Maximum recording length "
                f"({config.max_recording_ms / 1000:.0f}s) reached "
                f"-- finalizing"
            )

        elif reason == self.INTERRUPTED:
            print("Recording ended early -- using captured audio")

        else:
            print("Speech ended -- recording complete")

        self.last_reason = reason

        audio = np.concatenate(captured).astype(np.float32).reshape(-1, 1)

        try:
            write(self.filename, config.sample_rate, audio)

        except Exception as error:
            raise RecorderError(
                f"Could not save the recording "
                f"({type(error).__name__}: {error})."
            ) from error

        return self.filename

    # -----------------------------------------------------
    # CLEANUP
    # -----------------------------------------------------

    def cleanup(self):

        if os.path.exists(self.filename):

            try:
                os.remove(self.filename)

            except PermissionError:
                pass


class _StreamOverflow(Exception):
    """Input overflow reported by the audio device."""
