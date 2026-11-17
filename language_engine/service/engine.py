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

import functools
import os
import tempfile
import threading
from dataclasses import dataclass
from typing import Callable, Dict, Optional

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState
from app.dialogue.localization import ResponseLocalizer
from app.dialogue.manager import DialogueManager
from app.dialogue.text_normalization import normalize_turn
from app.intent.detector import IntentDetector
from app.knowledge.answerability import for_domain
from app.observability.latency import stage, turn_timer
from app.pipeline.voice_pipeline import VoiceAssistantPipeline
from app.speech.stt import SpeechToText


class TranscriptionError(RuntimeError):
    """Raised when audio could not be turned into text."""


#: Said when the customer leaves, and to anything said after that.
FAREWELL = "Thank you for using the banking assistant."

#: One knowledge refresh at a time: retriever, FAQ index, answerability and
#: answer cache are swapped together.
_REFRESH_LOCK = threading.Lock()


@dataclass
class TurnResult:
    #: What the customer is shown and hears: the reply rendered in the
    #: session's language.
    reply: str
    ended: bool = False
    #: The same reply in canonical English, before rendering -- which is
    #: also exactly what went into conversation history. Carried so the
    #: distinction the output boundary depends on is visible to callers
    #: and assertable by tests, rather than implied.
    canonical_reply: Optional[str] = None
    #: Domain integration (Phase 4), filled by domain runtimes only; Banking
    #: leaves them unset. The detected intent, the documents an answer was
    #: grounded in (attribution metadata, never content), and how the turn
    #: ended ("answered", "no_verified_information", "clarify", ...).
    intent: Optional[str] = None
    sources: Optional[list] = None
    outcome: Optional[str] = None
    #: Phase 5, domain workflows only: a step-by-step list already rendered
    #: in the session language (directions), and a request for the calling
    #: backend ({"id", "type", "workflow"}) -- never data.
    steps: Optional[list] = None
    action: Optional[dict] = None
    #: Stage latencies in milliseconds (Phase 2): normalization,
    #: policy, exact_lookup, intent_detection, embedding, retrieval,
    #: llm_understand, llm_answer and total -- whichever the turn used.
    timings: Optional[dict] = None


def timed_turn(method):
    """
    Times one turn stage by stage (Phase 2; observability.latency).

    A decorator rather than code inside run_turn, so run_turn's own body
    stays the sequence the CLI parity suite reads. The timings are attached
    to the result and logged as one line -- durations only, never the
    customer's words.
    """

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with turn_timer() as timer:
            result = method(self, *args, **kwargs)

        result.timings = timer.as_dict()
        print(f"[LATENCY] {timer.summary()}")

        return result

    return wrapper


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

        # THE SAME detector, injected -- not a second one (Phase
        # 3.2B-16A).
        #
        # DialogueManager needs a detector to answer one question:
        # "is this turn a request for a DIFFERENT banking service than
        # the one in progress?" Without it, _detect_workflow_conflict()
        # returns None by design and the whole of Phase 3.2B-14 is dark.
        # That is exactly what had happened here: VoiceAssistantPipeline
        # passed `intent_detector=` and this constructor did not, so a
        # customer mid-deposit who asked to withdraw heard the deposit
        # step restated -- the defect 3.2B-14 was written to fix, still
        # live on the web path only.
        #
        # Injected rather than constructed for the same reason the CLI
        # injects it: this engine has exactly one intent classifier, and
        # a second would double the start-up cost and the memory while
        # adding nothing.
        self.dialogue = DialogueManager(intent_detector=self.intent_detector)

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

    @staticmethod
    def _render(
        localizer: Optional[ResponseLocalizer],
        reply: str,
        *,
        remember: bool,
    ) -> str:
        """
        The single output boundary, mirroring the CLI's.

        `remember` is True only for a reply that was also written to
        conversation history, so the localizer's remembered canonical
        reply and the history never disagree about what the assistant
        last said.

        No localizer -- an older caller, or a test -- means English out,
        exactly as before this phase.
        """
        if localizer is None:
            return reply

        return localizer.render(reply, remember=remember)

    @staticmethod
    def has_exited(conversation: ConversationManager) -> bool:
        """Whether the customer has ended this conversation ("exit", "bye")."""
        return getattr(conversation, "session_state", None) == SessionState.EXITED

    def _farewell(self, localizer: Optional[ResponseLocalizer]) -> TurnResult:
        """The reply to an exit, and to every turn after one. Never remembered."""
        return TurnResult(
            reply=self._render(localizer, FAREWELL, remember=False),
            ended=True,
            canonical_reply=FAREWELL,
        )

    # -----------------------------------------------------------------
    # Knowledge maintenance (Phase 2)
    # -----------------------------------------------------------------

    def refresh_knowledge(self) -> dict:
        """
        Re-reads the knowledge collection after an article was added,
        edited, activated or removed.

        Only changed articles are re-embedded, an article is never
        indexed twice, the FAQ answers are rebuilt from the new text,
        and cached answers are dropped (their knowledge version is
        gone). Returns what changed.
        """
        understanding = self.dialogue.dialogue_understanding
        with _REFRESH_LOCK:
            retriever = understanding.knowledge_retriever
            summary = retriever.refresh()
            self.dialogue.fast_path.refresh(retriever.documents)
            understanding.answerability = for_domain(understanding.domain, retriever.documents)
            understanding.answer_cache.clear()
        # What a maintainer needs to see (Phase 3A): which articles were
        # left out and why, and what in the manifest or FAQ index is broken.
        summary["skipped"] = dict(retriever.loader.skip_reasons)
        summary["problems"] = list(retriever.loader.problems)
        summary["faq_problems"] = list(self.dialogue.fast_path.structured.problems)
        return summary

    def knowledge_gaps(self, limit: int = 100) -> list:
        """The most recent knowledge-gap records (app/knowledge/gaps.py)."""
        return self.dialogue.dialogue_understanding.gap_log.recent(limit)

    def knowledge_gap_groups(self, include_resolved: bool = True) -> list:
        """One row per question, with its count and review status."""
        return self.dialogue.dialogue_understanding.gap_log.grouped(include_resolved)

    def resolve_knowledge_gap(self, question_hash: str, resolution: str, note: str = "") -> dict:
        """Closes one group; ValueError / KeyError for a bad resolution / question."""
        return self.dialogue.dialogue_understanding.gap_log.resolve(question_hash, resolution, note)

    @timed_turn
    def run_turn(
        self,
        conversation: ConversationManager,
        user_text: str,
        localizer: Optional[ResponseLocalizer] = None,
    ) -> TurnResult:
        """
        Mirrors one iteration of the engine's own conversation loop.

        The sequence is the CLI's, minus the terminal input and output:
        normalize the transcript, classify control commands, record the
        turn in history, let the engine decide the reply, then render it
        in the session's language on the way out. Voice and text both
        arrive here, which is what makes them one pipeline rather than
        two.

        `localizer` is per-session and optional. It is per-session
        because ResponseLocalizer holds the session's LANGUAGE -- one
        shared instance would render a Kannada customer's reply in
        whichever language the previous request happened to use -- and
        because it remembers the last canonical reply for replay. It is
        optional so every existing caller keeps working unchanged, in
        which case nothing is rendered and the reply stays English.

        WHY THIS METHOD KEEPS DRIFTING FROM THE CLI, AND WHAT FIXES IT
        -------------------------------------------------------------
        The per-turn ROUTING is shared -- `_respond` below is the
        engine's own method, not a copy -- but the steps AROUND it were
        hand-written here and fell behind three times over
        (normalization, the injected detector, rendering). The parity
        suite in debugging/test_service_turn.py exists to catch the
        fourth: it asserts this sequence against the CLI's, rather than
        asserting any one of the three fixes in isolation.
        """
        # A conversation the customer has left takes no further turns.
        # Checked before anything else -- an empty turn, a control, a
        # banking request -- so nothing after an exit can reach routing,
        # history or the workflow: every later turn gets the same
        # farewell and ended=True, exactly as the exit turn itself did.
        if self.has_exited(conversation):
            return self._farewell(localizer)

        raw_text = (user_text or "").strip()

        if not raw_text:
            # Never recorded in history, so never remembered.
            return TurnResult(
                reply=self._render(
                    localizer,
                    "I did not catch that. Could you say it again?",
                    remember=False,
                ),
                canonical_reply="I did not catch that. Could you say it again?",
            )

        # Normalisation, exactly where the CLI applies it: after
        # transcription, before ANY routing decision. Since M5 one call
        # produces all three representations (text_normalization): the
        # ORIGINAL, the NORMALIZED spelling, and the ROUTING text --
        # mis-heard banking terms repaired ("Chuck Book" -> "cheque book")
        # and loanwords written in English (ಲೋನ್ / लोन -> loan).
        #
        # The ORIGINAL is what goes into history below, keeping debugging
        # honest about what was actually heard. Only the routing path sees
        # the routing text.
        with stage("normalization"):
            turn = normalize_turn(raw_text)
        text = turn.routing

        # Deterministic and LLM-free, so leaving a session still works
        # even while the language model is failing.
        control = self.dialogue.detect_control(text)

        if control == "session_exit":
            conversation.update_session_state(SessionState.EXITED)

            # Like the CLI, an exit turn is not recorded: the loop ends
            # before history is touched. Not recorded means not
            # remembered.
            return self._farewell(localizer)

        conversation.update_session_state(SessionState.PROCESSING)
        conversation.add_history("User", raw_text)

        host = _TurnHost(conversation, self.dialogue, self.intent_detector)

        try:
            # The engine's real routing, unchanged.
            reply = VoiceAssistantPipeline._respond(host, control, text)
        except Exception:
            # A transient failure costs one turn, never the workflow. The
            # conversation object is untouched, so the next turn resumes
            # exactly where this one left off.
            conversation.update_session_state(SessionState.READY)

            apology = (
                "Sorry, I hit a temporary problem handling that. "
                "Your request is still saved -- please say that again."
            )

            return TurnResult(
                reply=self._render(localizer, apology, remember=False),
                canonical_reply=apology,
            )

        # CANONICAL ENGLISH goes into history, always.
        #
        # History is what dialogue understanding is later given as
        # context, and what `repeat` replays through
        # _last_assistant_message(). Storing the rendered reply would put
        # Kannada into the English prompt and make a replay return text
        # that was never the assistant's own wording.
        conversation.add_history("Assistant", reply)
        conversation.update_session_state(SessionState.READY)

        return TurnResult(
            reply=self._render(localizer, reply, remember=True),
            canonical_reply=reply,
        )


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


# ---------------------------------------------------------------------
# Runtimes for the other application domains
#
# Banking is served by get_runtime() above, exactly as before domains
# existed. Every other domain gets its OWN runtime -- its own intent
# profile, knowledge collection, workflows and dialogue state -- built on
# first use by a factory that domain registers. Expensive, immutable
# models (the sentence encoder, Whisper) are shared between runtimes by
# their own caches; nothing mutable is.
#
# A domain with no registered factory is not served: get_domain_runtime()
# raises DomainRuntimeUnavailable rather than lending it Banking's runtime.
# ---------------------------------------------------------------------


class DomainRuntimeUnavailable(RuntimeError):
    """The domain is registered but its engine components are not available."""


_domain_factories: Dict[str, Callable[[], EngineRuntime]] = {}
_domain_runtimes: Dict[str, EngineRuntime] = {}
_domain_lock = threading.Lock()


def register_domain_runtime(domain: str, factory: Callable[[], EngineRuntime]) -> None:
    """Declares how to build `domain`'s runtime. Built lazily, once."""
    with _domain_lock:
        _domain_factories[domain] = factory
        _domain_runtimes.pop(domain, None)


def unregister_domain_runtime(domain: str) -> None:
    """Removes a domain's factory and runtime (tests)."""
    with _domain_lock:
        _domain_factories.pop(domain, None)
        _domain_runtimes.pop(domain, None)


def get_domain_runtime(domain: str) -> EngineRuntime:
    """`domain`'s own runtime, built on first use. Never another domain's."""
    with _domain_lock:
        runtime = _domain_runtimes.get(domain)

        if runtime is None:
            factory = _domain_factories.get(domain)

            if factory is None:
                raise DomainRuntimeUnavailable(domain)

            try:
                runtime = factory()
            except Exception as error:
                # A domain that cannot be built (an invalid manifest, a
                # model that failed to load) is unavailable -- 503 for that
                # domain only. Not cached, so a later request retries.
                raise DomainRuntimeUnavailable(domain) from error
            _domain_runtimes[domain] = runtime

        return runtime


def domain_runtime_status(domain: str) -> str:
    """"ready", "registered" (not built yet) or "unavailable". Builds nothing."""
    with _domain_lock:
        if domain in _domain_runtimes:
            return "ready"
        if domain in _domain_factories:
            return "registered"
        return "unavailable"
