"""
Phase 3.2B-2 regression tests -- explicit step references and
cross-workflow step reads.

THE DEFECT THIS SUITE LOCKS DOWN

A bare step reference had no gate before intent detection. With a
COMPLETED deposit workflow:

    user: "Step 4"
      -> classify_command()      -> None
      -> looks_like_a_question() -> False
      -> control pre-filter      -> False
      -> Intent: withdraw money | Confidence: 0.104
      -> Workflow state changed to: active

Asking to HEAR a step enrolled the customer in a withdrawal.
IntentDetector is a total function -- argmax over five banking
labels, no abstention, no threshold -- so any utterance reaching
it becomes a banking request.

The question-shaped variants ("Tell me step 4") escaped intent
detection but were answered from the RAG knowledge base, which
GUESSES at step content. A step is data the system holds
exactly, so this phase reads it from the workflow definition.

WHAT IS UNDER TEST

    A step reference is READ-ONLY in every workflow state.

Every assertion is about STATE and about whether IntentDetector
was called -- never about wording, except where an existing
phase already fixed the wording.

    ACTIVE     -> reads the step, stays ACTIVE, step unmoved
    SUSPENDED  -> reads the step, stays SUSPENDED, no resume
    COMPLETED  -> reads the step, stays COMPLETED, no new workflow
    CANCELLED  -> reads the step, stays CANCELLED, no new workflow
    NONE       -> safe reply, nothing started, no intent call

Runs entirely offline: no microphone, no Groq calls, no model
downloads. DialogueUnderstanding and IntentDetector are
injected; the DialogueManager, WorkflowLoader, the real workflow
JSON definitions and the pipeline routing under test are real.

Run from language_engine/:

    python -m debugging.test_phase32b2
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue.manager import (
    DialogueManager,
    StepReference,
    classify_command,
    classify_step_reference,
    classify_turn,
    normalize_command_text,
    strip_step_request_lead_ins,
)
from app.dialogue.llm.dialogue_understanding import (
    EMPTY_ENTITIES,
    DialogueUnderstanding,
    coerce_step_number,
    fallback_understanding,
)
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
        self.next_result = fallback_understanding()
        self.answer = "KNOWLEDGE ANSWER"
        self.answer_calls = 0
        self.understand_calls = 0

    def set(self, message_type, action, step_completed=False,
            target_workflow=None, **ents):
        self.next_result = {
            "type": message_type,
            "action": action,
            "step_completed": step_completed,
            "target_workflow": target_workflow,
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

    The defaults reproduce the smoke test's own numbers. The CALL
    is the defect, whichever intent comes back.
    """

    def __init__(self, intent="withdraw money", confidence=0.104):
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
    WITHOUT run()'s call to start_conversation().
    """

    user_input = normalize_banking_terms(text)

    control = pipeline.dialogue.detect_control(user_input)

    if control == "session_exit":
        return "SESSION_EXIT"

    return pipeline._respond(control, user_input)


def snapshot(conversation):
    """Everything a read-only turn must leave untouched."""

    return (
        conversation.workflow_state,
        conversation.current_workflow,
        conversation.current_intent,
        conversation.current_step,
        dict(conversation.entities),
    )


# =========================================================
# WORKFLOW STAGING  (real definitions, read from disk)
# =========================================================

WITHDRAW_STEPS = [
    "Please take a withdrawal slip.",
    "Fill in your account number.",
    "Enter the withdrawal amount.",
    "Sign the withdrawal slip.",
    "Submit the slip to the cashier.",
]

DEPOSIT_STEPS = [
    "Please take a deposit slip.",
    "Fill in your account number.",
    "Enter the amount to deposit.",
    "Submit the slip along with the cash.",
]

LOAN_STEPS = [
    "Please proceed to the loan assistance desk.",
    "Collect the loan application form.",
    "Keep your identity documents ready.",
]


def withdraw_at_amount_step():
    """Withdrawal, ACTIVE, on step 3 of 5."""

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


def deposit_at_account_step():
    """Deposit, ACTIVE, on step 2 of 4."""

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I took the slip")

    assert conversation.current_step == 2, conversation.current_step

    fake.set("unknown", "none")

    return fake, dialogue, conversation


def suspended_withdraw():
    fake, dialogue, conversation = withdraw_at_amount_step()
    dialogue.handle_control_command(conversation, "pause")

    assert conversation.workflow_state is WorkflowState.SUSPENDED

    return fake, dialogue, conversation


def completed_deposit():
    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")

    fake.set("workflow_action", "complete", step_completed=True)

    for _ in range(12):
        dialogue.generate_response(conversation, "I did that")
        if conversation.workflow_state is WorkflowState.COMPLETED:
            break

    assert conversation.workflow_state is WorkflowState.COMPLETED

    fake.set("unknown", "none")

    return fake, dialogue, conversation


def cancelled_deposit():
    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")
    dialogue.handle_control_command(conversation, "cancel")

    assert conversation.workflow_state is WorkflowState.CANCELLED

    fake.set("unknown", "none")

    return fake, dialogue, conversation


def none_state():
    fake = FakeUnderstanding()
    return fake, make_dialogue(fake), fresh_conversation()


def read_only_check(label, conversation, detector, before, response):
    """
    The full safety assertion for a step reference, applied
    identically in every state.
    """

    check(
        f"{label}: IntentDetector was NOT called",
        detector.calls == [],
        detector.calls,
    )
    check(
        f"{label}: nothing in the conversation changed",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )
    check(
        f"{label}: a usable reply was produced",
        isinstance(response, str) and bool(response),
        response,
    )


# =========================================================
# [1-5]  ACTIVE WORKFLOW
# =========================================================

def test_active_numeric_step():
    section('[1]  ACTIVE + "Step 4"')

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot(conversation)
    understand_before = fake.understand_calls

    response = turn(pipeline, "Step 4")

    read_only_check("[1]", conversation, detector, before, response)

    check(
        "[1] step 4's real instruction was read out",
        WITHDRAW_STEPS[3] in response,
        response,
    )
    check(
        "[1] it is NOT answered from the knowledge base",
        response != fake.answer,
        response,
    )
    check(
        "[1] no LLM call was needed",
        fake.understand_calls == understand_before,
        (understand_before, fake.understand_calls),
    )
    check(
        "[1] still ACTIVE on step 3",
        conversation.workflow_state is WorkflowState.ACTIVE
        and conversation.current_step == 3,
        (conversation.workflow_state, conversation.current_step),
    )
    check(
        "[1] the reply keeps the customer oriented",
        WITHDRAW_STEPS[2] in response,
        response,
    )


def test_active_word_number_step():
    section('[2]  ACTIVE + "step four"')

    for text, index in (
        ("step four", 3),
        ("step two", 1),
        ("step five", 4),
        ("step one", 0),
    ):
        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[2] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[2] {text!r} read out the right step",
            WITHDRAW_STEPS[index] in response,
            response,
        )


def test_active_repeat_step():
    section('[3]  ACTIVE + "repeat step 4"')

    for text in (
        "repeat step 4",
        "Can you repeat step 4?",
        "can you please repeat step 4",
        "Tell me step 4",
        "What about step 4?",
        "I want step four",
        "please read out step 4",
    ):
        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[3] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[3] {text!r} read out step 4",
            WITHDRAW_STEPS[3] in response,
            response,
        )


def test_active_ordinal_step():
    section('[4]  ACTIVE + "fourth step"')

    for text, index in (
        ("fourth step", 3),
        ("the fourth step", 3),
        ("Can you tell me the fourth step?", 3),
        ("second step", 1),
        ("the first step", 0),
        ("4th step", 3),
        ("2nd step", 1),
    ):
        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[4] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[4] {text!r} read out the right step",
            WITHDRAW_STEPS[index] in response,
            response,
        )


def test_active_out_of_range_step():
    section("[5]  ACTIVE + out-of-range step")

    for text, requested in (
        ("Step 7", 7),
        ("step ten", 10),
        ("step 0", 0),
        ("seventh step", 7),
    ):
        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[5] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[5] {text!r} did not crash and started nothing",
            conversation.workflow_state is WorkflowState.ACTIVE
            and conversation.current_workflow == "withdraw money",
            (conversation.workflow_state, conversation.current_workflow),
        )
        check(
            f"[5] {text!r} says the step is unavailable",
            "no step" in response.lower()
            or "not available" in response.lower(),
            response,
        )
        check(
            f"[5] {text!r} does not read out any instruction",
            not any(step in response for step in WITHDRAW_STEPS[:1]),
            response,
        )

    # The real step count is reported rather than a bare refusal.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)
    response = turn(pipeline, "Step 7")

    check(
        "[5] the reply names the real number of steps (5)",
        "5 steps" in response,
        response,
    )


# =========================================================
# [6-9]  OTHER WORKFLOW STATES
# =========================================================

def test_suspended_step_reference():
    section("[6]  SUSPENDED + step reference")

    for text, index in (("Step 4", 3), ("step two", 1),
                        ("repeat step 5", 4)):
        fake, dialogue, conversation = suspended_withdraw()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[6] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[6] {text!r} read out the step",
            WITHDRAW_STEPS[index] in response,
            response,
        )
        check(
            f"[6] {text!r} did NOT resume the workflow",
            conversation.workflow_state is WorkflowState.SUSPENDED,
            conversation.workflow_state,
        )
        check(
            f"[6] {text!r} says the request is still paused",
            "paused" in response.lower(),
            response,
        )
        check(
            f"[6] {text!r} kept the step at 3",
            conversation.current_step == 3,
            conversation.current_step,
        )


def test_completed_step_reference():
    section("[7]  COMPLETED + step reference")

    for text, index in (("Step 4", 3), ("step two", 1),
                        ("tell me step 1", 0)):
        fake, dialogue, conversation = completed_deposit()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[7] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[7] {text!r} read the completed workflow's step",
            DEPOSIT_STEPS[index] in response,
            response,
        )
        check(
            f"[7] {text!r} stays COMPLETED",
            conversation.workflow_state is WorkflowState.COMPLETED,
            conversation.workflow_state,
        )
        check(
            f"[7] {text!r} started NO new workflow",
            conversation.current_workflow == "deposit money",
            conversation.current_workflow,
        )
        check(
            f"[7] {text!r} reports the completed status",
            "completed" in response.lower(),
            response,
        )


def test_cancelled_step_reference():
    section("[8]  CANCELLED + step reference")

    for text, index in (("Step 4", 3), ("step two", 1)):
        fake, dialogue, conversation = cancelled_deposit()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[8] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[8] {text!r} read the cancelled workflow's step",
            DEPOSIT_STEPS[index] in response,
            response,
        )
        check(
            f"[8] {text!r} stays CANCELLED",
            conversation.workflow_state is WorkflowState.CANCELLED,
            conversation.workflow_state,
        )
        check(
            f"[8] {text!r} started NO new workflow",
            conversation.current_workflow == "deposit money",
            conversation.current_workflow,
        )
        check(
            f"[8] {text!r} reports the cancelled status",
            "cancelled" in response.lower(),
            response,
        )


def test_no_workflow_step_reference():
    section("[9]  NONE + step reference")

    for text in ("Step 4", "step four", "repeat step 2",
                 "the fourth step"):
        fake, dialogue, conversation = none_state()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[9] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[9] {text!r} started nothing",
            conversation.workflow_state is WorkflowState.NONE
            and conversation.current_workflow is None,
            (conversation.workflow_state, conversation.current_workflow),
        )
        check(
            f"[9] {text!r} says there is nothing to refer to",
            "no active request" in response.lower(),
            response,
        )
        check(
            f"[9] {text!r} invents no workflow information",
            not any(
                step in response
                for step in WITHDRAW_STEPS + DEPOSIT_STEPS + LOAN_STEPS
            ),
            response,
        )


# =========================================================
# [10-13]  CROSS-WORKFLOW REFERENCES
# =========================================================

def test_current_workflow_step():
    section('[10]  Current workflow + "step 4"')

    # No workflow named -> the current one.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    response = turn(pipeline, "step 4")

    check(
        "[10] resolves against the CURRENT workflow",
        WITHDRAW_STEPS[3] in response,
        response,
    )
    check(
        "[10] does not read the deposit workflow",
        DEPOSIT_STEPS[3] not in response,
        response,
    )
    check(
        "[10] no workflow phrase was recognised",
        classify_turn("step 4").workflow_phrase is None,
        classify_turn("step 4"),
    )


def test_withdrawal_asking_about_deposit():
    section('[11]  Current withdrawal + "step 4 of deposit"')

    for text in (
        "step 4 of deposit",
        "Can you tell me step 4 of the deposit process?",
        "tell me step 4 of deposit money",
        "fourth step of the deposit process",
    ):
        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[11] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[11] {text!r} read the DEPOSIT step",
            DEPOSIT_STEPS[3] in response,
            response,
        )
        check(
            f"[11] {text!r} did NOT read the withdrawal step",
            WITHDRAW_STEPS[3] not in response,
            response,
        )
        check(
            f"[11] {text!r} kept the withdrawal ACTIVE on step 3",
            conversation.workflow_state is WorkflowState.ACTIVE
            and conversation.current_workflow == "withdraw money"
            and conversation.current_step == 3,
            (conversation.workflow_state, conversation.current_workflow,
             conversation.current_step),
        )
        check(
            f"[11] {text!r} names the workflow it answered about",
            "deposit" in response.lower(),
            response,
        )


def test_deposit_asking_about_withdrawal():
    section('[12]  Current deposit + "step 4 of withdrawal"')

    for text in (
        "step 4 of withdrawal",
        "tell me step 4 of the withdrawal process",
        "step four of withdraw money",
    ):
        fake, dialogue, conversation = deposit_at_account_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[12] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[12] {text!r} read the WITHDRAWAL step",
            WITHDRAW_STEPS[3] in response,
            response,
        )
        check(
            f"[12] {text!r} kept the deposit ACTIVE on step 2",
            conversation.workflow_state is WorkflowState.ACTIVE
            and conversation.current_workflow == "deposit money"
            and conversation.current_step == 2,
            (conversation.workflow_state, conversation.current_workflow,
             conversation.current_step),
        )


def test_target_workflow_does_not_mutate():
    section("[13]  A named workflow never switches the current one")

    # Loan has only 3 steps -- an out-of-range cross-workflow
    # reference must still not touch anything.
    for text in (
        "step 2 of loan application",
        "step 4 of loan application",
        "step 1 of the loan process",
    ):
        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[13] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[13] {text!r} did NOT start the loan workflow",
            conversation.current_workflow == "withdraw money"
            and conversation.current_intent == "withdraw money",
            (conversation.current_workflow, conversation.current_intent),
        )

    # The in-range one really does read the loan definition.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)
    response = turn(pipeline, "step 2 of loan application")

    check(
        "[13] the loan step was read from its own definition",
        LOAN_STEPS[1] in response,
        response,
    )

    # Out of range for THAT workflow, not the current one.
    response = turn(pipeline, "step 4 of loan application")

    check(
        "[13] out-of-range names the loan's 3 steps, not 5",
        "3 steps" in response,
        response,
    )


def test_unknown_target_workflow():
    section("[13]  An unknown named workflow is safe")

    for text in (
        "step 4 of savings account",
        "step 2 of the cheque book process",
        "step 1 of opening a new account",
        "step 3 of money",
    ):
        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)
        response = turn(pipeline, text)

        read_only_check(f"[13] {text!r}", conversation, detector,
                        before, response)
        check(
            f"[13] {text!r} admits it has no such procedure",
            "don't have" in response.lower(),
            response,
        )
        check(
            f"[13] {text!r} invents no steps",
            not any(
                step in response
                for step in WITHDRAW_STEPS[3:4] + DEPOSIT_STEPS + LOAN_STEPS
            ),
            response,
        )


def test_workflow_resolution_is_data_driven():
    section("[13]  Workflow names come from the definitions")

    loader = WorkflowLoader()
    available = loader.available_workflows()

    check(
        "[13] every definition on disk is enumerated",
        set(available) == {
            "apply for loan", "deposit money", "withdraw money"
        },
        available,
    )

    for spoken, expected in (
        ("deposit", "deposit money"),
        ("the deposit process", "deposit money"),
        ("deposit money", "deposit money"),
        ("withdrawal", "withdraw money"),
        ("the withdrawal process", "withdraw money"),
        ("loan", "apply for loan"),
        ("loan application", "apply for loan"),
        ("apply for loan", "apply for loan"),
    ):
        check(
            f"[13] resolve {spoken!r} -> {expected!r}",
            loader.resolve_workflow_name(spoken) == expected,
            loader.resolve_workflow_name(spoken),
        )

    # Ambiguous or unknown -> None, never a guess.
    for spoken in ("money", "the process", "savings account",
                   "cheque book", "", None):
        check(
            f"[13] resolve {spoken!r} -> None",
            loader.resolve_workflow_name(spoken) is None,
            loader.resolve_workflow_name(spoken),
        )


# =========================================================
# [14-17]  PRECEDENCE AGAINST COMPLETION AND NEXT
# =========================================================

def test_completion_outranks_step_reference():
    section('[14]  "I completed step 4" is still a completion')

    for text in (
        "I completed step 4",
        "I have completed step 4",
        "I finished step 4",
        "I did step 4",
        "step 4 is done",
        "I filled in step 2",
        "I have already completed step 4",
    ):
        check(
            f"[14] {text!r} is NOT a step reference",
            classify_turn(text) is None,
            classify_turn(text),
        )

    # And it still advances the workflow through the LLM path.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("workflow_action", "complete", step_completed=True)

    response = turn(pipeline, "I completed step 3")

    check(
        "[14] a completion statement still advances exactly once",
        conversation.current_step == 4,
        conversation.current_step,
    )
    check(
        "[14] and the next instruction is returned",
        WITHDRAW_STEPS[3] in response,
        response,
    )
    check(
        "[14] the workflow is still ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )


def test_compound_completion_and_next_still_works():
    section('[15]  "I completed this step. What next?" advances once')

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("workflow_action", "next_step", step_completed=True)

    response = turn(
        pipeline,
        "I completed this step. What should I do next?"
    )

    check(
        "[15] advanced EXACTLY once (3 -> 4)",
        conversation.current_step == 4,
        conversation.current_step,
    )
    check(
        "[15] responded with the NEXT instruction",
        WITHDRAW_STEPS[3] in response,
        response,
    )
    check(
        "[15] still ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[15] IntentDetector was not involved",
        detector.calls == [],
        detector.calls,
    )

    # The live model's ACTUAL reply for this sentence also carries
    # step_number=4 (verified against Groq). Branch 8 must not
    # treat that as a step-read request and swallow the
    # completion, so the compound is re-tested with it present.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set(
        "workflow_action", "next_step",
        step_completed=True, step_number=4
    )

    response = turn(
        pipeline,
        "I completed step 3. What should I do next?"
    )

    check(
        "[15] step_number alongside a completion still advances once",
        conversation.current_step == 4,
        conversation.current_step,
    )
    check(
        "[15] and returns the next instruction, not a step read",
        WITHDRAW_STEPS[3] in response,
        response,
    )
    check(
        "[15] the completion was not swallowed by the step read",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )


def test_what_next_does_not_advance():
    section('[16]  "What should I do next?" does not advance')

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("workflow_action", "next_step", step_completed=False)

    response = turn(pipeline, "What should I do next?")

    check(
        "[16] the step did NOT advance",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[16] the current instruction is restated",
        WITHDRAW_STEPS[2] in response,
        response,
    )
    check(
        "[16] 'what is the next step' is not a step reference",
        classify_turn("what is the next step") is None,
        classify_turn("what is the next step"),
    )
    check(
        "[16] 'what should I do next' is not a step reference",
        classify_turn("what should I do next") is None,
        classify_turn("what should I do next"),
    )


def test_repeat_current_step_does_not_advance():
    section('[17]  "Repeat the current step" does not advance')

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot(conversation)

    response = turn(pipeline, "repeat")

    check(
        "[17] a bare 'repeat' is still the repeat CONTROL",
        classify_turn("repeat") == "repeat",
        classify_turn("repeat"),
    )
    check(
        "[17] it returns the current instruction",
        response == WITHDRAW_STEPS[2],
        response,
    )
    check(
        "[17] nothing changed",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )

    # "repeat the current step" as a phrase.
    response = turn(pipeline, "can you repeat that")
    check(
        "[17] a polite repeat also returns the current step",
        response == WITHDRAW_STEPS[2],
        response,
    )
    check(
        "[17] still on step 3",
        conversation.current_step == 3,
        conversation.current_step,
    )


# =========================================================
# [18-20]  BOUNDARIES
# =========================================================

def test_step_without_number():
    section('[18]  "step" without a number is not a reference')

    for text in (
        "step",
        "steps",
        "the step",
        "this step",
        "which step",
        "step please",
        "what step",
    ):
        check(
            f"[18] {text!r} is not a step reference",
            classify_turn(text) is None
            or not isinstance(classify_turn(text), StepReference),
            classify_turn(text),
        )

    # And it does not become one end-to-end either.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot(conversation)
    fake.set("question", "none")

    turn(pipeline, "which step")

    check(
        "[18] an ambiguous 'step' turn mutates nothing",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )


def test_unrelated_uses_of_step():
    section('[19]  "I stepped outside" is not a step reference')

    for text in (
        "I stepped outside",
        "step carefully",
        "next step in my life",
        "watch your step",
        "I need to step away",
        "my next step is to sign",
        "the steps are slippery",
        "step by step please",
    ):
        result = classify_turn(text)
        check(
            f"[19] {text!r} is not a step reference",
            not isinstance(result, StepReference),
            result,
        )

    # "I stepped outside" must not be routed as a step read.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot(conversation)
    fake.set("unknown", "none")

    response = turn(pipeline, "I stepped outside")

    check(
        "[19] 'I stepped outside' reads no step",
        not any(
            f"Step {n}:" in response for n in range(1, 6)
        ),
        response,
    )
    check(
        "[19] 'I stepped outside' mutates nothing",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )


def test_step_reference_never_reaches_intent_detector():
    section("[20]  No step reference ever reaches IntentDetector")

    references = [
        "Step 4", "step four", "step 2", "repeat step 4",
        "Can you repeat step 4?", "Tell me step 4",
        "What about step 4?", "I want step four",
        "Can you tell me the fourth step?", "fourth step",
        "4th step", "the second step", "what is step four",
        "Step 7", "step ten",
        "step 4 of deposit", "step 2 of loan application",
        "step 4 of savings account",
        "Can you tell me step 4 of the deposit process?",
    ]

    for stage_name, stage in (
        ("ACTIVE", withdraw_at_amount_step),
        ("SUSPENDED", suspended_withdraw),
        ("COMPLETED", completed_deposit),
        ("CANCELLED", cancelled_deposit),
        ("NONE", none_state),
    ):
        offenders = []
        mutated = []

        for text in references:
            fake, dialogue, conversation = stage()
            detector = RecordingDetector()
            pipeline = make_pipeline(dialogue, detector, conversation)

            before = snapshot(conversation)

            # A control-typed reply would be the LLM's guess; the
            # deterministic tier must decide first regardless.
            fake.set("question", "none")

            turn(pipeline, text)

            if detector.calls:
                offenders.append(text)

            if snapshot(conversation) != before:
                mutated.append(text)

        check(
            f"[20] {stage_name}: no step reference reached intent",
            offenders == [],
            offenders,
        )
        check(
            f"[20] {stage_name}: no step reference mutated state",
            mutated == [],
            mutated,
        )


# =========================================================
# [21]  step_number / target_workflow HANDLING
# =========================================================

def test_step_number_forms():
    section("[21]  Numeric, word and malformed step numbers")

    for text, expected in (
        ("step 4", 4),
        ("step four", 4),
        ("fourth step", 4),
        ("4th step", 4),
        ("step 10", 10),
        ("step ten", 10),
        ("tenth step", 10),
    ):
        result = classify_step_reference(normalize_command_text(text))
        check(
            f"[21] {text!r} -> step {expected}",
            isinstance(result, StepReference)
            and result.step_number == expected,
            result,
        )

    # Malformed / unsupported -> not a reference at all, never a
    # guessed number.
    for text in (
        "step eleven",
        "step twenty",
        "step abc",
        "step 4a",
        "step four hundred",
        "step -1",
    ):
        result = classify_step_reference(normalize_command_text(text))
        check(
            f"[21] {text!r} is not a step reference",
            not isinstance(result, StepReference),
            result,
        )


def test_malformed_step_number_via_llm():
    section("[21]  A malformed step_number from the LLM is safe")

    # The LLM path still coerces through coerce_step_number().
    for bad in ("three", "", 3.5, [2], {"step": 2}, True, None):
        fake, dialogue, conversation = withdraw_at_amount_step()

        fake.next_result = {
            "type": "workflow_action",
            "action": "repeat",
            "step_completed": False,
            "target_workflow": None,
            "entities": {"step_number": bad},
        }

        before = snapshot(conversation)
        response = dialogue.generate_response(conversation, "repeat that")

        check(
            f"[21] step_number={bad!r} does not crash",
            isinstance(response, str) and bool(response),
            response,
        )
        check(
            f"[21] step_number={bad!r} mutates nothing",
            snapshot(conversation) == before,
            (before, snapshot(conversation)),
        )

    check(
        "[21] coerce_step_number is still the one coercion path",
        coerce_step_number("4") == 4
        and coerce_step_number(True) is None
        and coerce_step_number("x") is None,
    )


def test_target_workflow_schema_field():
    section("[21]  target_workflow is nullable and sanitized")

    understanding = object.__new__(DialogueUnderstanding)

    class FakeMessage:
        def __init__(self, content):
            self.content = content

    class FakeChoice:
        def __init__(self, content):
            self.message = FakeMessage(content)

    class FakeResponse:
        def __init__(self, content):
            self.choices = [FakeChoice(content)]

    # Missing -> None (the common case).
    result = understanding._parse_understanding(FakeResponse(
        '{"type": "question", "action": "none"}'
    ))
    check(
        "[21] a missing target_workflow is None",
        result["target_workflow"] is None,
        result,
    )

    # Present.
    result = understanding._parse_understanding(FakeResponse(
        '{"type": "question", "action": "repeat",'
        ' "target_workflow": "deposit",'
        ' "entities": {"step_number": 4}}'
    ))
    check(
        "[21] a real target_workflow is preserved",
        result["target_workflow"] == "deposit",
        result,
    )

    # Junk forms.
    for raw, label in (
        ('"target_workflow": null', "null"),
        ('"target_workflow": ""', "empty string"),
        ('"target_workflow": "   "', "whitespace"),
        ('"target_workflow": "null"', 'string "null"'),
        ('"target_workflow": 4', "number"),
        ('"target_workflow": ["deposit"]', "list"),
    ):
        result = understanding._parse_understanding(FakeResponse(
            '{"type": "question", "action": "none", ' + raw + "}"
        ))
        check(
            f"[21] target_workflow {label} -> None",
            result["target_workflow"] is None,
            result,
        )

    check(
        "[21] the safe fallback carries target_workflow = None",
        fallback_understanding()["target_workflow"] is None,
        fallback_understanding(),
    )

    check(
        "[21] target_workflow is NOT an entity",
        "target_workflow" not in EMPTY_ENTITIES,
        sorted(EMPTY_ENTITIES),
    )


def test_llm_cross_workflow_path():
    section("[21]  The LLM path honours target_workflow")

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set(
        "workflow_action", "repeat",
        target_workflow="deposit", step_number=4
    )

    before = snapshot(conversation)
    response = dialogue.generate_response(
        conversation,
        "what is step 4 of the deposit process"
    )

    check(
        "[21] the DEPOSIT step was read",
        DEPOSIT_STEPS[3] in response,
        response,
    )
    check(
        "[21] the withdrawal was left untouched",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )

    # An unknown target from the LLM is safe too.
    fake.set(
        "workflow_action", "repeat",
        target_workflow="savings account", step_number=2
    )
    response = dialogue.generate_response(conversation, "step 2 of savings")

    check(
        "[21] an unknown LLM target_workflow is safe",
        "don't have" in response.lower()
        and snapshot(conversation) == before,
        response,
    )

    # Same-workflow reads keep their historical bare reply.
    fake.set("workflow_action", "repeat", step_number=4)
    response = dialogue.generate_response(conversation, "repeat step 4")

    check(
        "[21] a same-workflow LLM read keeps the bare instruction",
        response == WITHDRAW_STEPS[3],
        response,
    )


# =========================================================
# [22]  PHASE 3.2B-1 ACKNOWLEDGEMENT BEHAVIOUR PRESERVED
# =========================================================

def test_acknowledgement_behaviour_preserved():
    section("[22]  Acknowledgement behaviour is unchanged")

    # Spelling question -> workflow stays on the exact step.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("question", "none")
    response = turn(pipeline, "Spell 2000 rupees.")

    check(
        "[22] the spelling question was answered",
        response == fake.answer,
        response,
    )
    check(
        "[22] the workflow stayed on step 3",
        conversation.workflow_state is WorkflowState.ACTIVE
        and conversation.current_step == 3,
        (conversation.workflow_state, conversation.current_step),
    )

    # Then "Thank you." -> restates the exact step, no advance.
    understand_before = fake.understand_calls
    response = turn(pipeline, "Thank you.")

    check(
        "[22] the acknowledgement restates the exact step",
        WITHDRAW_STEPS[2] in response,
        response,
    )
    check(
        "[22] it did not advance",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[22] it made no LLM call",
        fake.understand_calls == understand_before,
        (understand_before, fake.understand_calls),
    )
    check(
        "[22] it never reached IntentDetector",
        detector.calls == [],
        detector.calls,
    )

    # SUSPENDED + "Thank you." -> stays suspended.
    fake, dialogue, conversation = suspended_withdraw()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    response = turn(pipeline, "Thank you.")

    check(
        "[22] SUSPENDED acknowledgement does not resume",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[22] SUSPENDED acknowledgement says how to continue",
        "paused" in response.lower() and "resume" in response.lower(),
        response,
    )

    # COMPLETED / CANCELLED + "Thank you." -> no new workflow.
    for stage, expected in (
        (completed_deposit, WorkflowState.COMPLETED),
        (cancelled_deposit, WorkflowState.CANCELLED),
    ):
        fake, dialogue, conversation = stage()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        turn(pipeline, "Thank you.")

        check(
            f"[22] {expected.name} acknowledgement starts nothing",
            conversation.workflow_state is expected
            and conversation.current_workflow == "deposit money"
            and detector.calls == [],
            (conversation.workflow_state, conversation.current_workflow,
             detector.calls),
        )


def test_control_commands_still_win():
    section("[22]  Control commands are unaffected")

    for text, expected in (
        ("pause", "pause"),
        ("resume", "resume"),
        ("continue", "resume"),
        ("repeat", "repeat"),
        ("next", "next"),
        ("cancel", "cancel"),
        ("stop", "cancel"),
        ("never mind", "cancel"),
        ("thank you", "thanks"),
        ("okay", "acknowledgement"),
        ("exit", "session_exit"),
        ("can you please repeat that", "repeat"),
        ("pause for some time", "pause"),
    ):
        check(
            f"[22] {text!r} -> {expected}",
            classify_turn(text) == expected,
            classify_turn(text),
        )

    check(
        "[22] classify_command stays control-only",
        classify_command("repeat step 3") is None
        and classify_command("step 4") is None,
        (classify_command("repeat step 3"), classify_command("step 4")),
    )
    check(
        "[22] and classify_turn adds the step layer on top",
        isinstance(classify_turn("repeat step 3"), StepReference),
        classify_turn("repeat step 3"),
    )


def test_lead_in_stripper_unit():
    section("[22]  strip_step_request_lead_ins()")

    for text, expected in (
        ("tell me step 4", "step 4"),
        ("what is step 4", "step 4"),
        ("the fourth step", "fourth step"),
        ("i want step four", "step four"),
        ("step 4", "step 4"),
        ("", ""),
    ):
        check(
            f"[22] strip {text!r} -> {expected!r}",
            strip_step_request_lead_ins(text) == expected,
            strip_step_request_lead_ins(text),
        )


# =========================================================
# RUN
# =========================================================

def main():
    test_active_numeric_step()
    test_active_word_number_step()
    test_active_repeat_step()
    test_active_ordinal_step()
    test_active_out_of_range_step()

    test_suspended_step_reference()
    test_completed_step_reference()
    test_cancelled_step_reference()
    test_no_workflow_step_reference()

    test_current_workflow_step()
    test_withdrawal_asking_about_deposit()
    test_deposit_asking_about_withdrawal()
    test_target_workflow_does_not_mutate()
    test_unknown_target_workflow()
    test_workflow_resolution_is_data_driven()

    test_completion_outranks_step_reference()
    test_compound_completion_and_next_still_works()
    test_what_next_does_not_advance()
    test_repeat_current_step_does_not_advance()

    test_step_without_number()
    test_unrelated_uses_of_step()
    test_step_reference_never_reaches_intent_detector()

    test_step_number_forms()
    test_malformed_step_number_via_llm()
    test_target_workflow_schema_field()
    test_llm_cross_workflow_path()

    test_acknowledgement_behaviour_preserved()
    test_control_commands_still_win()
    test_lead_in_stripper_unit()

    section("SUMMARY")

    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED  {failure}")
        return 1

    print()
    print("  All Phase 3.2B-2 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
