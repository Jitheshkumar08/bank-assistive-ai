"""
The face-to-face interpreter's side of this service.

Kept apart from the turn pipeline on purpose. An interpreter utterance is
transcribed and translated and nothing else: it never reaches run_turn(),
intent detection or the dialogue manager, so what staff say can never start,
advance or cancel the customer's workflow. The visit's conversation is only
TOUCHED -- kept from idling out while the customer talks to staff -- never
read or changed.
"""

from __future__ import annotations

import threading
from typing import Dict, List, Optional

from app.translation.interpreter_translator import INTERPRETER_LANGUAGES, InterpreterTranslator
from service.tts import load_engine_speech

_translator: Optional[InterpreterTranslator] = None
_translator_lock = threading.Lock()


def get_translator() -> InterpreterTranslator:
    """The translator, built on first use. Tests replace it with set_translator()."""
    global _translator

    with _translator_lock:
        if _translator is None:
            _translator = InterpreterTranslator()

        return _translator


def set_translator(translator: Optional[InterpreterTranslator]) -> None:
    global _translator

    with _translator_lock:
        _translator = translator


def speech_languages() -> set:
    """Languages a voice exists for. Empty when speech cannot be loaded."""
    try:
        _, voices = load_engine_speech()
    except Exception:
        return set()

    return set(voices)


def capabilities() -> List[Dict[str, object]]:
    """
    What the interpreter can do per language, as this service knows it.

    `speech` is whether a translation INTO the language can be read aloud.
    Every listed language can be recognised (each has an ASR route) and
    translated to and from the others.
    """
    voices = speech_languages()

    return [
        {"code": code, "name": entry["name"], "speech": code in voices}
        for code, entry in INTERPRETER_LANGUAGES.items()
    ]
