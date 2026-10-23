"""
PHASE 3.2B-16A -- WEB SERVICE / CLI PARITY

WHY THIS SUITE EXISTS

`service/engine.py` shares the engine's per-turn ROUTING -- it calls the real
`VoiceAssistantPipeline._respond` rather than a copy -- but the steps AROUND
that call were hand-written, and fell behind the CLI three separate times:

  G1  DialogueManager() was constructed with no intent_detector, so the whole
      of Phase 3.2B-14 was dark on the web path. A customer mid-deposit who
      asked to withdraw heard "Please take a deposit slip." again.
  G2  ResponseLocalizer was never applied, so a Kannada visit got English
      sentences, which /tts then read aloud in a Kannada voice.
  G3  normalize_banking_terms() was never applied, so Whisper's "Chuck Book"
      never became "cheque book".

Fixing those three is not what stops a fourth. This suite is what stops a
fourth: it asserts the SEQUENCE the service performs against the sequence the
CLI performs, so a capability added to `VoiceAssistantPipeline.run()` and not
to `EngineRuntime.run_turn()` fails here rather than in a live session.

    receive turn -> normalize -> existing routing -> canonical English history
                 -> ResponseLocalizer -> returned reply

WHAT IS REAL HERE AND WHAT IS NOT

Real: EngineRuntime.run_turn, VoiceAssistantPipeline._respond, DialogueManager,
IntentDetector (the actual model), ConversationManager, WorkflowLoader,
ResponseLocalizer, SessionRegistry, the deterministic control tier.

Stubbed: the Groq understanding client only. No microphone, no ASR, no
network. The embedding model is local, exactly as the Phase 3.2B-12, -14 and
-15 suites use it.

Run from language_engine/:
    python -m debugging.test_service_turn
"""
import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState, WorkflowState
from app.dialogue.llm.dialogue_understanding import fallback_understanding
from app.dialogue.localization import ResponseLocalizer, localize
from app.dialogue.manager import DialogueManager
from app.dialogue.term_normalizer import normalize_banking_terms
from app.intent.detector import IntentDetector
from app.workflow.loader import WorkflowLoader

from service import engine as engine_module
from service.engine import EngineRuntime, TurnResult
from service.registry import SessionEntry, SessionRegistry


failures = []
checks = [0]


def check(name, ok, detail=""):
    checks[0] += 1
    if not ok:
        failures.append(f"{name}  [{detail}]" if detail else name)
    print(("  PASS  " if ok else "  FAIL  ") + name + (f"  [{detail}]" if detail else ""))


def section(title):
    print()
    print(f"--- {title}")


DEPOSIT_STEP_1 = "Please take a deposit slip."
DEPOSIT_STEP_2 = "Fill in your account number."
WITHDRAW_STEP_1 = "Please take a withdrawal slip."


# =========================================================
# HARNESS
# =========================================================

def entities(**overrides):
    base = {
        "amount": None,
        "account_number": None,
        "name": None,
        "phone_number": None,
        "step_number": None,
    }
    base.update(overrides)
    return base


class FakeUnderstanding:
    """Stands in for the Groq-backed understanding client.

    The default classification is the one the live session produced --
    workflow_action / none / not completed -- because that is the turn the
    web path was mishandling.

    It also records the text it was given, which is how normalization is
    observed: the router's view of the utterance, not the raw transcript.
    """

    def __init__(self):
        self.next_result = {
            "type": "workflow_action",
            "action": "none",
            "step_completed": False,
            "target_workflow": None,
            "entities": entities(),
        }
        self.seen_text = []
        self.questions = []
        self.answer = "ANSWERED-FROM-KNOWLEDGE-BASE"

    def set(self, message_type, action="none", step_completed=False, **ents):
        self.next_result = {
            "type": message_type,
            "action": action,
            "step_completed": step_completed,
            "target_workflow": None,
            "entities": entities(**ents),
        }

    def fail(self):
        self.next_result = fallback_understanding()

    def understand(self, user_text, current_workflow=None,
                   current_step=None, current_instruction=None):
        self.seen_text.append(user_text)
        return self.next_result

    def answer_question(self, question, workflow_context,
                        current_instruction, recent_context=None):
        self.questions.append(question)
        return self.answer


class ExplodingUnderstanding:
    """Raises rather than answering, to exercise the turn's error boundary."""

    def understand(self, **kwargs):
        raise RuntimeError("engine blew up")

    def answer_question(self, **kwargs):
        raise RuntimeError("engine blew up")


def make_runtime(detector, understanding=None):
    """An EngineRuntime with real routing and no models loaded.

    NOTE: this helper WIRES the detector into DialogueManager the way the
    production constructor does. It is therefore NOT proof that the
    constructor does so -- test_construction_wiring() below is, by running
    the real EngineRuntime.__init__ against counted stand-ins. The two are
    deliberately separate: this one exercises behaviour, that one exercises
    wiring.
    """
    runtime = object.__new__(EngineRuntime)
    # Whisper/IndicConformer are never reached: no test here transcribes.
    runtime.stt = None
    runtime.intent_detector = detector

    dialogue = object.__new__(DialogueManager)
    dialogue.workflow_loader = WorkflowLoader()
    dialogue.dialogue_understanding = understanding or FakeUnderstanding()
    dialogue.intent_detector = detector

    runtime.dialogue = dialogue

    return runtime


def fresh_conversation(language="en"):
    conversation = ConversationManager()
    conversation.start_conversation()
    conversation.language = language
    return conversation


def active_workflow(intent, step=1, language="en"):
    """A conversation with `intent` loaded and ACTIVE."""
    conversation = fresh_conversation(language)
    conversation.set_intent(intent)
    conversation.load_workflow(intent)
    conversation.current_step = step
    return conversation


def assistant_history(conversation):
    return [
        entry["message"]
        for entry in conversation.history
        if entry.get("speaker") == "Assistant"
    ]


def user_history(conversation):
    return [
        entry["message"]
        for entry in conversation.history
        if entry.get("speaker") == "User"
    ]


# =========================================================
# A, K  CONSTRUCTION WIRING
#
# The real EngineRuntime.__init__, run against counted stand-ins for the
# three expensive collaborators. This is what proves G1 is fixed at the
# source rather than in a test helper.
# =========================================================

def test_construction_wiring():
    section("A, K -- the service injects THE detector, and builds only one")

    built = {"stt": 0, "detector": 0, "dialogue": 0}
    captured = {}

    class CountingStt:
        def __init__(self):
            built["stt"] += 1

    class CountingDetector:
        def __init__(self):
            built["detector"] += 1

        def detect_intent(self, text):  # pragma: no cover - not called here
            return {}

    class CountingDialogue:
        def __init__(self, intent_detector=None):
            built["dialogue"] += 1
            captured["intent_detector"] = intent_detector
            # Mirrors the real constructor's own assignment, so the
            # attribute assertions below mean what they say.
            self.intent_detector = intent_detector

    originals = (
        engine_module.SpeechToText,
        engine_module.IntentDetector,
        engine_module.DialogueManager,
    )

    engine_module.SpeechToText = CountingStt
    engine_module.IntentDetector = CountingDetector
    engine_module.DialogueManager = CountingDialogue

    try:
        runtime = EngineRuntime()
    finally:
        (
            engine_module.SpeechToText,
            engine_module.IntentDetector,
            engine_module.DialogueManager,
        ) = originals

    check("[K] exactly ONE IntentDetector is constructed",
          built["detector"] == 1, str(built))
    check("[K] exactly one DialogueManager is constructed",
          built["dialogue"] == 1, str(built))

    check("[A] the dialogue manager was given a detector",
          captured.get("intent_detector") is not None)
    check("[A] it was given THE runtime's detector, not another one",
          captured.get("intent_detector") is runtime.intent_detector)
    check("[A] the dialogue manager holds that same detector",
          runtime.dialogue.intent_detector is runtime.intent_detector)

    # The CLI's own wiring, for comparison. Parity means these agree.
    import app.pipeline.voice_pipeline as pipeline_module
    import inspect

    source = inspect.getsource(pipeline_module.VoiceAssistantPipeline.__init__)
    check("[A] the CLI wires the detector the same way",
          "intent_detector=self.intent_detector" in source)


# =========================================================
# G  NORMALIZATION IS APPLIED ON THE SERVICE PATH
# =========================================================

def test_normalization(detector):
    section("G -- banking-term normalization reaches the router")

    # The normalizer's own contract, unchanged and not reimplemented here.
    check("[G] the normalizer still maps the known variant",
          normalize_banking_terms("I need my Chuck Book")
          == "I need my cheque book",
          normalize_banking_terms("I need my Chuck Book"))

    fake = FakeUnderstanding()
    fake.set("question", "explain")
    runtime = make_runtime(detector, fake)
    conversation = active_workflow("deposit money", step=2)

    runtime.run_turn(conversation, "Where do I get my Chuck Book?")

    check("[G] the router saw the NORMALIZED text",
          fake.seen_text and "cheque book" in fake.seen_text[-1],
          str(fake.seen_text[-1]) if fake.seen_text else "nothing seen")
    check("[G] the router did not see the raw mis-transcription",
          fake.seen_text and "Chuck Book" not in fake.seen_text[-1],
          str(fake.seen_text[-1]) if fake.seen_text else "")

    # The normalizer's documented rule: history keeps what was HEARD.
    check("[G] history keeps the RAW transcript",
          user_history(conversation) == ["Where do I get my Chuck Book?"],
          str(user_history(conversation)))

    # Normalization must not disturb anything else.
    check("[G] the workflow is untouched",
          conversation.current_workflow == "deposit money"
          and conversation.current_step == 2
          and conversation.workflow_state == WorkflowState.ACTIVE)

    # A control word survives normalization unchanged -- nothing in the
    # table is a control phrase, and Kannada carries no ASCII at all.
    for text in ("cancel", "pause", "ವಿರಾಮ", "ನಿಲ್ಲಿಸು", "ಮುಂದುವರಿಸಿ"):
        check(f"[G] normalization leaves {text!r} alone",
              normalize_banking_terms(text) == text)


# =========================================================
# B, C, D, O  WORKFLOW CONFLICT THROUGH THE SERVICE
# =========================================================

def conflict_case(detector, current, utterance, label, language="en"):
    fake = FakeUnderstanding()          # workflow_action / none, as live
    runtime = make_runtime(detector, fake)
    conversation = active_workflow(current, language=language)
    localizer = ResponseLocalizer(language)

    before_step = conversation.current_step
    result = runtime.run_turn(conversation, utterance, localizer)

    conflict = conversation.workflow_conflict

    check(f"[{label}] a conflict is raised", conflict is not None,
          f"reply={result.reply[:60]!r}")
    check(f"[{label}] the current request is NOT repeated",
          DEPOSIT_STEP_1 not in result.reply
          and WITHDRAW_STEP_1 not in result.reply,
          result.reply[:70])
    check(f"[{label}] nothing was switched",
          conversation.current_workflow == current
          and conversation.workflow_state == WorkflowState.ACTIVE
          and conversation.current_step == before_step,
          f"{conversation.current_workflow} / {conversation.workflow_state}")

    return conversation, result, conflict


def test_conflict_parity(detector):
    section("B, C, D -- workflow conflict works through the service path")

    # B -- active deposit + an English withdrawal request
    conversation, result, conflict = conflict_case(
        detector, "deposit money", "I want to withdraw money", "B")
    check("[B] the requested service is the withdrawal",
          conflict.requested_workflow == "withdraw money", str(conflict))
    check("[B] the reply is a clarification question",
          result.reply.rstrip().endswith("?"), result.reply[:70])
    check("[B] the reply names the deposit in progress",
          "deposit in progress" in result.reply, result.reply[:70])

    # C -- active withdrawal + an English deposit request
    _c, result_c, conflict_c = conflict_case(
        detector, "withdraw money", "I want to deposit money", "C")
    check("[C] the requested service is the deposit",
          conflict_c.requested_workflow == "deposit money", str(conflict_c))
    check("[C] the reply names the withdrawal in progress",
          "withdrawal in progress" in result_c.reply, result_c.reply[:70])

    # D -- THE LIVE KANNADA CASE, through the web service
    _d, result_d, conflict_d = conflict_case(
        detector, "deposit money", "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು", "D", language="kn")
    check("[D] the requested service is the withdrawal",
          conflict_d.requested_workflow == "withdraw money", str(conflict_d))
    check("[D] the assistant does NOT say 'Please take a deposit slip.'",
          result_d.reply != DEPOSIT_STEP_1
          and DEPOSIT_STEP_1 not in result_d.reply,
          result_d.reply[:70])

    # K again, from the other direction: with NO detector the feature is
    # simply off, which is what proves the behaviour above comes from the
    # injection and not from somewhere else.
    bare = make_runtime(None, FakeUnderstanding())
    bare_conversation = active_workflow("deposit money")
    bare_result = bare.run_turn(bare_conversation, "I want to withdraw money")
    check("[K] with no detector injected there is no conflict",
          bare_conversation.workflow_conflict is None)
    check("[K] with no detector the pre-fix reply is what comes back",
          bare_result.reply == DEPOSIT_STEP_1, bare_result.reply[:60])


def test_conflict_resolution_preserved(detector):
    section("O -- Phase 3.2B-14 resolution semantics, through the service")

    # Cancel -> old cancelled, new started.
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = active_workflow("deposit money", step=2)
    runtime.run_turn(conversation, "I want to withdraw money")
    result = runtime.run_turn(conversation, "cancel it and withdraw")

    check("[O] cancel starts the requested workflow",
          conversation.current_workflow == "withdraw money"
          and conversation.workflow_state == WorkflowState.ACTIVE
          and conversation.current_step == 1,
          f"{conversation.current_workflow} / {conversation.workflow_state}")
    check("[O] cancel reports the cancellation",
          "cancelled the deposit" in result.reply, result.reply[:70])
    check("[O] cancel keeps nothing paused",
          conversation.paused_workflow is None)
    check("[O] the conflict is resolved", conversation.workflow_conflict is None)

    # Pause -> old suspended AND recoverable, new started.
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = active_workflow("deposit money", step=3)
    runtime.run_turn(conversation, "I want to withdraw money")
    result = runtime.run_turn(conversation, "pause it and withdraw")

    check("[O] pause starts the requested workflow",
          conversation.current_workflow == "withdraw money"
          and conversation.workflow_state == WorkflowState.ACTIVE)
    check("[O] pause keeps the deposit recoverable",
          conversation.paused_workflow is not None
          and conversation.paused_workflow.workflow == "deposit money"
          and conversation.paused_workflow.step == 3,
          str(conversation.paused_workflow))
    check("[O] the paused request restores SUSPENDED at its step",
          conversation.restore_paused_workflow() is not None
          and conversation.workflow_state == WorkflowState.SUSPENDED
          and conversation.current_step == 3,
          str(conversation.workflow_state))

    # Continue -> nothing moves.
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = active_workflow("deposit money", step=2)
    runtime.run_turn(conversation, "I want to withdraw money")
    result = runtime.run_turn(conversation, "continue with the deposit")

    check("[O] continue keeps the deposit exactly where it was",
          conversation.current_workflow == "deposit money"
          and conversation.current_step == 2
          and conversation.workflow_state == WorkflowState.ACTIVE,
          f"{conversation.current_workflow} / {conversation.current_step}")
    check("[O] continue resolves the conflict",
          conversation.workflow_conflict is None)
    check("[O] continue restates the step the customer is on",
          DEPOSIT_STEP_2 in result.reply, result.reply[:70])

    # A Kannada control word resolves the conflict through the same path.
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = active_workflow("deposit money", language="kn")
    runtime.run_turn(conversation, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    runtime.run_turn(conversation, "ನಿಲ್ಲಿಸು")
    check("[O] a Kannada cancel resolves the conflict and starts the withdrawal",
          conversation.current_workflow == "withdraw money"
          and conversation.workflow_state == WorkflowState.ACTIVE,
          f"{conversation.current_workflow} / {conversation.workflow_state}")


# =========================================================
# E, F  CONTROL COMMANDS STILL WORK, BOTH LANGUAGES
# =========================================================

def test_controls(detector):
    section("E, F -- pause / resume / cancel / repeat / exit through the service")

    cases = (
        # (label, pause, resume, cancel, repeat, exit)
        ("E/en", "pause", "resume", "cancel", "repeat", "exit"),
        ("F/kn", "ವಿರಾಮ", "ಮುಂದುವರಿಸಿ", "ನಿಲ್ಲಿಸು", "ಮತ್ತೆ ಹೇಳಿ", "ಹೊರಗೆ"),
    )

    for label, pause, resume, cancel, repeat, leave in cases:

        runtime = make_runtime(detector, FakeUnderstanding())
        conversation = active_workflow("deposit money", step=2)

        result = runtime.run_turn(conversation, pause)
        check(f"[{label}] pause suspends the workflow",
              conversation.workflow_state == WorkflowState.SUSPENDED,
              str(conversation.workflow_state))
        check(f"[{label}] pause does not move the step",
              conversation.current_step == 2)

        result = runtime.run_turn(conversation, resume)
        check(f"[{label}] resume reactivates the workflow",
              conversation.workflow_state == WorkflowState.ACTIVE,
              str(conversation.workflow_state))
        check(f"[{label}] resume states the step again",
              DEPOSIT_STEP_2 in result.canonical_reply,
              str(result.canonical_reply)[:60])

        result = runtime.run_turn(conversation, repeat)
        check(f"[{label}] repeat recalls the instruction",
              result.canonical_reply == DEPOSIT_STEP_2,
              str(result.canonical_reply)[:60])
        check(f"[{label}] repeat does not move the step",
              conversation.current_step == 2)

        result = runtime.run_turn(conversation, cancel)
        check(f"[{label}] cancel asks first and changes nothing",
              conversation.workflow_state == WorkflowState.ACTIVE
              and conversation.current_step == 2,
              str(conversation.workflow_state))

        result = runtime.run_turn(conversation, cancel)   # the confirmation
        check(f"[{label}] cancel cancels the workflow",
              conversation.workflow_state == WorkflowState.CANCELLED,
              str(conversation.workflow_state))

        result = runtime.run_turn(conversation, leave)
        check(f"[{label}] exit ends the session",
              result.ended is True, str(result.ended))
        check(f"[{label}] exit marks the session EXITED",
              conversation.session_state == SessionState.EXITED,
              str(conversation.session_state))
        check(f"[{label}] an exit turn is not recorded in history",
              user_history(conversation)[-1] != leave
              if user_history(conversation) else True,
              str(user_history(conversation)[-3:]))


# =========================================================
# H, I, J  LOCALIZATION AND CANONICAL HISTORY
# =========================================================

def test_localization_and_history(detector):
    section("H, I, J -- localization out, canonical English in history")

    # --- H: a fixed sentence is rendered in the session language -------
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = fresh_conversation("kn")          # nothing active
    localizer = ResponseLocalizer("kn")

    result = runtime.run_turn(conversation, "cancel", localizer)

    english = "There's nothing active to cancel right now."
    kannada, translated = localize(english, "kn")

    check("[H] the fixture really does have a Kannada rendering", translated)
    check("[H] the reply is returned in Kannada",
          result.reply == kannada, result.reply)
    check("[H] the canonical reply is the English one",
          result.canonical_reply == english, str(result.canonical_reply))
    check("[I] history stores canonical English, not the rendering",
          assistant_history(conversation) == [english],
          str(assistant_history(conversation)))
    check("[I] the Kannada rendering is nowhere in history",
          kannada not in assistant_history(conversation))

    # --- H: a translated PREFIX over dynamic text ---------------------
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = active_workflow("deposit money", step=1, language="kn")
    localizer = ResponseLocalizer("kn")

    runtime.run_turn(conversation, "ವಿರಾಮ", localizer)
    result = runtime.run_turn(conversation, "ಮುಂದುವರಿಸಿ", localizer)

    check("[H] the 'Continuing.' opener is rendered in Kannada",
          result.reply.startswith("ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ"), result.reply[:50])
    # Until M6 this asserted the instruction STAYED English -- the
    # limitation M6 removes. The authored rendering now replaces it, and
    # the English must not leak into the Kannada reply.
    check("[H] the workflow instruction is rendered in Kannada (M6)",
          DEPOSIT_STEP_1 not in result.reply and "ಚೀಟಿ" in result.reply, result.reply[:70])
    check("[I] history holds the canonical English reply",
          assistant_history(conversation)[-1] == f"Continuing. {DEPOSIT_STEP_1}",
          assistant_history(conversation)[-1])

    # --- English sessions are untouched -------------------------------
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = fresh_conversation("en")
    result = runtime.run_turn(conversation, "cancel", ResponseLocalizer("en"))
    check("[H] an English session is unchanged by rendering",
          result.reply == english and result.canonical_reply == english,
          result.reply)

    # --- No localizer at all: the pre-phase behaviour ------------------
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = fresh_conversation("kn")
    result = runtime.run_turn(conversation, "cancel")
    check("[H] with no localizer the reply stays English",
          result.reply == english, result.reply)

    # --- J: replay goes through canonical history, not the rendering ---
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = active_workflow("deposit money", language="kn")
    localizer = ResponseLocalizer("kn")

    runtime.run_turn(conversation, "ನಿಲ್ಲಿಸು", localizer)       # cancel
    cancelled_english = assistant_history(conversation)[-1]
    replay = runtime.run_turn(conversation, "ಮತ್ತೆ ಹೇಳಿ", localizer)

    check("[J] the replayed canonical reply is the stored English one",
          replay.canonical_reply == cancelled_english,
          f"{replay.canonical_reply!r} vs {cancelled_english!r}")
    check("[J] nothing in history is a rendered string",
          all(message == localize(message, "en")[0]
              for message in assistant_history(conversation)),
          str(assistant_history(conversation)))
    check("[J] replay re-renders rather than replaying stored English",
          replay.reply == localize(cancelled_english, "kn")[0],
          replay.reply[:60])

    # --- the localizer's remembered reply tracks history ---------------
    check("[J] the localizer remembers the canonical reply, not the rendering",
          localizer.last_canonical in assistant_history(conversation),
          str(localizer.last_canonical))

    # A reply that is NOT written to history is NOT remembered either, so
    # the two can never disagree about what was last said.
    exiting = runtime.run_turn(conversation, "ಹೊರಗೆ", localizer)
    check("[J] an exit reply is not remembered as the last canonical reply",
          localizer.last_canonical != exiting.canonical_reply,
          str(localizer.last_canonical))


# =========================================================
# M  KNOWLEDGE QUESTIONS MUST NOT BECOME CONFLICTS
# =========================================================

def test_knowledge_questions(detector):
    section("M -- a knowledge question does not interrupt the workflow")

    for text, language in (
        ("What is an education loan?", "en"),
        ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು", "kn"),
    ):
        fake = FakeUnderstanding()
        fake.set("question", "explain")
        runtime = make_runtime(detector, fake)
        conversation = active_workflow("withdraw money", step=2, language=language)

        result = runtime.run_turn(conversation, text, ResponseLocalizer(language))

        check(f"[M/{language}] the question is answered from the knowledge path",
              result.canonical_reply == "ANSWERED-FROM-KNOWLEDGE-BASE",
              str(result.canonical_reply)[:60])
        check(f"[M/{language}] no conflict is raised",
              conversation.workflow_conflict is None)
        check(f"[M/{language}] the withdrawal is preserved",
              conversation.current_workflow == "withdraw money"
              and conversation.workflow_state == WorkflowState.ACTIVE
              and conversation.current_step == 2,
              f"{conversation.workflow_state} / {conversation.current_step}")

    # Even when understanding MISLABELS the question as a workflow action --
    # the classification that caused the original live defect -- the
    # existing question pre-filter keeps it off the conflict path.
    fake = FakeUnderstanding()                       # workflow_action / none
    runtime = make_runtime(detector, fake)
    conversation = active_workflow("withdraw money", step=2)
    result = runtime.run_turn(conversation, "What is an education loan?")

    check("[M] a mislabelled question still raises no conflict",
          conversation.workflow_conflict is None)
    check("[M] a mislabelled question switches nothing",
          conversation.current_workflow == "withdraw money"
          and conversation.workflow_state == WorkflowState.ACTIVE)


# =========================================================
# N  FAILURE PATHS STAY SAFE
# =========================================================

def test_failure_paths(detector):
    section("N -- understanding failure and hard errors stay safe")

    # The model answered with nothing usable (400 / timeout / bad JSON).
    fake = FakeUnderstanding()
    fake.fail()
    runtime = make_runtime(detector, fake)
    conversation = active_workflow("deposit money", step=2)

    result = runtime.run_turn(conversation, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು",
                              ResponseLocalizer("kn"))

    check("[N] a failed understanding says so",
          result.canonical_reply.startswith("Sorry, I didn't catch that."),
          str(result.canonical_reply)[:60])
    check("[N] a failed understanding raises no conflict",
          conversation.workflow_conflict is None)
    check("[N] a failed understanding moves nothing",
          conversation.current_step == 2
          and conversation.workflow_state == WorkflowState.ACTIVE,
          str(conversation.workflow_state))
    check("[N] the failure reply is still recorded canonically",
          assistant_history(conversation)[-1] == result.canonical_reply)

    # The understanding client raised outright.
    runtime = make_runtime(detector, ExplodingUnderstanding())
    conversation = active_workflow("deposit money", step=2)
    before = (conversation.current_workflow, conversation.current_step,
              conversation.workflow_state)

    result = runtime.run_turn(conversation, "something that explodes",
                              ResponseLocalizer("kn"))

    check("[N] a raised error becomes a safe apology",
          result.canonical_reply.startswith("Sorry, I hit a temporary problem"),
          str(result.canonical_reply)[:60])
    check("[N] the workflow survives a raised error",
          (conversation.current_workflow, conversation.current_step,
           conversation.workflow_state) == before,
          str(conversation.workflow_state))
    check("[N] the session is returned to READY",
          conversation.session_state == SessionState.READY,
          str(conversation.session_state))
    check("[N] the apology is NOT written to history",
          result.canonical_reply not in assistant_history(conversation),
          str(assistant_history(conversation)))

    # Empty input.
    runtime = make_runtime(detector, FakeUnderstanding())
    conversation = active_workflow("deposit money", step=2)
    for blank in ("", "   ", None):
        result = runtime.run_turn(conversation, blank, ResponseLocalizer("kn"))
        check(f"[N] {blank!r} asks the customer to repeat themselves",
              result.canonical_reply == "I did not catch that. Could you say it again?",
              str(result.canonical_reply)[:50])
        check(f"[N] {blank!r} records nothing",
              conversation.history == [], str(conversation.history))
        check(f"[N] {blank!r} moves nothing",
              conversation.current_step == 2
              and conversation.workflow_state == WorkflowState.ACTIVE)


# =========================================================
# L  SESSION AND REGISTRY STATE
# =========================================================

def test_session_state(detector):
    section("L -- session, registry and per-session localizer state")

    registry = SessionRegistry()

    kn_entry = registry.get_or_create("visit-kn", "kn")
    en_entry = registry.get_or_create("visit-en", "en")

    check("[L] each visit gets its own conversation",
          kn_entry.conversation is not en_entry.conversation)
    check("[L] each visit gets its own localizer",
          kn_entry.localizer is not en_entry.localizer)
    check("[L] the localizer takes the visit's language",
          kn_entry.localizer.language == "kn"
          and en_entry.localizer.language == "en",
          f"{kn_entry.localizer.language} / {en_entry.localizer.language}")
    check("[L] a returning visit keeps its localizer",
          registry.get_or_create("visit-kn").localizer is kn_entry.localizer)

    # An entry built directly can never have a mismatched localizer.
    direct = SessionEntry(conversation=fresh_conversation("hi"), language="hi")
    check("[L] a directly built entry gets a matching localizer",
          direct.localizer is not None and direct.localizer.language == "hi",
          str(direct.localizer and direct.localizer.language))

    # An explicitly supplied localizer is respected.
    supplied = ResponseLocalizer("kn")
    explicit = SessionEntry(
        conversation=fresh_conversation("kn"), language="kn", localizer=supplied
    )
    check("[L] an explicitly supplied localizer is kept",
          explicit.localizer is supplied)

    # Two visits in different languages do not contaminate each other.
    runtime = make_runtime(detector, FakeUnderstanding())
    kn_result = runtime.run_turn(kn_entry.conversation, "cancel", kn_entry.localizer)
    en_result = runtime.run_turn(en_entry.conversation, "cancel", en_entry.localizer)

    english = "There's nothing active to cancel right now."
    check("[L] the Kannada visit is answered in Kannada",
          kn_result.reply == localize(english, "kn")[0], kn_result.reply)
    check("[L] the English visit is answered in English",
          en_result.reply == english, en_result.reply)
    check("[L] neither visit's history was contaminated",
          assistant_history(kn_entry.conversation) == [english]
          and assistant_history(en_entry.conversation) == [english])

    # Workflow state is per visit too.
    a = registry.get_or_create("visit-a", "en")
    b = registry.get_or_create("visit-b", "en")
    a.conversation.set_intent("deposit money")
    a.conversation.load_workflow("deposit money")
    check("[L] one visit's workflow does not reach another",
          b.conversation.current_workflow is None
          and b.conversation.workflow_state == WorkflowState.NONE,
          str(b.conversation.workflow_state))

    check("[L] removing a visit frees it", registry.remove("visit-a") is True)
    check("[L] removing it twice reports nothing removed",
          registry.remove("visit-a") is False)


# =========================================================
# PARITY: THE SERVICE SEQUENCE MATCHES THE CLI SEQUENCE
#
# The guard against a FOURTH drift. Each step the CLI loop performs around
# _respond is asserted to be performed here too.
# =========================================================

def test_sequence_parity(detector):
    section("Parity -- the service performs the CLI's sequence around _respond")

    import inspect
    import app.pipeline.voice_pipeline as pipeline_module

    cli = inspect.getsource(pipeline_module.VoiceAssistantPipeline.run)
    service = inspect.getsource(EngineRuntime.run_turn)

    for step, needle in (
        # M5: both paths call normalize_turn(), which applies
        # normalize_banking_terms() and the loanword canonicalisation in
        # one place. The needle follows the call; the check is unchanged:
        # the CLI and the service normalise identically.
        ("normalizes the turn", "normalize_turn"),
        ("detects control before routing", "detect_control"),
        ("records the user turn", 'add_history("User"'),
        ("records the assistant turn", 'add_history("Assistant"'),
        ("renders at the output boundary", "render"),
    ):
        check(f"the CLI {step}", needle in cli, "missing from run()")
        check(f"the service {step}",
              needle in service or needle == "render" and "_render" in service,
              "missing from run_turn()")

    # The routing itself is SHARED, not copied -- this is what keeps the
    # two paths from diverging in the part that matters most.
    check("the service calls the engine's own _respond",
          "VoiceAssistantPipeline._respond" in service)

    # And the service must not have grown its own conflict logic.
    #
    # Checked against the module's SYNTAX TREE, not its text: the source
    # discusses conflict handling in comments on purpose, and a substring
    # search cannot tell an explanation from an implementation.
    import ast

    tree = ast.parse(inspect.getsource(engine_module))
    identifiers = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            identifiers.add(node.id)
        elif isinstance(node, ast.Attribute):
            identifiers.add(node.attr)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            identifiers.add(node.name)
        elif isinstance(node, ast.alias):
            identifiers.add(node.asname or node.name.split(".")[-1])

    for forbidden in ("_detect_workflow_conflict", "_resolve_workflow_conflict",
                      "WorkflowConflict", "conflict_question",
                      "resolve_conflict_answer", "workflow_conflict"):
        check(f"the service does not implement or call {forbidden}",
              forbidden not in identifiers,
              "present in service/engine.py code")

    # TurnResult keeps both views, so the boundary stays inspectable.
    result = TurnResult(reply="x", canonical_reply="y")
    check("TurnResult carries the rendered and the canonical reply",
          result.reply == "x" and result.canonical_reply == "y")


# =========================================================
# MAIN
# =========================================================

def main():
    print("PHASE 3.2B-16A -- WEB SERVICE / CLI PARITY")

    test_construction_wiring()
    test_sequence_parity(None)

    # The real detector: everything below exercises genuine conflict
    # detection, not a stub's opinion of it.
    detector = IntentDetector()

    test_normalization(detector)
    test_conflict_parity(detector)
    test_conflict_resolution_preserved(detector)
    test_controls(detector)
    test_localization_and_history(detector)
    test_knowledge_questions(detector)
    test_failure_paths(detector)
    test_session_state(detector)

    print()
    print(f"  {checks[0]} checks, {len(failures)} failed")

    if failures:
        print()
        for failure in failures:
            print("  -", failure)
        print()
        print("  Phase 3.2B-16A has failures.")
        return 1

    print()
    print("  All Phase 3.2B-16A parity checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
