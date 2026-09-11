"""
Phase 3 regression tests -- VAD-driven recording.

These are UNIT TESTS. They run entirely offline with no
microphone, no audio device and no Groq calls. Audio is a
scripted sequence of frames and the VAD is a deterministic
stand-in, so the recorder's decision logic -- when to start,
when to stop, what to discard -- is what actually gets tested.

  ------------------------------------------------------------
  WHAT THESE TESTS DO NOT PROVE

  They say nothing about real microphone behaviour: device
  initialization, driver quirks, acoustics, or how the real
  Silero model scores a real voice in a real branch office.
  Those are covered only by the live microphone test plan in
  the Phase 3 report, which must be run by hand.

  The one exception is the resource-reuse section below, which
  loads the genuine Silero model to confirm it comes from the
  installed package rather than the network.
  ------------------------------------------------------------

Run from language_engine/:

    python -m debugging.test_vad_recorder
"""

import os
import sys
import tempfile
import types

import numpy as np
import torch

# The application prints emoji. When this suite's output is
# redirected to a file, Windows falls back to cp1252 and those
# characters cannot be encoded. That is a property of the
# console, not of the recorder, so the test process fixes its
# own stdout rather than the application changing what it
# prints. (See the Phase 3 report: the same hazard exists in
# voice_pipeline.py's own error prints and was left alone.)

for _stream_out in (sys.stdout, sys.stderr):
    if hasattr(_stream_out, "reconfigure"):
        _stream_out.reconfigure(encoding="utf-8", errors="replace")

from scipy.io.wavfile import read as wav_read

from app.speech import recorder as recorder_module
from app.speech.recorder import (
    AudioRecorder,
    RecorderError,
    VadConfig,
    load_vad_model,
    vad_load_count,
)


# =========================================================
# TINY TEST HARNESS  (same shape as the other suites)
# =========================================================

PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label}   {detail}")


def section(title):
    print()
    print("=" * 62)
    print(title)
    print("=" * 62)


# =========================================================
# FAKES
# =========================================================

class FakeVad:
    """
    Deterministic stand-in for Silero.

    Loud frames (amplitude 1.0) are speech, quiet frames
    (amplitude 0.0) are not. That keeps every timing assertion
    below exact instead of probabilistic.
    """

    def __init__(self):
        self.calls = 0
        self.resets = 0

    def reset_states(self):
        self.resets += 1

    def __call__(self, tensor, sample_rate):
        self.calls += 1
        loud = float(np.abs(tensor.numpy()).max()) > 0.5
        return torch.tensor(0.92 if loud else 0.02)


class StreamBoom(Exception):
    """Simulated audio-device failure."""


class ScriptedStream:
    """
    Replays a fixed list of frames, then reports end-of-stream.

    fail_at    -- frame index at which read() raises StreamBoom
    overflow_at-- frame index reported as an input overflow
    """

    def __init__(self, frames, fail_at=None, overflow_at=None):
        self.frames = frames
        self.fail_at = fail_at
        self.overflow_at = overflow_at
        self.position = 0
        self.entered = 0
        self.closed = 0

    def __enter__(self):
        self.entered += 1
        return self

    def __exit__(self, *_):
        self.closed += 1
        return False

    def read(self, _frames):

        index = self.position

        if self.overflow_at is not None and index == self.overflow_at:
            self.overflow_at = None
            return self.frames[index], True

        if self.fail_at is not None and index == self.fail_at:
            raise StreamBoom("device went away")

        if index >= len(self.frames):
            return None, False

        self.position += 1
        return self.frames[index], False


def frames_from_script(config, script):
    """
    Builds frames from a script such as:

        [("silence", 3000), ("speech", 1200), ("silence", 1000)]
    """

    frames = []

    for kind, milliseconds in script:

        value = 1.0 if kind == "speech" else 0.0

        for _ in range(config.frames_for(milliseconds)):
            frames.append(
                np.full(
                    (config.frame_samples, 1),
                    value,
                    dtype=np.float32
                )
            )

    return frames


TEMP_WAV = os.path.join(
    tempfile.gettempdir(),
    "phase3_vad_recorder_test.wav"
)


def build_recorder(script, config=None, **stream_options):
    """A recorder wired to a scripted stream and a fake VAD."""

    config = (config or VadConfig()).validate()

    frames = frames_from_script(config, script)

    stream = ScriptedStream(frames, **stream_options)
    vad = FakeVad()

    audio_recorder = AudioRecorder(
        config=config,
        vad=vad,
        stream_factory=lambda: stream,
        filename=TEMP_WAV,
        preload=False,
    )

    return audio_recorder, stream, vad


def remove_temp_wav():
    if os.path.exists(TEMP_WAV):
        try:
            os.remove(TEMP_WAV)
        except PermissionError:
            pass


def recorded_frame_count(config, path):
    """Length of the written WAV, measured in VAD frames."""

    rate, data = wav_read(path)

    return rate, data.shape[0] / config.frame_samples


# =========================================================
# 1. SPEECH DETECTED
# =========================================================

def test_speech_detected():

    section("1. SPEECH DETECTED")

    config = VadConfig()

    audio_recorder, stream, vad = build_recorder(
        [("speech", 1200), ("silence", 1000)],
        config=config
    )

    remove_temp_wav()

    path = audio_recorder.record()

    check("a recording is produced", path == TEMP_WAV, f"got {path!r}")

    check("outcome is a normal end of speech",
          audio_recorder.last_reason == AudioRecorder.SPEECH_ENDED,
          f"got {audio_recorder.last_reason}")

    check("the WAV file exists", os.path.exists(TEMP_WAV))

    rate, _frame_length = recorded_frame_count(config, TEMP_WAV)

    check("sample rate handed to Whisper is unchanged (16 kHz)",
          rate == 16000, f"got {rate}")

    check("roughly the spoken duration was captured",
          1200 <= audio_recorder.last_speech_ms <= 1400,
          f"got {audio_recorder.last_speech_ms:.0f} ms")

    check("VAD state was reset for the utterance",
          vad.resets == 1, f"got {vad.resets}")

    check("every frame read was scored by the VAD",
          vad.calls == stream.position,
          f"{vad.calls} scored, {stream.position} read")

    remove_temp_wav()


# =========================================================
# 2. INITIAL SILENCE BEFORE SPEECH
# =========================================================

def test_initial_silence_is_not_charged_to_the_user():

    section("2. INITIAL SILENCE BEFORE SPEECH")

    config = VadConfig()

    # The customer takes three seconds to gather themselves,
    # then speaks for 1.2 s. None of that hesitation may end up
    # in the recording, and none of it may eat into the
    # utterance the way the old fixed window did.

    audio_recorder, _stream, _vad = build_recorder(
        [("silence", 3000), ("speech", 1200), ("silence", 1000)],
        config=config
    )

    remove_temp_wav()

    path = audio_recorder.record()

    check("speech after a long pause is still captured",
          path == TEMP_WAV, f"got {path!r}")

    _rate, frame_length = recorded_frame_count(config, TEMP_WAV)

    recorded_ms = frame_length * config.frame_ms

    check("the 3 s of hesitation is not in the recording",
          recorded_ms < 2600,
          f"recorded {recorded_ms:.0f} ms")

    check("the whole utterance is in the recording",
          recorded_ms >= 1200,
          f"recorded {recorded_ms:.0f} ms")

    check("pre-roll kept the audio just before the first word",
          recorded_ms >= 1200 + config.pre_roll_ms - config.frame_ms,
          f"recorded {recorded_ms:.0f} ms")

    check("full speech duration was measured",
          audio_recorder.last_speech_ms >= 1200,
          f"got {audio_recorder.last_speech_ms:.0f} ms")

    remove_temp_wav()


# =========================================================
# 3. SPEECH FOLLOWED BY SILENCE
# =========================================================

def test_speech_followed_by_silence():

    section("3. SPEECH FOLLOWED BY SILENCE")

    config = VadConfig()

    # A second of room tone first, so the pre-roll buffer is
    # full at the moment speech is confirmed -- that is the
    # case the frame arithmetic below describes.

    audio_recorder, stream, _vad = build_recorder(
        [("silence", 1000), ("speech", 1200), ("silence", 4000)],
        config=config
    )

    remove_temp_wav()

    path = audio_recorder.record()

    check("recording finalized", path == TEMP_WAV)

    check("finalized because speech ended",
          audio_recorder.last_reason == AudioRecorder.SPEECH_ENDED,
          f"got {audio_recorder.last_reason}")

    speech_frames = config.frames_for(1200)

    expected = (
        config.pre_roll_frames
        + (speech_frames - config.start_frames)
        + config.end_silence_frames
    )

    _rate, frame_length = recorded_frame_count(config, TEMP_WAV)

    check("stopped one end-of-silence window after the last word",
          int(round(frame_length)) == expected,
          f"expected {expected} frames, got {frame_length:.0f}")

    check("the remaining 3.2 s of silence was never recorded",
          stream.position < len(stream.frames),
          "the stream was drained to the end")

    remove_temp_wav()


# =========================================================
# 4. CONTINUOUS SPEECH  (the old 6 s window is gone)
# =========================================================

def test_continuous_speech_past_the_old_window():

    section("4. CONTINUOUS SPEECH BEYOND SIX SECONDS")

    config = VadConfig()

    audio_recorder, _stream, _vad = build_recorder(
        [("speech", 12000), ("silence", 1500)],
        config=config
    )

    remove_temp_wav()

    path = audio_recorder.record()

    check("long speech is captured", path == TEMP_WAV)

    check("speech was NOT cut off at six seconds",
          audio_recorder.last_speech_ms > 6000,
          f"only {audio_recorder.last_speech_ms:.0f} ms captured")

    check("the full twelve seconds was captured",
          audio_recorder.last_speech_ms >= 12000,
          f"got {audio_recorder.last_speech_ms:.0f} ms")

    check("it ended on silence, not on a timer",
          audio_recorder.last_reason == AudioRecorder.SPEECH_ENDED,
          f"got {audio_recorder.last_reason}")

    remove_temp_wav()


# =========================================================
# 5. NO SPEECH AT ALL
# =========================================================

def test_no_speech():

    section("5. NO SPEECH")

    config = VadConfig(max_wait_ms=4000).validate()

    audio_recorder, stream, _vad = build_recorder(
        [("silence", 20000)],
        config=config
    )

    remove_temp_wav()

    path = audio_recorder.record()

    check("silence returns a clean no-speech result",
          path is None, f"got {path!r}")

    check("the outcome is labelled as a no-speech timeout",
          audio_recorder.last_reason == AudioRecorder.NO_SPEECH_TIMEOUT,
          f"got {audio_recorder.last_reason}")

    check("no audio file is written for silence",
          not os.path.exists(TEMP_WAV))

    check("waiting stopped at the configured limit",
          stream.position == config.max_wait_frames,
          f"read {stream.position} of {config.max_wait_frames} frames")

    check("no speech time was accumulated",
          audio_recorder.last_speech_ms == 0.0,
          f"got {audio_recorder.last_speech_ms}")

    check("the audio stream was closed",
          stream.closed == 1, f"closed {stream.closed} times")

    remove_temp_wav()


# =========================================================
# 6. SHORT NOISE BURST
# =========================================================

def test_short_noise_burst():

    section("6. SHORT NOISE BURST")

    config = VadConfig()

    # A keyboard click / chair scrape / microphone pop: loud
    # enough to look like speech for a moment, far too short to
    # be a word.

    audio_recorder, _stream, _vad = build_recorder(
        [("silence", 300), ("speech", 100), ("silence", 2000)],
        config=config
    )

    remove_temp_wav()

    path = audio_recorder.record()

    check("a 100 ms burst does not become an utterance",
          path is None, f"got {path!r}")

    check("it is reported as too short",
          audio_recorder.last_reason == AudioRecorder.TOO_SHORT,
          f"got {audio_recorder.last_reason}")

    check("nothing was sent to Whisper",
          not os.path.exists(TEMP_WAV))

    # ... while a real short word still gets through.

    audio_recorder, _stream, _vad = build_recorder(
        [("silence", 300), ("speech", 500), ("silence", 1500)],
        config=config
    )

    path = audio_recorder.record()

    check('a real short word ("yes") is still accepted',
          path == TEMP_WAV, f"got {path!r}")

    remove_temp_wav()


# =========================================================
# 7. MAXIMUM RECORDING DURATION  (safety ceiling)
# =========================================================

def test_maximum_recording_duration():

    section("7. MAXIMUM RECORDING DURATION")

    config = VadConfig(max_recording_ms=2000).validate()

    audio_recorder, stream, _vad = build_recorder(
        [("speech", 30000)],
        config=config
    )

    remove_temp_wav()

    path = audio_recorder.record()

    check("the ceiling finalizes rather than crashing",
          path == TEMP_WAV, f"got {path!r}")

    check("the outcome names the ceiling",
          audio_recorder.last_reason == AudioRecorder.MAX_DURATION,
          f"got {audio_recorder.last_reason}")

    _rate, frame_length = recorded_frame_count(config, TEMP_WAV)

    check("the captured audio is returned, not discarded",
          int(round(frame_length)) == config.max_recording_frames,
          f"expected {config.max_recording_frames} frames, "
          f"got {frame_length:.0f}")

    check("recording stopped at the ceiling, not at the end of input",
          stream.position < len(stream.frames),
          "the stream ran to the end")

    check("the stream was closed cleanly",
          stream.closed == 1, f"closed {stream.closed} times")

    remove_temp_wav()


# =========================================================
# 8. RECORDER FAILURE
# =========================================================

def test_recorder_failure():

    section("8. RECORDER FAILURE")

    config = VadConfig()

    # --- microphone will not open --------------------------

    def broken_microphone():
        raise OSError("no input device")

    audio_recorder = AudioRecorder(
        config=config,
        vad=FakeVad(),
        stream_factory=broken_microphone,
        filename=TEMP_WAV,
        preload=False,
    )

    try:
        audio_recorder.record()
        check("a dead microphone raises RecorderError", False,
              "no exception was raised")

    except RecorderError as error:
        check("a dead microphone raises RecorderError", True)
        check("the error names the microphone",
              "Microphone unavailable" in str(error), str(error))

    except Exception as error:
        check("a dead microphone raises RecorderError", False,
              f"raised {type(error).__name__}")

    # --- stream dies before any speech ---------------------

    audio_recorder, _stream, _vad = build_recorder(
        [("silence", 2000)],
        config=config,
        fail_at=5
    )

    try:
        audio_recorder.record()
        check("a stream failure before speech raises RecorderError",
              False, "no exception was raised")

    except RecorderError:
        check("a stream failure before speech raises RecorderError",
              True)

    except Exception as error:
        check("a stream failure before speech raises RecorderError",
              False, f"raised {type(error).__name__}")

    # --- stream dies mid-sentence, after real speech -------

    remove_temp_wav()

    audio_recorder, _stream, _vad = build_recorder(
        [("speech", 3000)],
        config=config,
        fail_at=40
    )

    path = audio_recorder.record()

    check("speech already captured survives a mid-sentence failure",
          path == TEMP_WAV, f"got {path!r}")

    check("the interruption is reported",
          audio_recorder.last_reason == AudioRecorder.INTERRUPTED,
          f"got {audio_recorder.last_reason}")

    remove_temp_wav()

    # --- input overflow is survivable ----------------------

    audio_recorder, _stream, _vad = build_recorder(
        [("speech", 1200), ("silence", 1200)],
        config=config,
        overflow_at=3
    )

    path = audio_recorder.record()

    check("an input overflow does not end the recording",
          path == TEMP_WAV, f"got {path!r}")

    remove_temp_wav()

    # --- VAD cannot be loaded ------------------------------

    original_loader = recorder_module.load_vad_model

    def broken_loader():
        raise ImportError("silero_vad is not installed")

    recorder_module.load_vad_model = broken_loader

    try:
        audio_recorder = AudioRecorder(
            config=config,
            stream_factory=lambda: ScriptedStream([]),
            filename=TEMP_WAV,
            preload=False,
        )

        try:
            audio_recorder.record()
            check("an unloadable VAD raises RecorderError", False,
                  "no exception was raised")

        except RecorderError as error:
            check("an unloadable VAD raises RecorderError", True)
            check("the error names voice activity detection",
                  "Voice activity detection" in str(error), str(error))

        except Exception as error:
            check("an unloadable VAD raises RecorderError", False,
                  f"raised {type(error).__name__}")

        # Construction itself must survive a broken VAD, so the
        # assistant still starts and can report the problem.

        try:
            AudioRecorder(
                config=config,
                stream_factory=lambda: ScriptedStream([]),
                filename=TEMP_WAV,
                preload=True,
            )
            check("constructing a recorder survives a broken VAD", True)

        except Exception as error:
            check("constructing a recorder survives a broken VAD",
                  False, f"raised {type(error).__name__}")

    finally:
        recorder_module.load_vad_model = original_loader


# =========================================================
# 9. REPEATED RECORDING SESSIONS
# =========================================================

def test_repeated_sessions():

    section("9. REPEATED RECORDING SESSIONS")

    config = VadConfig(max_wait_ms=3000).validate()

    vad = FakeVad()

    scripts = [
        [("speech", 1200), ("silence", 1200)],
        [("silence", 10000)],
        [("speech", 900), ("silence", 1200)],
        [("silence", 200), ("speech", 100), ("silence", 1500)],
    ]

    streams = []

    def next_stream():
        stream = ScriptedStream(
            frames_from_script(config, scripts[len(streams)])
        )
        streams.append(stream)
        return stream

    audio_recorder = AudioRecorder(
        config=config,
        vad=vad,
        stream_factory=next_stream,
        filename=TEMP_WAV,
        preload=False,
    )

    results = []

    for _ in scripts:
        remove_temp_wav()
        results.append(audio_recorder.record())

    check("turn 1 (speech) captured", results[0] == TEMP_WAV)
    check("turn 2 (silence) returns no speech", results[1] is None)
    check("turn 3 (speech again) captured", results[2] == TEMP_WAV)
    check("turn 4 (noise burst) returns no speech", results[3] is None)

    check("silence in turn 2 did not break turn 3",
          results[2] == TEMP_WAV)

    check("a fresh stream is opened per turn",
          len(streams) == 4, f"got {len(streams)}")

    check("every stream was closed",
          all(stream.closed == 1 for stream in streams),
          str([stream.closed for stream in streams]))

    check("VAD state is reset once per utterance",
          vad.resets == 4, f"got {vad.resets}")

    remove_temp_wav()


# =========================================================
# 10. VAD RESOURCE REUSE
# =========================================================

def test_vad_resource_reuse():

    section("10. VAD RESOURCE REUSE")

    # --- the singleton loads exactly once ------------------

    saved_model = recorder_module._VAD_MODEL
    saved_count = recorder_module._VAD_LOAD_COUNT
    saved_module = sys.modules.get("silero_vad")

    build_count = {"n": 0}

    class StubModel:
        def reset_states(self):
            pass

    def stub_load_silero_vad(*_args, **_kwargs):
        build_count["n"] += 1
        return StubModel()

    stub = types.ModuleType("silero_vad")
    stub.load_silero_vad = stub_load_silero_vad

    recorder_module._VAD_MODEL = None
    recorder_module._VAD_LOAD_COUNT = 0
    sys.modules["silero_vad"] = stub

    try:
        first = load_vad_model()
        second = load_vad_model()
        third = load_vad_model()

        check("the VAD model is built only once",
              build_count["n"] == 1, f"built {build_count['n']} times")

        check("every caller gets the same instance",
              first is second is third)

        check("the load counter agrees",
              vad_load_count() == 1, f"got {vad_load_count()}")

        # Several recorders, one model.

        first_recorder = AudioRecorder(
            filename=TEMP_WAV,
            stream_factory=lambda: ScriptedStream([]),
        )

        second_recorder = AudioRecorder(
            filename=TEMP_WAV,
            stream_factory=lambda: ScriptedStream([]),
        )

        check("two recorders share one VAD instance",
              first_recorder._vad is second_recorder._vad is first)

        check("constructing recorders does not rebuild the model",
              build_count["n"] == 1, f"built {build_count['n']} times")

    finally:
        recorder_module._VAD_MODEL = saved_model
        recorder_module._VAD_LOAD_COUNT = saved_count

        if saved_module is None:
            sys.modules.pop("silero_vad", None)
        else:
            sys.modules["silero_vad"] = saved_module

    # --- the real model loads from the installed package ---
    #
    # This is the one place the genuine Silero model is used.
    # It proves the weights ship with the wheel: no download,
    # no network call to decide whether someone is speaking.

    try:
        real = load_vad_model()

        check("the real Silero model loads locally", real is not None)

        probability = real(torch.zeros(512), 16000).item()

        check("a 512-sample frame is accepted at 16 kHz",
              0.0 <= probability <= 1.0, f"got {probability}")

        check("silence scores below the start threshold",
              probability < VadConfig().start_threshold,
              f"got {probability}")

        real.reset_states()
        check("the real model exposes reset_states", True)

        before = vad_load_count()
        load_vad_model()

        check("a second call does not reload the real model",
              vad_load_count() == before,
              f"{before} -> {vad_load_count()}")

    except Exception as error:
        check("the real Silero model loads locally", False,
              f"{type(error).__name__}: {error}")


# =========================================================
# 11. CONFIGURATION
# =========================================================

def test_configuration():

    section("11. CONFIGURATION")

    config = VadConfig()

    check("frame size is 32 ms",
          abs(config.frame_ms - 32.0) < 1e-9, f"got {config.frame_ms}")

    check("end-of-speech silence is configurable and documented",
          config.end_silence_ms == 800, f"got {config.end_silence_ms}")

    check("a maximum recording duration exists",
          config.max_recording_ms == 30000,
          f"got {config.max_recording_ms}")

    check("the ceiling is far above the old six-second window",
          config.max_recording_ms > 6000)

    check("a minimum speech duration exists",
          config.min_speech_ms == 300, f"got {config.min_speech_ms}")

    check("hysteresis: continuing is easier than starting",
          config.continue_threshold < config.start_threshold)

    # --- environment overrides -----------------------------

    overridden = VadConfig.from_env({
        "VAD_END_SILENCE_MS": "1500",
        "VAD_MIN_SPEECH_MS": "450",
        "VAD_MAX_RECORDING_MS": "20000",
        "VAD_START_THRESHOLD": "0.6",
        "VAD_CONTINUE_THRESHOLD": "0.4",
    })

    check("VAD_END_SILENCE_MS is honoured",
          overridden.end_silence_ms == 1500)

    check("VAD_MIN_SPEECH_MS is honoured",
          overridden.min_speech_ms == 450)

    check("VAD_MAX_RECORDING_MS is honoured",
          overridden.max_recording_ms == 20000)

    check("VAD_START_THRESHOLD is honoured",
          abs(overridden.start_threshold - 0.6) < 1e-9)

    check("unset values keep their defaults",
          overridden.sample_rate == 16000
          and overridden.pre_roll_ms == 320)

    # --- bad configuration is reported, not swallowed ------

    try:
        VadConfig.from_env({"VAD_END_SILENCE_MS": "soon"})
        check("an unparseable override is rejected", False,
              "no exception was raised")

    except ValueError as error:
        check("an unparseable override is rejected", True)
        check("the error names the variable",
              "VAD_END_SILENCE_MS" in str(error), str(error))

    try:
        VadConfig(frame_samples=480).validate()
        check("a frame size Silero cannot accept is rejected", False,
              "no exception was raised")

    except ValueError as error:
        check("a frame size Silero cannot accept is rejected", True)
        check("the error explains the 512-sample requirement",
              "512" in str(error), str(error))

    try:
        VadConfig(sample_rate=44100, frame_samples=512).validate()
        check("an unsupported sample rate is rejected", False,
              "no exception was raised")

    except ValueError:
        check("an unsupported sample rate is rejected", True)


# =========================================================
# 12. SILENCE MUST NOT CONTROL THE WORKFLOW
#
# The critical Phase 3 guarantee. A customer who stops talking
# to fill in a form has not completed, cancelled, paused or
# exited anything.
# =========================================================

def test_silence_never_controls_the_workflow():

    section("12. SILENCE NEVER CONTROLS THE WORKFLOW")

    from app.dialogue.manager import classify_command
    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    class NeverCalledStt:
        def __init__(self):
            self.calls = 0

        def transcribe(self, *_args, **_kwargs):
            self.calls += 1
            return {"text": "should never happen", "language": "en"}

    class SilentRecorder:
        def __init__(self, outcome):
            self.outcome = outcome
            self.cleanups = 0

        def record(self):
            if isinstance(self.outcome, Exception):
                raise self.outcome
            return self.outcome

        def cleanup(self):
            self.cleanups += 1

    # --- no speech ----------------------------------------

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.recorder = SilentRecorder(None)
    pipeline.stt = NeverCalledStt()

    heard = pipeline.listen("1", "en")

    check("no speech reaches the pipeline as empty input",
          heard == "", f"got {heard!r}")

    check("Whisper is not run on silence",
          pipeline.stt.calls == 0, f"called {pipeline.stt.calls} times")

    # --- recorder failure ---------------------------------

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.recorder = SilentRecorder(
        RecorderError("microphone unavailable")
    )
    pipeline.stt = NeverCalledStt()

    heard = pipeline.listen("1", "en")

    check("a recorder failure costs one turn, not the session",
          heard == "", f"got {heard!r}")

    # --- empty input carries no control meaning -----------

    for text in ("", "   ", "\n"):
        check(f"{text!r} is not a control command",
              classify_command(text) is None,
              f"got {classify_command(text)}")

    # The run loop short-circuits on empty input before control
    # detection, intent detection or the dialogue manager are
    # reached, so conversation state cannot be touched by
    # silence. What is asserted here is the other half: empty
    # input has no control meaning even if it did get through,
    # while a real spoken command still does.

    check("silence maps to no workflow outcome, but speech still does",
          classify_command("") is None
          and classify_command("exit") == "session_exit"
          and classify_command("cancel") == "cancel",
          "control classification changed shape")


# =========================================================
# MAIN
# =========================================================

def main():

    test_speech_detected()
    test_initial_silence_is_not_charged_to_the_user()
    test_speech_followed_by_silence()
    test_continuous_speech_past_the_old_window()
    test_no_speech()
    test_short_noise_burst()
    test_maximum_recording_duration()
    test_recorder_failure()
    test_repeated_sessions()
    test_vad_resource_reuse()
    test_configuration()
    test_silence_never_controls_the_workflow()

    remove_temp_wav()

    section("SUMMARY")
    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED: {failure}")
        return 1

    print()
    print("  All Phase 3 VAD recorder tests passed.")
    print()
    print("  NOTE: these are unit tests over scripted audio.")
    print("  Live microphone behaviour is NOT verified here --")
    print("  run the live test plan (TEST A..I) by hand.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
