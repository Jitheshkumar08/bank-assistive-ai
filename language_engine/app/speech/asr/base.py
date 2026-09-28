"""ASR provider contract (Phase 3.2B-11).

One recogniser interface, one result type. Providers know nothing about the
dialogue manager, the workflow engine or translation: they turn audio into text
in the language they were asked for, and nothing else.

Translation stays where it already lives (app/translation). A recogniser must
never return English for regional audio "helpfully" -- that would hide a
language failure from the pipeline.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class SpeechRecognitionResult:
    """What every provider returns.

    text/language keep the legacy SpeechToText contract; the rest is additive so
    callers that only read ["text"] keep working unchanged.
    """

    text: str
    language: str
    provider: str
    model: str
    latency_seconds: Optional[float] = None
    confidence: Optional[float] = None
    fallback_used: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        """Legacy-compatible mapping.

        `text` and `language` are exactly what app.speech.stt.SpeechToText
        returned before this phase, so existing callers are unaffected.
        """
        return {
            "text": self.text,
            "language": self.language,
            "provider": self.provider,
            "model": self.model,
            "latency_seconds": self.latency_seconds,
            "confidence": self.confidence,
            "fallback_used": self.fallback_used,
            "metadata": dict(self.metadata),
        }


class SpeechRecognizer(ABC):
    """Base class for ASR providers."""

    #: short provider id used in configuration and logs
    name: str = "base"
    #: human-readable model identifier recorded on every result
    model_name: str = "unknown"

    @abstractmethod
    def supports_language(self, language: str) -> bool:
        """True when this provider can transcribe `language` (ISO 639-1)."""

    @abstractmethod
    def transcribe(self, audio_path: str, language: Optional[str] = None
                   ) -> SpeechRecognitionResult:
        """Transcribe a 16 kHz mono audio file into text in `language`."""

    def available(self) -> bool:
        """True when the provider's dependencies and models can be loaded.

        Checked before routing so a missing optional dependency degrades to the
        configured fallback instead of raising at request time.
        """
        return True

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<{type(self).__name__} name={self.name!r} model={self.model_name!r}>"
