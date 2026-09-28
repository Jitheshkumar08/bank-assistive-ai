"""ASR provider selection and language routing (Phase 3.2B-11).

Routing is configuration, not code. Nothing outside this module decides which
model runs for a language, and the dialogue manager never learns a provider name.

Environment:

    ASR_PROVIDER              auto (default) | whisper | indicconformer
    ASR_LANGUAGE_PROVIDERS    "kn=indicconformer,hi=indicconformer,en=whisper"
    ASR_FALLBACK              whisper (default) | none
    ASR_INDIC_QUANTIZATION    int8 (default) | fp32
    ASR_INDIC_MODELS          "kn=org/repo,ta=org/repo"
    ASR_INDIC_ENABLE_UNVERIFIED  1 to allow the untested languages of the family
    ASR_WHISPER_MODEL         small (default)

`auto` sends a language to the first provider that declares support, following
ASR_LANGUAGE_PROVIDERS and then the default order. English always lands on
Whisper: IndicConformer has no English model.

Fallback is explicit. When the selected provider fails, the fallback provider is
used ONLY if it genuinely supports that language, and the result is marked
fallback_used=True with the original error in metadata. Whisper is never passed
off as a reliable Kannada transcript without that flag being set.
"""
import os
from typing import Dict, List, Optional

from app.speech.asr.base import SpeechRecognitionResult, SpeechRecognizer
from app.speech.asr.indic_conformer_provider import IndicConformerRecognizer
from app.speech.asr.whisper_provider import WhisperRecognizer

#: default per-language routing; overridden by ASR_LANGUAGE_PROVIDERS
DEFAULT_LANGUAGE_PROVIDERS = {
    "en": "whisper",
    "kn": "indicconformer",
    "hi": "indicconformer",
}

#: order tried when a language has no explicit route
DEFAULT_PROVIDER_ORDER = ["indicconformer", "whisper"]


def _parse_map(raw: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for pair in (p for p in (raw or "").split(",") if p.strip()):
        if "=" in pair:
            lang, provider = pair.split("=", 1)
            out[lang.strip().lower()] = provider.strip().lower()
    return out


def build_providers() -> Dict[str, SpeechRecognizer]:
    return {
        "whisper": WhisperRecognizer(os.getenv("ASR_WHISPER_MODEL", "small").strip() or "small"),
        "indicconformer": IndicConformerRecognizer(),
    }


class RoutingSpeechRecognizer(SpeechRecognizer):
    """Routes each request to a provider and applies the configured fallback."""

    name = "router"

    def __init__(self, providers: Optional[Dict[str, SpeechRecognizer]] = None,
                 provider_setting: Optional[str] = None,
                 language_providers: Optional[Dict[str, str]] = None,
                 fallback: Optional[str] = None):
        self.providers = providers if providers is not None else build_providers()
        self.provider_setting = (provider_setting
                                 or os.getenv("ASR_PROVIDER", "auto").strip().lower() or "auto")
        routes = dict(DEFAULT_LANGUAGE_PROVIDERS)
        routes.update(_parse_map(os.getenv("ASR_LANGUAGE_PROVIDERS", "")))
        if language_providers is not None:
            routes = dict(language_providers)
        self.language_providers = routes
        self.fallback = (fallback if fallback is not None
                         else os.getenv("ASR_FALLBACK", "whisper").strip().lower())
        self.model_name = f"router({self.provider_setting})"

    # ------------------------------------------------------------------ routing

    def _candidates(self, language: str) -> List[str]:
        """Provider names to try for `language`, best first."""
        if self.provider_setting != "auto":
            names = [self.provider_setting]
        else:
            preferred = self.language_providers.get(language)
            names = ([preferred] if preferred else []) + [
                n for n in DEFAULT_PROVIDER_ORDER if n != preferred
            ]
        usable = []
        for n in names:
            p = self.providers.get(n)
            if p is not None and p.supports_language(language) and p.available():
                usable.append(n)
        return usable

    def supports_language(self, language: str) -> bool:
        return bool(self._candidates((language or "en").lower()))

    def describe_routing(self, languages=("en", "kn", "hi")) -> Dict[str, List[str]]:
        """Which providers would serve each language, for startup logging."""
        return {lang: self._candidates(lang) for lang in languages}

    # -------------------------------------------------------------- transcribe

    def transcribe(self, audio_path: str, language: Optional[str] = None
                   ) -> SpeechRecognitionResult:
        lang = (language or "en").lower()
        candidates = self._candidates(lang)

        if self.fallback in self.providers and self.fallback not in candidates:
            fb = self.providers[self.fallback]
            if fb.supports_language(lang) and fb.available():
                candidates.append(self.fallback)

        if not candidates:
            raise RuntimeError(
                f"No ASR provider available for language {lang!r}. "
                f"Configured provider={self.provider_setting!r}, "
                f"routes={self.language_providers}, fallback={self.fallback!r}."
            )

        errors = []
        for index, name in enumerate(candidates):
            provider = self.providers[name]
            try:
                result = provider.transcribe(audio_path, language=lang)
            except Exception as exc:  # provider failed -> try the next candidate
                errors.append(f"{name}: {type(exc).__name__}: {exc}")
                print(f"⚠️  ASR provider '{name}' failed for '{lang}': {exc}")
                continue
            if index > 0:
                # Explicit, never silent: the caller can see this was not the
                # provider chosen for this language.
                result.fallback_used = True
                result.metadata["fallback_from"] = candidates[0]
                result.metadata["fallback_errors"] = errors
            return result

        raise RuntimeError(
            f"All ASR providers failed for language {lang!r}: " + " | ".join(errors))


def create_recognizer() -> RoutingSpeechRecognizer:
    """Build the configured recogniser. The single entry point for the app."""
    return RoutingSpeechRecognizer()
