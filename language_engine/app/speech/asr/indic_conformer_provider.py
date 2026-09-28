"""AI4Bharat IndicConformer provider (ONNX, CPU) -- Phase 3.2B-11.

Runs the official AI4Bharat IndicConformer checkpoints through their MIT-licensed
ONNX conversions with the `onnx-asr` library: pure onnxruntime, no NeMo, no
torch, no GPU. Each language is a separate ~138 MB int8 model, downloaded once
from Hugging Face and cached locally, then run fully offline.

Verified on this project's hardware (Ryzen 5 5600H, CPU only), 5 clips per
language from the frozen banking set:

    Kannada  WER 16.7%  script 100% correct  RTF 0.26
    Hindi    WER 13.2%  script 100% correct  RTF 0.26

against the Whisper-small baseline of 118.1% / 24% / RTF 8.70 (Kannada).
Those WERs are flattering -- the clips come from the IndicVoices train split
that IndicConformer was trained on -- so treat them as proof the provider works,
not as an accuracy claim. A contamination-free measurement needs the custom
corpus described in debugging/spike/asr_recording_plan.md.

Only `kn` and `hi` have been smoke-tested. The other repos in the map exist and
come from the same conversion family, but are UNVERIFIED here and are opt-in
through configuration rather than advertised as supported.
"""
import os
import time
import wave
from typing import Dict, Optional, Tuple

import numpy as np

from app.speech.asr.base import SpeechRecognitionResult, SpeechRecognizer

#: Sample rates onnx-asr accepts directly for a NumPy waveform; anything else is
#: resampled here first.
NATIVE_SAMPLE_RATES = (8000, 16000)
TARGET_SAMPLE_RATE = 16000

#: language -> Hugging Face repo of the ONNX conversion.
#: MIT licensed, ungated, converted from ai4bharat/indicconformer_stt_<lang>_hybrid_ctc_rnnt_large.
DEFAULT_MODELS: Dict[str, str] = {
    "kn": "OpenVoiceOS/ai4bharat-indicconformer-kn-onnx",
    "hi": "OpenVoiceOS/ai4bharat-indicconformer-hi-onnx",
}

#: Same family, present on the Hub but NOT tested by this project. Enable with
#: ASR_INDIC_ENABLE_UNVERIFIED=1 (and measure before trusting the output).
UNVERIFIED_MODELS: Dict[str, str] = {
    "as": "OpenVoiceOS/ai4bharat-indicconformer-as-onnx",
    "bn": "OpenVoiceOS/ai4bharat-indicconformer-bn-onnx",
    "brx": "OpenVoiceOS/ai4bharat-indicconformer-brx-onnx",
    "doi": "OpenVoiceOS/ai4bharat-indicconformer-doi-onnx",
    "gu": "OpenVoiceOS/ai4bharat-indicconformer-gu-onnx",
    "kok": "OpenVoiceOS/ai4bharat-indicconformer-kok-onnx",
    "ks": "OpenVoiceOS/ai4bharat-indicconformer-ks-onnx",
    "mai": "OpenVoiceOS/ai4bharat-indicconformer-mai-onnx",
    "ml": "OpenVoiceOS/ai4bharat-indicconformer-ml-onnx",
    "mni": "OpenVoiceOS/ai4bharat-indicconformer-mni-onnx",
    "mr": "OpenVoiceOS/ai4bharat-indicconformer-mr-onnx",
}

#: Languages this provider must never claim. Tulu has no verified model in this
#: family and stays a separate research track (Phase 3.2B-10 audit).
NEVER_CLAIMED = {"tcy", "en"}


def read_waveform(audio_path: str) -> Tuple[np.ndarray, int]:
    """Read a WAV file as mono float32 in [-1, 1], plus its sample rate.

    onnx-asr reads files with the stdlib `wave` module, which supports only
    integer PCM and raises "unknown format: 3" on IEEE-float WAV. The recorder
    (app/speech/recorder.py) writes float32 WAV through scipy, so live
    recordings hit exactly that error. Decoding here instead keeps the provider
    working for both: onnx-asr accepts a float32 NumPy array directly.

    scipy is already a pinned dependency and is what the recorder writes with,
    so this adds nothing new; the stdlib path is a fallback for integer PCM.
    """
    data = None
    sample_rate = None
    try:
        from scipy.io import wavfile

        sample_rate, data = wavfile.read(audio_path)
    except ImportError:
        with wave.open(audio_path, "rb") as fh:  # integer PCM only
            sample_rate = fh.getframerate()
            raw = fh.readframes(fh.getnframes())
            width = fh.getsampwidth()
            if width == 1:
                data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
            else:
                data = np.frombuffer(raw, dtype=f"<i{width}")
            if fh.getnchannels() > 1:
                data = data.reshape(-1, fh.getnchannels())

    data = np.asarray(data)
    if data.ndim > 1:  # stereo or (n, 1) as written by the recorder
        data = data.mean(axis=1)

    if np.issubdtype(data.dtype, np.integer):
        # Scale by the dtype range: int16 -> /32768, int32 -> /2**31, uint8 -> centred.
        if data.dtype == np.uint8:
            data = (data.astype(np.float32) - 128.0) / 128.0
        else:
            data = data.astype(np.float32) / float(2 ** (8 * data.dtype.itemsize - 1))
    else:
        data = data.astype(np.float32)

    if sample_rate not in NATIVE_SAMPLE_RATES:
        try:
            from math import gcd

            from scipy.signal import resample_poly

            divisor = gcd(int(sample_rate), TARGET_SAMPLE_RATE)
            data = resample_poly(data, TARGET_SAMPLE_RATE // divisor, int(sample_rate) // divisor)
            data = data.astype(np.float32)
            sample_rate = TARGET_SAMPLE_RATE
        except ImportError as exc:  # pragma: no cover - scipy is pinned
            raise RuntimeError(
                f"audio is {sample_rate} Hz; resampling to {TARGET_SAMPLE_RATE} Hz needs scipy"
            ) from exc

    return np.ascontiguousarray(data, dtype=np.float32), int(sample_rate)


def _models_from_env() -> Dict[str, str]:
    models = dict(DEFAULT_MODELS)
    if os.getenv("ASR_INDIC_ENABLE_UNVERIFIED", "").strip().lower() in ("1", "true", "yes"):
        models.update(UNVERIFIED_MODELS)
    # ASR_INDIC_MODELS="kn=org/repo,ta=org/repo" overrides or adds entries.
    raw = os.getenv("ASR_INDIC_MODELS", "").strip()
    for pair in (p for p in raw.split(",") if p.strip()):
        if "=" in pair:
            lang, repo = pair.split("=", 1)
            models[lang.strip().lower()] = repo.strip()
    return {k: v for k, v in models.items() if k not in NEVER_CLAIMED}


class IndicConformerRecognizer(SpeechRecognizer):

    name = "indicconformer"

    def __init__(self, models: Optional[Dict[str, str]] = None,
                 quantization: Optional[str] = None):
        self.models = models if models is not None else _models_from_env()
        self.quantization = (quantization
                             or os.getenv("ASR_INDIC_QUANTIZATION", "int8").strip().lower())
        self.model_name = f"ai4bharat/indicconformer (onnx {self.quantization})"
        self._loaded: Dict[str, object] = {}

    def supports_language(self, language: str) -> bool:
        return (language or "").lower() in self.models

    def available(self) -> bool:
        try:
            import onnx_asr  # noqa: F401
            return True
        except Exception:
            return False

    def _load(self, language: str):
        if language not in self._loaded:
            import onnx_asr  # lazy: keeps the dependency optional

            repo = self.models[language]
            print(f"Loading IndicConformer ONNX for '{language}' ({repo}, {self.quantization})...")
            self._loaded[language] = onnx_asr.load_model(repo, quantization=self.quantization)
            print("IndicConformer loaded ✅")
        return self._loaded[language]

    def transcribe(self, audio_path: str, language: Optional[str] = None
                   ) -> SpeechRecognitionResult:
        lang = (language or "").lower()
        if not self.supports_language(lang):
            # Never guess a language: an unsupported code is an error the router
            # can act on, not something to silently transcribe as Hindi.
            raise ValueError(
                f"IndicConformer has no model configured for language {lang!r}; "
                f"configured: {sorted(self.models)}"
            )
        model = self._load(lang)
        started = time.perf_counter()
        # Decode here rather than handing onnx-asr the path: its reader is the
        # stdlib `wave` module, which rejects the float32 WAV the recorder writes.
        waveform, sample_rate = read_waveform(audio_path)
        text = model.recognize(waveform, sample_rate=sample_rate)
        latency = time.perf_counter() - started
        return SpeechRecognitionResult(
            text=(text or "").strip(),
            language=lang,
            provider=self.name,
            model=self.models[lang],
            latency_seconds=round(latency, 4),
            metadata={
                "runtime": "onnx-asr / onnxruntime (CPU)",
                "quantization": self.quantization,
                "decoding": "CTC greedy",
                "verified_languages": sorted(DEFAULT_MODELS),
                "input_sample_rate": sample_rate,
                "input_samples": int(waveform.shape[0]),
            },
        )
