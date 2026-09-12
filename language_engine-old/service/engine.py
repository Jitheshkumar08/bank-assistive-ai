"""
Holds the engine's expensive objects and runs one turn at a time.

Two rules shape this file:

1. Nothing in `app/` is modified or re-implemented. The per-turn routing
   is the engine's own `VoiceAssistantPipeline._respond`, called with a
   host object that supplies exactly the three attributes it reads. That
   keeps control detection, question routing, intent detection and
   workflow activation identical to the CLI, rather than a second copy
   that drifts.

2. Expensive things are loaded once; mutable per-customer state is not
   shared. Whisper and the sentence-transformer encoders are immutable
   after construction and safe to reuse. ConversationManager is not, and
   comes from the session registry instead.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from typing import Optional

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState
from app.dialogue.manager import DialogueManager
from app.intent.detector import IntentDetector
from app.pipeline.voice_pipeline import VoiceAssistantPipeline
from app.speech.stt import SpeechToText


class TranscriptionError(RuntimeError):
    """Raised when audio could not be turned into text."""


@dataclass
class TurnResult:
    reply: str
    ended: bool = False


class _TurnHost:
    """
    Stand-in for the pipeline when running a single turn.

    `_respond` reads only `conversation`, `dialogue` and
    `intent_detector` -- it never touches the recorder, Whisper or TTS.
    Supplying just those three lets the real method run unchanged,
    without constructing a pipeline that would try to open a microphone
    and a speaker on the server.
    """

    def __init__(
        self,
        conversation: ConversationManager,
        dialogue: DialogueManager,
        intent_detector: IntentDetector,
    ) -> None:
        self.conversation = conversation
        self.dialogue = dialogue
        self.intent_detector = intent_detector


class EngineRuntime:
    """The engine, loaded once and shared across requests."""

    def __init__(self) -> None:
        # Each of these pulls a model into memory and takes real time.
        # Constructing them per request would make every turn unusable.
        self.stt = SpeechToText()
        self.intent_detector = IntentDetector()
        self.dialogue = DialogueManager()

    # -----------------------------------------------------------------
    # Speech to text
    # -----------------------------------------------------------------

    def transcribe(self, audio: bytes, *, language: str, suffix: str) -> str:
        """
        Runs the engine's existing Whisper path over an uploaded recording.

        The audio is written to a uniquely named temporary file and
        deleted immediately afterwards. The engine's own AudioRecorder
        uses a fixed filename, which is safe for one person at a terminal
        and a collision waiting to happen for concurrent web requests --
        so that class is deliberately not used here.

        Audio is never logged and never kept.
        """
        if not audio:
            raise TranscriptionError("The recording was empty.")

        handle, path = tempfile.mkstemp(suffix=suffix or ".webm", prefix="utterance-")

        try:
            with os.fdopen(handle, "wb") as file:
                file.write(audio)

            result = self.stt.transcribe(path, language=language)
        except TranscriptionError:
            raise
        except Exception as error:
            # Whisper needs ffmpeg to decode anything that is not WAV, so
            # a missing codec surfaces here as well as genuinely broken
            # audio. The caller cannot tell the difference and neither
            # message helps a customer, so both become one safe error.
            raise TranscriptionError("The recording could not be understood.") from error
        finally:
            try:
                os.remove(path)
            except OSError:
                # Best effort. The file is in the OS temp directory and
                # carries no identifying name.
                pass

        text = (result or {}).get("text", "")

        return text.strip() if isinstance(text, str) else ""

    # -----------------------------------------------------------------
    # One conversational turn
    # -----------------------------------------------------------------

    def run_turn(self, conversation: ConversationManager, user_text: str) -> TurnResult:
        """
        Mirrors one iteration of the engine's own conversation loop.

        The sequence is the CLI's, minus the terminal input and output:
        classify control commands first, record the turn in history, then
        let the engine decide the reply. Voice and text both arrive here,
        which is what makes them one pipeline rather than two.
        """
        text = (user_text or "").strip()

        if not text:
            return TurnResult(reply="I did not catch that. Could you say it again?")

        # Deterministic and LLM-free, so leaving a session still works
        # even while the language model is failing.
        control = self.dialogue.detect_control(text)

        if control == "session_exit":
            conversation.update_session_state(SessionState.EXITED)
            return TurnResult(
                reply="Thank you for using the banking assistant.",
                ended=True,
            )

        conversation.update_session_state(SessionState.PROCESSING)
        conversation.add_history("User", text)

        host = _TurnHost(conversation, self.dialogue, self.intent_detector)

        try:
            # The engine's real routing, unchanged.
            reply = VoiceAssistantPipeline._respond(host, control, text)
        except Exception:
            # A transient failure costs one turn, never the workflow. The
            # conversation object is untouched, so the next turn resumes
            # exactly where this one left off.
            conversation.update_session_state(SessionState.READY)
            return TurnResult(
                reply=(
                    "Sorry, I hit a temporary problem handling that. "
                    "Your request is still saved -- please say that again."
                ),
            )

        conversation.add_history("Assistant", reply)
        conversation.update_session_state(SessionState.READY)

        return TurnResult(reply=reply)


_runtime: Optional[EngineRuntime] = None


def get_runtime() -> EngineRuntime:
    """The shared runtime, built on first use."""
    global _runtime

    if _runtime is None:
        _runtime = EngineRuntime()

    return _runtime


def set_runtime(runtime: Optional[EngineRuntime]) -> None:
    """Injection point for tests; production never calls this."""
    global _runtime
    _runtime = runtime
