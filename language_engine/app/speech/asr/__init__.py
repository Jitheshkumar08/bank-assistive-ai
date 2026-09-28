"""Pluggable ASR providers for the language engine (Phase 3.2B-11).

    from app.speech.asr import create_recognizer
    recognizer = create_recognizer()
    result = recognizer.transcribe("clip.wav", language="kn")
    result.text, result.provider, result.model, result.fallback_used

Providers do speech -> text in the SAME language as the audio. Translation to
English remains a separate layer (app/translation); nothing here touches it.
"""
from app.speech.asr.base import SpeechRecognitionResult, SpeechRecognizer
from app.speech.asr.factory import (
    DEFAULT_LANGUAGE_PROVIDERS,
    RoutingSpeechRecognizer,
    build_providers,
    create_recognizer,
)
from app.speech.asr.indic_conformer_provider import IndicConformerRecognizer
from app.speech.asr.whisper_provider import WhisperRecognizer

__all__ = [
    "SpeechRecognitionResult",
    "SpeechRecognizer",
    "RoutingSpeechRecognizer",
    "WhisperRecognizer",
    "IndicConformerRecognizer",
    "create_recognizer",
    "build_providers",
    "DEFAULT_LANGUAGE_PROVIDERS",
]
