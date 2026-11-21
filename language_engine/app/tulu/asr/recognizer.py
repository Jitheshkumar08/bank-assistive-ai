"""Tulu speech recognition: existing acoustic model + closed-set matching.

WHAT IS AND IS NOT CLAIMED

No ASR model recognises Tulu (see evaluation/reports/tulu_asr_eval.md and
the earlier phase_3_2b10 audit). The 12 customer recordings (63 s) are far
too few to fine-tune one. This recogniser therefore:

  1. runs an EXISTING acoustic model (configured via TULU_ASR_ACOUSTIC) over
     the recording. Its raw output is Kannada/Devanagari letters for Tulu
     sounds -- a phonetic approximation, not a Tulu transcript;
  2. transliterates that output to Roman letters and matches it against the
     verified Tulu customer utterances (app/tulu/intent/matcher.py);
  3. ACCEPTS only a match at or above the matcher threshold, returning the
     verified Romanized utterance; otherwise it REFUSES, and the caller asks
     the customer to type in Tulu (the reliable input path).

So this is closed-set recognition of the verified deposit phrases, measured
honestly in the evaluation report -- not open-vocabulary Tulu ASR.
"""

from __future__ import annotations

import os
import threading
from dataclasses import asdict, dataclass, field
from typing import Callable, Optional

from app.tulu.intent.matcher import MATCH_THRESHOLD, VERIFIED_MATCH, understand
from app.tulu.normalization.text import detect_script, to_roman

#: Acoustic back ends available without new downloads.
ACOUSTIC_MODELS = ("indicconformer-kn", "whisper-small-kn")
DEFAULT_ACOUSTIC = os.getenv("TULU_ASR_ACOUSTIC", "indicconformer-kn")

REFUSAL = ("Tulu speech could not be recognised reliably. "
           "Please type your request in Tulu (Roman or Kannada script).")


@dataclass
class TuluRecognitionResult:
    accepted: bool
    transcript: Optional[str]          # verified Romanized Tulu when accepted
    raw_hypothesis: str                # what the acoustic model produced
    raw_script: str
    hypothesis_roman: str
    acoustic_model: str
    match: dict = field(default_factory=dict)
    note: str = ("Closed-set recognition of verified Tulu deposit phrases using a "
                 "Kannada acoustic model; not open-vocabulary Tulu ASR.")

    def as_dict(self):
        return asdict(self)


def _build_acoustic(name: str) -> Callable[[str], str]:
    if name == "indicconformer-kn":
        from app.speech.asr.indic_conformer_provider import IndicConformerRecognizer

        model = IndicConformerRecognizer()
        return lambda path: model.transcribe(path, language="kn").text
    if name == "whisper-small-kn":
        from app.speech.asr.whisper_provider import WhisperRecognizer

        model = WhisperRecognizer("small")
        return lambda path: model.transcribe(path, language="kn").text
    raise ValueError(f"unknown Tulu acoustic model {name!r}; choose from {ACOUSTIC_MODELS}")


class TuluSpeechRecognizer:

    def __init__(self, acoustic: str = DEFAULT_ACOUSTIC,
                 transcriber: Optional[Callable[[str], str]] = None,
                 threshold: float = MATCH_THRESHOLD):
        self.acoustic_name = acoustic
        self._transcriber = transcriber
        self.threshold = threshold

    def _transcribe(self, path: str) -> str:
        if self._transcriber is None:
            self._transcriber = _build_acoustic(self.acoustic_name)
        return (self._transcriber(path) or "").strip()

    def recognize(self, audio_path: str) -> TuluRecognitionResult:
        raw = self._transcribe(audio_path)
        result = understand(raw, threshold=self.threshold) if raw else None
        accepted = bool(result and result.method == VERIFIED_MATCH)
        return TuluRecognitionResult(
            accepted=accepted,
            transcript=result.matched_text if accepted else None,
            raw_hypothesis=raw,
            raw_script=detect_script(raw),
            hypothesis_roman=to_roman(raw),
            acoustic_model=self.acoustic_name,
            match=({"id": result.matched_id, "group": result.group, "score": result.score,
                    "candidates": result.candidates} if result else {}),
        )


_lock = threading.Lock()
_instance: Optional[TuluSpeechRecognizer] = None


def get_recognizer() -> TuluSpeechRecognizer:
    """One shared recogniser (the acoustic model loads on first use)."""
    global _instance
    with _lock:
        if _instance is None:
            _instance = TuluSpeechRecognizer()
        return _instance
