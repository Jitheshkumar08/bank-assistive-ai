"""
Regression tests for Phase 2.5 -- dialogue quality and knowledge
quality.

Runs entirely offline: no microphone, no audio device, no Groq
calls and no model downloads. Dialogue understanding is injected,
so this exercises the routing and workflow logic itself.

The fakes and the conversation helpers are reused from the Phase 2
remediation suite so both suites describe the same system.

Run from the repository root:

    python -m debugging.test_phase25
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState, WorkflowState
from app.knowledge.loader import KnowledgeLoader
from app.dialogue.manager import (
    classify_command,
    looks_like_a_question,
    restate_current_step,
)
from app.dialogue.term_normalizer import normalize_banking_terms

from debugging.test_remediation import (
    FakeUnderstanding,
    fresh_conversation,
    make_dialogue,
)


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


class RecordingUnderstanding(FakeUnderstanding):
    """FakeUnderstanding that keeps the question-answering args."""

    def __init__(self):
        super().__init__()
        self.last_workflow_context = None
        self.last_current_instruction = None

    def answer_question(self, question, workflow_context,
                        current_instruction):
        self.last_workflow_context = workflow_context
        self.last_current_instruction = current_instruction
        return super().answer_question(
            question, workflow_context, current_instruction
        )


def started_deposit_at_step_2():
    """
    Deposit workflow sitting on step 2, "Fill in your account
    number." -- the exact situation the real microphone test
    exposed.
    """

    fake = RecordingUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")

    fake.set("workflow_action", "complete")
    dialogue.generate_response(conversation, "I took the slip")

    return fake, dialogue, conversation


ACCOUNT_NUMBER_STEP = "Fill in your account number."


# =========================================================
# [A] [B]  CONTEXTUAL WORKFLOW ACKNOWLEDGEMENTS
#
# A statement of intent about the current step keeps the step,
# does not complete it, and is answered in context.
# =========================================================

def test_intent_to_act_acknowledgements():
    section("[A] [B]  Contextual workflow acknowledgements")

    for tag, utterance in (
        ("A", "I need to fill this"),
        ("B", "I'll fill it"),
        ("B", "let me fill this"),
        ("B", "okay, I'll do it"),
    ):

        fake, dialogue, conversation = started_deposit_at_step_2()

        check(
            f"[{tag}] precondition: on the account-number step",
            conversation.current_step == 2,
            conversation.current_step,
        )

        fake.set("acknowledgement", "none")
        response = dialogue.generate_response(conversation, utterance)

        check(
            f"[{tag}] {utterance!r} keeps the current step",
            conversation.current_step == 2,
            conversation.current_step,
        )
        check(
            f"[{tag}] {utterance!r} restates the current instruction",
            ACCOUNT_NUMBER_STEP in response,
            response,
        )
        check(
            f"[{tag}] {utterance!r} invites a completion signal",
            "completed it" in response,
            response,
        )
        check(
            f"[{tag}] {utterance!r} leaves the workflow ACTIVE",
            conversation.workflow_state is WorkflowState.ACTIVE,
            conversation.workflow_state,
        )

    # An acknowledgement must still not resume a suspended
    # workflow by itself -- Phase 2 behaviour.
    fake, dialogue, conversation = started_deposit_at_step_2()
    conversation.suspend_workflow()

    fake.set("acknowledgement", "none")
    dialogue.generate_response(conversation, "I'll fill it")

    check(
        "[A] acknowledgement does not resume a suspended workflow",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[A] acknowledgement does not advance while suspended",
        conversation.current_step == 2,
        conversation.current_step,
    )


# =========================================================
# [C]  COMPLETION STILL ADVANCES
# =========================================================

def test_completion_still_advances():
    section("[C]  Completion statements still advance the workflow")

    fake, dialogue, conversation = started_deposit_at_step_2()

    fake.set("workflow_action", "complete")
    response = dialogue.generate_response(conversation, "I filled it")

    check(
        "[C] 'I filled it' advances to step 3",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[C] 'I filled it' returns the next instruction",
        response == "Enter the amount to deposit.",
        response,
    )

    # [C] amount step completed WITHOUT stating an amount
    fake.set("workflow_action", "complete")
    response = dialogue.generate_response(
        conversation, "yes, I entered it"
    )

    check(
        "[C] amount step completes without a numeric amount",
        conversation.current_step == 4,
        conversation.current_step,
    )
    check(
        "[C] amount step returns the final instruction",
        response == "Submit the slip along with the cash.",
        response,
    )


# =========================================================
# [D] [E] [F] [G]  "NEXT" SEMANTICS
#
# Nothing here may skip a required banking instruction.
# =========================================================

def test_next_semantics():
    section('[D] [E] [F] [G]  "next" never skips a required step')

    # ---- [D] [E] asking what comes next (LLM path) ----
    for tag, utterance in (
        ("D", "What should I do next?"),
        ("E", "What is the next step?"),
    ):

        fake, dialogue, conversation = started_deposit_at_step_2()

        fake.set("workflow_action", "next_step")
        response = dialogue.generate_response(conversation, utterance)

        check(
            f"[{tag}] {utterance!r} does not advance the step",
            conversation.current_step == 2,
            conversation.current_step,
        )
        check(
            f"[{tag}] {utterance!r} gives the current instruction",
            ACCOUNT_NUMBER_STEP in response,
            response,
        )
        check(
            f"[{tag}] {utterance!r} invites a completion signal",
            "completed it" in response,
            response,
        )

    # ---- [F] bare "next" (deterministic control path) ----
    fake, dialogue, conversation = started_deposit_at_step_2()

    check(
        "[F] 'next' is a deterministic control command",
        classify_command("next") == "next",
        classify_command("next"),
    )

    response = dialogue.handle_control_command(conversation, "next")

    check(
        "[F] control 'next' does not advance the step",
        conversation.current_step == 2,
        conversation.current_step,
    )
    check(
        "[F] control 'next' restates the current instruction",
        ACCOUNT_NUMBER_STEP in response,
        response,
    )
    check(
        "[F] control 'next' matches the LLM next_step wording",
        response == restate_current_step(ACCOUNT_NUMBER_STEP),
        response,
    )

    # ---- [G] "Yes, next." ----
    check(
        "[G] 'Yes, next.' is NOT a deterministic control command",
        classify_command("Yes, next.") is None,
        classify_command("Yes, next."),
    )

    fake, dialogue, conversation = started_deposit_at_step_2()

    fake.set("workflow_action", "next_step")
    response = dialogue.generate_response(conversation, "Yes, next.")

    check(
        "[G] 'Yes, next.' does not skip the required step",
        conversation.current_step == 2,
        conversation.current_step,
    )
    check(
        "[G] 'Yes, next.' restates the current instruction",
        ACCOUNT_NUMBER_STEP in response,
        response,
    )

    # ---- asking what's next while SUSPENDED still resumes ----
    fake, dialogue, conversation = started_deposit_at_step_2()
    conversation.suspend_workflow()

    fake.set("workflow_action", "next_step")
    response = dialogue.generate_response(
        conversation, "what should I do next?"
    )

    check(
        "[D] next_step resumes a suspended workflow",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[D] resumed next_step does not skip the step",
        conversation.current_step == 2,
        conversation.current_step,
    )


# =========================================================
# [H]  QUESTION ABOUT THE CURRENT STEP
# =========================================================

def test_current_step_question():
    section("[H]  Question about the current workflow step")

    fake, dialogue, conversation = started_deposit_at_step_2()

    fake.set("question", "none")
    response = dialogue.generate_response(
        conversation, "Exactly where should I fill my account number?"
    )

    check(
        "[H] question routed to the knowledge path",
        response == "KNOWLEDGE ANSWER",
        response,
    )
    check(
        "[H] question does not advance the workflow",
        conversation.current_step == 2,
        conversation.current_step,
    )
    check(
        "[H] question leaves the workflow ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[H] current instruction passed to the answerer",
        fake.last_current_instruction == ACCOUNT_NUMBER_STEP,
        fake.last_current_instruction,
    )
    check(
        "[H] workflow context marks the current step",
        "Step 2 (current step): Fill in your account number."
        in (fake.last_workflow_context or ""),
        fake.last_workflow_context,
    )
    check(
        "[H] workflow context still lists the other steps",
        "Step 1: Please take a deposit slip."
        in (fake.last_workflow_context or ""),
        fake.last_workflow_context,
    )

    # A question while SUSPENDED must not resume or advance.
    conversation.suspend_workflow()
    dialogue.generate_response(conversation, "why is this needed?")

    check(
        "[H] question does not resume a suspended workflow",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )


# =========================================================
# [I]  CHEQUE BOOK / DOMAIN TERM NORMALIZATION
# =========================================================

def test_term_normalization():
    section("[I]  Banking terminology normalization")

    cases = [
        ("What is Chuck Book?", "What is cheque book?"),
        ("I need a chut book", "I need a cheque book"),
        ("Chat Book please", "cheque book please"),
        ("checkbook", "cheque book"),
        ("Can I get a check book?", "Can I get a cheque book?"),
        ("pass book", "passbook"),
        ("my a c number is 12345", "my account number is 12345"),
    ]

    for raw, expected in cases:
        result = normalize_banking_terms(raw)
        check(
            f"[I] {raw!r} -> {expected!r}",
            result == expected,
            result,
        )

    # Must NOT rewrite arbitrary words.
    untouched = [
        "I want to check my balance",
        "Please take a withdrawal slip.",
        "I want to deposit money",
        "I want to take a load",
        "ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "मुझे पैसे जमा करने हैं",
    ]

    for text in untouched:
        check(
            f"[I] left unchanged: {text!r}",
            normalize_banking_terms(text) == text,
            normalize_banking_terms(text),
        )

    check(
        "[I] empty input is safe",
        normalize_banking_terms("") == ""
        and normalize_banking_terms(None) == "",
    )

    # The pipeline keeps the RAW transcript and passes the
    # normalized text downstream.
    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    class RecordingDialogue:
        def __init__(self):
            self.seen = []

        def detect_control(self, text):
            self.seen.append(text)
            if text.strip().lower().rstrip(".") == "exit":
                return "session_exit"
            return None

        def answer_general_question(self, text):
            return "KNOWLEDGE ANSWER"

        def generate_response(self, conversation, user_input=None):
            return "KNOWLEDGE ANSWER"

        def handle_control_command(self, conversation, command):
            return "control ok"

        def start_workflow(self, conversation, intent):
            return True, "started"

    dialogue = RecordingDialogue()

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.conversation = ConversationManager()
    pipeline.dialogue = dialogue
    pipeline.intent_detector = None
    pipeline.tts = None

    script = iter(["What is Chuck Book?", "exit"])
    pipeline.select_language = lambda: ("English", "en")
    pipeline.select_input_mode = lambda: "2"
    pipeline.listen = lambda mode, language_code: next(script)
    pipeline.speak = lambda mode, response, language_code: None

    context = pipeline.run()

    check(
        "[I] normalized text reaches the dialogue layer",
        dialogue.seen and dialogue.seen[0] == "What is cheque book?",
        dialogue.seen,
    )

    user_turns = [
        entry["message"]
        for entry in context["history"]
        if entry["speaker"] == "User"
    ]

    check(
        "[I] raw transcript preserved in history",
        user_turns and user_turns[0] == "What is Chuck Book?",
        user_turns,
    )


# =========================================================
# [J]  LOW-CONFIDENCE / AMBIGUOUS INTENT
#
# Phase 2.5 deliberately adds NO confidence threshold: a
# low-confidence intent must still start its workflow, because
# the scores are English-calibrated and rejecting on them would
# break Kannada/Hindi. Ambiguity clarification is a Phase 3
# speech-robustness item.
# =========================================================

def test_low_confidence_intent_behaviour():
    section("[J]  Low-confidence intent behaviour (no threshold)")

    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    class LowConfidenceDetector:
        def __init__(self):
            self.calls = []

        def detect_intent(self, text):
            self.calls.append(text)
            return {"intent": "open new account", "confidence": 0.325}

    class RecordingDialogue:
        def __init__(self):
            self.started = []

        def detect_control(self, text):
            if text.strip().lower().rstrip(".") == "exit":
                return "session_exit"
            return None

        def answer_general_question(self, text):
            return None

        def generate_response(self, conversation, user_input=None):
            return "workflow response"

        def handle_control_command(self, conversation, command):
            return "control ok"

        def start_workflow(self, conversation, intent):
            self.started.append(intent)
            return False, (
                "I understood your request, but I don't have a "
                "guided procedure for that service yet."
            )

    detector = LowConfidenceDetector()
    dialogue = RecordingDialogue()

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.conversation = ConversationManager()
    pipeline.dialogue = dialogue
    pipeline.intent_detector = detector
    pipeline.tts = None

    script = iter(["I want to take a load", "exit"])
    pipeline.select_language = lambda: ("English", "en")
    pipeline.select_input_mode = lambda: "2"
    pipeline.listen = lambda mode, language_code: next(script)
    pipeline.speak = lambda mode, response, language_code: None

    context = pipeline.run()

    check(
        "[J] low-confidence intent is still detected, not rejected",
        detector.calls == ["I want to take a load"],
        detector.calls,
    )
    check(
        "[J] low-confidence intent still reaches start_workflow",
        dialogue.started == ["open new account"],
        dialogue.started,
    )
    check(
        "[J] session survives an unsupported low-confidence intent",
        context["session_state"] == SessionState.EXITED.value,
        context["session_state"],
    )
    check(
        "[J] workflow state untouched by a failed activation",
        context["workflow_state"] == WorkflowState.NONE.value,
        context["workflow_state"],
    )
    check(
        "[J] 'load' is deliberately NOT rewritten to 'loan'",
        normalize_banking_terms("I want to take a load")
        == "I want to take a load",
    )


# =========================================================
# [K]  MULTILINGUAL INTENT REGRESSION
# =========================================================

def test_multilingual_regression():
    section("[K]  Multilingual behaviour preserved")

    declaratives = [
        "I want to deposit money",
        "ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "मुझे पैसे जमा करने हैं",
        "ಸಾಲ ಬೇಕು",
    ]

    for text in declaratives:
        check(
            f"[K] declarative stays on the intent path: {text!r}",
            looks_like_a_question(text) is False,
        )
        check(
            f"[K] not swallowed by control matching: {text!r}",
            classify_command(text) is None,
            classify_command(text),
        )
        check(
            f"[K] not altered by normalization: {text!r}",
            normalize_banking_terms(text) == text,
        )


# =========================================================
# [L]  KNOWLEDGE BASE + RAG QUESTION REGRESSION
# =========================================================

def test_knowledge_base_and_rag():
    section("[L]  Knowledge base and RAG routing")

    documents = KnowledgeLoader().load_documents()
    sources = {document["source"] for document in documents}

    # The Phase 2 documents must survive untouched.
    for name in (
        "account_opening.md",
        "deposit.md",
        "loan.md",
        "withdrawal.md",
    ):
        check(
            f"[L] existing document preserved: {name}",
            name in sources,
            sorted(sources),
        )

    # Phase 2.5 general banking documents.
    for name in (
        "cheque_book.md",
        "passbook.md",
        "savings_account.md",
        "current_account.md",
        "account_number.md",
        "deposit_slip.md",
        "withdrawal_slip.md",
        "bank_transfer.md",
        "banking_services.md",
        "loan_basics.md",
        "account_opening_requirements.md",
    ):
        check(
            f"[L] knowledge document added: {name}",
            name in sources,
            sorted(sources),
        )

    by_source = {
        document["source"]: document["content"]
        for document in documents
    }

    check(
        "[L] cheque book document explains the term",
        "cheque book" in by_source["cheque_book.md"].lower(),
    )
    check(
        "[L] documents stay modular (no single giant file)",
        all(
            len(content) < 4000
            for content in by_source.values()
        ),
        {
            source: len(content)
            for source, content in by_source.items()
            if len(content) >= 4000
        },
    )

    # Routing: a banking question still reaches the RAG path,
    # a declarative request still reaches intent detection.
    fake = RecordingUnderstanding()
    dialogue = make_dialogue(fake)

    fake.set("question", "none")
    check(
        "[L] banking question answered via the knowledge path",
        dialogue.answer_general_question("What is a cheque book?")
        == "KNOWLEDGE ANSWER",
    )
    check(
        "[L] general question answered via the knowledge path",
        dialogue.answer_general_question("What is ChatGPT?")
        == "KNOWLEDGE ANSWER",
    )
    check(
        "[L] declarative returns None (intent detection proceeds)",
        dialogue.answer_general_question("I want to deposit money")
        is None,
    )


# =========================================================
# [M]  PAUSE / RESUME REGRESSION
# =========================================================

def test_pause_resume_regression():
    section("[M]  Pause / resume regression")

    fake, dialogue, conversation = started_deposit_at_step_2()

    response = dialogue.handle_control_command(conversation, "pause")
    check(
        "[M] pause suspends the workflow",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check("[M] pause acknowledges", "paused" in response.lower(), response)

    response = dialogue.handle_control_command(conversation, "resume")
    check(
        "[M] resume reactivates the workflow",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[M] resume restates the current instruction",
        ACCOUNT_NUMBER_STEP in response,
        response,
    )
    check(
        "[M] resume does not skip the step",
        conversation.current_step == 2,
        conversation.current_step,
    )

    # A side question during a suspended workflow keeps state.
    conversation.suspend_workflow()
    fake.set("question", "none")
    dialogue.generate_response(conversation, "why do I need this?")

    check(
        "[M] side question keeps the workflow suspended",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[M] side question keeps the step",
        conversation.current_step == 2,
        conversation.current_step,
    )


# =========================================================
# [N]  NEW WORKFLOW AFTER COMPLETION
# =========================================================

def test_new_workflow_after_completion():
    section("[N]  New workflow after completion")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")

    fake.set("workflow_action", "complete")
    for _ in range(3):
        dialogue.generate_response(conversation, "done")

    final = dialogue.generate_response(conversation, "done")

    check("[N] deposit completes", final == "Workflow Completed.", final)
    check(
        "[N] state is COMPLETED",
        conversation.workflow_state is WorkflowState.COMPLETED,
    )

    # A completed workflow still answers questions.
    fake.set("question", "none")
    answer = dialogue.generate_response(
        conversation, "what is a cheque book?"
    )
    check(
        "[N] completed workflow still answers questions",
        answer == "KNOWLEDGE ANSWER",
        answer,
    )

    started, first = dialogue.start_workflow(conversation, "withdraw money")

    check("[N] a new workflow starts after completion", started is True)
    check(
        "[N] new workflow begins at its own step 1",
        first == "Please take a withdrawal slip.",
        first,
    )
    check(
        "[N] state back to ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
    )
    check(
        "[N] step reset for the new workflow",
        conversation.current_step == 1,
        conversation.current_step,
    )


# =========================================================
# [O]  SESSION EXIT
# =========================================================

def test_exit_regression():
    section("[O]  Session exit")

    for text in ("Exit.", "exit", "EXIT!", "Goodbye.", "quit", "bye"):
        check(
            f"[O] {text!r} ends the session",
            classify_command(text) == "session_exit",
            classify_command(text),
        )

    for text in ("don't exit", "I don't want to exit"):
        check(
            f"[O] {text!r} does NOT end the session",
            classify_command(text) != "session_exit",
            classify_command(text),
        )

    # Other Phase 2 control words are unchanged.
    for text, expected in (
        ("stop", "cancel"),
        ("cancel", "cancel"),
        ("pause", "pause"),
        ("resume", "resume"),
        ("continue", "resume"),
        ("repeat", "repeat"),
        ("what's next", "next"),
    ):
        check(
            f"[O] control preserved: {text!r} -> {expected}",
            classify_command(text) == expected,
            classify_command(text),
        )


# =========================================================
# MAIN
# =========================================================

def main():
    test_intent_to_act_acknowledgements()
    test_completion_still_advances()
    test_next_semantics()
    test_current_step_question()
    test_term_normalization()
    test_low_confidence_intent_behaviour()
    test_multilingual_regression()
    test_knowledge_base_and_rag()
    test_pause_resume_regression()
    test_new_workflow_after_completion()
    test_exit_regression()

    section("SUMMARY")
    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED: {failure}")
        return 1

    print()
    print("  All Phase 2.5 tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
