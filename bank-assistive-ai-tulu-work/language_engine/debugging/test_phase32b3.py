"""
Phase 3.2B-3 regression tests -- bounded recent side-question
context.

THE GAP THIS CLOSES

Mid-workflow, a customer asks a side question and follows it up
with a pronoun:

    "Spell 20000 rupees."        -> "Twenty thousand rupees."
    "Spell it letter by letter."

The follow-up reached the question-answering layer as the bare
string "Spell it letter by letter." Nothing downstream knew what
"it" was, and the RAG query was that same useless string, so
retrieval ran against an unrelated document set. Verified before
the fix: answer_question() received the question with no context
of any kind, and ConversationManager had nowhere to hold it.

WHAT IS AND IS NOT BUILT

Exactly ONE exchange is retained, in ONE slot on the
ConversationManager. There is no history list, no vector store,
no database, no profile and no general coreference model. The
bound is structural -- RecentSideQuestion is a single immutable
value in a single attribute -- so there is no container that
could grow.

THE INVARIANTS UNDER TEST

    A side question, with or without context, NEVER changes
    workflow state.

Asserted as a whole-state snapshot comparison, in every workflow
state. Also asserted: the slot holds at most one exchange, two
conversations cannot see each other's context, and no module-level
mutable context exists.

Runs entirely offline: no microphone, no Groq calls, no model
downloads. The question answerer and IntentDetector are injected;
the DialogueManager, ConversationManager, the context module and
the pipeline routing under test are real.

Run from language_engine/:

    python -m debugging.test_phase32b3
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue.manager import DialogueManager, StepReference, classify_turn
from app.dialogue.llm.dialogue_understanding import (
    EMPTY_ENTITIES,
    QUESTION_UNAVAILABLE_MESSAGE,
    fallback_understanding,
)
from app.dialogue import side_question_context as ctx
from app.dialogue.side_question_context import (
    RecentSideQuestion,
    accepts_recent_context,
    extract_subject,
    format_recent_context,
    next_context,
    refers_to_recent_context,
    retrieval_query,
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


def attr(obj, name, default=None):
    """
    Safe field access on a possibly-absent context.

    Used so that removing the context mechanism produces a CLEAN
    list of failures instead of an AttributeError that aborts the
    whole suite -- which is what the non-vacuity check needs.
    """

    if obj is None:
        return default

    return getattr(obj, name, default)


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
    Stands in for DialogueUnderstanding, WITH the optional
    `recent_context` parameter -- i.e. a current collaborator.

    Every call is recorded, so the tests can assert on the context
    that production code actually passed. `replies` lets a test
    script distinct answers per turn.
    """

    def __init__(self):
        self.next_result = fallback_understanding()
        self.calls = []
        self.understand_calls = 0
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
        self.calls.append({
            "question": question,
            "recent_context": recent_context,
            "current_instruction": current_instruction,
        })

        if self.replies:
            return self.replies.pop(0)

        return self.answer

    # Convenience accessors
    @property
    def last_context(self):
        return self.calls[-1]["recent_context"] if self.calls else None

    @property
    def contexts(self):
        return [call["recent_context"] for call in self.calls]


class LegacyAnswerer(RecordingAnswerer):
    """
    A collaborator written BEFORE this phase: answer_question()
    has the original three-argument signature and would raise
    TypeError if handed `recent_context`.

    Five existing suites inject exactly this shape, so production
    code must keep working against it.
    """

    def answer_question(self, question, workflow_context,
                        current_instruction):
        self.calls.append({
            "question": question,
            "recent_context": None,
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
    """Everything a side question must leave untouched."""

    return (
        conversation.workflow_state,
        conversation.current_workflow,
        conversation.current_intent,
        conversation.current_step,
        dict(conversation.entities),
    )


# =========================================================
# WORKFLOW STAGING
# =========================================================

WITHDRAW_AMOUNT_STEP = "Enter the withdrawal amount."
DEPOSIT_SLIP_STEP = "Please take a deposit slip."


def withdraw_at_amount_step(answerer=None):
    """Withdrawal, ACTIVE, on step 3 (the amount step)."""

    fake = answerer if answerer is not None else RecordingAnswerer()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "withdraw money")

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I took the slip")
    dialogue.generate_response(conversation, "I filled my account number")

    assert conversation.current_step == 3, conversation.current_step

    fake.set("question", "none")
    fake.calls.clear()

    return fake, dialogue, conversation


def suspended_withdraw(answerer=None):
    fake, dialogue, conversation = withdraw_at_amount_step(answerer)
    dialogue.handle_control_command(conversation, "pause")
    assert conversation.workflow_state is WorkflowState.SUSPENDED
    return fake, dialogue, conversation


def completed_deposit(answerer=None):
    fake = answerer if answerer is not None else RecordingAnswerer()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")
    fake.set("workflow_action", "complete", step_completed=True)

    for _ in range(12):
        dialogue.generate_response(conversation, "I did that")
        if conversation.workflow_state is WorkflowState.COMPLETED:
            break

    assert conversation.workflow_state is WorkflowState.COMPLETED

    fake.set("question", "none")
    fake.calls.clear()

    return fake, dialogue, conversation


def cancelled_deposit(answerer=None):
    fake = answerer if answerer is not None else RecordingAnswerer()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")
    dialogue.handle_control_command(conversation, "cancel")
    dialogue.handle_control_command(conversation, "cancel")   # confirmed

    assert conversation.workflow_state is WorkflowState.CANCELLED

    fake.set("question", "none")
    fake.calls.clear()

    return fake, dialogue, conversation


# =========================================================
# [1]  A SIDE QUESTION STORES CONTEXT
# =========================================================

def test_side_question_stores_context():
    section("[1]  A side question stores the exchange")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Twenty thousand rupees."]

    check(
        "[1] nothing is remembered before the first question",
        conversation.recent_side_question is None,
        conversation.recent_side_question,
    )

    dialogue.generate_response(conversation, "Spell 20000 rupees.")

    stored = conversation.recent_side_question

    check(
        "[1] the exchange is now remembered",
        isinstance(stored, RecentSideQuestion),
        stored,
    )
    check(
        "[1] the question was stored verbatim",
        attr(stored, "question") == "Spell 20000 rupees.",
        stored,
    )
    check(
        "[1] the answer was stored verbatim",
        attr(stored, "answer") == "Twenty thousand rupees.",
        stored,
    )
    check(
        "[1] the subject was extracted",
        attr(stored, "subject") == "20000 rupees",
        stored,
    )
    check(
        "[1] the FIRST question received no context",
        fake.calls[0]["recent_context"] is None,
        fake.calls[0],
    )


def test_failed_answer_is_not_remembered():
    section("[1]  A failed answer is not remembered")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = [QUESTION_UNAVAILABLE_MESSAGE]

    dialogue.generate_response(conversation, "Spell 20000 rupees.")

    check(
        "[1] the unavailable message is NOT stored as a referent",
        conversation.recent_side_question is None,
        conversation.recent_side_question,
    )


# =========================================================
# [2-6]  REFERENCE RESOLUTION
# =========================================================

def _context_for_followup(followup, first="Spell 20000 rupees.",
                          first_answer="Twenty thousand rupees."):
    """
    Asks `first`, then `followup`, and returns the context that
    production code passed on the SECOND call.
    """

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = [first_answer, "FOLLOW-UP ANSWER"]

    dialogue.generate_response(conversation, first)
    dialogue.generate_response(conversation, followup)

    return fake, conversation, fake.calls[-1]["recent_context"]


def test_it_resolves():
    section('[2]  "it" resolves to the previous side question')

    fake, conversation, passed = _context_for_followup(
        "Spell it letter by letter."
    )

    check(
        "[2] context was passed to the answerer",
        passed is not None,
        passed,
    )
    check(
        "[2] it carries the previous question",
        attr(passed, "question") == "Spell 20000 rupees.",
        passed,
    )
    check(
        "[2] it carries the previous answer",
        attr(passed, "answer") == "Twenty thousand rupees.",
        passed,
    )
    check(
        "[2] it names the referent",
        attr(passed, "subject") == "20000 rupees",
        passed,
    )


def test_this_resolves():
    section('[3]  "this" resolves when safe')

    fake, conversation, passed = _context_for_followup(
        "What does this mean?",
        first="What's a cheque book?",
        first_answer="A cheque book contains cheque leaves.",
    )

    check(
        "[3] context was passed",
        passed is not None and attr(passed, "subject") == "a cheque book",
        passed,
    )
    check(
        "[3] the previous answer travelled with it",
        "cheque leaves" in attr(passed, "answer", ""),
        passed,
    )


def test_that_resolves():
    section('[4]  "that" resolves when safe')

    fake, conversation, passed = _context_for_followup(
        "Can you explain that?",
        first="What is an account number?",
        first_answer="An account number identifies your account.",
    )

    check(
        "[4] context was passed",
        passed is not None and attr(passed, "subject") == "an account number",
        passed,
    )


def test_the_amount_preserved():
    section('[5]  "the amount" preserves amount context')

    fake, conversation, passed = _context_for_followup(
        "Spell the amount please."
    )

    check(
        "[5] the amount context was passed",
        passed is not None and attr(passed, "subject") == "20000 rupees",
        passed,
    )
    check(
        "[5] 'the amount' is recognised as a reference",
        refers_to_recent_context("Spell the amount please.") is True,
    )


def test_the_number_preserved():
    section('[6]  "the number" preserves number context')

    fake, conversation, passed = _context_for_followup(
        "Read out the number again.",
        first="What is my account number 12345?",
        first_answer="Your account number is 12345.",
    )

    check(
        "[6] context was passed for 'the number'",
        passed is not None,
        passed,
    )
    check(
        "[6] 'the number' is recognised as a reference",
        refers_to_recent_context("Read out the number again.") is True,
    )
    check(
        "[6] 'this number' is recognised too",
        refers_to_recent_context("spell this number") is True,
    )


def test_non_referential_question_gets_context_but_own_subject():
    section("[6]  A question naming its own subject replaces it")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Twenty thousand rupees.", "A cheque book is..."]

    dialogue.generate_response(conversation, "Spell 20000 rupees.")
    dialogue.generate_response(conversation, "What is a cheque book?")

    check(
        "[6] the new subject replaced the old one",
        attr(conversation.recent_side_question, "subject") == "a cheque book",
        conversation.recent_side_question,
    )
    check(
        "[6] retrieval is NOT augmented for a non-referential question",
        retrieval_query(
            "What is a cheque book?",
            RecentSideQuestion("Spell 20000 rupees.",
                              "Twenty thousand rupees.", "20000 rupees")
        ) == "What is a cheque book?",
    )


# =========================================================
# [7-11]  SPELLING FOLLOW-UP + WORKFLOW PRESERVATION
# =========================================================

def test_spelling_followup_exact_regression():
    section("[7]  EXACT REGRESSION: spelling follow-up")

    # ACTIVE withdrawal, amount step.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot(conversation)

    fake.replies = ["Twenty thousand rupees.", "T-W-E-N-T-Y T-H-O-U-S-A-N-D"]

    first = turn(pipeline, "Spell 20000 rupees.")
    second = turn(pipeline, "Spell it letter by letter.")

    check(
        "[7] the first answer came back",
        first == "Twenty thousand rupees.",
        first,
    )
    check(
        "[7] the follow-up was answered",
        second == "T-W-E-N-T-Y T-H-O-U-S-A-N-D",
        second,
    )
    check(
        "[7] the follow-up resolved to the SAME amount",
        attr(fake.calls[-1]["recent_context"], "subject") == "20000 rupees",
        fake.calls[-1]["recent_context"],
    )
    check(
        "[7] same workflow",
        conversation.current_workflow == "withdraw money",
        conversation.current_workflow,
    )
    check(
        "[7] same step (3)",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[7] no workflow advancement -- whole state unchanged",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )
    check(
        "[7] IntentDetector was NOT called",
        detector.calls == [],
        detector.calls,
    )
    check(
        "[7] the current step travelled with the follow-up",
        fake.calls[-1]["current_instruction"] == WITHDRAW_AMOUNT_STEP,
        fake.calls[-1],
    )


def test_spelling_followup_does_not_advance():
    section("[8]  A spelling follow-up does not advance")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Twenty thousand rupees.", "T-W-E-N-T-Y", "T-W-E-N-T-Y"]

    before = snapshot(conversation)

    for text in ("Spell 20000 rupees.",
                 "Spell it letter by letter.",
                 "Spell it again."):
        dialogue.generate_response(conversation, text)
        check(
            f"[8] {text!r} left the step at 3",
            conversation.current_step == 3,
            conversation.current_step,
        )

    check(
        "[8] the whole state is unchanged after three side questions",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )


def test_spelling_followup_does_not_complete():
    section("[9]  A spelling follow-up does not complete the step")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Twenty thousand rupees.", "T-W-E-N-T-Y"]

    dialogue.generate_response(conversation, "Spell 20000 rupees.")
    dialogue.generate_response(conversation, "Spell it letter by letter.")

    check(
        "[9] the workflow was not completed",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[9] no entity was recorded from a question",
        conversation.entities == {},
        conversation.entities,
    )
    check(
        "[9] the step was not marked done",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_current_step_unchanged_and_active_stays_active():
    section("[10-11]  current_step unchanged, ACTIVE stays ACTIVE")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot(conversation)

    for text in ("Spell 20000 rupees.", "Spell it letter by letter.",
                 "What does this mean?", "Can you explain that?"):
        turn(pipeline, text)

    check(
        "[10] current_step is still 3",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[11] the workflow is still ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[11] the whole state is unchanged",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )
    check(
        "[11] IntentDetector never called",
        detector.calls == [],
        detector.calls,
    )


# =========================================================
# [12-14]  OTHER WORKFLOW STATES
# =========================================================

def test_suspended_stays_suspended():
    section("[12]  SUSPENDED stays SUSPENDED")

    fake, dialogue, conversation = suspended_withdraw()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot(conversation)
    fake.replies = ["Twenty thousand rupees.", "T-W-E-N-T-Y"]

    turn(pipeline, "Spell 20000 rupees.")
    turn(pipeline, "Spell it letter by letter.")

    check(
        "[12] still SUSPENDED -- a side question does not resume",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[12] the whole state is unchanged",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )
    check(
        "[12] the follow-up still resolved the referent",
        attr(fake.calls[-1]["recent_context"], "subject") == "20000 rupees",
        fake.calls[-1]["recent_context"],
    )
    check(
        "[12] IntentDetector never called",
        detector.calls == [],
        detector.calls,
    )


def test_completed_and_cancelled_unchanged():
    section("[13-14]  COMPLETED / CANCELLED stay unchanged")

    for label, stage, expected in (
        ("[13]", completed_deposit, WorkflowState.COMPLETED),
        ("[14]", cancelled_deposit, WorkflowState.CANCELLED),
    ):
        fake, dialogue, conversation = stage()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        before = snapshot(conversation)

        for text in ("Spell 20000 rupees.", "Spell it letter by letter."):
            turn(pipeline, text)

        check(
            f"{label} state is still {expected.name}",
            conversation.workflow_state is expected,
            conversation.workflow_state,
        )
        check(
            f"{label} the whole state is unchanged",
            snapshot(conversation) == before,
            (before, snapshot(conversation)),
        )
        check(
            f"{label} no new workflow was started",
            conversation.current_workflow == "deposit money",
            conversation.current_workflow,
        )


# =========================================================
# [15-17]  BOUNDEDNESS AND INVALIDATION
# =========================================================

def test_only_one_exchange_retained():
    section("[15]  Only ONE exchange is ever retained")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = [f"ANSWER {n}" for n in range(1, 6)]

    questions = [
        "What is a cheque book?",
        "What is a passbook?",
        "What is a deposit slip?",
        "What is an account number?",
        "What is a withdrawal slip?",
    ]

    for question in questions:
        dialogue.generate_response(conversation, question)

    stored = conversation.recent_side_question

    check(
        "[15] the slot holds a single exchange, not a list",
        isinstance(stored, RecentSideQuestion),
        type(stored),
    )
    check(
        "[15] it holds the LATEST question only",
        attr(stored, "question") == questions[-1],
        stored,
    )
    check(
        "[15] it holds the LATEST answer only",
        attr(stored, "answer") == "ANSWER 5",
        stored,
    )
    check(
        "[15] no earlier question is reachable from the slot",
        not any(
            earlier in repr(stored)
            for earlier in questions[:-1]
        ),
        stored,
    )
    check(
        "[15] the context passed on turn 5 was turn 4's exchange only",
        fake.calls[-1]["recent_context"] is None
        or fake.calls[-1]["recent_context"].question == questions[-2],
        fake.calls[-1]["recent_context"],
    )

    # The type itself cannot accumulate: three fields, all scalars.
    check(
        "[15] RecentSideQuestion has exactly three fields",
        RecentSideQuestion._fields == ("question", "answer", "subject"),
        RecentSideQuestion._fields,
    )


def test_new_relevant_question_replaces_context():
    section("[16]  A new relevant question replaces the context")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Twenty thousand rupees.", "A cheque book is...",
                    "FOLLOW-UP"]

    dialogue.generate_response(conversation, "Spell 20000 rupees.")
    check(
        "[16] subject is the amount",
        attr(conversation.recent_side_question, "subject") == "20000 rupees",
    )

    dialogue.generate_response(conversation, "What is a cheque book?")
    check(
        "[16] the subject was REPLACED, not appended",
        attr(conversation.recent_side_question, "subject") == "a cheque book",
        conversation.recent_side_question,
    )

    # A follow-up now resolves against the cheque book, not the
    # amount.
    dialogue.generate_response(conversation, "What does this mean?")
    check(
        "[16] the follow-up resolved to the NEW subject",
        attr(fake.calls[-1]["recent_context"], "subject") == "a cheque book",
        fake.calls[-1]["recent_context"],
    )


def test_new_workflow_clears_context():
    section("[17]  A new workflow does not inherit old context")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Two thousand rupees."]

    dialogue.generate_response(conversation, "Spell 2000 rupees.")

    check(
        "[17] context exists before the new workflow",
        conversation.recent_side_question is not None,
    )

    # "I want to withdraw money" -> a new workflow is started.
    dialogue.start_workflow(conversation, "deposit money")

    check(
        "[17] starting a workflow cleared the context",
        conversation.recent_side_question is None,
        conversation.recent_side_question,
    )

    # A later question therefore gets no stale referent.
    fake.replies = ["ANSWER"]
    dialogue.generate_response(conversation, "What does this mean?")

    check(
        "[17] the question after the new workflow got no stale context",
        fake.calls[-1]["recent_context"] is None,
        fake.calls[-1]["recent_context"],
    )

    # release_workflow and start_conversation clear it too.
    conversation.remember_side_question(
        RecentSideQuestion("q", "a", "s")
    )
    conversation.release_workflow()
    check(
        "[17] release_workflow clears the context",
        conversation.recent_side_question is None,
    )

    conversation.remember_side_question(
        RecentSideQuestion("q", "a", "s")
    )
    conversation.start_conversation()
    check(
        "[17] start_conversation clears the context",
        conversation.recent_side_question is None,
    )


def test_controls_do_not_clear_context():
    section("[17]  Controls keep the customer on task, so keep context")

    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Twenty thousand rupees."]

    dialogue.generate_response(conversation, "Spell 20000 rupees.")
    stored = conversation.recent_side_question

    for command in ("pause", "resume", "repeat"):
        dialogue.handle_control_command(conversation, command)

    check(
        "[17] pause/resume/repeat left the context intact",
        conversation.recent_side_question == stored,
        conversation.recent_side_question,
    )

    dialogue.handle_control_command(
        conversation, StepReference(step_number=4)
    )

    check(
        "[17] a step reference left the context intact",
        conversation.recent_side_question == stored,
        conversation.recent_side_question,
    )


# =========================================================
# [18-20]  EARLIER-PHASE BEHAVIOUR PRESERVED
# =========================================================

def test_pause_resume_intact():
    section("[18]  Pause / resume behaviour is intact")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.replies = ["Twenty thousand rupees."]
    turn(pipeline, "Spell 20000 rupees.")

    response = turn(pipeline, "pause")
    check(
        "[18] pause still suspends",
        conversation.workflow_state is WorkflowState.SUSPENDED
        and "paused" in response.lower(),
        (conversation.workflow_state, response),
    )

    response = turn(pipeline, "resume")
    check(
        "[18] resume still returns to the exact step",
        conversation.workflow_state is WorkflowState.ACTIVE
        and conversation.current_step == 3
        and WITHDRAW_AMOUNT_STEP in response,
        (conversation.workflow_state, conversation.current_step, response),
    )
    check(
        "[18] IntentDetector never called",
        detector.calls == [],
        detector.calls,
    )


def test_acknowledgement_intact():
    section("[19]  Acknowledgement behaviour is intact")

    # The Phase 3.2B-1 regression: spelling -> "Thank you."
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.replies = ["Two thousand rupees."]
    turn(pipeline, "Spell 2000 rupees.")

    understand_before = fake.understand_calls
    answer_calls_before = len(fake.calls)

    response = turn(pipeline, "Thank you.")

    check(
        "[19] the acknowledgement restates the exact step",
        WITHDRAW_AMOUNT_STEP in response,
        response,
    )
    check(
        "[19] it did not advance",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[19] still ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[19] no LLM understanding call",
        fake.understand_calls == understand_before,
        (understand_before, fake.understand_calls),
    )
    check(
        "[19] no question-answering call",
        len(fake.calls) == answer_calls_before,
        (answer_calls_before, len(fake.calls)),
    )
    check(
        "[19] IntentDetector not called",
        detector.calls == [],
        detector.calls,
    )
    check(
        "[19] the side context survived the acknowledgement",
        conversation.recent_side_question is not None,
        conversation.recent_side_question,
    )

    # SUSPENDED
    fake, dialogue, conversation = suspended_withdraw()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    response = turn(pipeline, "Thank you.")
    check(
        "[19] SUSPENDED acknowledgement does not resume",
        conversation.workflow_state is WorkflowState.SUSPENDED
        and "paused" in response.lower(),
        (conversation.workflow_state, response),
    )

    # COMPLETED / CANCELLED
    for stage, expected in (
        (completed_deposit, WorkflowState.COMPLETED),
        (cancelled_deposit, WorkflowState.CANCELLED),
    ):
        fake, dialogue, conversation = stage()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        turn(pipeline, "Thank you.")

        check(
            f"[19] {expected.name} acknowledgement starts nothing",
            conversation.workflow_state is expected
            and conversation.current_workflow == "deposit money"
            and detector.calls == [],
            (conversation.workflow_state, conversation.current_workflow,
             detector.calls),
        )


def test_step_reference_intact():
    section("[20]  Step-reference behaviour is intact")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.replies = ["Twenty thousand rupees."]
    turn(pipeline, "Spell 20000 rupees.")

    before = snapshot(conversation)
    answer_calls_before = len(fake.calls)

    response = turn(pipeline, "Step 4")

    check(
        "[20] the step was read from the definition",
        "Sign the withdrawal slip." in response,
        response,
    )
    check(
        "[20] a step reference did NOT go through question answering",
        len(fake.calls) == answer_calls_before,
        (answer_calls_before, len(fake.calls)),
    )
    check(
        "[20] nothing changed",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )
    check(
        "[20] IntentDetector not called",
        detector.calls == [],
        detector.calls,
    )
    check(
        "[20] step references are still their own classification",
        isinstance(classify_turn("step 4"), StepReference),
        classify_turn("step 4"),
    )
    check(
        "[20] and controls are still theirs",
        classify_turn("pause") == "pause"
        and classify_turn("repeat") == "repeat",
    )


# =========================================================
# [21]  AMBIGUITY -- NO INVENTED REFERENT
# =========================================================

def test_ambiguous_reference_invents_nothing():
    section("[21]  An unresolvable reference invents nothing")

    # "it" with NO preceding side question.
    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["I'm not sure which amount you mean."]

    dialogue.generate_response(conversation, "Spell it letter by letter.")

    check(
        "[21] no context was fabricated",
        fake.calls[-1]["recent_context"] is None,
        fake.calls[-1]["recent_context"],
    )
    check(
        "[21] the question reached the answerer unchanged",
        fake.calls[-1]["question"] == "Spell it letter by letter.",
        fake.calls[-1],
    )
    check(
        "[21] retrieval was not augmented with an invented subject",
        retrieval_query("Spell it letter by letter.", None)
        == "Spell it letter by letter.",
    )

    # A stored exchange with NO subject must not invent one.
    stored = next_context(None, "What does this mean?", "It means...")
    check(
        "[21] a subject-less question stores subject=None",
        attr(stored, "subject") is None,
        stored,
    )
    check(
        "[21] retrieval is not augmented without a subject",
        retrieval_query("Spell it.", stored) == "Spell it.",
    )

    # A vague reference phrase is not frozen in as a subject.
    check(
        "[21] 'the amount' alone is not stored as a subject",
        extract_subject("explain the amount") is None,
        extract_subject("explain the amount"),
    )


# =========================================================
# [22-23]  MULTI-SESSION ISOLATION
# =========================================================

def test_no_module_level_context():
    section("[22]  No module-level mutable context exists")

    # A module global holding context would be shared by every
    # conversation in the process.
    suspicious = [
        name for name in dir(ctx)
        if not name.startswith("_")
        and isinstance(getattr(ctx, name), (list, dict, set, bytearray))
    ]

    check(
        "[22] the context module holds no mutable containers",
        suspicious == [],
        suspicious,
    )

    for name in ("RECENT_CONTEXT", "recent_context",
                 "CONTEXT", "LAST_QUESTION", "_CACHE"):
        check(
            f"[22] no module global named {name!r}",
            not hasattr(ctx, name),
        )

    check(
        "[22] the context value is immutable (a NamedTuple)",
        issubclass(RecentSideQuestion, tuple),
    )

    # DialogueManager must not hold the context either -- it takes
    # `conversation` in every method and may serve many sessions.
    fake, dialogue, conversation = withdraw_at_amount_step()
    fake.replies = ["Twenty thousand rupees."]
    dialogue.generate_response(conversation, "Spell 20000 rupees.")

    manager_state = [
        name for name in vars(dialogue)
        if "side_question" in name or "recent_context" in name
    ]

    check(
        "[22] DialogueManager stores no side-question context",
        manager_state == [],
        manager_state,
    )
    check(
        "[22] the conversation is the one holding it",
        conversation.recent_side_question is not None,
    )


def test_two_conversations_are_isolated():
    section("[23]  Two conversations cannot share context")

    # ONE DialogueManager, TWO conversations -- the exact shape
    # that would leak if context lived on the manager.
    fake = RecordingAnswerer()
    dialogue = make_dialogue(fake)

    first = fresh_conversation()
    second = fresh_conversation()

    dialogue.start_workflow(first, "withdraw money")
    dialogue.start_workflow(second, "deposit money")

    fake.set("question", "none")

    fake.replies = ["Twenty thousand rupees."]
    dialogue.generate_response(first, "Spell 20000 rupees.")

    check(
        "[23] conversation A remembered its exchange",
        first.recent_side_question is not None
        and attr(first.recent_side_question, "subject") == "20000 rupees",
        first.recent_side_question,
    )
    check(
        "[23] conversation B remembered NOTHING",
        second.recent_side_question is None,
        second.recent_side_question,
    )

    # B now asks a follow-up. It must get NO context from A.
    fake.replies = ["ANSWER FOR B"]
    dialogue.generate_response(second, "Spell it letter by letter.")

    check(
        "[23] B's follow-up received no context from A",
        fake.calls[-1]["recent_context"] is None,
        fake.calls[-1]["recent_context"],
    )
    check(
        "[23] A's context is still intact and untouched",
        attr(first.recent_side_question, "subject") == "20000 rupees",
        first.recent_side_question,
    )

    # And B's own exchange does not appear in A.
    check(
        "[23] B's exchange did not leak into A",
        attr(first.recent_side_question, "question") == "Spell 20000 rupees.",
        first.recent_side_question,
    )


# =========================================================
# [24-25]  RAG AND BACKWARD COMPATIBILITY
# =========================================================

def test_rag_behaviour_preserved():
    section("[24]  Existing RAG behaviour is preserved")

    stored = RecentSideQuestion(
        "Spell 20000 rupees.", "Twenty thousand rupees.", "20000 rupees"
    )

    # Augmented ONLY when there is a reference AND a subject.
    check(
        "[24] a referential question augments the query",
        retrieval_query("Spell it letter by letter.", stored)
        == "Spell it letter by letter. 20000 rupees",
        retrieval_query("Spell it letter by letter.", stored),
    )

    for question in (
        "What is a cheque book?",
        "What documents are needed?",
        "How do I open an account?",
        "Tell me about education loans",
    ):
        check(
            f"[24] {question!r} query is unchanged",
            retrieval_query(question, stored) == question,
            retrieval_query(question, stored),
        )

    check(
        "[24] no context -> query unchanged",
        retrieval_query("Spell it letter by letter.", None)
        == "Spell it letter by letter.",
    )
    check(
        "[24] a subject already in the question is not repeated",
        retrieval_query("Spell 20000 rupees again.", stored)
        == "Spell 20000 rupees again.",
        retrieval_query("Spell 20000 rupees again.", stored),
    )

    # An empty context renders to nothing, so the prompt is
    # unchanged for every non-referential question.
    check(
        "[24] no context renders no prompt section",
        format_recent_context(None) == "",
    )
    check(
        "[24] a real context renders the bounded block",
        "Customer asked:" in format_recent_context(stored)
        and "That question was about: 20000 rupees"
        in format_recent_context(stored),
        format_recent_context(stored),
    )
    check(
        "[24] a long remembered answer is truncated",
        len(format_recent_context(
            RecentSideQuestion("q", "x" * 5000, "s")
        )) < 1000,
    )


def test_context_is_optional_for_old_callers():
    section("[25]  Context is optional; old collaborators work")

    check(
        "[25] a legacy 3-arg answerer is detected as not accepting it",
        accepts_recent_context(
            LegacyAnswerer().answer_question
        ) is False,
    )
    check(
        "[25] a current answerer is detected as accepting it",
        accepts_recent_context(
            RecordingAnswerer().answer_question
        ) is True,
    )

    def kwargs_answerer(question, workflow_context,
                        current_instruction, **kw):
        return "ok"

    check(
        "[25] a **kwargs answerer is treated as accepting it",
        accepts_recent_context(kwargs_answerer) is True,
    )
    check(
        "[25] an unreadable callable degrades to False",
        accepts_recent_context(None) is False,
    )

    # End to end against a LEGACY answerer: the whole chain must
    # still work, just without context.
    legacy = LegacyAnswerer()
    fake, dialogue, conversation = withdraw_at_amount_step(legacy)

    legacy.replies = ["Twenty thousand rupees.", "T-W-E-N-T-Y"]

    before = snapshot(conversation)

    first = dialogue.generate_response(conversation, "Spell 20000 rupees.")
    second = dialogue.generate_response(
        conversation, "Spell it letter by letter."
    )

    check(
        "[25] a legacy answerer still answers the first question",
        first == "Twenty thousand rupees.",
        first,
    )
    check(
        "[25] a legacy answerer still answers the follow-up",
        second == "T-W-E-N-T-Y",
        second,
    )
    check(
        "[25] no TypeError -- the keyword was not passed",
        len(legacy.calls) == 2,
        legacy.calls,
    )
    check(
        "[25] the workflow is still untouched",
        snapshot(conversation) == before,
        (before, snapshot(conversation)),
    )
    check(
        "[25] the exchange is still remembered for later",
        conversation.recent_side_question is not None,
        conversation.recent_side_question,
    )

    # A conversation object without the new methods must not crash
    # the dialogue layer either.
    class BareConversation:
        workflow_state = WorkflowState.ACTIVE
        current_workflow = "withdraw money"
        current_intent = "withdraw money"
        current_step = 3
        entities = {}

    bare = BareConversation()
    answerer = RecordingAnswerer()
    manager = make_dialogue(answerer)

    workflow = WorkflowLoader().load_workflow("withdraw money")

    response = manager.handle_question(
        bare, workflow, WITHDRAW_AMOUNT_STEP, "What is this?", {}
    )

    check(
        "[25] a conversation without the slot still answers",
        response == answerer.answer,
        response,
    )


def test_context_module_units():
    section("[25]  Context module units")

    for text, expected in (
        ("Spell it letter by letter.", True),
        ("What does this mean?", True),
        ("Can you explain that?", True),
        ("spell the amount", True),
        ("read the number", True),
        ("that word again", True),
        ("What is a cheque book?", False),
        ("Spell 20000 rupees.", False),
        ("How do I open an account?", False),
        ("", False),
    ):
        check(
            f"[25] refers_to_recent_context({text!r}) -> {expected}",
            refers_to_recent_context(text) is expected,
            refers_to_recent_context(text),
        )

    for text, expected in (
        ("Spell 20000 rupees.", "20000 rupees"),
        ("What is an account number?", "an account number"),
        ("What's a cheque book?", "a cheque book"),
        ("Tell me about education loans", "education loans"),
        ("Spell it letter by letter.", None),
        ("What does this mean?", None),
        ("Can you explain that?", None),
        ("", None),
    ):
        check(
            f"[25] extract_subject({text!r}) -> {expected!r}",
            extract_subject(text) == expected,
            extract_subject(text),
        )

    # The chain: subject carried forward, then replaced.
    stored = None
    for question, answer, expected in (
        ("Spell 20000 rupees.", "Twenty thousand.", "20000 rupees"),
        ("Spell it letter by letter.", "T-W-E-N-T-Y", "20000 rupees"),
        ("Spell it again.", "T-W-E-N-T-Y", "20000 rupees"),
        ("What is a cheque book?", "A cheque book...", "a cheque book"),
        ("What does this mean?", "It means...", "a cheque book"),
    ):
        stored = next_context(stored, question, answer)
        check(
            f"[25] after {question!r} subject={expected!r}",
            attr(stored, "subject") == expected,
            stored,
        )


# =========================================================
# RUN
# =========================================================

def main():
    test_side_question_stores_context()
    test_failed_answer_is_not_remembered()

    test_it_resolves()
    test_this_resolves()
    test_that_resolves()
    test_the_amount_preserved()
    test_the_number_preserved()
    test_non_referential_question_gets_context_but_own_subject()

    test_spelling_followup_exact_regression()
    test_spelling_followup_does_not_advance()
    test_spelling_followup_does_not_complete()
    test_current_step_unchanged_and_active_stays_active()

    test_suspended_stays_suspended()
    test_completed_and_cancelled_unchanged()

    test_only_one_exchange_retained()
    test_new_relevant_question_replaces_context()
    test_new_workflow_clears_context()
    test_controls_do_not_clear_context()

    test_pause_resume_intact()
    test_acknowledgement_intact()
    test_step_reference_intact()

    test_ambiguous_reference_invents_nothing()

    test_no_module_level_context()
    test_two_conversations_are_isolated()

    test_rag_behaviour_preserved()
    test_context_is_optional_for_old_callers()
    test_context_module_units()

    section("SUMMARY")

    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED  {failure}")
        return 1

    print()
    print("  All Phase 3.2B-3 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
