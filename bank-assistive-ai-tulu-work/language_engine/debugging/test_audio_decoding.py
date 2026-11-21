"""
AUDIO FIX A1 -- BROWSER RECORDINGS REACH INDICCONFORMER

Regression tests for read_waveform() / decode_with_ffmpeg() in
app/speech/asr/indic_conformer_provider.py, the router in
app/speech/asr/factory.py and EngineRuntime.transcribe.

Browsers upload WebM/Opus (MediaRecorder), never WAV. IndicConformer read
every upload with scipy's WAV reader, which refused it ("File format
b'\\x1aE\\xdf\\xa3' not understood"), so every Kannada and Hindi voice turn
fell back to Whisper.

WHAT IS SIMULATED

Only the ONNX model's recognize() and the Whisper provider are stand-ins: no
model is downloaded or loaded. Container detection and ffmpeg decoding are the
real code, run on real audio -- the WebM/Opus fixture is encoded by the
installed ffmpeg at test time (48 kHz Opus, as Chromium records). That a REAL
browser recording decodes is not proven here; it needs a manual test.

Offline: no network, no model. Needs ffmpeg on PATH; without it the decoding
tests are reported as SKIPPED, not passed.

Run from language_engine/:

    python -m debugging.test_audio_decoding
"""

import os
import shutil
import subprocess
import sys
import tempfile

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
from scipy.io import wavfile

from app.speech.asr import indic_conformer_provider as icp
from app.speech.asr.base import SpeechRecognitionResult, SpeechRecognizer
from app.speech.asr.factory import RoutingSpeechRecognizer
from app.speech.asr.indic_conformer_provider import AudioDecodeError, IndicConformerRecognizer


PASSED = []
FAILED = []
SKIPPED = []

FFMPEG = shutil.which("ffmpeg")
FIXTURES = tempfile.mkdtemp(prefix="a1-audio-fixtures-")


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def skip(label):
    SKIPPED.append(label)
    print(f"  SKIP  {label} -- ffmpeg not on PATH")


def webm_fixture():
    """One second of a 440 Hz tone as WebM/Opus at 48 kHz."""
    path = os.path.join(FIXTURES, "tone.webm")
    if not os.path.exists(path):
        subprocess.run(
            [FFMPEG, "-nostdin", "-loglevel", "error", "-f", "lavfi",
             "-i", "sine=frequency=440:duration=1:sample_rate=48000",
             "-ac", "1", "-c:a", "libopus", path],
            check=True,
        )
    return path


def wav_fixture():
    """One second of a 440 Hz tone as 16 kHz int16 WAV."""
    path = os.path.join(FIXTURES, "tone.wav")
    t = np.arange(16000) / 16000.0
    wavfile.write(path, 16000, (0.5 * np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16))
    return path


def write_fixture(name, payload):
    path = os.path.join(FIXTURES, name)
    with open(path, "wb") as fh:
        fh.write(payload)
    return path


class FakeModel:
    """Stands in for the ONNX model: records what it was given."""

    def __init__(self, fail=False):
        self.fail = fail
        self.inputs = []

    def recognize(self, waveform, sample_rate):
        self.inputs.append((waveform, sample_rate))
        if self.fail:
            raise RuntimeError("onnxruntime inference failed")
        return "ಸರಿ"


class Indic(IndicConformerRecognizer):
    """The real provider, with only model loading replaced."""

    def __init__(self, model):
        super().__init__(models={"kn": "test/kn", "hi": "test/hi"})
        self.model = model
        self.loads = []

    def available(self):
        return True

    def _load(self, language):
        self.loads.append(language)
        return self.model


class FakeWhisper(SpeechRecognizer):
    name = "whisper"
    model_name = "fake-whisper"

    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def supports_language(self, language):
        return True

    def transcribe(self, audio_path, language=None):
        self.calls.append(language)
        if self.fail:
            raise RuntimeError("Failed to load audio")
        return SpeechRecognitionResult(text="whisper text", language=language,
                                       provider=self.name, model=self.model_name)


def router(indic, whisper):
    return RoutingSpeechRecognizer(
        providers={"indicconformer": indic, "whisper": whisper},
        provider_setting="auto",
        language_providers={"kn": "indicconformer", "hi": "indicconformer", "en": "whisper"},
        fallback="whisper",
    )


class TempfileWatch:
    """Counts temp files/dirs created inside the block."""

    def __enter__(self):
        self.created = 0
        self.saved = tempfile.mkstemp, tempfile.mkdtemp, tempfile.NamedTemporaryFile

        def counted(original):
            def wrapper(*args, **kwargs):
                self.created += 1
                return original(*args, **kwargs)
            return wrapper

        tempfile.mkstemp, tempfile.mkdtemp, tempfile.NamedTemporaryFile = (counted(f) for f in self.saved)
        return self

    def __exit__(self, *exc):
        tempfile.mkstemp, tempfile.mkdtemp, tempfile.NamedTemporaryFile = self.saved


# =========================================================
# 1  WEBM IS DECODED INTO A WAVEFORM INDICCONFORMER ACCEPTS
# =========================================================

def test_webm_is_decoded():
    if not FFMPEG:
        return skip("WebM/Opus decodes to 16 kHz mono float32")

    path = webm_fixture()
    with open(path, "rb") as fh:
        check("the fixture really is WebM (EBML magic)", fh.read(4) == b"\x1a\x45\xdf\xa3")

    # The exact failure being fixed: scipy alone refuses this file.
    try:
        wavfile.read(path)
        check("scipy alone refuses WebM", False, "scipy read it")
    except ValueError as error:
        check("scipy alone refuses WebM", "not understood" in str(error), str(error))

    waveform, rate = icp.read_waveform(path)
    check("16 kHz", rate == 16000, str(rate))
    check("mono float32", waveform.ndim == 1 and waveform.dtype == np.float32, f"{waveform.ndim} {waveform.dtype}")
    check("about one second of samples", 15000 <= waveform.shape[0] <= 17000, str(waveform.shape))
    check("within [-1, 1]", float(np.abs(waveform).max()) <= 1.0)
    check("the tone survived decoding (not silence)", float(np.abs(waveform).max()) > 0.1,
          str(float(np.abs(waveform).max())))

    model = FakeModel()
    result = Indic(model).transcribe(path, language="kn")
    got_wave, got_rate = model.inputs[0]
    check("IndicConformer recognised the decoded WebM", result.text == "ಸರಿ" and result.provider == "indicconformer")
    check("the model was given the decoded 16 kHz waveform",
          got_rate == 16000 and got_wave.dtype == np.float32 and got_wave.flags["C_CONTIGUOUS"])


# =========================================================
# 2  WAV IS READ DIRECTLY, WITHOUT FFMPEG
# =========================================================

def test_wav_is_not_converted():
    path = wav_fixture()
    saved = icp.subprocess.run

    def forbidden(*args, **kwargs):
        raise AssertionError("ffmpeg must not run for WAV")

    icp.subprocess.run = forbidden
    try:
        waveform, rate = icp.read_waveform(path)
        check("WAV read without ffmpeg", rate == 16000 and waveform.shape == (16000,), f"{rate} {waveform.shape}")
        check("int16 WAV scaled to [-1, 1]", 0.45 < float(np.abs(waveform).max()) <= 0.5)
    except AssertionError as error:
        check("WAV read without ffmpeg", False, str(error))
    finally:
        icp.subprocess.run = saved

    check("a WAV file is recognised as WAV", icp.is_wav(path))
    if FFMPEG:
        check("a WebM file is not recognised as WAV", not icp.is_wav(webm_fixture()))


# =========================================================
# 3  INVALID OR CORRUPT AUDIO FAILS SAFELY
# =========================================================

def test_invalid_audio_is_refused():
    if not FFMPEG:
        return skip("corrupt recordings are refused")

    with open(webm_fixture(), "rb") as fh:
        truncated = fh.read(40)       # EBML header, no audio

    cases = {
        "garbage.webm": b"this is not a recording " * 20,
        "truncated.webm": truncated,
        "empty.webm": b"",
    }
    for name, payload in cases.items():
        path = write_fixture(name, payload)
        try:
            icp.read_waveform(path)
            check(f"{name} refused", False, "decoded without error")
        except AudioDecodeError as error:
            message = str(error)
            check(f"{name} refused with AudioDecodeError", True)
            check(f"{name}: the error does not name the file", FIXTURES not in message and name not in message, message)

    model = FakeModel()
    indic = Indic(model)
    try:
        indic.transcribe(write_fixture("garbage2.webm", b"\x00\x01junk" * 50), language="kn")
        check("garbage refused before the model", False, "no error")
    except AudioDecodeError:
        check("garbage refused before the model is loaded or run", indic.loads == [] and model.inputs == [])

    # A broken WAV keeps its existing behaviour: scipy's own ValueError.
    path = write_fixture("broken.wav", b"RIFF\x10\x00\x00\x00WAVEjunk")
    try:
        icp.read_waveform(path)
        check("broken WAV refused", False, "no error")
    except ValueError:
        check("broken WAV refused with a ValueError", True)

    # ffmpeg missing: a clear error, never a silent success.
    saved = icp.shutil.which
    icp.shutil.which = lambda name: None
    try:
        icp.read_waveform(webm_fixture())
        check("missing ffmpeg reported", False, "no error")
    except AudioDecodeError as error:
        check("missing ffmpeg reported clearly", "ffmpeg" in str(error), str(error))
    finally:
        icp.shutil.which = saved


# =========================================================
# 4  KANNADA / HINDI WEBM NO LONGER FALLS BACK TO WHISPER
# =========================================================

def test_webm_routing_stays_on_indicconformer():
    if not FFMPEG:
        return skip("kn/hi WebM stays on IndicConformer")

    for language in ("kn", "hi"):
        whisper = FakeWhisper()
        result = router(Indic(FakeModel()), whisper).transcribe(webm_fixture(), language=language)
        check(f"{language}: WebM served by IndicConformer", result.provider == "indicconformer", result.provider)
        check(f"{language}: no fallback", result.fallback_used is False and whisper.calls == [],
              f"{result.fallback_used} {whisper.calls}")

    whisper = FakeWhisper()
    result = router(Indic(FakeModel()), whisper).transcribe(webm_fixture(), language="en")
    check("en: still Whisper, unchanged", result.provider == "whisper" and whisper.calls == ["en"])


# =========================================================
# 5  A GENUINE INFERENCE FAILURE STILL FALLS BACK
# =========================================================

def test_inference_failure_still_falls_back():
    path = webm_fixture() if FFMPEG else wav_fixture()

    whisper = FakeWhisper()
    result = router(Indic(FakeModel(fail=True)), whisper).transcribe(path, language="kn")
    check("inference failure falls back to Whisper", result.provider == "whisper" and whisper.calls == ["kn"])
    check("the fallback is flagged", result.fallback_used is True
          and result.metadata.get("fallback_from") == "indicconformer")
    errors = result.metadata.get("fallback_errors", [])
    check("the original error is kept", len(errors) == 1 and "onnxruntime inference failed" in errors[0], f"{errors}")

    if FFMPEG:
        whisper = FakeWhisper()
        garbage = write_fixture("garbage3.webm", b"not audio " * 30)
        result = router(Indic(FakeModel()), whisper).transcribe(garbage, language="kn")
        check("an undecodable upload still goes to the fallback, as before",
              result.fallback_used is True and "AudioDecodeError" in result.metadata["fallback_errors"][0])


# =========================================================
# 6  TEMPORARY FILES ARE CLEANED UP
# =========================================================

def test_temporary_files_are_cleaned_up():
    from service.engine import EngineRuntime, TranscriptionError
    from app.speech.stt import SpeechToText

    if FFMPEG:
        with TempfileWatch() as watch:
            icp.read_waveform(webm_fixture())
        check("decoding writes no temporary file", watch.created == 0, str(watch.created))

    with open(webm_fixture() if FFMPEG else wav_fixture(), "rb") as fh:
        good = fh.read()

    def runtime(indic, whisper):
        rt = EngineRuntime.__new__(EngineRuntime)
        rt.stt = SpeechToText(recognizer=router(indic, whisper))
        return rt

    created = []
    saved = tempfile.mkstemp

    def recording_mkstemp(*args, **kwargs):
        handle, path = saved(*args, **kwargs)
        created.append(path)
        return handle, path

    import service.engine as engine_module
    engine_module.tempfile.mkstemp = recording_mkstemp
    try:
        text = runtime(Indic(FakeModel()), FakeWhisper()).transcribe(good, language="kn", suffix=".webm")
        check("success: transcribed by IndicConformer", text == "ಸರಿ", text)
        check("success: the upload's temp file is gone",
              len(created) == 1 and not os.path.exists(created[0]), f"{created}")

        created.clear()
        try:
            runtime(Indic(FakeModel()), FakeWhisper(fail=True)).transcribe(
                b"not audio " * 30, language="kn", suffix=".webm")
            check("failure: refused", False, "no error")
        except TranscriptionError as error:
            check("failure: one customer-safe error", str(error) == "The recording could not be understood.", str(error))
        check("failure: the upload's temp file is gone",
              len(created) == 1 and not os.path.exists(created[0]), f"{created}")
    finally:
        engine_module.tempfile.mkstemp = saved


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("A1 AUDIO DECODING TESTS")
    print("=" * 60)

    try:
        for test in tests:
            print(f"\n{test.__name__}")
            test()
    finally:
        shutil.rmtree(FIXTURES, ignore_errors=True)

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}   skipped: {len(SKIPPED)}")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
