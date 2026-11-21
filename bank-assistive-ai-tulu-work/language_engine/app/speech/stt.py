"""Speech-to-text entry point for the pipeline.

The public contract is unchanged from before Phase 3.2B-11:

    SpeechToText().transcribe(path, language="en") -> {"text": ..., "language": ...}

What changed is what sits behind it. Instead of Whisper only, the call is routed
to the ASR provider configured for that language (app/speech/asr), so Kannada and
Hindi can use AI4Bharat IndicConformer while English continues to use exactly the
same Whisper model, decoding and defaults as before. Whisper also remains the
fallback for every language it supports.

The returned mapping now carries extra keys (provider, model, latency_seconds,
fallback_used, metadata). They are additive: callers that read only ["text"] and
["language"] behave exactly as they did.

Configuration lives in the environment (see .env.example and
docs: ASR_PROVIDER, ASR_LANGUAGE_PROVIDERS, ASR_FALLBACK).
"""
from typing import Any, Dict, Optional

from app.speech.asr import SpeechRecognitionResult, create_recognizer


class SpeechToText:

    def __init__(self, recognizer=None):
        self.recognizer = recognizer if recognizer is not None else create_recognizer()
        self.last_result: Optional[SpeechRecognitionResult] = None
        routing = getattr(self.recognizer, "describe_routing", None)
        if routing is not None:
            pretty = ", ".join(f"{lang}->{(names or ['none'])[0]}"
                               for lang, names in routing().items())
            print(f"Speech-to-text ready (routing: {pretty})")

    def transcribe(self, audio_path: str, language: str = "en") -> Dict[str, Any]:
        result = self.recognizer.transcribe(audio_path, language=language)
        self.last_result = result
        return result.as_dict()
