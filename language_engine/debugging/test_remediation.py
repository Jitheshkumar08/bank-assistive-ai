"""
Regression tests for the remediation phase.

Runs entirely offline: no microphone, no audio device, no Groq
calls and no model downloads. Heavy collaborators are injected,
so this exercises the control/dialogue/workflow logic itself.

Run from the repository root:

    python -m debugging.test_remediation
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState, WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue.manager import (
    DialogueManager,
    classify_command,
    looks_like_a_question,
)
from app.dialogue.llm.dialogue_understanding import (
    DialogueUnderstanding,
    EMPTY_ENTITIES,
    QUESTION_UNAVAILABLE_MESSAGE,
    fallback_understanding,
)
from app.speech.tts import TextToSpeech, sanitize_for_speech


# =========================================================
# TINY TEST HARNESS
# =========================================================

PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label}   {detail}")


def section(title):
    print()
    print("=" * 62)
    print(title)
    print("=" * 62)


# =========================================================
# FAKES
# =========================================================

def entities(**overrides):
    result = dict(EMPTY_ENTITIES)
    result.update(overrides)
    return result


class FakeUnderstanding:
    """Stands in for DialogueUnderstanding (no Groq, no models)."""

    def __init__(self):
        self.next_result = {
            "type": "unknown",
            "action": "none",
            "entities": entities(),
        }
        self.answer = "KNOWLEDGE ANSWER"
        self.answer_calls = 0
        self.understand_calls = 0

    def set(self, message_type, action, **ents):
        self.next_result = {
            "type": message_type,
            "action": action,
            "entities": entities(**ents),
        }

    def understand(self, user_text, current_workflow=None,
                   current_step=None, current_instruction=None):
        self.understand_calls += 1
        return self.next_result

    def answer_question(self, question, workflow_context,
                        current_instruction):
        self.answer_calls += 1
        return self.answer


def make_dialogue(fake):
    """DialogueManager with a real loader and an injected LLM."""
    manager = object.__new__(DialogueManager)
    manager.workflow_loader = WorkflowLoader()
    manager.dialogue_understanding = fake
    return manager


def fresh_conversation():
    conversation = ConversationManager()
    conversation.start_conversation()
    return conversation


# =========================================================
# FIX 2 -- WORKFLOW LOADER SAFETY
# =========================================================

def test_workflow_loader():
    section("FIX 2  Workflow loader safety")

    loader = WorkflowLoader()

    for name in ("withdraw money", "deposit money", "apply for loan"):
        check(
            f"has_workflow({name!r}) is True",
            loader.has_workflow(name) is True,
        )
        definition = loader.load_workflow(name)
        check(
            f"load_workflow({name!r}) returns steps",
            isinstance(definition, dict) and bool(definition.get("steps")),
        )

    # [O] and [P] -- the two intents with no definition on disk
    for name in ("check account balance", "open new account"):
        check(
            f"has_workflow({name!r}) is False",
            loader.has_workflow(name) is False,
        )
        check(
            f"load_workflow({name!r}) returns None",
            loader.load_workflow(name) is None,
        )

    check(
        "resolve_filename strips ' money' as a SUFFIX only",
        loader.resolve_filename("withdraw money") == "withdraw.json"
        and loader.resolve_filename("send money abroad")
        == "send_money_abroad.json",
        loader.resolve_filename("send money abroad"),
    )

    check(
        "resolve_filename('apply for loan') -> apply_for_loan.json",
        loader.resolve_filename("apply for loan") == "apply_for_loan.json",
    )

    check(
        "load_workflow(None) returns None instead of raising",
        loader.load_workflow(None) is None,
    )


# =========================================================
# FIX 1 -- MISSING WORKFLOW SAFETY
# =========================================================

def test_missing_workflow_safety():
    section("FIX 1  Missing workflow never activates / never wedges")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)

    # ---- [O] check account balance ----
    conversation = fresh_conversation()
    started, response = dialogue.start_workflow(
        conversation, "check account balance"
    )

    check("[O] start_workflow reports failure", started is False)
    check(
        "[O] workflow_state stays NONE (not ACTIVE)",
        conversation.workflow_state is WorkflowState.NONE,
        conversation.workflow_state,
    )
    check(
        "[O] current_workflow left unset",
        conversation.current_workflow is None,
    )
    check("[O] user gets a clear response", bool(response.strip()))

    # The session must NOT be wedged: a valid service still starts.
    started_after, _ = dialogue.start_workflow(conversation, "deposit money")
    check("[O] a valid workflow still starts afterwards", started_after is True)

    # ---- [P] open new account ----
    conversation = fresh_conversation()
    started, _ = dialogue.start_workflow(conversation, "open new account")
    check("[P] start_workflow reports failure", started is False)
    check(
        "[P] workflow_state stays NONE",
        conversation.workflow_state is WorkflowState.NONE,
    )

    # ---- an ACTIVE workflow must be PRESERVED, not destroyed ----
    conversation = fresh_conversation()
    dialogue.start_workflow(conversation, "withdraw money")
    fake.set("workflow_action", "complete")
    dialogue.generate_response(conversation, "done")
    step_before = conversation.current_step

    started, response = dialogue.start_workflow(
        conversation, "check account balance"
    )

    check("active workflow: refusal reported", started is False)
    check(
        "active workflow PRESERVED as ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "active workflow identity preserved",
        conversation.current_workflow == "withdraw money",
        conversation.current_workflow,
    )
    check(
        "active workflow step preserved",
        conversation.current_step == step_before,
        conversation.current_step,
    )


# =========================================================
# FIX 9 -- ONE WORKFLOW IDENTITY
# =========================================================

def test_workflow_identity():
    section("FIX 9  Single workflow identity")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "withdraw money")

    check(
        "current_workflow is the identity used for loading",
        conversation.current_workflow == "withdraw money",
    )
    check(
        "current_intent agrees with current_workflow",
        conversation.current_intent == conversation.current_workflow,
    )

    instruction = dialogue._resolve_current_instruction(conversation)
    check(
        "_resolve_current_instruction resolves via current_workflow",
        instruction == "Please take a withdrawal slip.",
        instruction,
    )

    conversation.release_workflow()
    check(
        "release_workflow returns to NONE",
        conversation.workflow_state is WorkflowState.NONE
        and conversation.current_workflow is None
        and conversation.current_step == 0,
    )


# =========================================================
# FIX 7 -- CONTROL + KNOWLEDGE ROUTING (NO REGRESSION)
# =========================================================

def test_control_routing():
    section("FIX 7  Control routing preserved")

    cases = [
        ("Exit.", "session_exit", "H"),
        ("exit", "session_exit", "H"),
        ("EXIT!", "session_exit", "H"),
        ("Goodbye.", "session_exit", "H"),
        ("quit", "session_exit", "H"),
        ("stop", "cancel", "G"),
        ("cancel", "cancel", "F"),
        ("pause", "pause", "C"),
        ("hold on", "pause", "C"),
        ("resume", "resume", "D"),
        ("continue", "resume", "D"),
        ("repeat", "repeat", "E"),
        ("say that again", "repeat", "E"),
        ("next", "next", None),
        ("what's next", "next", None),
    ]

    for text, expected, tag in cases:
        label = f"[{tag}] " if tag else ""
        result = classify_command(text)
        check(
            f"{label}{text!r} -> {expected}",
            result == expected,
            f"got {result}",
        )

    # Must NOT be swallowed by control matching
    for text in ("don't exit", "cancel my loan application tomorrow",
                 "I want to deposit money"):
        check(
            f"{text!r} is NOT a control command",
            classify_command(text) is None,
            classify_command(text),
        )


def test_knowledge_routing():
    section("FIX 7  Knowledge question routing preserved")

    # [L] [M] [N]
    questions = [
        ("What is ChatGPT?", "L"),
        ("What is a cheque book?", "M"),
        ("What all do you know about banking system?", "N"),
        ("Why is this required?", None),
        ("How do I open an account?", None),
    ]

    for text, tag in questions:
        label = f"[{tag}] " if tag else ""
        check(
            f"{label}{text!r} looks like a question",
            looks_like_a_question(text) is True,
        )

    # Declarative banking requests must still reach intent detection,
    # in every language -- this is what protects Kannada/Hindi.
    declaratives = [
        "I want to deposit money",
        "ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "मुझे पैसे जमा करने हैं",
    ]

    for text in declaratives:
        check(
            f"declarative stays on intent path: {text!r}",
            looks_like_a_question(text) is False,
        )

    # A question routes to the knowledge answer, not a workflow.
    fake = FakeUnderstanding()
    fake.set("question", "none")
    dialogue = make_dialogue(fake)

    answer = dialogue.answer_general_question("What is ChatGPT?")
    check(
        "[L] general question answered via RAG path",
        answer == "KNOWLEDGE ANSWER",
        answer,
    )

    # A declarative returns None so the caller runs intent detection.
    check(
        "declarative returns None (intent detection proceeds)",
        dialogue.answer_general_question("I want to deposit money") is None,
    )


# =========================================================
# WORKFLOW PROGRESSION  [A] [B] [I] [J] [K]
# =========================================================

def test_workflow_progression():
    section("Workflow progression  [A] [B] [I] [J] [K]")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)

    # ---- [A] withdrawal, 5 steps ----
    conversation = fresh_conversation()
    _, first = dialogue.start_workflow(conversation, "withdraw money")
    check("[A] withdrawal starts at step 1",
          first == "Please take a withdrawal slip.", first)

    fake.set("workflow_action", "complete")
    second = dialogue.generate_response(conversation, "done")
    check("[A] completing step 1 advances to step 2",
          second == "Fill in your account number.", second)

    for _ in range(3):
        dialogue.generate_response(conversation, "done")

    final = dialogue.generate_response(conversation, "done")
    check("[A] withdrawal completes", final == "Workflow Completed.", final)
    check("[A] state is COMPLETED",
          conversation.workflow_state is WorkflowState.COMPLETED)

    # ---- [I] completed workflow -> a new workflow starts cleanly ----
    started, deposit_first = dialogue.start_workflow(
        conversation, "deposit money"
    )
    check("[I] new workflow starts after completion", started is True)
    check("[I] new workflow begins at its own step 1",
          deposit_first == "Please take a deposit slip.", deposit_first)
    check("[I] state back to ACTIVE",
          conversation.workflow_state is WorkflowState.ACTIVE)

    # ---- [B] deposit, 4 steps ----
    fake.set("workflow_action", "complete")
    conversation = fresh_conversation()
    dialogue.start_workflow(conversation, "deposit money")
    for _ in range(3):
        dialogue.generate_response(conversation, "done")
    done = dialogue.generate_response(conversation, "done")
    check("[B] deposit completes", done == "Workflow Completed.", done)

    # ---- [J] side question while ACTIVE ----
    conversation = fresh_conversation()
    dialogue.start_workflow(conversation, "withdraw money")
    fake.set("workflow_action", "complete")
    dialogue.generate_response(conversation, "done")
    step_before = conversation.current_step

    fake.set("question", "none")
    answer = dialogue.generate_response(conversation, "where do I submit it?")

    check("[J] question answered while active",
          answer == "KNOWLEDGE ANSWER", answer)
    check("[J] step NOT advanced by a question",
          conversation.current_step == step_before)
    check("[J] workflow still ACTIVE",
          conversation.workflow_state is WorkflowState.ACTIVE)

    # ---- [K] side question while SUSPENDED ----
    conversation.suspend_workflow()
    step_before = conversation.current_step
    answer = dialogue.generate_response(conversation, "why is this needed?")

    check("[K] question answered while suspended",
          answer == "KNOWLEDGE ANSWER", answer)
    check("[K] still SUSPENDED (question does not resume)",
          conversation.workflow_state is WorkflowState.SUSPENDED)
    check("[K] step unchanged while suspended",
          conversation.current_step == step_before)


# =========================================================
# FIX 8 -- REPEAT VS QUESTION PRIORITY  [E] [U]
# =========================================================

def test_repeat_vs_question():
    section("FIX 8  repeat vs question priority  [E] [U]")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()
    dialogue.start_workflow(conversation, "withdraw money")

    current = "Please take a withdrawal slip."

    # [E] plain repeat still repeats the instruction
    fake.set("workflow_action", "repeat")
    result = dialogue.generate_response(conversation, "say that again")
    check("[E] plain repeat returns the current instruction",
          result == current, result)

    # repeat a specific step
    fake.set("workflow_action", "repeat", step_number=3)
    result = dialogue.generate_response(conversation, "repeat step 3")
    check("repeat step 3 returns step 3",
          result == "Enter the withdrawal amount.", result)

    # out-of-range step
    fake.set("workflow_action", "repeat", step_number=99)
    result = dialogue.generate_response(conversation, "repeat step 99")
    check("out-of-range step reports unavailable",
          "not available" in result, result)

    # [U] repeat + question -> question wins
    fake.set("question", "repeat")
    result = dialogue.generate_response(
        conversation, "can you repeat what you said about the loan rate?"
    )
    check("[U] repeat+question routes to knowledge answer",
          result == "KNOWLEDGE ANSWER", result)
    check("[U] step untouched by repeat+question",
          conversation.current_step == 1)

    # help + repeat -> also treated as a question
    fake.set("help", "repeat")
    result = dialogue.generate_response(conversation, "repeat, I don't get it")
    check("help+repeat routes to knowledge answer",
          result == "KNOWLEDGE ANSWER", result)


# =========================================================
# CONTROL COMMAND HANDLING  [C] [D] [F] [G]
# =========================================================

def test_control_handling():
    section("Control command handling  [C] [D] [F] [G]")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()
    dialogue.start_workflow(conversation, "withdraw money")

    # [C] pause
    dialogue.handle_control_command(conversation, "pause")
    check("[C] pause suspends the workflow",
          conversation.workflow_state is WorkflowState.SUSPENDED)

    # [D] resume
    response = dialogue.handle_control_command(conversation, "resume")
    check("[D] resume reactivates the workflow",
          conversation.workflow_state is WorkflowState.ACTIVE)
    check("[D] resume restates the instruction",
          "withdrawal slip" in response, response)

    # [E] repeat via control path
    response = dialogue.handle_control_command(conversation, "repeat")
    check("[E] control repeat returns the instruction",
          response == "Please take a withdrawal slip.", response)

    # [F] / [G] cancel
    dialogue.handle_control_command(conversation, "cancel")
    check("[F][G] cancel moves to CANCELLED",
          conversation.workflow_state is WorkflowState.CANCELLED)

    # control with nothing active must not crash
    empty = fresh_conversation()
    for command in ("pause", "resume", "cancel", "repeat", "next"):
        response = dialogue.handle_control_command(empty, command)
        check(f"control {command!r} with no workflow is safe",
              isinstance(response, str) and bool(response))


# =========================================================
# FIX 3 -- LLM FAILURE HANDLING  [Q] [R]
# =========================================================

class FakeMessage:
    def __init__(self, content):
        self.content = content


class FakeChoice:
    def __init__(self, content):
        self.message = FakeMessage(content)


class FakeResponse:
    def __init__(self, content):
        self.choices = [FakeChoice(content)]


class RaisingClient:
    class chat:
        class completions:
            @staticmethod
            def create(**kwargs):
                raise RuntimeError("simulated Groq/network failure")


class ReturningClient:
    def __init__(self, content):
        payload = FakeResponse(content)

        class completions:
            @staticmethod
            def create(**kwargs):
                return payload

        class chat:
            pass

        chat.completions = completions
        self.chat = chat


class RaisingRetriever:
    def search(self, query, top_k=2):
        raise RuntimeError("simulated retrieval failure")


class EmptyRetriever:
    def search(self, query, top_k=2):
        return []


def bare_understanding():
    return object.__new__(DialogueUnderstanding)


def test_llm_failure_handling():
    section("FIX 3  LLM failure handling  [Q] [R]")

    understanding = bare_understanding()

    expected_keys = set(EMPTY_ENTITIES)

    # [Q] unusable content of every shape
    bad_contents = [
        (None, "content=None"),
        ("", "empty string"),
        ("   ", "whitespace only"),
        ("this is not json", "invalid JSON"),
        ("[1, 2, 3]", "JSON array, not an object"),
    ]

    for content, description in bad_contents:
        result = understanding._parse_understanding(FakeResponse(content))
        check(
            f"[Q] {description} -> safe fallback",
            result["type"] == "unknown" and result["action"] == "none",
            result,
        )
        check(
            f"[Q] {description} -> full entity set",
            set(result["entities"]) == expected_keys,
            set(result["entities"]),
        )

    # malformed response object entirely
    class Broken:
        pass

    result = understanding._parse_understanding(Broken())
    check("[Q] malformed response object -> fallback",
          result == fallback_understanding(), result)

    # partial but valid JSON gets the entity set completed
    result = understanding._parse_understanding(
        FakeResponse('{"type": "question", "action": "none"}')
    )
    check("[Q] missing entities are filled in",
          set(result["entities"]) == expected_keys, result)
    check("[Q] step_number present on partial reply",
          result["entities"]["step_number"] is None)

    # string "null" normalization
    result = understanding._parse_understanding(FakeResponse(
        '{"type": "information", "action": "none",'
        ' "entities": {"amount": "null", "account_number": "12345"}}'
    ))
    check("[Q] string 'null' normalized to None",
          result["entities"]["amount"] is None)
    check("[Q] real entity value preserved",
          result["entities"]["account_number"] == "12345")

    # [R] transport failure inside understand()
    understanding.client = RaisingClient()
    understanding.knowledge_retriever = EmptyRetriever()

    result = understanding.understand(
        user_text="I have taken the slip",
        current_workflow="withdraw money",
        current_step=1,
        current_instruction="Please take a withdrawal slip.",
    )
    check("[R] Groq failure in understand() -> fallback, no raise",
          result == fallback_understanding(), result)

    # [R] transport failure inside answer_question()
    answer = understanding.answer_question(
        question="What documents are needed?",
        workflow_context="withdraw money",
        current_instruction="Please take a withdrawal slip.",
    )
    check("[R] Groq failure in answer_question() -> safe message",
          answer == QUESTION_UNAVAILABLE_MESSAGE, answer)

    # empty content from answer_question
    understanding.client = ReturningClient(None)
    answer = understanding.answer_question(
        question="What documents are needed?",
        workflow_context="withdraw money",
        current_instruction="",
    )
    check("[R] empty answer content -> safe message",
          answer == QUESTION_UNAVAILABLE_MESSAGE, answer)

    # retrieval failure must not propagate
    understanding.client = ReturningClient("Bring your ID card.")
    understanding.knowledge_retriever = RaisingRetriever()
    answer = understanding.answer_question(
        question="What documents are needed?",
        workflow_context="withdraw money",
        current_instruction="",
    )
    check("[R] retrieval failure degrades instead of raising",
          answer == "Bring your ID card.", answer)


def test_llm_failure_preserves_workflow():
    section("FIX 3  A failed turn preserves workflow state")

    class FailingUnderstanding(FakeUnderstanding):
        def understand(self, *args, **kwargs):
            return fallback_understanding()

    fake = FailingUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()
    dialogue.start_workflow(conversation, "withdraw money")

    fake_complete = FakeUnderstanding()
    fake_complete.set("workflow_action", "complete")
    dialogue.dialogue_understanding = fake_complete
    dialogue.generate_response(conversation, "done")

    step_before = conversation.current_step
    state_before = conversation.workflow_state

    dialogue.dialogue_understanding = fake
    response = dialogue.generate_response(conversation, "anything")

    check("failed understanding still returns a response",
          isinstance(response, str) and bool(response))
    check("failed understanding does NOT advance the step",
          conversation.current_step == step_before)
    check("failed understanding does NOT change workflow state",
          conversation.workflow_state is state_before)


# =========================================================
# FIX 4 -- PIPELINE EXCEPTION BOUNDARY
# =========================================================

def test_pipeline_exception_boundary():
    section("FIX 4  Pipeline survives a failing turn")

    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    class ExplodingDialogue:
        def detect_control(self, text):
            if text.strip().lower() == "exit":
                return "session_exit"
            return None

        def answer_general_question(self, text):
            raise RuntimeError("simulated dialogue failure")

        def generate_response(self, conversation, user_input=None):
            raise RuntimeError("simulated dialogue failure")

        def handle_control_command(self, conversation, command):
            return "control ok"

        def start_workflow(self, conversation, intent):
            raise RuntimeError("simulated dialogue failure")

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.conversation = ConversationManager()
    pipeline.dialogue = ExplodingDialogue()
    pipeline.intent_detector = None
    pipeline.tts = None

    script = iter(["I want to withdraw money", "still here?", "exit"])

    pipeline.select_language = lambda: ("English", "en")
    pipeline.select_input_mode = lambda: "2"
    pipeline.listen = lambda mode, language_code: next(script)
    pipeline.speak = lambda mode, response, language_code: None

    try:
        context = pipeline.run()
        survived = True
    except Exception as error:  # noqa: BLE001 - this is the assertion
        context = None
        survived = False
        print(f"        raised: {type(error).__name__}: {error}")

    check("session survives repeated dialogue failures", survived)
    check("session exits cleanly afterwards",
          context is not None
          and context["session_state"] == SessionState.EXITED.value,
          context["session_state"] if context else None)

    if context:
        speakers = [entry["speaker"] for entry in context["history"]]
        check("failed turns still recorded in history",
              speakers.count("Assistant") >= 2, speakers)


# =========================================================
# FIX 5 / FIX 6 -- TTS  [S] [T]
# =========================================================

def test_tts_initialization():
    section("FIX 5  TTS initialization  [S]")

    import pygame

    original_init = pygame.mixer.init
    calls = {"count": 0}

    def failing_init(*args, **kwargs):
        calls["count"] += 1
        raise pygame.error("simulated: no audio device available")

    pygame.mixer.init = failing_init

    try:
        tts = TextToSpeech()
        check("[S] TextToSpeech constructs with no audio device", True)
        check("[S] constructor does NOT touch the mixer",
              calls["count"] == 0, calls["count"])

        tts.speak("Please take a withdrawal slip.", "en")
        check("[S] speak() degrades instead of raising", True)
        check("[S] mixer failure attempted once", calls["count"] == 1,
              calls["count"])

        tts.speak("Another instruction.", "en")
        check("[S] mixer failure remembered (not retried every turn)",
              calls["count"] == 1, calls["count"])

    except Exception as error:
        check("[S] TTS handles a missing audio device", False,
              f"{type(error).__name__}: {error}")
    finally:
        pygame.mixer.init = original_init


def test_tts_sanitization():
    section("FIX 6  Markdown sanitization for TTS  [T]")

    cases = [
        ("**Deposit**", "Deposit"),
        ("**Account opening**", "Account opening"),
        ("Please *take* the slip.", "Please take the slip."),
        ("## Documents", "Documents"),
        ("# Loan", "Loan"),
        ("- Bring your ID", "Bring your ID"),
        ("* Account opening", "Account opening"),
        ("Use `account_number` here", "Use account_number here"),
        ("__bold__ text", "bold text"),
        ("See [the form](http://example.com)", "See the form"),
        ("**Deposit** and **Withdraw**", "Deposit and Withdraw"),
        ("", ""),
        (None, ""),
    ]

    for raw, expected in cases:
        result = sanitize_for_speech(raw)
        check(f"[T] {raw!r} -> {expected!r}", result == expected, result)

    # Content that must survive untouched
    preserved = [
        "Please deposit Rs 2,000 today.",
        "Your balance is 1,25,000 rupees.",
        "1. Take a slip",
        "snake_case_name stays",
        "-5000 is negative",
        "Enter the withdrawal amount.",
    ]

    for text in preserved:
        result = sanitize_for_speech(text)
        check(f"[T] preserved: {text!r}", result == text, result)


# =========================================================
# CONVERSATION STATE
# =========================================================

def test_conversation_state():
    section("ConversationManager state transitions")

    conversation = fresh_conversation()
    check("new conversation is NONE",
          conversation.workflow_state is WorkflowState.NONE)

    conversation.load_workflow("withdraw money")
    check("load_workflow activates",
          conversation.workflow_state is WorkflowState.ACTIVE)
    check("load_workflow starts at step 1", conversation.current_step == 1)

    conversation.suspend_workflow()
    check("suspend works",
          conversation.workflow_state is WorkflowState.SUSPENDED)

    conversation.resume_workflow()
    check("resume works",
          conversation.workflow_state is WorkflowState.ACTIVE)

    conversation.cancel_workflow()
    check("cancel works",
          conversation.workflow_state is WorkflowState.CANCELLED)
    check("cancelled property agrees", conversation.cancelled is True)

    conversation.complete_workflow()
    check("complete works",
          conversation.workflow_state is WorkflowState.COMPLETED)
    check("completed property agrees", conversation.completed is True)

    conversation.release_workflow()
    check("release clears everything",
          conversation.workflow_state is WorkflowState.NONE
          and conversation.current_intent is None
          and conversation.current_workflow is None
          and conversation.entities == {})


# =========================================================
# MAIN
# =========================================================

def main():
    test_workflow_loader()
    test_missing_workflow_safety()
    test_workflow_identity()
    test_control_routing()
    test_knowledge_routing()
    test_workflow_progression()
    test_repeat_vs_question()
    test_control_handling()
    test_llm_failure_handling()
    test_llm_failure_preserves_workflow()
    test_pipeline_exception_boundary()
    test_tts_initialization()
    test_tts_sanitization()
    test_conversation_state()

    section("SUMMARY")
    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED: {failure}")
        return 1

    print()
    print("  All remediation regression tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
