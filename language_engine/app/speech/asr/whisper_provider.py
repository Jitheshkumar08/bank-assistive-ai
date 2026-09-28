"""Whisper provider -- the existing production baseline, behaviour unchanged.

This wraps exactly what app/speech/stt.py did before Phase 3.2B-11:

    whisper.load_model("small")
    model.transcribe(path, language=<code>, fp16=False)

Same model, same decoding, same defaults. English behaviour is therefore
identical to before; the only difference is that the model is now loaded on
first use instead of at construction, so starting the assistant no longer waits
for Whisper when a regional provider will serve the first turn.
"""
import time
from typing import Optional

from app.speech.asr.base import SpeechRecognitionResult, SpeechRecognizer

#: Whisper's own language list. Kept here so routing never claims a language
#: Whisper cannot actually decode (it has no Odia, Bodo, Dogri, Kashmiri,
#: Konkani, Maithili, Manipuri, Santali or Tulu).
WHISPER_LANGUAGES = {
    "en", "as", "bn", "gu", "hi", "kn", "ml", "mr", "ne", "pa", "sa", "sd", "ta", "te", "ur",
}


class WhisperRecognizer(SpeechRecognizer):

    name = "whisper"

    def __init__(self, model_size: str = "small"):
        self.model_size = model_size
        self.model_name = f"openai/whisper-{model_size}"
        self._model = None

    def _ensure_model(self):
        if self._model is None:
            import whisper  # imported lazily: heavy, and not needed for Indic-only turns

            print(f"Loading Whisper model ({self.model_size})...")
            self._model = whisper.load_model(self.model_size)
            print("Whisper loaded ✅")
        return self._model

    def supports_language(self, language: str) -> bool:
        return (language or "en").lower() in WHISPER_LANGUAGES

    def available(self) -> bool:
        try:
            import whisper  # noqa: F401
            return True
        except Exception:
            return False

    def transcribe(self, audio_path: str, language: Optional[str] = None
                   ) -> SpeechRecognitionResult:
        lang = (language or "en").lower()
        model = self._ensure_model()
        started = time.perf_counter()
        result = model.transcribe(audio_path, language=lang, fp16=False)
        latency = time.perf_counter() - started
        return SpeechRecognitionResult(
            text=result["text"].strip(),
            language=lang,
            provider=self.name,
            model=self.model_name,
            latency_seconds=round(latency, 4),
            metadata={"decoding": "openai-whisper transcribe() defaults, fp16=False"},
        )
