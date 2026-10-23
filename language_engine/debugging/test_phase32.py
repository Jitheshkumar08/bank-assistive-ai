"""
Phase 3.2A regression tests -- deterministic, state-aware
conversational acknowledgement routing.

Covers the bug reported from live testing:

    withdrawal workflow COMPLETED
    user: "Thank you."
    -> Intent: apply for loan | Confidence: 0.212
    -> a loan workflow was started

IntentDetector is a total function (argmax over five banking
labels, no abstention), so any utterance that reaches it becomes
a banking request. Acknowledgements are therefore classified
deterministically in the Tier-1 routing layer and never reach it.

The invariants under test are about STATE, not wording:

    ACTIVE     + "Thank you" -> same workflow, same step, step
                                restated, no advancement
    SUSPENDED  + "Thank you" -> stays SUSPENDED, does NOT resume
    COMPLETED  + "Thank you" -> stays COMPLETED, no new workflow
    CANCELLED  + "Thank you" -> stays CANCELLED, no new workflow
    NONE       + "Thank you" -> nothing activated, session alive

Runs entirely offline: no microphone, no Groq calls, no model
downloads. DialogueUnderstanding and IntentDetector are injected;
the DialogueManager and the pipeline routing under test are real.

Run from language_engine/:

    python -m debugging.test_phase32
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState, WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue.manager import (
    DialogueManager,
    ACKNOWLEDGEMENT_PHRASES,
    SESSION_EXIT_PHRASES,
    WORKFLOW_CONTROL_PHRASES,
    classify_command,
    looks_like_a_question,
    restate_current_step,
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
    """
    Stands in for DialogueUnderstanding.

    understand_calls is asserted on directly: this phase must add
    NO LLM call, so an acknowledgement turn has to leave the
    counter untouched.
    """

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

    Most assertions in this suite are `detector.calls == []`: an
    acknowledgement must never reach intent detection, in any
    workflow state.
    """

    def __init__(self, intent="apply for loan", confidence=0.212):
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


# =========================================================
# PIPELINE HARNESS
# =========================================================

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

    Returns the assistant response, or the sentinel "SESSION_EXIT".
    """

    user_input = normalize_banking_terms(text)

    control = pipeline.dialogue.detect_control(user_input)

    if control == "session_exit":
        return "SESSION_EXIT"

    return pipeline._respond(control, user_input)


def run_session(dialogue, detector, texts):
    """
    A full fresh session through the real run() loop. Only for
    tests that start from WorkflowState.NONE, because run()
    resets the conversation.
    """

    pipeline = make_pipeline(dialogue, detector, ConversationManager())

    script = iter(list(texts) + ["exit"])
    pipeline.listen = lambda mode, language_code: next(script)

    return pipeline.run()


def last_assistant(context):
    for entry in reversed(context["history"]):
        if entry["speaker"] == "Assistant":
            return entry["message"]
    return None


# =========================================================
# WORKFLOW STAGING
# =========================================================

AMOUNT_STEP = "Enter the withdrawal amount."
SLIP_STEP = "Please take a withdrawal slip."


def withdraw_at_amount_step():
    """
    Withdrawal workflow, ACTIVE, sitting on step 3 -- the amount
    step. Advanced through the normal completion path so the
    state is reached the same way a real session reaches it.
    """

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "withdraw money")

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I took the slip")
    dialogue.generate_response(conversation, "I filled my account number")

    fake.set("unknown", "none")

    return fake, dialogue, conversation


# =========================================================
# [A]  NONE STATE
# =========================================================

def test_none_state_acknowledgements():
    section("[A]  Acknowledgement with no workflow (NONE)")

    phrases = [
        "Thank you",
        "Thank you.",
        "THANK YOU",
        "Thanks",
        "Okay",
        "Alright",
        "Got it",
    ]

    for phrase in phrases:

        fake = FakeUnderstanding()
        dialogue = make_dialogue(fake)
        detector = RecordingDetector()

        context = run_session(dialogue, detector, [phrase])

        response = last_assistant(context)

        check(f"[A] {phrase!r} never reaches intent detection",
              detector.calls == [], detector.calls)

        check(f"[A] {phrase!r} activates no workflow",
              context["workflow_state"] == WorkflowState.NONE.value
              and context["workflow"] is None
              and context["intent"] is None,
              (context["workflow_state"], context["workflow"]))

        check(f"[A] {phrase!r} consulted no LLM",
              fake.understand_calls == 0 and fake.answer_calls == 0,
              (fake.understand_calls, fake.answer_calls))

        check(f"[A] {phrase!r} gets a conversational reply",
              response is not None
              and "help with anything else" in response,
              response)

        check(f"[A] {phrase!r} keeps the session alive",
              context["session_state"] == SessionState.EXITED.value,
              context["session_state"])

    # The opener differs between the two classes; the state
    # behaviour does not.

    check("[A] 'thanks' class opens with \"You're welcome.\"",
          classify_command("Thank you.") == "thanks")

    check("[A] 'acknowledgement' class covers plain receipts",
          classify_command("Okay") == "acknowledgement")


# =========================================================
# [B]  ACTIVE STATE
# =========================================================

def test_active_state_acknowledgement():
    section("[B]  Acknowledgement during an ACTIVE workflow")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    check("[B] staged on the amount step",
          conversation.current_step == 3
          and conversation.workflow_state is WorkflowState.ACTIVE,
          (conversation.current_step, conversation.workflow_state))

    understand_before = fake.understand_calls

    response = turn(pipeline, "Thank you.")

    check("[B] intent detection was NOT called",
          detector.calls == [], detector.calls)

    check("[B] workflow is still withdraw money",
          conversation.current_workflow == "withdraw money"
          and conversation.current_intent == "withdraw money",
          (conversation.current_workflow, conversation.current_intent))

    check("[B] state is still ACTIVE",
          conversation.workflow_state is WorkflowState.ACTIVE,
          conversation.workflow_state)

    check("[B] the step did NOT advance",
          conversation.current_step == 3,
          conversation.current_step)

    check("[B] the current instruction is restated",
          response == "You're welcome. " + restate_current_step(AMOUNT_STEP),
          response)

    check("[B] no LLM call was added for the acknowledgement",
          fake.understand_calls == understand_before,
          (understand_before, fake.understand_calls))

    # "Okay" takes the same path with the other opener.

    response = turn(pipeline, "Okay")

    check("[B] 'Okay' also restates the step without advancing",
          response == "Okay. " + restate_current_step(AMOUNT_STEP)
          and conversation.current_step == 3,
          (response, conversation.current_step))

    # A real completion must still advance -- Phase 3.1 behaviour
    # is untouched by this phase.

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I entered the amount")

    check("[B] a genuine completion still advances the step",
          conversation.current_step == 4,
          conversation.current_step)


# =========================================================
# [C]  SPELLING -> "THANK YOU"  (mandatory regression)
# =========================================================

def test_spelling_then_thank_you():
    section("[C]  Spelling question, then \"Thank you.\"")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    check("[C] withdrawal is ACTIVE on the amount step",
          conversation.current_workflow == "withdraw money"
          and conversation.current_step == 3
          and conversation.workflow_state is WorkflowState.ACTIVE,
          (conversation.current_workflow, conversation.current_step))

    # ---- 1. the spelling question ------------------------
    #
    # A spelling request is a question: it must be answered
    # without completing or advancing the step (Phase 3.1 rules
    # 59-63 / 68).

    fake.set("question", "none", step_completed=False)
    fake.answer = "T-W-O T-H-O-U-S-A-N-D R-U-P-E-E-S."

    response = turn(pipeline, "Spell 2000 rupees.")

    check("[C] the spelling answer is returned",
          response == "T-W-O T-H-O-U-S-A-N-D R-U-P-E-E-S.",
          response)

    check("[C] spelling did NOT complete the step",
          conversation.current_step == 3,
          conversation.current_step)

    check("[C] spelling did NOT advance the workflow",
          conversation.workflow_state is WorkflowState.ACTIVE
          and conversation.current_workflow == "withdraw money",
          (conversation.workflow_state, conversation.current_workflow))

    check("[C] spelling did not extract an amount entity",
          conversation.entities.get("amount") is None,
          conversation.entities)

    check("[C] intent detection was not reached by the question",
          detector.calls == [], detector.calls)

    # ---- 2. "Thank you." after the side interaction -------

    understand_before = fake.understand_calls

    response = turn(pipeline, "Thank you.")

    check("[C] the acknowledgement is detected deterministically",
          classify_command("Thank you.") == "thanks")

    check("[C] intent detection was NOT called",
          detector.calls == [], detector.calls)

    check("[C] no LLM call for the acknowledgement",
          fake.understand_calls == understand_before,
          (understand_before, fake.understand_calls))

    check("[C] STILL on the amount step",
          conversation.current_step == 3,
          conversation.current_step)

    check("[C] still the withdrawal workflow, still ACTIVE",
          conversation.current_workflow == "withdraw money"
          and conversation.workflow_state is WorkflowState.ACTIVE,
          (conversation.current_workflow, conversation.workflow_state))

    check("[C] the amount step is restated, so context is not lost",
          AMOUNT_STEP in response,
          response)

    check("[C] the reply acknowledges the thanks",
          response.startswith("You're welcome."),
          response)

    check("[C] no new workflow was started",
          conversation.current_intent == "withdraw money",
          conversation.current_intent)


# =========================================================
# [D]  SUSPENDED STATE
# =========================================================

def test_suspended_state_acknowledgement():
    section("[D]  Acknowledgement while SUSPENDED (never resumes)")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    turn(pipeline, "pause")

    check("[D] the workflow is SUSPENDED",
          conversation.workflow_state is WorkflowState.SUSPENDED,
          conversation.workflow_state)

    understand_before = fake.understand_calls

    response = turn(pipeline, "Thank you.")

    check("[D] intent detection was NOT called",
          detector.calls == [], detector.calls)

    check("[D] the workflow is STILL SUSPENDED (no implicit resume)",
          conversation.workflow_state is WorkflowState.SUSPENDED,
          conversation.workflow_state)

    check("[D] the step did not advance",
          conversation.current_step == 3,
          conversation.current_step)

    check("[D] no other workflow was started",
          conversation.current_workflow == "withdraw money",
          conversation.current_workflow)

    check("[D] no LLM call for the acknowledgement",
          fake.understand_calls == understand_before,
          (understand_before, fake.understand_calls))

    check("[D] the reply says how to continue",
          "paused" in response.lower() and "resume" in response.lower(),
          response)

    check("[D] the reply does NOT restate the step as if active",
          AMOUNT_STEP not in response,
          response)

    # ACKNOWLEDGEMENT != RESUME: an explicit resume still works.

    response = turn(pipeline, "resume")

    check("[D] an explicit 'resume' still resumes",
          conversation.workflow_state is WorkflowState.ACTIVE,
          conversation.workflow_state)

    check("[D] resume returns to the same step",
          AMOUNT_STEP in response and conversation.current_step == 3,
          (response, conversation.current_step))


# =========================================================
# [E]  COMPLETED STATE  (the reported live bug)
# =========================================================

def test_completed_state_acknowledgement():
    section("[E]  Acknowledgement after COMPLETED (the live bug)")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    fake.set("workflow_action", "complete", step_completed=True)
    for _ in range(3):
        dialogue.generate_response(conversation, "I did it")

    check("[E] the withdrawal is COMPLETED",
          conversation.workflow_state is WorkflowState.COMPLETED,
          conversation.workflow_state)

    fake.set("unknown", "none")
    understand_before = fake.understand_calls

    response = turn(pipeline, "Thank you.")

    check("[E] intent detection was NOT called",
          detector.calls == [], detector.calls)

    check("[E] NO new workflow was started",
          conversation.current_workflow == "withdraw money"
          and conversation.current_intent == "withdraw money",
          (conversation.current_workflow, conversation.current_intent))

    check("[E] state is still COMPLETED",
          conversation.workflow_state is WorkflowState.COMPLETED,
          conversation.workflow_state)

    check("[E] no LLM call for the acknowledgement",
          fake.understand_calls == understand_before,
          (understand_before, fake.understand_calls))

    check("[E] the reply reports completion and offers more help",
          "completed" in response.lower()
          and "anything else" in response.lower(),
          response)

    # The session must stay usable: a REAL banking request after
    # the acknowledgement still reaches intent detection.

    detector.intent = "deposit money"
    turn(pipeline, "I want to deposit money")

    check("[E] a real request after thanks still reaches intent detection",
          detector.calls == ["I want to deposit money"],
          detector.calls)

    check("[E] and still starts its workflow",
          conversation.current_workflow == "deposit money"
          and conversation.workflow_state is WorkflowState.ACTIVE,
          (conversation.current_workflow, conversation.workflow_state))


# =========================================================
# [F]  CANCELLED STATE
# =========================================================

def test_cancelled_state_acknowledgement():
    section("[F]  Acknowledgement after CANCELLED")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    turn(pipeline, "cancel")
    turn(pipeline, "cancel")   # cancel is confirmed before it is carried out

    check("[F] the workflow is CANCELLED",
          conversation.workflow_state is WorkflowState.CANCELLED,
          conversation.workflow_state)

    understand_before = fake.understand_calls

    response = turn(pipeline, "Thanks")

    check("[F] intent detection was NOT called",
          detector.calls == [], detector.calls)

    check("[F] state is still CANCELLED",
          conversation.workflow_state is WorkflowState.CANCELLED,
          conversation.workflow_state)

    check("[F] no new workflow was started",
          conversation.current_workflow == "withdraw money",
          conversation.current_workflow)

    check("[F] no LLM call for the acknowledgement",
          fake.understand_calls == understand_before,
          (understand_before, fake.understand_calls))

    check("[F] the reply reports the cancellation",
          "cancelled" in response.lower()
          and "anything else" in response.lower(),
          response)


# =========================================================
# [G]  COMPOUND UTTERANCES MUST NOT BE SWALLOWED
# =========================================================

def test_compound_utterances():
    section("[G]  Compound utterances still route normally")

    compounds = [
        "thank you but I want to withdraw money",
        "thanks, I want to apply for a loan",
        "thanks, what is a cheque book?",
        "okay I want to deposit money",
        "thank you for the loan information but I need to deposit money",
    ]

    for text in compounds:
        check(f"[G] not an acknowledgement: {text[:44]!r}",
              classify_command(text) is None,
              classify_command(text))

    # The two banking requests must reach intent detection.

    for text in ("thank you but I want to withdraw money",
                 "thanks, I want to apply for a loan",
                 "okay I want to deposit money"):

        fake = FakeUnderstanding()
        dialogue = make_dialogue(fake)
        detector = RecordingDetector(intent="withdraw money")

        run_session(dialogue, detector, [text])

        check(f"[G] reaches intent detection: {text[:40]!r}",
              detector.calls == [text], detector.calls)

    # The compound QUESTION must reach knowledge routing instead
    # -- the Phase 3.1 behaviour, unchanged.

    fake = FakeUnderstanding()
    fake.set("question", "none")
    dialogue = make_dialogue(fake)
    detector = RecordingDetector()

    context = run_session(dialogue, detector, ["thanks, what is a cheque book?"])

    check("[G] a compound question still routes to knowledge",
          last_assistant(context) == "KNOWLEDGE ANSWER",
          last_assistant(context))

    check("[G] and still never reaches intent detection",
          detector.calls == [], detector.calls)


# =========================================================
# [H]  SESSION EXIT IS UNCHANGED
# =========================================================

def test_exit_unchanged():
    section("[H]  Session exit commands unchanged")

    for phrase in ("Exit.", "Goodbye.", "bye", "EXIT!", "quit"):
        check(f"[H] {phrase!r} is still a session exit",
              classify_command(phrase) == "session_exit",
              classify_command(phrase))

    for phrase in ("Thank you.", "Thanks", "Okay", "Got it"):
        check(f"[H] {phrase!r} is NOT a session exit",
              classify_command(phrase) != "session_exit",
              classify_command(phrase))

    # An acknowledgement leaves the session running: the turn
    # AFTER it is still processed.

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    detector = RecordingDetector(intent="deposit money")

    context = run_session(dialogue, detector, ["Thank you.", "I want to deposit money"])

    check("[H] thanks did not end the session",
          detector.calls == ["I want to deposit money"],
          detector.calls)

    check("[H] the later request started its workflow",
          context["workflow"] == "deposit money",
          context["workflow"])

    check("[H] the session exited only on 'exit'",
          context["session_state"] == SessionState.EXITED.value,
          context["session_state"])

    # The vocabularies must not overlap.

    acknowledgements = set()
    for phrases in ACKNOWLEDGEMENT_PHRASES.values():
        acknowledgements |= phrases

    check("[H] acknowledgements do not overlap session exits",
          acknowledgements & SESSION_EXIT_PHRASES == set(),
          acknowledgements & SESSION_EXIT_PHRASES)

    controls = set()
    for phrases in WORKFLOW_CONTROL_PHRASES.values():
        controls |= phrases

    check("[H] acknowledgements do not overlap workflow controls",
          acknowledgements & controls == set(),
          acknowledgements & controls)


# =========================================================
# [I]  PHASE 3.1 REGRESSION
# =========================================================

def test_phase31_regression():
    section("[I]  Phase 3.1 behaviour preserved")

    declaratives = [
        "I want to deposit money",
        "I want to withdraw money",
        "I want to take a load",
        "I need a loan",
        "I want to open an account",
        "withdraw cash please",
        "I filled it",
        "I entered 20000",
        "ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "मुझे पैसे जमा करने हैं",
        "ಸಾಲ ಬೇಕು",
    ]

    for text in declaratives:
        check(f"[I] not intercepted by Tier-1: {text[:34]!r}",
              classify_command(text) is None,
              classify_command(text))

        check(f"[I] still not a question: {text[:34]!r}",
              looks_like_a_question(text) is False)

    # The headline Phase 3.1 case, end to end.

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    detector = RecordingDetector(intent="apply for loan", confidence=0.325)

    context = run_session(dialogue, detector, ["I want to take a load"])

    check("[I] 'I want to take a load' still reaches IntentDetector",
          detector.calls == ["I want to take a load"],
          detector.calls)

    check("[I] and still starts its workflow",
          context["workflow"] == "apply for loan",
          context["workflow"])

    # Kannada used to be outside this phrase set, and this suite asserted
    # that as a KNOWN LIMITATION: "ಧನ್ಯವಾದಗಳು" reached IntentDetector and
    # started a withdrawal workflow in a live session.
    #
    # Phase 3.2B-12 closed it by adding Kannada/Hindi phrasings to the same
    # deterministic tier, so the expectation is inverted here: the phrase must
    # now be caught BEFORE intent detection, exactly like "thank you".
    # The English behaviour asserted above is unchanged.

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    detector = RecordingDetector()

    run_session(dialogue, detector, ["ಧನ್ಯವಾದಗಳು"])

    check("[I] Kannada thanks is caught by the deterministic tier and never "
          "reaches intent detection (fixed in 3.2B-12)",
          detector.calls == [],
          detector.calls)


# =========================================================
# [J]  PHASE 2.5 LOW-CONFIDENCE REGRESSION
# =========================================================

def test_no_confidence_threshold():
    section("[J]  No confidence threshold was introduced")

    # A very low confidence must still start its workflow: the
    # routing decision is lexical, never numeric.

    for confidence in (0.325, 0.212, 0.05):

        fake = FakeUnderstanding()
        dialogue = make_dialogue(fake)
        detector = RecordingDetector(
            intent="withdraw money",
            confidence=confidence,
        )

        context = run_session(dialogue, detector, ["I want to withdraw money"])

        check(f"[J] confidence {confidence} still reaches start_workflow",
              context["workflow"] == "withdraw money"
              and context["workflow_state"] == WorkflowState.ACTIVE.value,
              (confidence, context["workflow"], context["workflow_state"]))

    # An intent with no workflow definition still fails safely.

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    detector = RecordingDetector(intent="open new account", confidence=0.325)

    context = run_session(dialogue, detector, ["I want to take a load"])

    check("[J] an unsupported intent still leaves the session usable",
          context["workflow_state"] == WorkflowState.NONE.value
          and context["session_state"] == SessionState.EXITED.value,
          (context["workflow_state"], context["session_state"]))

    check("[J] 'load' is still not rewritten to 'loan'",
          normalize_banking_terms("I want to take a load")
          == "I want to take a load")


# =========================================================
# [K]  ACKNOWLEDGEMENT IS NOT COMPLETION
# =========================================================

def test_acknowledgement_is_not_completion():
    section("[K]  Acknowledgement never completes a step")

    for phrase in ("Thank you.", "Thanks", "Okay", "Alright", "Got it"):

        fake, dialogue, conversation = withdraw_at_amount_step()
        detector = RecordingDetector()
        pipeline = make_pipeline(dialogue, detector, conversation)

        # Would advance the step if the acknowledgement were ever
        # routed into dialogue understanding.
        fake.set("workflow_action", "complete", step_completed=True)

        before = conversation.current_step

        turn(pipeline, phrase)

        check(f"[K] {phrase!r} did not advance the step",
              conversation.current_step == before,
              (before, conversation.current_step))

        check(f"[K] {phrase!r} did not complete the workflow",
              conversation.workflow_state is WorkflowState.ACTIVE,
              conversation.workflow_state)

    # "yes" and "done" are deliberately NOT acknowledgement
    # phrases: either can be evidence of completion, and that
    # judgement belongs to dialogue understanding.

    for phrase in ("yes", "done", "I filled it", "I completed it"):
        check(f"[K] {phrase!r} is not a deterministic acknowledgement",
              classify_command(phrase) is None,
              classify_command(phrase))

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I entered the amount")

    check("[K] a real completion statement still advances",
          conversation.current_step == 4,
          conversation.current_step)


# =========================================================
# RUN
# =========================================================

def main():
    test_none_state_acknowledgements()
    test_active_state_acknowledgement()
    test_spelling_then_thank_you()
    test_suspended_state_acknowledgement()
    test_completed_state_acknowledgement()
    test_cancelled_state_acknowledgement()
    test_compound_utterances()
    test_exit_unchanged()
    test_phase31_regression()
    test_no_confidence_threshold()
    test_acknowledgement_is_not_completion()

    section("SUMMARY")

    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED  {failure}")
        return 1

    print()
    print("  All Phase 3.2A checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
