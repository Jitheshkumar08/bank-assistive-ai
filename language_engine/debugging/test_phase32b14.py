"""
PHASE 3.2B-14 -- ACTIVE WORKFLOW INTERRUPTION & INTENT RE-EVALUATION

THE LIVE FAILURE THIS SUITE IS BUILT AROUND

    "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು"   -> deposit ACTIVE
    assistant                -> "Please take a deposit slip."
    "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು"     -> a withdrawal request, transcribed correctly
    assistant                -> "Please take a deposit slip."   <-- the defect

The utterance went through workflow-action understanding (type=workflow_action,
action=none, step_completed=false) because a workflow was already active, so
intent detection was never consulted and the deposit step was simply restated.

THE INVARIANT THIS SUITE EXISTS FOR

    A workflow in progress is NEVER switched, cancelled, paused or advanced
    because the customer mentioned a different banking service. The only thing
    that may happen on its own is a QUESTION.

Every state-changing case below therefore asserts BOTH the reply and the
workflow state on both sides of the transition.

Offline: no microphone, no ASR, no network, no LLM (the understanding client is
stubbed). The embedding model is local and is used by the real-detector section,
exactly as the Phase 3.2B-12 suite does.

Run from language_engine/:
    python -m debugging.test_phase32b14
"""
import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import PausedWorkflow, WorkflowState
from app.dialogue.llm.dialogue_understanding import fallback_understanding
from app.dialogue.manager import (
    DialogueManager,
    classify_command,
    looks_like_a_question,
)
from app.dialogue.term_normalizer import normalize_banking_terms
from app.dialogue.workflow_conflict import (
    CHOICE_CANCEL,
    CHOICE_CONTINUE,
    CHOICE_PAUSE,
    CONFLICT_CONTROL_CHOICES,
    WorkflowConflict,
    conflict_question,
    display_name,
    resolve_conflict_answer,
    same_workflow,
)
from app.intent.detector import IntentDetector
from app.workflow.loader import WorkflowLoader


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

    `set()` scripts the next classification. The default is the live failure's
    own classification -- workflow_action / none / not completed -- because
    that is the turn this phase had to stop mishandling.
    """

    def __init__(self):
        self.next_result = {
            "type": "workflow_action",
            "action": "none",
            "step_completed": False,
            "target_workflow": None,
            "entities": entities(),
        }
        self.understand_calls = 0
        self.answer_calls = 0
        self.questions = []
        self.answer = "ANSWERED-FROM-KNOWLEDGE-BASE"

    def set(self, message_type, action="none", step_completed=False,
            target_workflow=None, **ents):
        self.next_result = {
            "type": message_type,
            "action": action,
            "step_completed": step_completed,
            "target_workflow": target_workflow,
            "entities": entities(**ents),
        }

    def fail(self):
        self.next_result = fallback_understanding()

    def understand(self, user_text, current_workflow=None,
                   current_step=None, current_instruction=None):
        self.understand_calls += 1
        return self.next_result

    def answer_question(self, question, workflow_context,
                        current_instruction, recent_context=None):
        self.answer_calls += 1
        self.questions.append(question)
        return self.answer


class ScriptedDetector:
    """Stands in for IntentDetector, returning the SAME result shape.

    `table` maps an utterance to (intent, is_banking_intent). Anything not in
    the table gets `default`, which is a NON-banking answer, so a test has to
    say explicitly that an utterance is a service request.
    """

    def __init__(self, table=None, default=("withdraw money", False)):
        self.table = dict(table or {})
        self.default = default
        self.calls = []

    def detect_intent(self, text):
        self.calls.append(text)
        intent, banking = self.table.get(text, self.default)
        return {
            "intent": intent,
            "confidence": 0.9 if banking else 0.1,
            "category": "BANKING_INTENT" if banking else "KNOWLEDGE_QUESTION",
            "is_banking_intent": banking,
            "anchor_category": "KNOWLEDGE_QUESTION",
            "anchor_confidence": 0.1,
            "margin": 0.25 if banking else -0.1,
            "scores": {},
            "anchor_scores": {},
        }


class LegacyDetector:
    """A detector from before abstention existed: no is_banking_intent key."""

    def __init__(self):
        self.calls = []

    def detect_intent(self, text):
        self.calls.append(text)
        return {"intent": "withdraw money", "confidence": 0.104}


def make_dialogue(understanding=None, detector=None):
    """A DialogueManager without the real LLM client.

    Same pattern as every offline suite here: __init__ builds a Groq client and
    needs GROQ_API_KEY, which an offline suite must not require.
    """
    manager = object.__new__(DialogueManager)
    manager.workflow_loader = WorkflowLoader()
    manager.dialogue_understanding = understanding or FakeUnderstanding()
    manager.intent_detector = detector
    return manager


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
    """One real pipeline turn, including the session-exit gate in run()."""

    user_input = normalize_banking_terms(text)
    control = pipeline.dialogue.detect_control(user_input)

    if control == "session_exit":
        return "SESSION_EXIT"

    return pipeline._respond(control, user_input)


def active_workflow(intent, step=1, **ents):
    """A conversation with `intent` loaded and ACTIVE.

    Set up exactly as DialogueManager.start_workflow() does it: the workflow
    SLOT holds the canonical intent name, which the loader resolves to the JSON.
    """
    conversation = ConversationManager()
    conversation.start_conversation()
    conversation.set_intent(intent)
    conversation.load_workflow(intent)
    conversation.current_step = step
    conversation.add_entities(ents)
    return conversation


def snapshot_state(conversation):
    """Everything a conflict must not be able to move."""
    return (
        conversation.workflow_state,
        conversation.current_intent,
        conversation.current_workflow,
        conversation.current_step,
        dict(conversation.entities),
    )


def pending(conversation):
    return getattr(conversation, "workflow_conflict", None)


# =========================================================
# 1  THE CONFLICT MODULE, AS UNITS
# =========================================================

def test_conflict_module_units():
    section("The conflict module (units)")

    # --- spoken names -------------------------------------------------
    check("deposit money -> 'deposit'",
          display_name("deposit money") == "deposit")
    check("withdraw money -> 'withdrawal'",
          display_name("withdraw money") == "withdrawal")
    check("apply for loan -> 'loan application'",
          display_name("apply for loan") == "loan application")
    check("an unknown identity falls back to itself, not to a guess",
          display_name("send money abroad") == "send money abroad")
    check("an empty identity is never spoken as a workflow name",
          display_name(None) == "request")

    # --- identity comparison -----------------------------------------
    check("same_workflow is whitespace and case insensitive",
          same_workflow("Deposit  Money", "deposit money"))
    check("different workflows are not the same",
          not same_workflow("deposit money", "withdraw money"))
    check("None is not the same as a workflow",
          not same_workflow(None, "deposit money"))

    # --- the question -------------------------------------------------
    question = conflict_question(
        WorkflowConflict("deposit money", "withdraw money")
    )
    check("the question names the request in progress",
          "deposit in progress" in question, question)
    check("the question offers cancel-and-start",
          "cancel the deposit and start a withdrawal" in question, question)
    check("the question offers pause-and-start",
          "pause the deposit and start a withdrawal" in question, question)
    check("the question offers continue",
          "continue with the deposit" in question, question)
    check("the question is a question",
          question.rstrip().endswith("?"), question)

    paused_question = conflict_question(
        WorkflowConflict("deposit money", "withdraw money"),
        paused=True
    )
    check("a paused request is not offered a pause",
          "pause the deposit and start" not in paused_question,
          paused_question)
    check("a paused request is described as paused",
          "currently paused" in paused_question, paused_question)

    # --- free-text answers -------------------------------------------
    for text, expected in (
        ("cancel it and withdraw", CHOICE_CANCEL),
        ("cancel the deposit", CHOICE_CANCEL),
        ("stop the deposit and withdraw instead", CHOICE_CANCEL),
        ("forget the deposit", CHOICE_CANCEL),
        ("pause it and withdraw", CHOICE_PAUSE),
        ("pause the deposit and start withdrawal", CHOICE_PAUSE),
        ("put the deposit on hold and withdraw", CHOICE_PAUSE),
        ("i'll do the deposit later", CHOICE_PAUSE),
        ("continue with the deposit", CHOICE_CONTINUE),
        ("continue the deposit", CHOICE_CONTINUE),
        ("keep going with the deposit", CHOICE_CONTINUE),
        ("carry on with the deposit", CHOICE_CONTINUE),
        ("stay with the deposit", CHOICE_CONTINUE),
        # "continue" is also a connective: an answer that picks another
        # option keeps that option.
        ("cancel the deposit and continue with the withdrawal", CHOICE_CANCEL),
        ("pause the deposit and continue with the withdrawal", CHOICE_PAUSE),
        # Nothing named, or two contradictory options named.
        ("what is a withdrawal slip", None),
        ("hmm", None),
        ("", None),
        ("cancel it, or actually pause it", None),
    ):
        got = resolve_conflict_answer(text)
        check(f"answer {text!r} -> {expected}", got == expected, f"got {got}")

    # Whole-token matching: a word that merely CONTAINS a keyword is not one.
    check("'account holder' does not read as 'hold'",
          resolve_conflict_answer("the account holder is me") is None)
    check("'dropped' is not 'drop'",
          resolve_conflict_answer("i dropped my pen") is None)

    # --- Kannada and Hindi answers -----------------------------------
    for text, expected in (
        ("ಠೇವಣಿ ರದ್ದು ಮಾಡಿ ಹಣ ತೆಗೆಯಿರಿ", CHOICE_CANCEL),
        ("ಠೇವಣಿ ನಿಲ್ಲಿಸಿ ಹಣ ತೆಗೆಯಬೇಕು", CHOICE_CANCEL),
        ("ಠೇವಣಿ ವಿರಾಮ ಮಾಡಿ ಹಣ ತೆಗೆಯಿರಿ", CHOICE_PAUSE),
        ("ಠೇವಣಿಯನ್ನು ಮುಂದುವರಿಸಿ", CHOICE_CONTINUE),
        # Two contradictory options named -> asked again, in any language.
        ("ಠೇವಣಿ ರದ್ದು ಮಾಡಿ ವಿರಾಮ ಮಾಡಿ", None),
        ("जमा रद्द करो और पैसे निकालो", CHOICE_CANCEL),
        ("जमा को रुको और पैसे निकालो", CHOICE_PAUSE),
        ("जमा जारी रखो", CHOICE_CONTINUE),
    ):
        got = resolve_conflict_answer(text)
        check(f"answer {text!r} -> {expected}", got == expected, f"got {got}")

    # --- control words map onto the three options --------------------
    check("the cancel control selects cancel",
          CONFLICT_CONTROL_CHOICES.get("cancel") == CHOICE_CANCEL)
    check("the pause control selects pause",
          CONFLICT_CONTROL_CHOICES.get("pause") == CHOICE_PAUSE)
    check("the resume control selects continue",
          CONFLICT_CONTROL_CHOICES.get("resume") == CHOICE_CONTINUE)
    check("repeat names no option",
          "repeat" not in CONFLICT_CONTROL_CHOICES)
    check("next names no option",
          "next" not in CONFLICT_CONTROL_CHOICES)
    check("no acknowledgement names an option",
          not {"thanks", "acknowledgement"} & set(CONFLICT_CONTROL_CHOICES))

    # The module holds no state.
    check("the resolver is a pure function",
          resolve_conflict_answer("cancel it and withdraw")
          == resolve_conflict_answer("cancel it and withdraw"))


# =========================================================
# 2  A -- ACTIVE DEPOSIT + WITHDRAWAL REQUEST
# =========================================================

def test_a_deposit_then_withdrawal():
    section("A -- active deposit + withdrawal request")

    fake = FakeUnderstanding()
    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    })
    dialogue = make_dialogue(fake, detector)
    conversation = active_workflow("deposit money")
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot_state(conversation)

    reply = turn(pipeline, "I want to withdraw money")

    check("a conflict is detected", pending(conversation) is not None)
    check("the conflict records the request in progress",
          pending(conversation).current_workflow == "deposit money",
          str(pending(conversation)))
    check("the conflict records the requested service",
          pending(conversation).requested_workflow == "withdraw money",
          str(pending(conversation)))

    check("the reply is the clarification",
          reply == conflict_question(
              WorkflowConflict("deposit money", "withdraw money")),
          reply)
    check("the deposit step is NOT repeated",
          DEPOSIT_STEP_1 not in reply, reply)

    check("the deposit is NOT cancelled",
          conversation.workflow_state == WorkflowState.ACTIVE,
          str(conversation.workflow_state))
    check("the withdrawal is NOT started",
          conversation.current_workflow == "deposit money",
          str(conversation.current_workflow))
    check("no state moved at all",
          snapshot_state(conversation) == before,
          str(snapshot_state(conversation)))
    check("nothing was snapshotted -- nothing was paused",
          conversation.paused_workflow is None)


# =========================================================
# 3  B -- ACTIVE WITHDRAWAL + DEPOSIT REQUEST
# =========================================================

def test_b_withdrawal_then_deposit():
    section("B -- active withdrawal + deposit request")

    fake = FakeUnderstanding()
    detector = ScriptedDetector({
        "I want to deposit money": ("deposit money", True),
    })
    dialogue = make_dialogue(fake, detector)
    conversation = active_workflow("withdraw money", step=3)
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot_state(conversation)

    reply = turn(pipeline, "I want to deposit money")

    check("a conflict is detected", pending(conversation) is not None)
    check("the reply names the withdrawal in progress",
          "withdrawal in progress" in reply, reply)
    check("the reply offers to start a deposit",
          "start a deposit" in reply, reply)
    check("the withdrawal is NOT cancelled",
          conversation.workflow_state == WorkflowState.ACTIVE)
    check("the deposit is NOT started",
          conversation.current_workflow == "withdraw money")
    check("the step is not moved",
          conversation.current_step == 3, str(conversation.current_step))
    check("no state moved at all", snapshot_state(conversation) == before)


# =========================================================
# 4  C -- THE CUSTOMER CHOOSES CANCEL
# =========================================================

def test_c_choose_cancel():
    section("C -- cancel the current request, start the new one")

    fake = FakeUnderstanding()
    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    })
    dialogue = make_dialogue(fake, detector)
    conversation = active_workflow("deposit money", step=2, amount=5000)
    pipeline = make_pipeline(dialogue, detector, conversation)

    turn(pipeline, "I want to withdraw money")
    calls_before = fake.understand_calls

    reply = turn(pipeline, "cancel it and withdraw")

    check("the withdrawal is now the live request",
          conversation.current_workflow == "withdraw money",
          str(conversation.current_workflow))
    check("the intent was switched too",
          conversation.current_intent == "withdraw money",
          str(conversation.current_intent))
    check("the withdrawal is ACTIVE",
          conversation.workflow_state == WorkflowState.ACTIVE,
          str(conversation.workflow_state))
    check("it starts at step 1",
          conversation.current_step == 1, str(conversation.current_step))
    check("the deposit was cancelled, so nothing was kept for it",
          conversation.paused_workflow is None)
    check("the conflict is resolved",
          pending(conversation) is None)

    check("the reply says the deposit was cancelled",
          "cancelled the deposit" in reply, reply)
    check("the reply gives the withdrawal's first step",
          WITHDRAW_STEP_1 in reply, reply)
    check("the deposit's entities did not follow into the withdrawal",
          conversation.entities == {}, str(conversation.entities))
    check("resolving a conflict needs no LLM call",
          fake.understand_calls == calls_before,
          f"{fake.understand_calls} vs {calls_before}")

    # The Kannada equivalent of the same answer.
    kn_detector = ScriptedDetector({
        "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು": ("withdraw money", True),
    })
    kn = active_workflow("deposit money")
    kn_pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), kn_detector), kn_detector, kn
    )
    turn(kn_pipeline, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    turn(kn_pipeline, "ಠೇವಣಿ ರದ್ದು ಮಾಡಿ ಹಣ ತೆಗೆಯಿರಿ")
    check("a Kannada cancel answer starts the withdrawal",
          kn.current_workflow == "withdraw money"
          and kn.workflow_state == WorkflowState.ACTIVE,
          f"{kn.current_workflow} / {kn.workflow_state}")


# =========================================================
# 5  D -- THE CUSTOMER CHOOSES PAUSE
# =========================================================

def test_d_choose_pause():
    section("D -- pause the current request, start the new one")

    fake = FakeUnderstanding()
    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    })
    dialogue = make_dialogue(fake, detector)
    conversation = active_workflow("deposit money", step=3, amount=5000)
    pipeline = make_pipeline(dialogue, detector, conversation)

    turn(pipeline, "I want to withdraw money")

    reply = turn(pipeline, "pause it and withdraw")

    check("the withdrawal is now the live request",
          conversation.current_workflow == "withdraw money",
          str(conversation.current_workflow))
    check("the withdrawal is ACTIVE",
          conversation.workflow_state == WorkflowState.ACTIVE,
          str(conversation.workflow_state))
    check("it starts at step 1", conversation.current_step == 1)
    check("the conflict is resolved", pending(conversation) is None)

    check("the reply says the deposit was paused",
          "paused the deposit" in reply, reply)
    check("the reply gives the withdrawal's first step",
          WITHDRAW_STEP_1 in reply, reply)

    # --- the paused request is RECOVERABLE ---------------------------
    held = conversation.paused_workflow
    check("the deposit was snapshotted",
          isinstance(held, PausedWorkflow), str(held))
    check("the snapshot holds the deposit",
          held.workflow == "deposit money", str(held))
    check("the snapshot holds the step it was on",
          held.step == 3, str(held))
    check("the snapshot holds the entities it had",
          held.entities == {"amount": 5000}, str(held))

    restored = conversation.restore_paused_workflow()
    check("restoring returns the snapshot", restored == held, str(restored))
    check("the deposit is back in the slot",
          conversation.current_workflow == "deposit money")
    check("it comes back SUSPENDED, not ACTIVE",
          conversation.workflow_state == WorkflowState.SUSPENDED,
          str(conversation.workflow_state))
    check("it comes back on the step it left",
          conversation.current_step == 3, str(conversation.current_step))
    check("it comes back with its entities",
          conversation.entities == {"amount": 5000},
          str(conversation.entities))
    check("the snapshot is consumed, not duplicated",
          conversation.paused_workflow is None)
    check("restoring with nothing held returns None",
          conversation.restore_paused_workflow() is None)

    # A snapshot never leaks into another session.
    conversation.stash_paused_workflow()
    conversation.start_conversation()
    check("a new session starts with no paused request",
          conversation.paused_workflow is None)


# =========================================================
# 6  E -- THE CUSTOMER CHOOSES CONTINUE
# =========================================================

def test_e_choose_continue():
    section("E -- continue the current request")

    fake = FakeUnderstanding()
    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    })
    dialogue = make_dialogue(fake, detector)
    conversation = active_workflow("deposit money", step=2, amount=5000)
    pipeline = make_pipeline(dialogue, detector, conversation)

    turn(pipeline, "I want to withdraw money")
    before = snapshot_state(conversation)

    reply = turn(pipeline, "continue with the deposit")

    check("the deposit is still the live request",
          conversation.current_workflow == "deposit money")
    check("the deposit is still ACTIVE",
          conversation.workflow_state == WorkflowState.ACTIVE,
          str(conversation.workflow_state))
    check("the current step is unchanged",
          conversation.current_step == 2, str(conversation.current_step))
    check("the entities are unchanged",
          conversation.entities == {"amount": 5000},
          str(conversation.entities))
    check("nothing moved at all", snapshot_state(conversation) == before)
    check("the conflict is resolved", pending(conversation) is None)
    check("nothing was snapshotted", conversation.paused_workflow is None)

    check("the reply says the deposit continues",
          "continue with the deposit" in reply, reply)
    check("the reply restates the step the customer is on",
          "Fill in your account number." in reply, reply)
    check("the withdrawal was NOT started",
          "withdrawal slip" not in reply, reply)

    # The same choice while the interrupted request was PAUSED resumes it,
    # which is what "continue" means there.
    suspended = active_workflow("deposit money", step=2)
    suspended.suspend_workflow()
    suspended_pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), detector), detector, suspended
    )
    ask = turn(suspended_pipeline, "I want to withdraw money")
    check("a conflict against a paused request says it is paused",
          "currently paused" in ask, ask)
    turn(suspended_pipeline, "continue with the deposit")
    check("continuing a paused request resumes it",
          suspended.workflow_state == WorkflowState.ACTIVE,
          str(suspended.workflow_state))
    check("resuming it does not move the step",
          suspended.current_step == 2, str(suspended.current_step))


# =========================================================
# 7  F -- A KNOWLEDGE QUESTION DURING AN ACTIVE WORKFLOW
# =========================================================

def test_f_knowledge_question_during_workflow():
    section("F -- a knowledge question must not interrupt anything")

    fake = FakeUnderstanding()
    fake.set("question", "explain")
    detector = ScriptedDetector({
        "What is an education loan?": ("apply for loan", True),
    })
    dialogue = make_dialogue(fake, detector)
    conversation = active_workflow("withdraw money", step=2)
    pipeline = make_pipeline(dialogue, detector, conversation)

    before = snapshot_state(conversation)

    reply = turn(pipeline, "What is an education loan?")

    check("the question was answered from the knowledge path",
          reply == "ANSWERED-FROM-KNOWLEDGE-BASE", reply)
    check("the question reached the answerer",
          fake.questions == ["What is an education loan?"],
          str(fake.questions))
    check("no conflict was raised", pending(conversation) is None)
    check("the withdrawal is preserved",
          conversation.workflow_state == WorkflowState.ACTIVE)
    check("the step is unchanged",
          conversation.current_step == 2, str(conversation.current_step))
    check("nothing moved at all", snapshot_state(conversation) == before)
    check("the intent detector was never consulted",
          detector.calls == [], str(detector.calls))

    # The customer can still be told where they were.
    resumed = dialogue.handle_control_command(conversation, "next")
    check("the workflow can still continue after the side question",
          "Fill in your account number." in resumed, resumed)

    # --- THE STRONGER CASE (requirement 5) --------------------------
    # Even if understanding had NOT recognised the question -- the exact
    # classification that caused the live failure -- the question pre-filter
    # still keeps it off the conflict path.
    check("the pre-filter recognises the question",
          looks_like_a_question("What is an education loan?"))

    mislabelled = FakeUnderstanding()          # workflow_action / none
    mis_detector = ScriptedDetector({
        "What is an education loan?": ("apply for loan", True),
    })
    mis_conversation = active_workflow("withdraw money", step=2)
    mis_pipeline = make_pipeline(
        make_dialogue(mislabelled, mis_detector),
        mis_detector,
        mis_conversation
    )
    mis_reply = turn(mis_pipeline, "What is an education loan?")

    check("a mislabelled question still raises no conflict",
          pending(mis_conversation) is None)
    check("a mislabelled question does not switch the workflow",
          mis_conversation.current_workflow == "withdraw money"
          and mis_conversation.workflow_state == WorkflowState.ACTIVE,
          str(mis_conversation.workflow_state))
    check("a mislabelled question keeps the existing safe reply",
          mis_reply == "Fill in your account number.", mis_reply)

    # A question shaped as a service request ("I want to apply for an
    # education loan") is NOT a knowledge question, and does conflict.
    service = FakeUnderstanding()
    service_detector = ScriptedDetector({
        "I want to apply for an education loan": ("apply for loan", True),
    })
    service_conversation = active_workflow("withdraw money")
    service_pipeline = make_pipeline(
        make_dialogue(service, service_detector),
        service_detector,
        service_conversation
    )
    service_reply = turn(
        service_pipeline, "I want to apply for an education loan"
    )
    check("a service request for a loan IS a conflict",
          pending(service_conversation) is not None, service_reply)
    check("the loan conflict is offered as a loan application",
          "loan application" in service_reply, service_reply)
    check("the loan conflict still starts nothing",
          service_conversation.current_workflow == "withdraw money"
          and service_conversation.workflow_state == WorkflowState.ACTIVE)


# =========================================================
# 8  G -- REPEAT DURING A CONFLICT
# =========================================================

def test_g_repeat_during_conflict():
    section("G -- repeat asks the conflict question again")

    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    })
    conversation = active_workflow("deposit money")
    dialogue = make_dialogue(FakeUnderstanding(), detector)
    pipeline = make_pipeline(dialogue, detector, conversation)

    asked = turn(pipeline, "I want to withdraw money")
    before = snapshot_state(conversation)

    for text in ("repeat", "say that again", "ಮತ್ತೆ ಹೇಳಿ", "फिर से बताइए"):
        reply = turn(pipeline, text)
        check(f"{text!r} repeats the conflict question",
              reply == asked, reply)
        check(f"{text!r} changes no state",
              snapshot_state(conversation) == before)
        check(f"{text!r} leaves the conflict pending",
              pending(conversation) is not None)
        check(f"{text!r} does not repeat the deposit step",
              DEPOSIT_STEP_1 not in reply, reply)

    # "next" and an acknowledgement are not answers either.
    for text in ("next", "what's next", "okay", "thank you"):
        reply = turn(pipeline, text)
        check(f"{text!r} asks the conflict question again",
              reply == asked, reply)
        check(f"{text!r} changes no state",
              snapshot_state(conversation) == before)

    # A read-only step reference still works while the question is open.
    step_reply = turn(pipeline, "repeat step 3")
    check("a step reference still reads a step during a conflict",
          "Enter the amount to deposit." in step_reply, step_reply)
    check("reading a step changes no state",
          snapshot_state(conversation) == before)
    check("reading a step leaves the conflict pending",
          pending(conversation) is not None)


# =========================================================
# 9  H -- CANCEL DURING A CONFLICT
# =========================================================

def test_h_cancel_during_conflict():
    section("H -- the cancel control during a conflict")

    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    })
    conversation = active_workflow("deposit money", step=2)
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), detector), detector, conversation
    )

    turn(pipeline, "I want to withdraw money")
    reply = turn(pipeline, "cancel")

    check("the deposit is gone from the slot",
          conversation.current_workflow == "withdraw money",
          str(conversation.current_workflow))
    check("the reply says the deposit was cancelled",
          "cancelled the deposit" in reply, reply)
    check("the conflict is resolved", pending(conversation) is None)
    check("the deposit was not kept",
          conversation.paused_workflow is None)
    check("the chosen service is what starts",
          WITHDRAW_STEP_1 in reply, reply)

    # The Kannada and Hindi cancel words resolve it identically.
    for word in ("ನಿಲ್ಲಿಸು", "ಸಾಕು", "रद्द करो"):
        fresh = active_workflow("deposit money")
        fresh_detector = ScriptedDetector({
            "I want to withdraw money": ("withdraw money", True),
        })
        fresh_pipeline = make_pipeline(
            make_dialogue(FakeUnderstanding(), fresh_detector),
            fresh_detector,
            fresh
        )
        turn(fresh_pipeline, "I want to withdraw money")
        turn(fresh_pipeline, word)
        check(f"{word!r} cancels the deposit and starts the withdrawal",
              fresh.current_workflow == "withdraw money"
              and fresh.workflow_state == WorkflowState.ACTIVE,
              f"{fresh.current_workflow} / {fresh.workflow_state}")

    # The pause control takes the pause option.
    for word in ("pause", "ವಿರಾಮ", "रुको"):
        fresh = active_workflow("deposit money", step=2)
        fresh_detector = ScriptedDetector({
            "I want to withdraw money": ("withdraw money", True),
        })
        fresh_pipeline = make_pipeline(
            make_dialogue(FakeUnderstanding(), fresh_detector),
            fresh_detector,
            fresh
        )
        turn(fresh_pipeline, "I want to withdraw money")
        turn(fresh_pipeline, word)
        check(f"{word!r} pauses the deposit and starts the withdrawal",
              fresh.current_workflow == "withdraw money"
              and fresh.paused_workflow is not None
              and fresh.paused_workflow.step == 2,
              f"{fresh.current_workflow} / {fresh.paused_workflow}")

    # The resume control takes the continue option.
    for word in ("continue", "ಮುಂದುವರಿಸಿ", "जारी रखो"):
        fresh = active_workflow("deposit money", step=2)
        fresh_detector = ScriptedDetector({
            "I want to withdraw money": ("withdraw money", True),
        })
        fresh_pipeline = make_pipeline(
            make_dialogue(FakeUnderstanding(), fresh_detector),
            fresh_detector,
            fresh
        )
        turn(fresh_pipeline, "I want to withdraw money")
        turn(fresh_pipeline, word)
        check(f"{word!r} keeps the deposit exactly where it was",
              fresh.current_workflow == "deposit money"
              and fresh.current_step == 2
              and fresh.workflow_state == WorkflowState.ACTIVE,
              f"{fresh.current_workflow} / {fresh.current_step}")


# =========================================================
# 10  I -- EXIT DURING A CONFLICT
# =========================================================

def test_i_exit_during_conflict():
    section("I -- exit during a conflict ends the session")

    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    })
    conversation = active_workflow("deposit money")
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), detector), detector, conversation
    )

    turn(pipeline, "I want to withdraw money")
    before = snapshot_state(conversation)

    for text in ("exit", "Exit.", "goodbye", "ಹೊರಗೆ", "ಹೊರಗೆ ಬ", "बाहर"):
        check(f"{text!r} is still a session exit",
              classify_command(text) == "session_exit",
              str(classify_command(text)))
        check(f"{text!r} exits even with a conflict pending",
              turn(pipeline, text) == "SESSION_EXIT")

    check("the exit did not move the workflow",
          snapshot_state(conversation) == before)
    check("a conflict never blocks the exit path",
          pending(conversation) is not None)


# =========================================================
# 11  J, K, L -- THE REAL DETECTOR, KANNADA AND ENGLISH
#
# The headline live scenario, end to end through the real routing layer with
# the REAL IntentDetector. Only the LLM is stubbed, and it is stubbed with the
# exact classification the live session produced.
# =========================================================

def test_jkl_real_detector(detector):
    section("J, K, L -- the live scenario with the real intent detector")

    cases = (
        # (in progress, utterance, expected requested service, label)
        ("deposit money", "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು", "withdraw money", "J"),
        ("withdraw money", "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "deposit money", "K"),
        ("deposit money", "I want to withdraw money", "withdraw money", "L"),
        ("withdraw money", "I want to deposit money", "deposit money", "L"),
        ("deposit money", "पैसे निकालने हैं", "withdraw money", "L"),
    )

    for current, utterance, expected, label in cases:

        fake = FakeUnderstanding()          # workflow_action / none, as live
        conversation = active_workflow(current)
        pipeline = make_pipeline(
            make_dialogue(fake, detector), detector, conversation
        )

        before = snapshot_state(conversation)
        reply = turn(pipeline, utterance)

        conflict = pending(conversation)

        check(f"[{label}] {utterance!r} during {current} is a conflict",
              conflict is not None, reply)

        if conflict is not None:
            check(f"[{label}] the requested service is {expected}",
                  conflict.requested_workflow == expected,
                  str(conflict))

        check(f"[{label}] nothing was switched",
              snapshot_state(conversation) == before,
              str(snapshot_state(conversation)))
        check(f"[{label}] the reply is a question",
              reply.rstrip().endswith("?"), reply)

    # --- THE EXACT LIVE SCENARIO -------------------------------------
    section("The exact live scenario (requirement 10)")

    fake = FakeUnderstanding()
    conversation = ConversationManager()
    conversation.start_conversation()
    dialogue = make_dialogue(fake, detector)
    pipeline = make_pipeline(dialogue, detector, conversation)

    # 1. the deposit request
    first = turn(pipeline, "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು")
    check("1. the deposit workflow starts",
          conversation.current_workflow == "deposit money"
          and conversation.workflow_state == WorkflowState.ACTIVE,
          f"{conversation.current_workflow} / {conversation.workflow_state}")
    check("2. the assistant asks for a deposit slip",
          first == DEPOSIT_STEP_1, first)

    # 3. the withdrawal request
    second = turn(pipeline, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    check("3. the assistant does NOT repeat the deposit slip step",
          second != DEPOSIT_STEP_1 and DEPOSIT_STEP_1 not in second, second)
    check("3. the assistant asks a conflict clarification",
          "deposit in progress" in second
          and "cancel the deposit and start a withdrawal" in second
          and "pause the deposit and start a withdrawal" in second
          and "continue with the deposit" in second,
          second)
    check("3. the deposit is still ACTIVE and unmoved",
          conversation.workflow_state == WorkflowState.ACTIVE
          and conversation.current_workflow == "deposit money"
          and conversation.current_step == 1,
          f"{conversation.workflow_state} / {conversation.current_step}")

    # "cancel it and withdraw"
    third = turn(pipeline, "cancel it and withdraw")
    check("'cancel it and withdraw' starts the withdrawal",
          conversation.current_workflow == "withdraw money"
          and conversation.workflow_state == WorkflowState.ACTIVE,
          f"{conversation.current_workflow} / {conversation.workflow_state}")
    check("'cancel it and withdraw' reports the cancellation",
          "cancelled the deposit" in third, third)
    check("'cancel it and withdraw' gives the withdrawal's first step",
          WITHDRAW_STEP_1 in third, third)

    # "pause it and withdraw", from a fresh deposit
    paused_conversation = ConversationManager()
    paused_conversation.start_conversation()
    paused_pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), detector),
        detector,
        paused_conversation
    )
    turn(paused_pipeline, "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು")
    turn(paused_pipeline, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    fourth = turn(paused_pipeline, "pause it and withdraw")

    check("'pause it and withdraw' starts the withdrawal",
          paused_conversation.current_workflow == "withdraw money"
          and paused_conversation.workflow_state == WorkflowState.ACTIVE,
          str(paused_conversation.current_workflow))
    check("'pause it and withdraw' reports the pause",
          "paused the deposit" in fourth, fourth)
    check("'pause it and withdraw' keeps the deposit recoverable",
          paused_conversation.paused_workflow is not None
          and paused_conversation.paused_workflow.workflow == "deposit money",
          str(paused_conversation.paused_workflow))
    check("the recovered deposit comes back SUSPENDED",
          (paused_conversation.restore_paused_workflow() is not None)
          and paused_conversation.workflow_state == WorkflowState.SUSPENDED,
          str(paused_conversation.workflow_state))


def test_real_detector_leaves_in_workflow_turns_alone(detector):
    section("The real detector must not interrupt ordinary in-workflow turns")

    # These are turns the customer makes WHILE doing a deposit. Each one is
    # classified by understanding the way it really is, so each is claimed by
    # an existing branch and must never reach the conflict check.
    cases = (
        ("I have taken the deposit slip", ("workflow_action", "complete", True)),
        ("I filled in my account number", ("information", "provide_information", False)),
        ("done", ("workflow_action", "complete", True)),
        ("let me do it", ("acknowledgement", "none", False)),
        ("I don't have a pen", ("unknown", "none", False)),
        ("where do I submit the slip", ("question", "explain", False)),
        ("what should I do next", ("workflow_action", "next_step", False)),
    )

    for text, (message_type, action, completed) in cases:

        fake = FakeUnderstanding()
        fake.set(message_type, action, step_completed=completed)
        conversation = active_workflow("deposit money", step=2)
        pipeline = make_pipeline(
            make_dialogue(fake, detector), detector, conversation
        )

        turn(pipeline, text)

        check(f"{text!r} raises no conflict",
              pending(conversation) is None)
        check(f"{text!r} keeps the deposit in the slot",
              conversation.current_workflow == "deposit money",
              str(conversation.current_workflow))
        check(f"{text!r} does not start a second workflow",
              conversation.workflow_state in (
                  WorkflowState.ACTIVE, WorkflowState.COMPLETED
              ),
              str(conversation.workflow_state))

    # A bare spoken amount during a deposit is information, not a request to
    # withdraw -- measured: the real detector scores "ಐದು ಸಾವಿರ ರೂಪಾಯಿ" as
    # withdraw money at margin +0.246, so only the branch ordering keeps it
    # off the conflict path.
    for amount_text in ("5000", "five thousand rupees", "ಐದು ಸಾವಿರ ರೂಪಾಯಿ"):
        fake = FakeUnderstanding()
        fake.set("information", "provide_information", amount=5000)
        conversation = active_workflow("deposit money", step=3)
        pipeline = make_pipeline(
            make_dialogue(fake, detector), detector, conversation
        )
        turn(pipeline, amount_text)
        check(f"a spoken amount ({amount_text!r}) raises no conflict",
              pending(conversation) is None)
        check(f"a spoken amount ({amount_text!r}) is recorded, not switched",
              conversation.entities.get("amount") == 5000
              and conversation.current_workflow == "deposit money",
              str(conversation.entities))


# =========================================================
# 12  M -- COMPLETION SEMANTICS ARE UNCHANGED
# =========================================================

def test_m_completion_semantics_unchanged():
    section("M -- existing completion semantics are unchanged")

    detector = ScriptedDetector(default=("withdraw money", True))

    # A completion report advances, even with a detector present that would
    # happily call the utterance a banking intent.
    fake = FakeUnderstanding()
    fake.set("workflow_action", "complete", step_completed=True)
    conversation = active_workflow("deposit money", step=1)
    dialogue = make_dialogue(fake, detector)
    pipeline = make_pipeline(dialogue, detector, conversation)

    reply = turn(pipeline, "I have taken the deposit slip")
    check("a completion still advances the step",
          conversation.current_step == 2, str(conversation.current_step))
    check("the next instruction is still the reply",
          reply == "Fill in your account number.", reply)
    check("a completion raises no conflict", pending(conversation) is None)

    # Deterministic completion resolution still outranks everything new.
    conversation.current_step = 1
    fake.set("information", "provide_information")
    reply = turn(pipeline, "I have taken the deposit slip.")
    check("deterministic completion still advances the step",
          conversation.current_step == 2, str(conversation.current_step))
    check("deterministic completion raises no conflict",
          pending(conversation) is None)

    # Walking a workflow to the end still completes it.
    walk = active_workflow("deposit money", step=1)
    walk_fake = FakeUnderstanding()
    walk_fake.set("workflow_action", "complete", step_completed=True)
    walk_pipeline = make_pipeline(
        make_dialogue(walk_fake, detector), detector, walk
    )
    for _ in range(4):
        last = turn(walk_pipeline, "I have completed it")
    check("the workflow still completes at the last step",
          walk.workflow_state == WorkflowState.COMPLETED,
          str(walk.workflow_state))
    check("completion still reports 'Workflow Completed.'",
          last == "Workflow Completed.", last)
    check("completing raises no conflict", pending(walk) is None)

    # An understanding failure is still reported honestly and still moves
    # nothing -- the conflict check must not become a second guess at it.
    failed = active_workflow("deposit money", step=2)
    failed_fake = FakeUnderstanding()
    failed_fake.fail()
    failed_pipeline = make_pipeline(
        make_dialogue(failed_fake, detector), detector, failed
    )
    reply = turn(failed_pipeline, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    check("a failed understanding still says so",
          reply.startswith("Sorry, I didn't catch that."), reply)
    check("a failed understanding raises no conflict",
          pending(failed) is None)
    check("a failed understanding moves nothing",
          failed.current_step == 2
          and failed.workflow_state == WorkflowState.ACTIVE,
          str(failed.workflow_state))


# =========================================================
# 13  N -- CONTROL BEHAVIOUR IS UNCHANGED
# =========================================================

def test_n_control_behaviour_unchanged():
    section("N -- pause / resume / cancel / repeat / exit are unchanged")

    detector = ScriptedDetector(default=("withdraw money", True))

    # Every one of these runs with a detector attached and NO conflict
    # pending, which is the state the whole existing session spends its life
    # in. Nothing about the replies or the transitions may differ.
    conversation = active_workflow("deposit money", step=2)
    dialogue = make_dialogue(FakeUnderstanding(), detector)

    reply = dialogue.handle_control_command(conversation, "pause")
    check("pause still suspends",
          conversation.workflow_state == WorkflowState.SUSPENDED)
    check("pause still confirms the pause",
          reply == ("Okay, I've paused this request. "
                    "Let me know when you're ready to continue."), reply)

    reply = dialogue.handle_control_command(conversation, "pause")
    check("pausing twice still says it is already paused",
          reply == ("That request is already paused. "
                    "Say resume when you'd like to continue."), reply)

    reply = dialogue.handle_control_command(conversation, "resume")
    check("resume still resumes",
          conversation.workflow_state == WorkflowState.ACTIVE)
    check("resume still states the step",
          reply == "Continuing. Fill in your account number.", reply)

    reply = dialogue.handle_control_command(conversation, "repeat")
    check("repeat still recalls the instruction",
          reply == "Fill in your account number.", reply)

    reply = dialogue.handle_control_command(conversation, "next")
    check("next still restates without skipping",
          reply == ("Fill in your account number. "
                    "Let me know when you've completed it."), reply)
    check("next still does not advance",
          conversation.current_step == 2, str(conversation.current_step))

    reply = dialogue.handle_control_command(conversation, "cancel")
    check("cancel still cancels",
          conversation.workflow_state == WorkflowState.CANCELLED)
    check("cancel still confirms the cancellation",
          reply == ("Okay, I've cancelled that request. "
                    "Let me know if you'd like help with something else."),
          reply)

    # Resting-state controls, and the acknowledgement wording.
    reply = dialogue.handle_control_command(conversation, "pause")
    check("a cancelled request still reports its status",
          "cancelled" in reply.lower(), reply)

    empty = ConversationManager()
    empty.start_conversation()
    check("nothing to cancel is still worded the same",
          dialogue.handle_control_command(empty, "cancel")
          == "There's nothing active to cancel right now.")
    check("nothing to pause is still worded the same",
          dialogue.handle_control_command(empty, "pause")
          == "There's nothing active to pause right now.")
    check("nothing to repeat is still worded the same",
          dialogue.handle_control_command(empty, "repeat")
          == "There's nothing to repeat right now.")

    active = active_workflow("deposit money", step=1)
    check("an acknowledgement still restates the step",
          dialogue.handle_control_command(active, "thanks")
          == ("You're welcome. Please take a deposit slip. "
              "Let me know when you've completed it."))

    # The multilingual control vocabulary is untouched.
    for text, expected in (
        ("ವಿರಾಮ", "pause"), ("ವಿರಾಮಿಸು", "pause"), ("ವಿರಾಮಿಸಿ", "pause"),
        ("ನಿಲ್ಲಿಸು", "cancel"), ("ಸಾಕು", "cancel"),
        ("ಮುಂದುವರಿಸಿ", "resume"), ("ಮುಂದುವರಿಸು", "resume"),
        ("ಮುಂದುವಸು", "resume"),
        ("ಮತ್ತೆ ಹೇಳಿ", "repeat"),
        ("ಹೊರಗೆ ಬ", "session_exit"),
        ("pause", "pause"), ("resume", "resume"), ("continue", "resume"),
        ("cancel", "cancel"), ("stop", "cancel"),
        ("repeat", "repeat"), ("say that again", "repeat"),
        ("next", "next"), ("exit", "session_exit"),
        ("can you please repeat that", "repeat"),
        ("don't cancel", None),
    ):
        got = classify_command(text)
        check(f"classify_command({text!r}) is still {expected}",
              got == expected, f"got {got}")


# =========================================================
# 14  O -- THE SIDE-QUESTION CHANNEL IS UNCHANGED
# =========================================================

def test_o_side_channel_unchanged():
    section("O -- the knowledge-question side channel is unchanged")

    detector = ScriptedDetector(default=("withdraw money", True))
    fake = FakeUnderstanding()
    fake.set("question", "explain")
    dialogue = make_dialogue(fake, detector)
    conversation = active_workflow("withdraw money", step=2)
    pipeline = make_pipeline(dialogue, detector, conversation)

    turn(pipeline, "How do I spell twenty thousand rupees?")
    check("the exchange is still remembered",
          conversation.recent_side_question is not None)
    check("the answerer still received the question",
          fake.questions[-1] == "How do I spell twenty thousand rupees?",
          str(fake.questions))
    check("a side question still does not move the step",
          conversation.current_step == 2)
    check("a side question still leaves the workflow ACTIVE",
          conversation.workflow_state == WorkflowState.ACTIVE)

    # A follow-up reference still carries the remembered subject.
    before = conversation.recent_side_question
    turn(pipeline, "What does that mean?")
    check("a follow-up still replaces the remembered exchange",
          conversation.recent_side_question is not before)
    check("a follow-up still raises no conflict",
          pending(conversation) is None)

    # Starting a workflow still clears the remembered exchange.
    conversation.load_workflow("withdraw money")
    check("loading a workflow still clears the side-question context",
          conversation.recent_side_question is None)


# =========================================================
# 15  P, Q -- NO STATE CORRUPTION, NO DUPLICATE WORKFLOWS
# =========================================================

def test_pq_state_integrity():
    section("P, Q -- state integrity and no duplicate workflows")

    detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
        "I want to apply for a loan": ("apply for loan", True),
    })
    conversation = active_workflow("deposit money", step=2, amount=5000)
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), detector), detector, conversation
    )

    # Naming a THIRD service while the question is open must not stack a
    # second conflict. It is not one of the three options, so it is answered
    # the way any non-answer is: the same question, again, and nothing moves.
    turn(pipeline, "I want to withdraw money")
    first = pending(conversation)
    reply = turn(pipeline, "I want to apply for a loan")
    second = pending(conversation)

    check("there is still exactly one conflict",
          second is not None and isinstance(second, WorkflowConflict),
          str(second))
    check("a third service does not stack a second conflict",
          second is first, str(second))
    check("the open question is unchanged",
          second.current_workflow == "deposit money"
          and second.requested_workflow == "withdraw money",
          str(second))
    check("naming a third service asks the same question again",
          reply == conflict_question(second), reply)
    check("no request started",
          conversation.current_workflow == "deposit money"
          and conversation.workflow_state == WorkflowState.ACTIVE)

    # Resolving it leaves exactly one live workflow.
    turn(pipeline, "cancel it and withdraw")
    check("exactly one workflow is live",
          conversation.current_workflow == "withdraw money",
          str(conversation.current_workflow))
    check("exactly one intent is set",
          conversation.current_intent == "withdraw money",
          str(conversation.current_intent))
    check("the workflow is ACTIVE once",
          conversation.workflow_state == WorkflowState.ACTIVE)
    check("no conflict survives the resolution",
          pending(conversation) is None)
    check("no snapshot survives a cancel",
          conversation.paused_workflow is None)

    # Pausing twice keeps ONE snapshot, never a stack.
    held = active_workflow("deposit money", step=2)
    held_detector = ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
        "I want to apply for a loan": ("apply for loan", True),
    })
    held_pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), held_detector),
        held_detector,
        held
    )
    turn(held_pipeline, "I want to withdraw money")
    turn(held_pipeline, "pause it and withdraw")
    turn(held_pipeline, "I want to apply for a loan")
    turn(held_pipeline, "pause it and start the loan")

    check("there is still exactly one snapshot",
          isinstance(held.paused_workflow, PausedWorkflow),
          str(held.paused_workflow))
    check("the newest paused request is the one held",
          held.paused_workflow.workflow == "withdraw money",
          str(held.paused_workflow))
    check("the loan is the one live workflow",
          held.current_workflow == "apply for loan"
          and held.workflow_state == WorkflowState.ACTIVE,
          f"{held.current_workflow} / {held.workflow_state}")

    # The context view reports both, and nothing else changed shape.
    context = held.get_context()
    check("the context reports the paused request",
          context["paused_workflow"] == {
              "workflow": "withdraw money", "step": 1
          },
          str(context["paused_workflow"]))
    check("the context reports no pending conflict",
          context["paused_workflow"] is not None
          and context["workflow_conflict"] is None,
          str(context["workflow_conflict"]))
    check("the existing context keys are all still there",
          {"session_state", "workflow_state", "intent", "workflow", "step",
           "language", "completed", "cancelled", "entities", "history"}
          <= set(context))

    # A conflict never survives a release or a new session.
    released = active_workflow("deposit money")
    released.remember_workflow_conflict(
        WorkflowConflict("deposit money", "withdraw money")
    )
    released.release_workflow()
    check("releasing the slot clears the conflict",
          pending(released) is None)
    released.remember_workflow_conflict(
        WorkflowConflict("deposit money", "withdraw money")
    )
    released.start_conversation()
    check("a new session clears the conflict",
          pending(released) is None)

    # Detection itself is side-effect free, called directly.
    probe = active_workflow("deposit money", step=2, amount=5000)
    probe_dialogue = make_dialogue(FakeUnderstanding(), ScriptedDetector({
        "I want to withdraw money": ("withdraw money", True),
    }))
    before = snapshot_state(probe)
    found = probe_dialogue._detect_workflow_conflict(
        probe, "I want to withdraw money"
    )
    check("detection finds the conflict", found is not None, str(found))
    check("detection stores nothing by itself", pending(probe) is None)
    check("detection changes no state", snapshot_state(probe) == before)


# =========================================================
# 16  R -- NO TRANSITION FROM AN AMBIGUOUS UTTERANCE
# =========================================================

def test_r_no_accidental_transition():
    section("R -- an ambiguous utterance can never move a workflow")

    # --- an ambiguous ANSWER re-asks and moves nothing ---------------
    for answer in (
        "cancel it, or actually pause it",
        "don't cancel it",
        "no, don't pause the deposit",
        "hmm I'm not sure",
        "what is a withdrawal slip",
        "",
    ):
        detector = ScriptedDetector({
            "I want to withdraw money": ("withdraw money", True),
        })
        conversation = active_workflow("deposit money", step=2, amount=5000)
        pipeline = make_pipeline(
            make_dialogue(FakeUnderstanding(), detector), detector, conversation
        )
        asked = turn(pipeline, "I want to withdraw money")
        before = snapshot_state(conversation)

        reply = (
            pipeline.dialogue.generate_response(conversation, answer)
            if answer == ""
            else turn(pipeline, answer)
        )

        check(f"answer {answer!r} asks the question again",
              reply == asked, reply)
        check(f"answer {answer!r} moves nothing",
              snapshot_state(conversation) == before,
              str(snapshot_state(conversation)))
        check(f"answer {answer!r} keeps the conflict pending",
              pending(conversation) is not None)
        check(f"answer {answer!r} starts no workflow",
              conversation.current_workflow == "deposit money")

    # --- the detector abstaining is not a conflict -------------------
    abstaining = ScriptedDetector(default=("withdraw money", False))
    conversation = active_workflow("deposit money", step=2)
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), abstaining), abstaining, conversation
    )
    reply = turn(pipeline, "something the detector abstains on")
    check("an abstention raises no conflict", pending(conversation) is None)
    check("an abstention keeps the existing safe reply",
          reply == "Fill in your account number.", reply)
    check("an abstention moves nothing",
          conversation.current_workflow == "deposit money"
          and conversation.current_step == 2)

    # --- a detector result with no abstention signal is not enough ---
    legacy = LegacyDetector()
    conversation = active_workflow("deposit money", step=2)
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), legacy), legacy, conversation
    )
    turn(pipeline, "I want to withdraw money")
    check("a detector with no is_banking_intent raises no conflict",
          pending(conversation) is None)
    check("a detector with no is_banking_intent starts nothing",
          conversation.current_workflow == "deposit money"
          and conversation.workflow_state == WorkflowState.ACTIVE)

    # --- no detector at all: the feature is simply off ---------------
    conversation = active_workflow("deposit money", step=2)
    dialogue = make_dialogue(FakeUnderstanding(), None)
    pipeline = make_pipeline(dialogue, None, conversation)
    reply = turn(pipeline, "I want to withdraw money")
    check("with no detector there is no conflict",
          pending(conversation) is None)
    check("with no detector the pre-phase reply is unchanged",
          reply == "Fill in your account number.", reply)

    # --- the SAME service is never a conflict ------------------------
    same = ScriptedDetector({
        "I want to deposit money": ("deposit money", True),
        "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು": ("deposit money", True),
    })
    conversation = active_workflow("deposit money", step=2)
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), same), same, conversation
    )
    for text in ("I want to deposit money", "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು"):
        reply = turn(pipeline, text)
        check(f"{text!r} against the same workflow is no conflict",
              pending(conversation) is None)
        check(f"{text!r} keeps the existing handling",
              reply == "Fill in your account number.", reply)

    # --- a negated request is never a conflict ----------------------
    negated = ScriptedDetector(default=("withdraw money", True))
    conversation = active_workflow("deposit money", step=2)
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), negated), negated, conversation
    )
    for text in ("I don't want to withdraw money",
                 "no, not a withdrawal"):
        turn(pipeline, text)
        check(f"{text!r} raises no conflict", pending(conversation) is None)
        check(f"{text!r} starts nothing",
              conversation.current_workflow == "deposit money")

    # --- a resting state can never hold a conflict -------------------
    for state in (WorkflowState.COMPLETED, WorkflowState.CANCELLED):
        resting = active_workflow("deposit money", step=2)
        resting.update_workflow_state(state)
        resting_dialogue = make_dialogue(FakeUnderstanding(), ScriptedDetector({
            "I want to withdraw money": ("withdraw money", True),
        }))
        found = resting_dialogue._detect_workflow_conflict(
            resting, "I want to withdraw money"
        )
        check(f"{state.value} raises no conflict", found is None, str(found))

    # --- a service with no guided procedure is reported, not offered -
    balance = ScriptedDetector({
        "what is my balance": ("check account balance", True),
        "check my balance": ("check account balance", True),
    })
    conversation = active_workflow("deposit money", step=2)
    pipeline = make_pipeline(
        make_dialogue(FakeUnderstanding(), balance), balance, conversation
    )
    reply = turn(pipeline, "check my balance")
    check("an unavailable service raises no conflict question",
          pending(conversation) is None, reply)
    check("an unavailable service is admitted honestly",
          "don't have a guided procedure" in reply, reply)
    check("an unavailable service still names the request in progress",
          "deposit is still in progress" in reply, reply)
    check("an unavailable service still restates the step",
          "Fill in your account number." in reply, reply)
    check("an unavailable service moves nothing",
          conversation.current_workflow == "deposit money"
          and conversation.current_step == 2
          and conversation.workflow_state == WorkflowState.ACTIVE)


# =========================================================
# MAIN
# =========================================================

def main():
    print("PHASE 3.2B-14 CHECKS")

    test_conflict_module_units()
    test_a_deposit_then_withdrawal()
    test_b_withdrawal_then_deposit()
    test_c_choose_cancel()
    test_d_choose_pause()
    test_e_choose_continue()
    test_f_knowledge_question_during_workflow()
    test_g_repeat_during_conflict()
    test_h_cancel_during_conflict()
    test_i_exit_during_conflict()
    test_m_completion_semantics_unchanged()
    test_n_control_behaviour_unchanged()
    test_o_side_channel_unchanged()
    test_pq_state_integrity()
    test_r_no_accidental_transition()

    # The real detector last: it is the only part that loads a model.
    detector = IntentDetector()
    test_jkl_real_detector(detector)
    test_real_detector_leaves_in_workflow_turns_alone(detector)

    print()
    print(f"  {checks[0]} checks, {len(failures)} failed")

    if failures:
        print()
        for failure in failures:
            print("  -", failure)
        print()
        print("  Phase 3.2B-14 has failures.")
        return 1

    print()
    print("  All Phase 3.2B-14 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
