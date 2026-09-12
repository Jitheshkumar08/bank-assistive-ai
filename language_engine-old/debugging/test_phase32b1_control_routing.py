"""
Phase 3.2B-1 follow-up -- control-utterance routing in resting
states.

Regression tests for a defect found in LIVE VOICE SMOKE TESTING
after the Phase 3.2B-1 automated suite passed. Observed sequence,
with a COMPLETED deposit workflow:

    user: "Can you pause for some time?"
      -> type=control, action=none
      -> Intent: check account balance | confidence 0.087

    user: "pause for some time"
      -> Intent: withdraw money | confidence 0.112
      -> Workflow state changed to: active

A request to PAUSE started a withdrawal workflow.

TWO independent causes, both covered here:

  1. STRUCTURAL. In a resting state (NONE / COMPLETED /
     CANCELLED) the pipeline's last gate before intent detection
     is DialogueManager.answer_general_question(). It discarded
     every classification that was not help/question -- which
     silently included type = "control" -- and returned None,
     which the pipeline reads as "proceed to intent detection".
     IntentDetector is a total function (argmax over five
     banking labels, no abstention, no threshold), so every
     utterance that reaches it becomes a banking request.

     The action enum has no pause/resume value, so
     action = "none" is the CORRECT reply for a pause. It must
     never be read as "no meaning found".

  2. COVERAGE. "pause for some time" did not reduce to "pause",
     because the politeness suffix table had no duration forms,
     AND it is not shaped like a question, so looks_like_a_
     question() was False and the LLM was never even consulted.
     That turn reached IntentDetector without any classification
     at all.

The invariants under test are about STATE and about whether
IntentDetector was called -- not about wording:

    COMPLETED + control  -> no intent call, stays COMPLETED,
                            no new workflow
    CANCELLED + control  -> no intent call, stays CANCELLED,
                            no new workflow
    ACTIVE    + pause    -> still suspends
    SUSPENDED + resume   -> still resumes the EXACT step
    SUSPENDED + repeat   -> still repeats the current step

Runs entirely offline: no microphone, no Groq calls, no model
downloads. DialogueUnderstanding and IntentDetector are
injected; the DialogueManager and the pipeline routing under
test are real.

Run from language_engine/:

    python -m debugging.test_phase32b1_control_routing
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue.manager import (
    DialogueManager,
    classify_command,
    looks_like_a_control_utterance,
    looks_like_a_question,
    resolve_control_command,
)
from app.dialogue.llm.dialogue_understanding import EMPTY_ENTITIES
from app.dialogue.term_normalizer import normalize_banking_terms

for _out in (sys.stdout, sys.stderr):
    if hasattr(_out, "reconfigure"):
        _out.reconfigure(encoding="utf-8", errors="replace")


# =========================================================
# TINY TEST HARNESS  (same shape as the other suites)
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
    """Stands in for DialogueUnderstanding."""

    def __init__(self):
        self.next_result = {
            "type": "unknown",
            "action": "none",
            "step_completed": False,
            "entities": entities(),
        }
        self.answer = "KNOWLEDGE ANSWER"
        self.answer_calls = 0
        self.understand_calls = 0

    def set(self, message_type, action, step_completed=False, **ents):
        self.next_result = {
            "type": message_type,
            "action": action,
            "step_completed": step_completed,
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


class RecordingDetector:
    """
    Stands in for IntentDetector and records every call.

    Nearly every assertion in this suite is `detector.calls == []`.
    IntentDetector has no abstention, so a control utterance
    reaching it BECOMES a banking request -- that call is the
    defect, regardless of which intent comes back.

    The defaults reproduce the smoke test's own numbers.
    """

    def __init__(self, intent="check account balance", confidence=0.087):
        self.calls = []
        self.intent = intent
        self.confidence = confidence

    def detect_intent(self, text):
        self.calls.append(text)
        return {"intent": self.intent, "confidence": self.confidence}


def make_dialogue(fake):
    manager = object.__new__(DialogueManager)
    manager.workflow_loader = WorkflowLoader()
    manager.dialogue_understanding = fake
    return manager


def fresh_conversation():
    conversation = ConversationManager()
    conversation.start_conversation()
    return conversation


def make_pipeline(dialogue, detector, conversation):
    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.conversation = conversation
    pipeline.dialogue = dialogue
    pipeline.intent_detector = detector
    pipeline.tts = None

    pipeline.select_language = lambda: ("English", "en")
    pipeline.select_input_mode = lambda: "2"
    pipeline.speak = lambda mode, response, language_code: None

    return pipeline


def turn(pipeline, text):
    """
    One user turn, routed exactly as VoiceAssistantPipeline.run()
    routes it (normalize -> detect_control -> _respond), but
    WITHOUT run()'s call to start_conversation(), which would
    reset the workflow state a staged test has just set up.
    """

    user_input = normalize_banking_terms(text)

    control = pipeline.dialogue.detect_control(user_input)

    if control == "session_exit":
        return "SESSION_EXIT"

    return pipeline._respond(control, user_input)


# =========================================================
# WORKFLOW STAGING
# =========================================================

DEPOSIT_SLIP_STEP = "Please take a deposit slip."
DEPOSIT_ACCOUNT_STEP = "Fill in your account number."
DEPOSIT_AMOUNT_STEP = "Enter the amount to deposit."

WITHDRAW_SLIP_STEP = "Please take a withdrawal slip."
WITHDRAW_AMOUNT_STEP = "Enter the withdrawal amount."


def completed_deposit():
    """
    Deposit workflow driven to COMPLETED through the normal
    completion path -- the exact state the smoke test was in.
    """

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")

    fake.set("workflow_action", "complete", step_completed=True)

    for _ in range(12):
        dialogue.generate_response(conversation, "I did that")
        if conversation.workflow_state is WorkflowState.COMPLETED:
            break

    assert conversation.workflow_state is WorkflowState.COMPLETED, (
        conversation.workflow_state
    )

    fake.set("unknown", "none")

    return fake, dialogue, conversation


def cancelled_deposit():
    """Deposit workflow driven to CANCELLED."""

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")
    dialogue.handle_control_command(conversation, "cancel")

    assert conversation.workflow_state is WorkflowState.CANCELLED, (
        conversation.workflow_state
    )

    fake.set("unknown", "none")

    return fake, dialogue, conversation


def withdraw_at_amount_step():
    """Withdrawal workflow, ACTIVE, on step 3 (the amount step)."""

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "withdraw money")

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I took the slip")
    dialogue.generate_response(conversation, "I filled my account number")

    assert conversation.current_step == 3, conversation.current_step

    fake.set("unknown", "none")

    return fake, dialogue, conversation


def resting_state_check(label, conversation, detector,
                        expected_state, expected_workflow, response):
    """
    The full safety assertion for a control utterance in a
    resting state, applied identically everywhere.
    """

    check(
        f"{label}: IntentDetector was NOT called",
        detector.calls == [],
        detector.calls,
    )
    check(
        f"{label}: state remains {expected_state.name}",
        conversation.workflow_state is expected_state,
        conversation.workflow_state,
    )
    check(
        f"{label}: no new workflow was started",
        conversation.current_workflow == expected_workflow,
        conversation.current_workflow,
    )
    check(
        f"{label}: current_intent unchanged",
        conversation.current_intent == expected_workflow,
        conversation.current_intent,
    )
    check(
        f"{label}: a safe reply was produced",
        isinstance(response, str) and bool(response),
        response,
    )
    check(
        f"{label}: the reply does not state a workflow step",
        WITHDRAW_SLIP_STEP not in response
        and DEPOSIT_SLIP_STEP not in response,
        response,
    )


# =========================================================
# [1]  COMPLETED + "Can you pause for some time?"
# =========================================================

def test_completed_polite_pause_with_duration():
    section('[1]  COMPLETED + "Can you pause for some time?"')

    fake, dialogue, conversation = completed_deposit()
    detector = RecordingDetector(
        intent="check account balance", confidence=0.087
    )
    pipeline = make_pipeline(dialogue, detector, conversation)

    # The smoke test's own classification.
    fake.set("control", "none")

    understand_before = fake.understand_calls

    response = turn(pipeline, "Can you pause for some time?")

    resting_state_check(
        "[1]", conversation, detector,
        WorkflowState.COMPLETED, "deposit money", response,
    )

    check(
        "[1] the reply reports the completed status",
        "completed" in response.lower(),
        response,
    )

    # Now resolved deterministically, so it costs no LLM call.
    check(
        "[1] classified deterministically as pause",
        classify_command("Can you pause for some time?") == "pause",
        classify_command("Can you pause for some time?"),
    )
    check(
        "[1] no LLM call was needed",
        fake.understand_calls == understand_before,
        (understand_before, fake.understand_calls),
    )


# =========================================================
# [2]  COMPLETED + "pause for some time"
# =========================================================

def test_completed_bare_pause_with_duration():
    section('[2]  COMPLETED + "pause for some time"')

    fake, dialogue, conversation = completed_deposit()
    detector = RecordingDetector(
        intent="withdraw money", confidence=0.112
    )
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("control", "none")

    response = turn(pipeline, "pause for some time")

    resting_state_check(
        "[2]", conversation, detector,
        WorkflowState.COMPLETED, "deposit money", response,
    )

    # This is the turn that started a withdrawal workflow.
    check(
        "[2] no withdrawal workflow was started",
        conversation.current_workflow != "withdraw money",
        conversation.current_workflow,
    )
    check(
        "[2] the workflow did NOT become ACTIVE",
        conversation.workflow_state is not WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[2] classified deterministically as pause",
        classify_command("pause for some time") == "pause",
        classify_command("pause for some time"),
    )

    # It is NOT question-shaped -- which is why the LLM was never
    # consulted for it before, and why the phrase table had to
    # cover it.
    check(
        "[2] the utterance is not question-shaped",
        looks_like_a_question("pause for some time") is False,
        looks_like_a_question("pause for some time"),
    )


def test_exact_smoke_test_sequence():
    section("[*]  The exact smoke-test sequence, in order")

    fake, dialogue, conversation = completed_deposit()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("control", "none")

    first = turn(pipeline, "Can you pause for some time?")
    second = turn(pipeline, "pause for some time")

    check(
        "[*] neither turn reached IntentDetector",
        detector.calls == [],
        detector.calls,
    )
    check(
        "[*] still COMPLETED after both turns",
        conversation.workflow_state is WorkflowState.COMPLETED,
        conversation.workflow_state,
    )
    check(
        "[*] still the deposit workflow after both turns",
        conversation.current_workflow == "deposit money",
        conversation.current_workflow,
    )
    check(
        "[*] both replies are safe and identical",
        first == second and "completed" in first.lower(),
        (first, second),
    )


# =========================================================
# [3]  COMPLETED + repeat
# =========================================================

def test_completed_repeat():
    section("[3]  COMPLETED + repeat control")

    for text in ("repeat", "can you repeat that", "say that again"):

        fake, dialogue, conversation = completed_deposit()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        fake.set("control", "none")

        response = turn(pipeline, text)

        resting_state_check(
            f"[3] {text!r}", conversation, detector,
            WorkflowState.COMPLETED, "deposit money", response,
        )


def test_completed_resume_and_next():
    section("[3]  COMPLETED + resume / next")

    for text in ("resume", "please continue", "what's next"):

        fake, dialogue, conversation = completed_deposit()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        fake.set("control", "none")

        response = turn(pipeline, text)

        check(
            f"[3] {text!r}: IntentDetector was NOT called",
            detector.calls == [],
            detector.calls,
        )
        check(
            f"[3] {text!r}: no workflow was reactivated",
            conversation.workflow_state is WorkflowState.COMPLETED,
            conversation.workflow_state,
        )
        check(
            f"[3] {text!r}: no new workflow",
            conversation.current_workflow == "deposit money",
            conversation.current_workflow,
        )
        check(
            f"[3] {text!r}: a safe reply was produced",
            isinstance(response, str) and bool(response),
            response,
        )


# =========================================================
# [4]  CANCELLED + pause
# =========================================================

def test_cancelled_control():
    section("[4]  CANCELLED + control")

    for text in (
        "pause",
        "Can you pause for some time?",
        "pause for some time",
        "please continue",
        "can you repeat that",
    ):

        fake, dialogue, conversation = cancelled_deposit()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        fake.set("control", "none")

        response = turn(pipeline, text)

        resting_state_check(
            f"[4] {text!r}", conversation, detector,
            WorkflowState.CANCELLED, "deposit money", response,
        )
        check(
            f"[4] {text!r}: the reply reports the cancelled status",
            "cancelled" in response.lower(),
            response,
        )


# =========================================================
# [5]  ACTIVE + pause  (must not regress)
# =========================================================

def test_active_pause_still_suspends():
    section("[5]  ACTIVE + pause still suspends")

    for text in (
        "pause",
        "Can you pause for some time?",
        "pause for some time",
        "can you pause for a moment",
        "hold on",
    ):

        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        response = turn(pipeline, text)

        check(
            f"[5] {text!r} suspends the workflow",
            conversation.workflow_state is WorkflowState.SUSPENDED,
            conversation.workflow_state,
        )
        check(
            f"[5] {text!r} keeps the step at 3",
            conversation.current_step == 3,
            conversation.current_step,
        )
        check(
            f"[5] {text!r} keeps the same workflow",
            conversation.current_workflow == "withdraw money",
            conversation.current_workflow,
        )
        check(
            f"[5] {text!r} never reaches IntentDetector",
            detector.calls == [],
            detector.calls,
        )
        check(
            f"[5] {text!r} confirms the pause",
            "paused" in response.lower(),
            response,
        )


# =========================================================
# [6]  SUSPENDED + resume  (must not regress)
# =========================================================

def test_suspended_resume_returns_exact_step():
    section("[6]  SUSPENDED + resume returns the EXACT step")

    for text in ("resume", "please continue", "okay, please continue"):

        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        conversation.add_entities({"account_number": "12345"})

        turn(pipeline, "pause")
        check(
            f"[6] {text!r}: SUSPENDED before the resume",
            conversation.workflow_state is WorkflowState.SUSPENDED,
            conversation.workflow_state,
        )

        response = turn(pipeline, text)

        check(
            f"[6] {text!r} reactivates the workflow",
            conversation.workflow_state is WorkflowState.ACTIVE,
            conversation.workflow_state,
        )
        check(
            f"[6] {text!r} returns to the EXACT step (3)",
            conversation.current_step == 3,
            conversation.current_step,
        )
        check(
            f"[6] {text!r} states that step",
            WITHDRAW_AMOUNT_STEP in response,
            response,
        )
        check(
            f"[6] {text!r} preserves entities",
            conversation.entities.get("account_number") == "12345",
            conversation.entities,
        )
        check(
            f"[6] {text!r} never reaches IntentDetector",
            detector.calls == [],
            detector.calls,
        )


# =========================================================
# [7]  SUSPENDED + repeat  (must not regress)
# =========================================================

def test_suspended_repeat_repeats_current_step():
    section("[7]  SUSPENDED + repeat repeats the current step")

    for text in ("repeat", "can you repeat that", "say that again"):

        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        turn(pipeline, "pause")

        response = turn(pipeline, text)

        check(
            f"[7] {text!r} returns the current instruction",
            response == WITHDRAW_AMOUNT_STEP,
            response,
        )
        check(
            f"[7] {text!r} does NOT resume",
            conversation.workflow_state is WorkflowState.SUSPENDED,
            conversation.workflow_state,
        )
        check(
            f"[7] {text!r} does not move the step",
            conversation.current_step == 3,
            conversation.current_step,
        )
        check(
            f"[7] {text!r} never reaches IntentDetector",
            detector.calls == [],
            detector.calls,
        )


# =========================================================
# [8]  THE STRUCTURAL GUARD
#
# The phrase tables will never cover every phrasing. The guard
# has to hold for control utterances they MISS, purely on the
# LLM's own type = "control".
# =========================================================

def test_structural_guard_on_uncovered_phrasing():
    section("[8]  type=control is never handed to IntentDetector")

    uncovered = [
        "I need to step away for a bit",
        "let us hold off on this",
        "I would like to take a break now",
        "can we pick up where we left off",
    ]

    for text in uncovered:

        check(
            f"[8] the phrase tables do NOT cover {text!r}",
            classify_command(text) is None,
            classify_command(text),
        )

        fake, dialogue, conversation = completed_deposit()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        fake.set("control", "none")

        response = turn(pipeline, text)

        resting_state_check(
            f"[8] {text!r}", conversation, detector,
            WorkflowState.COMPLETED, "deposit money", response,
        )


def test_control_prefilter_reaches_the_llm():
    section("[8]  A non-question control utterance is classified")

    # The bug's second half: not question-shaped, so the LLM was
    # never consulted and the turn went straight to
    # IntentDetector with no classification at all.

    for text in (
        "I need to step away for a bit",
        "let us hold off on this",
        "pause for some time",
    ):
        check(
            f"[8] {text!r} is not question-shaped",
            looks_like_a_question(text) is False,
            looks_like_a_question(text),
        )
        check(
            f"[8] but the control pre-filter catches it",
            looks_like_a_control_utterance(text) is True,
            looks_like_a_control_utterance(text),
        )

    fake, dialogue, conversation = completed_deposit()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("control", "none")
    understand_before = fake.understand_calls

    turn(pipeline, "I need to step away for a bit")

    check(
        "[8] the LLM WAS consulted for it",
        fake.understand_calls == understand_before + 1,
        (understand_before, fake.understand_calls),
    )


def test_guard_does_not_block_real_requests():
    section("[8]  Genuine banking requests still reach intent")

    # The pre-filter only decides whether to ASK the LLM. The
    # LLM's own type makes the call, so an utterance that merely
    # CONTAINS a control keyword is still routed normally.

    for text in (
        "I want to deposit money",
        "I want to continue my loan application",
        "I need to withdraw money again",
    ):

        fake, dialogue, conversation = completed_deposit()
        detector = RecordingDetector(
            intent="deposit money", confidence=0.8
        )
        pipeline = make_pipeline(dialogue, detector, conversation)

        # The LLM says this is a workflow request, not a control.
        fake.set("workflow_action", "none")

        turn(pipeline, text)

        check(
            f"[8] {text!r} still reaches IntentDetector",
            detector.calls == [text],
            detector.calls,
        )

    # And a genuine question is still answered, not blocked.
    fake, dialogue, conversation = completed_deposit()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("question", "none")
    response = turn(pipeline, "can you tell me about loans again?")

    check(
        "[8] a question containing 'again' is still answered",
        response == fake.answer,
        response,
    )
    check(
        "[8] the question did not reach IntentDetector",
        detector.calls == [],
        detector.calls,
    )


def test_resting_state_control_never_mutates():
    section("[8]  Resting-state control mutates nothing")

    for stage, expected_state in (
        (completed_deposit, WorkflowState.COMPLETED),
        (cancelled_deposit, WorkflowState.CANCELLED),
    ):

        fake, dialogue, conversation = stage()

        before = (
            conversation.workflow_state,
            conversation.current_workflow,
            conversation.current_intent,
            conversation.current_step,
            dict(conversation.entities),
        )

        for command in ("pause", "resume", "repeat", "cancel", "next"):
            dialogue.handle_control_command(conversation, command)

        after = (
            conversation.workflow_state,
            conversation.current_workflow,
            conversation.current_intent,
            conversation.current_step,
            dict(conversation.entities),
        )

        check(
            f"[8] {expected_state.name}: every control left state intact",
            before == after,
            (before, after),
        )


def test_none_state_control_still_safe():
    section("[8]  NONE + control is still safe")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)

    for text in (
        "pause",
        "pause for some time",
        "can you repeat that",
        "please continue",
    ):
        conversation = fresh_conversation()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        fake.set("control", "none")

        response = turn(pipeline, text)

        check(
            f"[8] NONE + {text!r}: nothing was started",
            conversation.workflow_state is WorkflowState.NONE
            and conversation.current_workflow is None,
            (conversation.workflow_state, conversation.current_workflow),
        )
        check(
            f"[8] NONE + {text!r}: IntentDetector was NOT called",
            detector.calls == [],
            detector.calls,
        )
        check(
            f"[8] NONE + {text!r}: a safe reply was produced",
            isinstance(response, str) and bool(response),
            response,
        )


# =========================================================
# [9]  DURATION SUFFIX COVERAGE
# =========================================================

def test_duration_suffixes():
    section("[9]  Duration forms reduce to the bare command")

    for text, expected in (
        ("pause for some time", "pause"),
        ("pause for a while", "pause"),
        ("pause for a few minutes", "pause"),
        ("pause for now", "pause"),
        ("pause a while", "pause"),
        ("wait for some time", "pause"),
        ("hold on for a while", "pause"),
        ("can you pause for some time", "pause"),
        ("could you please pause for a while", "pause"),
    ):
        check(
            f"[9] {text!r} -> {expected}",
            classify_command(text) == expected,
            classify_command(text),
        )

    # Still not fuzzy matching: a duration does not license a
    # cancel, and a real request is still a real request.
    for text in (
        "cancel for some time",
        "stop for some time",
        "I want to deposit money for some time",
        "what should I do for some time",
    ):
        check(
            f"[9] not a deterministic control: {text!r}",
            classify_command(text) in (None, "next"),
            classify_command(text),
        )

    # The negation guard still applies to the new forms.
    for text in (
        "don't pause for some time",
        "do not pause for a while",
    ):
        check(
            f"[9] negation still refuses: {text!r}",
            classify_command(text) is None,
            classify_command(text),
        )


def test_prefilter_and_resolver_units():
    section("[9]  Pre-filter and resolver units")

    for text in (
        "pause for some time",
        "I need to step away",
        "let us continue",
        "say that again",
        "hold off on this",
    ):
        check(
            f"[9] pre-filter accepts {text!r}",
            looks_like_a_control_utterance(text) is True,
            looks_like_a_control_utterance(text),
        )

    for text in (
        "I want to deposit money",
        "what documents are needed",
        "my account number is 12345",
        "",
    ):
        check(
            f"[9] pre-filter declines {text!r}",
            looks_like_a_control_utterance(text) is False,
            looks_like_a_control_utterance(text),
        )

    # Word-boundary anchored.
    check(
        "[9] pre-filter is word-boundary anchored",
        looks_like_a_control_utterance(
            "that service was discontinued"
        ) is False,
        looks_like_a_control_utterance("that service was discontinued"),
    )

    check(
        "[9] resolver still separates pause from resume",
        resolve_control_command("pause for some time") == "pause"
        and resolve_control_command("let us continue") == "resume",
        (
            resolve_control_command("pause for some time"),
            resolve_control_command("let us continue"),
        ),
    )


# =========================================================
# RUN
# =========================================================

def main():
    test_completed_polite_pause_with_duration()
    test_completed_bare_pause_with_duration()
    test_exact_smoke_test_sequence()
    test_completed_repeat()
    test_completed_resume_and_next()
    test_cancelled_control()
    test_active_pause_still_suspends()
    test_suspended_resume_returns_exact_step()
    test_suspended_repeat_repeats_current_step()
    test_structural_guard_on_uncovered_phrasing()
    test_control_prefilter_reaches_the_llm()
    test_guard_does_not_block_real_requests()
    test_resting_state_control_never_mutates()
    test_none_state_control_still_safe()
    test_duration_suffixes()
    test_prefilter_and_resolver_units()

    section("SUMMARY")

    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED  {failure}")
        return 1

    print()
    print("  All control-routing regression checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
