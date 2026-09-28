"""
Phase 3.2B-4 regression tests -- robust workflow completion
semantics.

THE GAP THIS CLOSES

Completion was the ONE workflow-affecting signal in the engine
with no deterministic component. Session exit, pause, resume,
cancel, repeat and next have phrase tables ahead of the LLM;
explicit step references have their own recognizer; a control the
tables cannot name is recovered from the customer's own words
after classification; even step_number is coerced rather than
trusted. Step completion -- the only signal that can ADVANCE a
banking instruction -- was one boolean from one model call:

    step_completed = (
        understanding.get("step_completed") is True
        or action == "complete"
    )

Nothing there read the customer's words, and nothing read the
current instruction.

The understanding prompt declares step_completed "independent of
type and action" (rule 64), but type, action, entities and
step_completed are emitted together, in ONE object, in ONE pass.
For a sentence that reports completion AND names a value or a
field, the extraction rules (33-37, and rule 28 explicitly) win,
the model commits to type = information, and then emits the
internally consistent-looking step_completed = false:

    "I have filled in my account number."   -> not completed
    "I have entered 5000 rupees."           -> not completed
    "The amount is entered."                -> not completed
    "I completed the account number."       -> not completed

Every one fell to the information branch, where the customer who
had just reported finished work was answered "Sorry, I didn't
catch that." and asked to do it again.

WHAT IS AND IS NOT BUILT

A three-valued resolver, not a phrase list. resolve_step_completion
returns True (a clause reports THIS step done), False (every clause
is a question, help request, refusal or intention) or None (defer
to the LLM, unchanged). The gates key on grammatical form -- verb
tense, clause mood, negation scope, token overlap with the active
instruction -- so "I have filled in my account number" is matched
because `filled` is a past form and `account number` overlaps the
instruction, not because it appears in a table.

THE INVARIANTS UNDER TEST

    The CURRENT STEP decides whether a completion statement
    refers to it.

    Entity extraction and completion detection are independent.

    Questions, spelling requests and intentions never complete.

    Control (cancel / pause / repeat) still outranks completion.

    Everything the resolver cannot read structurally reaches the
    LLM exactly as it did before this phase.

Runs entirely offline: no microphone, no Groq calls, no model
downloads. The understanding collaborator and IntentDetector are
injected; DialogueManager, ConversationManager, WorkflowLoader,
the resolver and the pipeline routing under test are real.

Run from language_engine/:

    python -m debugging.test_phase32b4
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue import manager as manager_module
from app.dialogue.manager import (
    DialogueManager,
    StepReference,
    classify_turn,
    restate_current_step,
)
from app.dialogue.llm.dialogue_understanding import (
    EMPTY_ENTITIES,
    fallback_understanding,
)
from app.dialogue.completion_semantics import (
    NOT_A_REPORT,
    REPORT,
    UNDECIDED,
    classify_clause,
    refers_to_current_step,
    resolve_step_completion,
    split_clauses,
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


class RecordingAnswerer:
    """
    Stands in for DialogueUnderstanding.

    `set()` scripts the reply the LLM would give. For the four
    headline cases it is set to the reply the LIVE model actually
    returns -- type=information, action=provide_information,
    step_completed=False -- so these tests fail without the
    resolver.
    """

    def __init__(self):
        self.next_result = fallback_understanding()
        self.calls = []
        self.understand_calls = 0
        self.answer_calls = 0
        self.replies = None
        self.answer = "GENERIC ANSWER"

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
                        current_instruction, recent_context=None):
        self.answer_calls += 1
        self.calls.append({
            "question": question,
            "current_instruction": current_instruction,
        })

        if self.replies:
            return self.replies.pop(0)

        return self.answer


class RecordingDetector:
    """Stands in for IntentDetector and records every call."""

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
    user_input = normalize_banking_terms(text)
    control = pipeline.dialogue.detect_control(user_input)

    if control == "session_exit":
        return "SESSION_EXIT"

    return pipeline._respond(control, user_input)


def snapshot(conversation):
    return (
        conversation.workflow_state,
        conversation.current_workflow,
        conversation.current_intent,
        conversation.current_step,
        dict(conversation.entities),
    )


# =========================================================
# WORKFLOW STAGING
#
# The step is set directly rather than driven through completion
# turns, so staging can never depend on the mechanism under test.
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

SLIP_STEP = WITHDRAW_STEPS[0]
ACCOUNT_NUMBER_STEP = WITHDRAW_STEPS[1]
AMOUNT_STEP = WITHDRAW_STEPS[2]
SIGN_STEP = WITHDRAW_STEPS[3]
SUBMIT_STEP = WITHDRAW_STEPS[4]


def withdraw_at(step, answerer=None):
    """Withdrawal, ACTIVE, parked on `step`."""

    fake = answerer if answerer is not None else RecordingAnswerer()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "withdraw money")
    conversation.current_step = step

    assert conversation.workflow_state is WorkflowState.ACTIVE

    return fake, dialogue, conversation


def at_account_number_step(answerer=None):
    return withdraw_at(2, answerer)


def at_amount_step(answerer=None):
    return withdraw_at(3, answerer)


# The reply the LIVE model returns for every one of the four
# headline failures. Using it is what makes these tests
# non-vacuous: with the resolver removed they all fail.
def observed_live_reply(fake, **ents):
    fake.set(
        "information",
        "provide_information",
        step_completed=False,
        **ents
    )


# =========================================================
# [1]  THE FOUR REPORTED FAILURES NOW COMPLETE
# =========================================================

def test_the_four_reported_failures():
    section("[1]  The four reported completion forms complete")

    cases = [
        ("I have filled in my account number.", 2, 3,
         ACCOUNT_NUMBER_STEP, AMOUNT_STEP, {}),
        ("I have entered 5000 rupees.", 3, 4,
         AMOUNT_STEP, SIGN_STEP, {"amount": 5000}),
        ("The amount is entered.", 3, 4,
         AMOUNT_STEP, SIGN_STEP, {}),
        ("I completed the account number.", 2, 3,
         ACCOUNT_NUMBER_STEP, AMOUNT_STEP, {}),
    ]

    for text, start, expected, instruction, next_step, ents in cases:

        fake, dialogue, conversation = withdraw_at(start)

        # The live model's actual reply for this sentence.
        observed_live_reply(fake, **ents)

        response = dialogue.generate_response(conversation, text)

        check(
            f"[1] advances: {text!r}",
            conversation.current_step == expected,
            (conversation.current_step, expected),
        )
        check(
            f"[1] returns the NEXT instruction: {text!r}",
            response == next_step,
            response,
        )
        check(
            f"[1] the finished step is not repeated: {text!r}",
            instruction not in response,
            response,
        )
        check(
            f"[1] no false receipt was issued: {text!r}",
            "didn't catch" not in response.lower()
            and "noted" not in response.lower(),
            response,
        )
        check(
            f"[1] workflow stays ACTIVE: {text!r}",
            conversation.workflow_state is WorkflowState.ACTIVE,
            conversation.workflow_state,
        )


# =========================================================
# [2]  ENTITY EXTRACTION STAYS INDEPENDENT
# =========================================================

def test_completion_and_entity_are_independent():
    section("[2]  step_completed=true AND amount=5000 together")

    fake, dialogue, conversation = at_amount_step()

    # The model contributes ONLY the entity here: it says
    # step_completed=False. The resolver contributes ONLY the
    # completion. Both must survive.
    observed_live_reply(fake, amount=5000)

    response = dialogue.generate_response(
        conversation,
        "I have entered 5000 rupees."
    )

    check(
        "[2] the step completed",
        conversation.current_step == 4,
        conversation.current_step,
    )
    check(
        "[2] the amount entity was persisted",
        conversation.entities.get("amount") == 5000,
        conversation.entities,
    )
    check(
        "[2] and the next instruction is returned",
        response == SIGN_STEP,
        response,
    )

    # The reverse direction: an entity with NO completion report
    # must still not advance. Extraction alone is never completion.
    fake, dialogue, conversation = at_amount_step()
    fake.set("information", "provide_information", amount=20000)

    response = dialogue.generate_response(conversation, "twenty thousand")

    check(
        "[2] a bare value does NOT complete the step",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[2] but the bare value was still stored",
        conversation.entities.get("amount") == 20000,
        conversation.entities,
    )
    check(
        "[2] and the instruction is restated",
        AMOUNT_STEP in response,
        response,
    )


# =========================================================
# [3]  QUESTIONS, SPELLING AND INTENTIONS NEVER COMPLETE
# =========================================================

NEGATIVE_UTTERANCES = (
    "Can you spell 5000 rupees?",
    "Spell it letter by letter.",
    "What should I do next?",
    "Can you explain how to fill this?",
    "I need to fill this.",
    "I'll fill this.",
)


def test_negative_cases_never_complete():
    section("[3]  Questions / help / intention never complete")

    for text in NEGATIVE_UTTERANCES:

        for step, instruction in (
            (2, ACCOUNT_NUMBER_STEP),
            (3, AMOUNT_STEP),
        ):

            fake, dialogue, conversation = withdraw_at(step)

            # Even the model's own classification is generous here:
            # it reports an extracted amount. Neither that nor the
            # sentence may advance the workflow.
            fake.set("question", "none", step_completed=False, amount=5000)

            before = snapshot(conversation)

            dialogue.generate_response(conversation, text)

            check(
                f"[3] step {step} unchanged: {text!r}",
                conversation.current_step == step,
                conversation.current_step,
            )
            check(
                f"[3] step {step} stays ACTIVE: {text!r}",
                conversation.workflow_state is WorkflowState.ACTIVE,
                conversation.workflow_state,
            )
            check(
                f"[3] step {step} workflow untouched: {text!r}",
                snapshot(conversation)[:4] == before[:4],
                (before, snapshot(conversation)),
            )


def test_spelling_records_no_entity():
    section("[3]  A value inside a question is not banked")

    fake, dialogue, conversation = at_amount_step()
    fake.set("help", "none", step_completed=False, amount=5000)

    dialogue.generate_response(conversation, "Can you spell 5000 rupees?")

    check(
        "[3] the step did not advance",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[3] no entity was recorded from a question",
        conversation.entities == {},
        conversation.entities,
    )


# =========================================================
# [4]  CURRENT-STEP AUTHORITY
# =========================================================

def test_current_step_authority():
    section("[4]  The current step decides what a completion means")

    # An amount completion at the ACCOUNT NUMBER step.
    fake, dialogue, conversation = at_account_number_step()
    observed_live_reply(fake, amount=5000)

    response = dialogue.generate_response(
        conversation,
        "I have entered 5000 rupees."
    )

    check(
        "[4] an amount report does NOT complete the account step",
        conversation.current_step == 2,
        conversation.current_step,
    )
    check(
        "[4] the account-number step is restated",
        ACCOUNT_NUMBER_STEP in response,
        response,
    )

    # An account-number completion at the AMOUNT step.
    fake, dialogue, conversation = at_amount_step()
    observed_live_reply(fake)

    response = dialogue.generate_response(
        conversation,
        "I have filled in my account number."
    )

    check(
        "[4] an account report does NOT complete the amount step",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[4] the amount step is restated",
        AMOUNT_STEP in response,
        response,
    )

    # The resolver itself must DECLINE rather than confirm. A
    # cross-step report resolves to None (defer), never True.
    check(
        "[4] resolver defers on an amount report at the account step",
        resolve_step_completion(
            "I have entered 5000 rupees.", ACCOUNT_NUMBER_STEP
        ) is None,
        resolve_step_completion(
            "I have entered 5000 rupees.", ACCOUNT_NUMBER_STEP
        ),
    )
    check(
        "[4] resolver defers on an account report at the amount step",
        resolve_step_completion(
            "I have filled in my account number.", AMOUNT_STEP
        ) is None,
        resolve_step_completion(
            "I have filled in my account number.", AMOUNT_STEP
        ),
    )

    # And confirms at the step each one actually belongs to.
    check(
        "[4] resolver confirms the amount report at the amount step",
        resolve_step_completion(
            "I have entered 5000 rupees.", AMOUNT_STEP
        ) is True,
    )
    check(
        "[4] resolver confirms the account report at its own step",
        resolve_step_completion(
            "I have filled in my account number.", ACCOUNT_NUMBER_STEP
        ) is True,
    )


# =========================================================
# [5]  THE VETO OUTRANKS A WRONG LLM `true`
#
# The property the three-valued design buys that an OR-floor
# could not: a model that wrongly reports completion for a
# spelling request can no longer advance a banking step.
# =========================================================

def test_veto_beats_a_wrong_llm_true():
    section("[5]  A wrong step_completed=true cannot complete a question")

    for text in NEGATIVE_UTTERANCES:

        fake, dialogue, conversation = at_amount_step()

        # The model gets it wrong in the DANGEROUS direction.
        fake.set("workflow_action", "complete", step_completed=True)

        dialogue.generate_response(conversation, text)

        check(
            f"[5] vetoed despite the model saying complete: {text!r}",
            conversation.current_step == 3,
            conversation.current_step,
        )
        check(
            f"[5] the workflow was not completed: {text!r}",
            conversation.workflow_state is WorkflowState.ACTIVE,
            conversation.workflow_state,
        )


# =========================================================
# [6]  DEFER PRESERVES PRIOR-PHASE BEHAVIOUR
# =========================================================

def test_step_reference_completion_still_defers():
    section("[6]  'I completed step 3' still belongs to the LLM")

    # Phase 3.2B-2 asserts this advances. The resolver must NOT
    # override it in either direction: "step 3" names a step
    # number, not the instruction's own words, so it defers.

    check(
        "[6] the resolver defers on 'I completed step 3'",
        resolve_step_completion("I completed step 3", AMOUNT_STEP) is None,
        resolve_step_completion("I completed step 3", AMOUNT_STEP),
    )
    check(
        "[6] and on the compound form",
        resolve_step_completion(
            "I completed step 3. What should I do next?", AMOUNT_STEP
        ) is None,
    )

    fake, dialogue, conversation = at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("workflow_action", "complete", step_completed=True)
    response = turn(pipeline, "I completed step 3")

    check(
        "[6] the LLM's completion still advances it",
        conversation.current_step == 4,
        conversation.current_step,
    )
    check(
        "[6] and returns the next instruction",
        SIGN_STEP in response,
        response,
    )

    # The same sentence with the model declining must NOT advance.
    fake, dialogue, conversation = at_amount_step()
    fake.set("workflow_action", "none", step_completed=False)

    dialogue.generate_response(conversation, "I completed step 3")

    check(
        "[6] and the LLM declining still does not advance it",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_bare_done_still_defers():
    section("[6]  A bare 'done' still belongs to the LLM")

    # manager.py excludes "yes" and "done" from the deterministic
    # acknowledgement table on purpose: either can be evidence of
    # completion, and that judgement belongs to dialogue
    # understanding. The resolver must honour the same rule.

    for text in ("done", "yes", "Yes, next.", "twenty thousand",
                 "it is uhh", "something unparseable"):

        check(
            f"[6] resolver defers on {text!r}",
            resolve_step_completion(text, AMOUNT_STEP) is None,
            resolve_step_completion(text, AMOUNT_STEP),
        )

    fake, dialogue, conversation = at_amount_step()
    fake.set("workflow_action", "complete", step_completed=True)

    dialogue.generate_response(conversation, "done")

    check(
        "[6] 'done' advances when the LLM says so",
        conversation.current_step == 4,
        conversation.current_step,
    )

    fake, dialogue, conversation = at_amount_step()
    fake.set("acknowledgement", "none", step_completed=False)

    dialogue.generate_response(conversation, "done")

    check(
        "[6] and does not when it does not",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_llm_fallback_still_cannot_advance():
    section("[6]  The safe fallback still never advances")

    fake, dialogue, conversation = at_amount_step()
    fake.next_result = fallback_understanding()

    dialogue.generate_response(conversation, "something unparseable")

    check(
        "[6] the safe fallback never advances a step",
        conversation.current_step == 3,
        conversation.current_step,
    )

    # A missing step_completed key behaves as before.
    fake, dialogue, conversation = at_amount_step()
    fake.next_result = {
        "type": "question",
        "action": "none",
        "entities": entities(),
    }

    dialogue.generate_response(conversation, "where do I sign?")

    check(
        "[6] an absent step_completed key does not advance",
        conversation.current_step == 3,
        conversation.current_step,
    )


# =========================================================
# [7]  COMPOUND COMPLETION + QUESTION
# =========================================================

def test_compound_completion_and_question():
    section("[7]  Completion plus a question, in one message")

    fake, dialogue, conversation = at_amount_step()

    # The model loses the completion; the resolver recovers it
    # from clause one, even though the message ends in "?".
    fake.set("question", "none", step_completed=False)

    response = dialogue.generate_response(
        conversation,
        "I entered the amount. Where should I submit the slip?"
    )

    check(
        "[7] advanced EXACTLY once (3 -> 4)",
        conversation.current_step == 4,
        conversation.current_step,
    )
    check(
        "[7] the question was actually answered",
        fake.answer_calls == 1,
        fake.answer_calls,
    )
    check(
        "[7] the answer reaches the customer",
        fake.answer in response,
        response,
    )
    check(
        "[7] the NEW step is also stated",
        SIGN_STEP in response,
        response,
    )
    check(
        "[7] the question was answered against the NEW step",
        fake.calls[-1]["current_instruction"] == SIGN_STEP,
        fake.calls[-1]["current_instruction"],
    )

    # Completion plus a request for direction.
    fake, dialogue, conversation = at_account_number_step()
    fake.set("workflow_action", "next_step", step_completed=False)

    response = dialogue.generate_response(
        conversation,
        "Yes, I completed by filling my account number. "
        "Next what should I do?"
    )

    check(
        "[7] completion + next_step advances exactly once",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[7] and the next instruction IS the answer",
        response == AMOUNT_STEP,
        response,
    )

    # Clause splitting is what makes both of the above work.
    check(
        "[7] clause split keeps the completion clause separate",
        split_clauses(
            "I entered the amount. Where should I submit the slip?"
        ) == ["i entered the amount.", "where should i submit the slip?"],
        split_clauses(
            "I entered the amount. Where should I submit the slip?"
        ),
    )
    check(
        "[7] and splits on a connective too",
        split_clauses("I filled it but what is next?")
        == ["i filled it", "what is next?"],
        split_clauses("I filled it but what is next?"),
    )


# =========================================================
# [8]  CONTROL PRIORITY IS PRESERVED
# =========================================================

def test_control_still_outranks_completion():
    section("[8]  cancel / pause / repeat still outrank completion")

    # Cancel (branch 7) runs before completion (branch 9).
    fake, dialogue, conversation = at_account_number_step()
    fake.set("control", "cancel", step_completed=True)

    dialogue.generate_response(conversation, "I filled it, actually cancel")

    check(
        "[8] cancel outranks completion",
        conversation.workflow_state is WorkflowState.CANCELLED,
        conversation.workflow_state,
    )
    check(
        "[8] a cancelled workflow did not also advance",
        conversation.current_step == 2,
        conversation.current_step,
    )

    # Pause (branch 8B) runs before completion.
    fake, dialogue, conversation = at_amount_step()
    fake.set("control", "none", step_completed=True)

    response = dialogue.generate_response(
        conversation,
        "I entered it, but please hold on for a moment"
    )

    check(
        "[8] the pause was honoured",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[8] the step did NOT advance past the pause",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[8] the reply confirms the pause",
        "paused" in response.lower(),
        response,
    )

    # Repeat (branch 8) runs before completion.
    fake, dialogue, conversation = at_amount_step()
    fake.set("workflow_action", "repeat", step_completed=True)

    response = dialogue.generate_response(conversation, "repeat, I filled it")

    check(
        "[8] repeat outranks completion",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[8] and repeats the current instruction",
        response == AMOUNT_STEP,
        response,
    )


def test_deterministic_control_unchanged():
    section("[8]  The deterministic tier is byte-identical")

    # Requirement: classify_turn() must be untouched. Every
    # utterance in this phase falls through it, and every control
    # phrase still classifies exactly as before.

    for text in (
        "I have filled in my account number.",
        "I have entered 5000 rupees.",
        "The amount is entered.",
        "I completed the account number.",
    ) + NEGATIVE_UTTERANCES:

        check(
            f"[8] classify_turn stays None: {text!r}",
            classify_turn(text) is None,
            classify_turn(text),
        )

    for text, expected in (
        ("exit", "session_exit"),
        ("Exit.", "session_exit"),
        ("pause", "pause"),
        ("can you please pause for a moment", "pause"),
        ("resume", "resume"),
        ("cancel", "cancel"),
        ("never mind", "cancel"),
        ("repeat", "repeat"),
        ("can you please repeat that", "repeat"),
        ("next", "next"),
        ("thank you", "thanks"),
        ("okay", "acknowledgement"),
        ("done", None),
        ("yes", None),
    ):
        check(
            f"[8] classify_turn({text!r}) == {expected!r}",
            classify_turn(text) == expected,
            classify_turn(text),
        )

    check(
        "[8] step references still classify",
        classify_turn("repeat step 4") == StepReference(4, None),
        classify_turn("repeat step 4"),
    )
    check(
        "[8] cross-workflow step references still classify",
        classify_turn("tell me step 4 of the deposit process")
        == StepReference(4, "the deposit process"),
        classify_turn("tell me step 4 of the deposit process"),
    )
    check(
        "[8] a completion statement still vetoes a step reference",
        classify_turn("I have completed step 4") is None,
        classify_turn("I have completed step 4"),
    )
    check(
        "[8] restate_current_step is unchanged",
        restate_current_step(AMOUNT_STEP)
        == f"{AMOUNT_STEP} Let me know when you've completed it.",
        restate_current_step(AMOUNT_STEP),
    )


def test_acknowledgement_and_next_step_unchanged():
    section("[8]  Acknowledgement / next_step branches unchanged")

    fake, dialogue, conversation = at_amount_step()
    fake.set("acknowledgement", "none", step_completed=False)

    response = dialogue.generate_response(conversation, "I need to fill this.")

    check(
        "[8] an intention restates the step",
        AMOUNT_STEP in response,
        response,
    )
    check(
        "[8] and does not advance it",
        conversation.current_step == 3,
        conversation.current_step,
    )

    fake, dialogue, conversation = at_amount_step()
    fake.set("workflow_action", "next_step", step_completed=False)

    response = dialogue.generate_response(conversation, "What should I do next?")

    check(
        "[8] next_step restates the current instruction",
        response == restate_current_step(AMOUNT_STEP),
        response,
    )
    check(
        "[8] and does not advance",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_suspended_completion_still_resumes():
    section("[8]  Completion still resumes a SUSPENDED workflow")

    fake, dialogue, conversation = at_account_number_step()
    conversation.suspend_workflow()

    check(
        "[8] precondition: suspended",
        conversation.workflow_state is WorkflowState.SUSPENDED,
    )

    observed_live_reply(fake)

    dialogue.generate_response(
        conversation,
        "I have filled in my account number."
    )

    check(
        "[8] a resolver-confirmed completion resumes the workflow",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[8] and advances exactly one step",
        conversation.current_step == 3,
        conversation.current_step,
    )


# =========================================================
# [9]  SINGLE ADVANCE / WORKFLOW COMPLETION
# =========================================================

def test_advances_exactly_once():
    section("[9]  One completion advances exactly one step")

    for text, start, instruction in (
        ("I have filled in my account number.", 2, ACCOUNT_NUMBER_STEP),
        ("The amount is entered.", 3, AMOUNT_STEP),
        ("I signed the withdrawal slip.", 4, SIGN_STEP),
    ):
        fake, dialogue, conversation = withdraw_at(start)
        observed_live_reply(fake)

        dialogue.generate_response(conversation, text)

        check(
            f"[9] advanced by exactly 1: {text!r}",
            conversation.current_step == start + 1,
            (start, conversation.current_step),
        )

    # Completing the LAST step completes the workflow.
    fake, dialogue, conversation = withdraw_at(5)
    observed_live_reply(fake)

    response = dialogue.generate_response(
        conversation,
        "I submitted the slip to the cashier."
    )

    check(
        "[9] the final step completes the workflow",
        conversation.workflow_state is WorkflowState.COMPLETED,
        conversation.workflow_state,
    )
    check(
        "[9] and says so",
        response == "Workflow Completed.",
        response,
    )


def test_walks_a_whole_workflow_naturally():
    section("[9]  A whole withdrawal in natural completion forms")

    fake, dialogue, conversation = withdraw_at(1)

    spoken = [
        "I have taken the withdrawal slip.",
        "I have filled in my account number.",
        "I have entered 5000 rupees.",
        "The slip is signed.",
        "I submitted it to the cashier.",
    ]

    for index, text in enumerate(spoken, start=1):

        # The model declines on every single turn.
        observed_live_reply(fake)

        dialogue.generate_response(conversation, text)

        expected = min(index + 1, len(WITHDRAW_STEPS) + 1)

        check(
            f"[9] turn {index} advanced to {expected}: {text!r}",
            conversation.current_step == expected,
            conversation.current_step,
        )

    check(
        "[9] the whole withdrawal completed without the LLM's help",
        conversation.workflow_state is WorkflowState.COMPLETED,
        conversation.workflow_state,
    )


# =========================================================
# [10]  RESOLVER UNIT TRUTH TABLE
#
# Includes every completion text the EXISTING suites drive, at
# its own step, so a future edit to the vocabulary cannot
# silently regress a prior phase.
# =========================================================

TRUTH_TABLE = (
    # --- the four reported failures ---
    ("I have filled in my account number.", ACCOUNT_NUMBER_STEP, True),
    ("I have entered 5000 rupees.", AMOUNT_STEP, True),
    ("The amount is entered.", AMOUNT_STEP, True),
    ("I completed the account number.", ACCOUNT_NUMBER_STEP, True),

    # --- cross-step: defer, never confirm, never veto ---
    ("I have entered 5000 rupees.", ACCOUNT_NUMBER_STEP, None),
    ("I have filled in my account number.", AMOUNT_STEP, None),
    ("I signed the withdrawal slip.", AMOUNT_STEP, None),

    # --- the six negatives, at both relevant steps ---
    ("Can you spell 5000 rupees?", AMOUNT_STEP, False),
    ("Can you spell 5000 rupees?", ACCOUNT_NUMBER_STEP, False),
    ("Spell it letter by letter.", AMOUNT_STEP, False),
    ("Spell it letter by letter.", ACCOUNT_NUMBER_STEP, False),
    ("What should I do next?", AMOUNT_STEP, False),
    ("What should I do next?", ACCOUNT_NUMBER_STEP, False),
    ("Can you explain how to fill this?", ACCOUNT_NUMBER_STEP, False),
    ("Can you explain how to fill this?", AMOUNT_STEP, False),
    ("I need to fill this.", ACCOUNT_NUMBER_STEP, False),
    ("I need to fill this.", AMOUNT_STEP, False),
    ("I'll fill this.", ACCOUNT_NUMBER_STEP, False),
    ("I'll fill this.", AMOUNT_STEP, False),

    # --- more spelling / wording requests (Phase 3.1 [C]) ---
    ("Can you spell 20000 rupees?", AMOUNT_STEP, False),
    ("Can you say the exact spelling?", AMOUNT_STEP, False),
    ("Spell it like T-W-E-N-T-Y-R-U-P-E-E-S.", AMOUNT_STEP, False),
    ("How do I write twenty thousand?", AMOUNT_STEP, False),
    ("What is the word for 20000?", AMOUNT_STEP, False),
    ("Spell 20000 rupees.", AMOUNT_STEP, False),
    ("Spell it again.", AMOUNT_STEP, False),
    ("Where should I submit the slip?", AMOUNT_STEP, False),
    ("where do I sign?", ACCOUNT_NUMBER_STEP, False),
    ("why is this needed?", AMOUNT_STEP, False),

    # --- intentions (Phase 3.1 [F]) ---
    ("I need to fill this", ACCOUNT_NUMBER_STEP, False),
    ("I'll fill it", ACCOUNT_NUMBER_STEP, False),
    ("let me do it", ACCOUNT_NUMBER_STEP, False),
    ("I am filling it", ACCOUNT_NUMBER_STEP, False),
    ("I will take the slip", SLIP_STEP, False),

    # --- negation ---
    ("I haven't filled it", ACCOUNT_NUMBER_STEP, False),
    ("I did not fill it", ACCOUNT_NUMBER_STEP, False),
    ("I have not entered the amount", AMOUNT_STEP, False),

    # --- every completion text the existing suites drive ---
    ("I took the slip", SLIP_STEP, True),
    ("I filled the account number", ACCOUNT_NUMBER_STEP, True),
    ("I filled my account number", ACCOUNT_NUMBER_STEP, True),
    ("I filled it", ACCOUNT_NUMBER_STEP, True),
    ("I entered the amount", AMOUNT_STEP, True),
    ("Yes, I entered the amount.", AMOUNT_STEP, True),
    ("I submitted it", SUBMIT_STEP, True),
    ("I did it", AMOUNT_STEP, True),
    ("I did that", AMOUNT_STEP, True),
    ("I completed it", AMOUNT_STEP, True),
    ("I completed this step. What should I do next?", AMOUNT_STEP, True),
    ("I entered the amount. Where should I submit the slip?",
     AMOUNT_STEP, True),
    ("Yes, I completed by filling my account number. "
     "Next what should I do?", ACCOUNT_NUMBER_STEP, True),

    # --- deferred: the LLM keeps these, exactly as before ---
    ("I completed step 3", AMOUNT_STEP, None),
    ("I completed step 3. What should I do next?", AMOUNT_STEP, None),
    ("I have completed step 4", AMOUNT_STEP, None),
    ("done", AMOUNT_STEP, None),
    ("yes", AMOUNT_STEP, None),
    ("Yes, next.", AMOUNT_STEP, None),
    ("twenty thousand", AMOUNT_STEP, None),
    ("it is uhh", AMOUNT_STEP, None),
    ("something unparseable", AMOUNT_STEP, None),
    ("", AMOUNT_STEP, None),
    ("I filled it", "", None),
    ("I filled it", None, None),
)


def test_resolver_truth_table():
    section("[10]  resolve_step_completion() truth table")

    for text, instruction, expected in TRUTH_TABLE:

        result = resolve_step_completion(text, instruction)

        check(
            f"[10] {str(expected):5} <- {text[:44]!r} @ "
            f"{(instruction or '-')[:24]!r}",
            result is expected,
            result,
        )


def test_clause_classification_unit():
    section("[10]  classify_clause() -- the four gates")

    for clause, expected in (
        ("i filled it", REPORT),
        ("i have filled in my account number", REPORT),
        ("the amount is entered", REPORT),
        ("i completed the account number", REPORT),
        ("yes, i entered the amount", REPORT),

        ("what should i do next?", NOT_A_REPORT),
        ("can you spell 5000 rupees?", NOT_A_REPORT),
        ("spell it letter by letter", NOT_A_REPORT),
        ("explain this to me", NOT_A_REPORT),
        ("where do i sign?", NOT_A_REPORT),
        ("i need to fill this", NOT_A_REPORT),
        ("i'll fill this", NOT_A_REPORT),
        ("let me do it", NOT_A_REPORT),
        ("i am filling it", NOT_A_REPORT),
        ("i haven't filled it", NOT_A_REPORT),
        ("i did not fill it", NOT_A_REPORT),

        ("done", UNDECIDED),
        ("twenty thousand", UNDECIDED),
        ("it is uhh", UNDECIDED),
        ("i had to fill it and i filled it", UNDECIDED),
    ):
        check(
            f"[10] classify_clause({clause!r}) == {expected}",
            classify_clause(clause) == expected,
            classify_clause(clause),
        )


def test_step_relevance_unit():
    section("[10]  refers_to_current_step() -- Gate 3")

    for clause, instruction, expected in (
        # bare / anaphoric objects refer to the current step
        ("i filled it", AMOUNT_STEP, True),
        ("i did that", ACCOUNT_NUMBER_STEP, True),
        ("i completed this step", AMOUNT_STEP, True),
        ("i submitted it", SUBMIT_STEP, True),
        # named objects must overlap the instruction
        ("i have filled in my account number",
         ACCOUNT_NUMBER_STEP, True),
        ("i have entered 5000 rupees", AMOUNT_STEP, True),
        ("the amount is entered", AMOUNT_STEP, True),
        ("i took the slip", SLIP_STEP, True),
        # and must NOT match a different step
        ("i have entered 5000 rupees", ACCOUNT_NUMBER_STEP, False),
        ("i have filled in my account number", AMOUNT_STEP, False),
        ("i signed the withdrawal slip", AMOUNT_STEP, False),
        ("i completed step 3", AMOUNT_STEP, False),
    ):
        result = refers_to_current_step(clause, instruction)

        check(
            f"[10] {clause[:38]!r} @ {instruction[:22]!r} -> {expected}",
            result is expected,
            result,
        )

    # A real banking noun is never treated as a bare reference:
    # that is what makes the step the authority.
    check(
        "[10] 'slip' is not an anaphor",
        refers_to_current_step("i signed the slip", AMOUNT_STEP)
        is False,
    )


# =========================================================
# [11]  NON-VACUITY
#
# With the resolver neutralised at runtime -- every call returning
# None, which IS the pre-phase behaviour -- the four headline
# cases must fail. If they still pass, this suite proves nothing.
# =========================================================

def test_non_vacuity():
    section("[11]  Without the resolver, the four cases fail again")

    original = manager_module.resolve_step_completion

    regressions = 0

    try:

        manager_module.resolve_step_completion = (
            lambda text, current_instruction: None
        )

        for text, start, ents in (
            ("I have filled in my account number.", 2, {}),
            ("I have entered 5000 rupees.", 3, {"amount": 5000}),
            ("The amount is entered.", 3, {}),
            ("I completed the account number.", 2, {}),
        ):
            fake, dialogue, conversation = withdraw_at(start)
            observed_live_reply(fake, **ents)

            response = dialogue.generate_response(conversation, text)

            stuck = conversation.current_step == start

            if stuck:
                regressions += 1

            check(
                f"[11] regresses without the resolver: {text!r}",
                stuck,
                (conversation.current_step, response),
            )

    finally:

        manager_module.resolve_step_completion = original

    check(
        "[11] all four headline cases are genuinely resolver-driven",
        regressions == 4,
        regressions,
    )

    # And the resolver is reached on the real path: with it
    # restored, the same case advances again.
    fake, dialogue, conversation = withdraw_at(2)
    observed_live_reply(fake)

    dialogue.generate_response(
        conversation,
        "I have filled in my account number."
    )

    check(
        "[11] and pass with it restored",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_resolver_is_pure():
    section("[11]  The resolver holds no state")

    # No module-level mutable state: the same call must give the
    # same answer regardless of what ran before it, and nothing
    # about a conversation may leak into it.

    first = resolve_step_completion("I filled it", ACCOUNT_NUMBER_STEP)

    for _ in range(5):
        resolve_step_completion("Can you spell 5000 rupees?", AMOUNT_STEP)
        resolve_step_completion("I completed step 3", AMOUNT_STEP)

    check(
        "[11] repeated calls are identical",
        resolve_step_completion("I filled it", ACCOUNT_NUMBER_STEP) is first,
    )

    import app.dialogue.completion_semantics as module

    mutable = [
        name
        for name, value in vars(module).items()
        if not name.startswith("__")
        and isinstance(value, (list, dict, set, bytearray))
    ]

    check(
        "[11] the module exposes no mutable module-level state",
        mutable == [],
        mutable,
    )


# =========================================================
# MAIN
# =========================================================

def main():
    test_the_four_reported_failures()
    test_completion_and_entity_are_independent()
    test_negative_cases_never_complete()
    test_spelling_records_no_entity()
    test_current_step_authority()
    test_veto_beats_a_wrong_llm_true()
    test_step_reference_completion_still_defers()
    test_bare_done_still_defers()
    test_llm_fallback_still_cannot_advance()
    test_compound_completion_and_question()
    test_control_still_outranks_completion()
    test_deterministic_control_unchanged()
    test_acknowledgement_and_next_step_unchanged()
    test_suspended_completion_still_resumes()
    test_advances_exactly_once()
    test_walks_a_whole_workflow_naturally()
    test_resolver_truth_table()
    test_clause_classification_unit()
    test_step_relevance_unit()
    test_non_vacuity()
    test_resolver_is_pure()

    print()
    print("=" * 62)
    print("SUMMARY")
    print("=" * 62)
    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print("  -", failure)
        print()
        print("  Phase 3.2B-4 has failures.")
        return 1

    print()
    print("  All Phase 3.2B-4 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
