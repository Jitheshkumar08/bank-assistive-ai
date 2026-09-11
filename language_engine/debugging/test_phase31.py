"""
Phase 3.1 regression tests -- dialogue/workflow stabilization.

Covers the four behaviours reported from live testing:

  #1  completion + "what should I do next?"  -> advance once
  #2  spelling/wording requests              -> never complete
  #3  completion + question                  -> advance AND answer
  #4  mid-sentence questions                 -> no workflow started

Runs entirely offline: no microphone, no Groq calls, no model
downloads. DialogueUnderstanding is injected, so what is tested
is the routing and the completion contract themselves.

Run from language_engine/:

    python -m debugging.test_phase31
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState, WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue.manager import (
    DialogueManager,
    looks_like_a_question,
    classify_command,
)
from app.dialogue.llm.dialogue_understanding import (
    EMPTY_ENTITIES,
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
    """
    Stands in for DialogueUnderstanding.

    set() mirrors the real schema, including the new
    step_completed boolean. It defaults to False so a test that
    does not mention completion can never accidentally advance a
    step.
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
        self.last_current_instruction = None

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
        self.last_current_instruction = current_instruction
        return self.answer


def make_dialogue(fake):
    manager = object.__new__(DialogueManager)
    manager.workflow_loader = WorkflowLoader()
    manager.dialogue_understanding = fake
    return manager


def fresh_conversation():
    conversation = ConversationManager()
    conversation.start_conversation()
    return conversation


ACCOUNT_NUMBER_STEP = "Fill in your account number."
AMOUNT_STEP = "Enter the amount to deposit."
SUBMIT_STEP = "Submit the slip along with the cash."


def deposit_at_step_2():
    """Deposit workflow sitting on step 2 (account number)."""

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)
    conversation = fresh_conversation()

    dialogue.start_workflow(conversation, "deposit money")

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I took the slip")

    return fake, dialogue, conversation


def deposit_at_step_3():
    """Deposit workflow sitting on step 3 (amount)."""

    fake, dialogue, conversation = deposit_at_step_2()

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I filled the account number")

    return fake, dialogue, conversation


# =========================================================
# [A]  ISSUE #1 -- COMPLETION + "WHAT SHOULD I DO NEXT?"
# =========================================================

def test_completion_plus_next():
    section('[A]  Issue #1 -- completion + "what should I do next?"')

    fake, dialogue, conversation = deposit_at_step_2()

    check("[A] precondition: on the account-number step",
          conversation.current_step == 2, conversation.current_step)

    # "Yes, I completed by filling my account number.
    #  Next what should I do?"
    #
    # The completion and the direction request arrive together.
    # Before Phase 3.1 the scalar action kept only next_step and
    # the finished step was restated forever.

    fake.set("workflow_action", "next_step", step_completed=True)

    response = dialogue.generate_response(
        conversation,
        "Yes, I completed by filling my account number. "
        "Next what should I do?"
    )

    check("[A] the workflow advanced exactly once",
          conversation.current_step == 3, conversation.current_step)

    check("[A] the next step is given",
          response == AMOUNT_STEP, response)

    check("[A] the completed step is NOT repeated",
          ACCOUNT_NUMBER_STEP not in response, response)

    check("[A] workflow stays ACTIVE",
          conversation.workflow_state is WorkflowState.ACTIVE,
          conversation.workflow_state)

    # A direction request WITHOUT completion must still not move.

    fake.set("workflow_action", "next_step", step_completed=False)

    response = dialogue.generate_response(
        conversation,
        "What should I do next?"
    )

    check("[A] next_step alone still does NOT advance",
          conversation.current_step == 3, conversation.current_step)

    check("[A] next_step alone restates the current step",
          AMOUNT_STEP in response, response)


# =========================================================
# [B]  ISSUE #3 -- COMPLETION + QUESTION
# =========================================================

def test_completion_plus_question():
    section("[B]  Issue #3 -- completion + question in one message")

    fake, dialogue, conversation = deposit_at_step_3()

    check("[B] precondition: on the amount step",
          conversation.current_step == 3, conversation.current_step)

    # "I signed the withdrawal slip. Where should I submit it?"
    # -- completion plus an informational question.

    fake.set("question", "none", step_completed=True)

    response = dialogue.generate_response(
        conversation,
        "I entered the amount. Where should I submit the slip?"
    )

    check("[B] the workflow advanced exactly once",
          conversation.current_step == 4, conversation.current_step)

    check("[B] the question was actually answered",
          fake.answer_calls == 1, fake.answer_calls)

    check("[B] the answer reaches the customer",
          fake.answer in response, response)

    check("[B] the new current step is also stated",
          SUBMIT_STEP in response, response)

    check("[B] workflow state is preserved (still ACTIVE)",
          conversation.workflow_state is WorkflowState.ACTIVE,
          conversation.workflow_state)

    check("[B] the question is answered against the NEW step",
          fake.last_current_instruction == SUBMIT_STEP,
          fake.last_current_instruction)

    # A question WITHOUT completion must never advance.

    fake, dialogue, conversation = deposit_at_step_3()
    fake.set("question", "none", step_completed=False)

    response = dialogue.generate_response(
        conversation,
        "Where should I submit the slip?"
    )

    check("[B] a plain question does NOT advance the workflow",
          conversation.current_step == 3, conversation.current_step)

    check("[B] a plain question is still answered",
          fake.answer_calls == 1, fake.answer_calls)


# =========================================================
# [C]  ISSUE #2 -- SPELLING / WORDING REQUESTS
# =========================================================

def test_spelling_requests_never_complete():
    section("[C]  Issue #2 -- spelling/wording never completes a step")

    spelling_requests = [
        "Can you spell 20000 rupees?",
        "Can you say the exact spelling?",
        "Spell it like T-W-E-N-T-Y-T-H-O-U-S-A-N-D-R-U-P-E-E-S.",
        "How do I write twenty thousand?",
        "What is the word for 20000?",
    ]

    for text in spelling_requests:

        fake, dialogue, conversation = deposit_at_step_3()

        # This is how the prompt now instructs the model to
        # classify a spelling request: help, no action, and
        # explicitly NOT completed -- even though a number is
        # present in the sentence.
        fake.set("help", "none", step_completed=False)

        response = dialogue.generate_response(conversation, text)

        check(f"[C] step unchanged: {text[:38]!r}",
              conversation.current_step == 3, conversation.current_step)

        check(f"[C] answered as help: {text[:38]!r}",
              fake.answer_calls == 1 and fake.answer in response,
              response)

        check(f"[C] workflow still ACTIVE: {text[:38]!r}",
              conversation.workflow_state is WorkflowState.ACTIVE)

    # A value mentioned inside a question must not be banked as
    # though the customer had supplied it.

    fake, dialogue, conversation = deposit_at_step_3()
    fake.set("help", "none", step_completed=False, amount=20000)

    dialogue.generate_response(conversation, "Can you spell 20000 rupees?")

    check("[C] a value inside a question does not complete the step",
          conversation.current_step == 3, conversation.current_step)

    # The amount step must STILL be completable for real.

    fake, dialogue, conversation = deposit_at_step_3()
    fake.set("workflow_action", "complete",
             step_completed=True, amount=20000)

    response = dialogue.generate_response(
        conversation,
        "Yes, I entered the amount."
    )

    check("[C] genuinely entering the amount still completes",
          conversation.current_step == 4, conversation.current_step)

    check("[C] and moves on to the submit step",
          response == SUBMIT_STEP, response)

    check("[C] the amount entity was persisted",
          conversation.entities.get("amount") == 20000,
          conversation.entities)


# =========================================================
# [D]  ISSUE #4 -- MID-SENTENCE QUESTION DETECTION
# =========================================================

def test_mid_sentence_question_detection():
    section("[D]  Issue #4 -- questions detected anywhere in the sentence")

    # The reported failure: routed into the loan workflow at
    # confidence 0.293 because the first word was "For".

    reported = (
        "For admission letter what really I should ask in the "
        "college like what type of letter is that"
    )

    check("[D] the reported utterance is now seen as a question",
          looks_like_a_question(reported) is True)

    more_questions = [
        "my son needs a college admission letter what should i ask them",
        "I signed the withdrawal slip. Where should I submit the slip?",
        "tell me how this works",
    ]

    for text in more_questions:
        check(f"[D] question detected: {text[:44]!r}",
              looks_like_a_question(text) is True)

    # ---------------------------------------------
    # REGRESSION GUARD -- these must NOT become questions.
    #
    # Only the strong WH-words are matched mid-sentence.
    # Auxiliaries such as "is"/"do"/"can" are deliberately
    # excluded, because they appear inside ordinary declarative
    # banking requests.
    # ---------------------------------------------

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
        check(f"[D] stays on the intent path: {text!r}",
              looks_like_a_question(text) is False)

    check("[D] 'load' is still not rewritten to 'loan'",
          normalize_banking_terms("I want to take a load")
          == "I want to take a load")

    for text in declaratives:
        check(f"[D] not swallowed by control matching: {text[:30]!r}",
              classify_command(text) is None, classify_command(text))


# =========================================================
# [E]  NO WORKFLOW IS STARTED BY A MID-SENTENCE QUESTION
# =========================================================

def test_question_does_not_start_a_workflow():
    section("[E]  Issue #4 -- a question must not activate a workflow")

    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    class LowConfidenceDetector:
        def __init__(self):
            self.calls = []

        def detect_intent(self, text):
            self.calls.append(text)
            return {"intent": "apply for loan", "confidence": 0.293}

    class RecordingDialogue:
        def __init__(self):
            self.started = []

        def detect_control(self, text):
            if text.strip().lower().rstrip(".") == "exit":
                return "session_exit"
            return None

        def answer_general_question(self, text):
            # Mirrors the real manager: the pre-filter decides
            # whether the LLM is consulted at all.
            if looks_like_a_question(text):
                return "KNOWLEDGE ANSWER"
            return None

        def generate_response(self, conversation, user_input=None):
            return "workflow response"

        def handle_control_command(self, conversation, command):
            return "control ok"

        def start_workflow(self, conversation, intent):
            self.started.append(intent)
            return True, "started"

    detector = LowConfidenceDetector()
    dialogue = RecordingDialogue()

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.conversation = ConversationManager()
    pipeline.dialogue = dialogue
    pipeline.intent_detector = detector
    pipeline.tts = None

    script = iter([
        "For admission letter what really I should ask in the "
        "college like what type of letter is that",
        "exit",
    ])

    pipeline.select_language = lambda: ("English", "en")
    pipeline.select_input_mode = lambda: "2"
    pipeline.listen = lambda mode, language_code: next(script)
    pipeline.speak = lambda mode, response, language_code: None

    context = pipeline.run()

    check("[E] no banking workflow was started",
          dialogue.started == [], dialogue.started)

    check("[E] intent detection was never reached",
          detector.calls == [], detector.calls)

    check("[E] workflow state stayed NONE",
          context["workflow_state"] == WorkflowState.NONE.value,
          context["workflow_state"])

    check("[E] the session still exits cleanly",
          context["session_state"] == SessionState.EXITED.value,
          context["session_state"])

    # ---------------------------------------------
    # REGRESSION GUARD for existing Phase 2.5 test [J]:
    # a low-confidence DECLARATIVE must still start its
    # workflow. No confidence threshold was introduced.
    # ---------------------------------------------

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

    pipeline.run()

    check("[E] a low-confidence declarative STILL starts its workflow",
          dialogue.started == ["apply for loan"], dialogue.started)

    check("[E] intent detection still runs for declaratives",
          detector.calls == ["I want to take a load"], detector.calls)


# =========================================================
# [F]  THE COMPLETION CONTRACT
# =========================================================

def test_completion_contract():
    section("[F]  step_completed contract")

    # --- never double-advance ------------------------------

    fake, dialogue, conversation = deposit_at_step_2()

    fake.set("workflow_action", "complete", step_completed=True)

    dialogue.generate_response(conversation, "I filled the account number")

    check("[F] one completion advances exactly one step",
          conversation.current_step == 3, conversation.current_step)

    # --- action=complete alone still works (back-compat) ---

    fake, dialogue, conversation = deposit_at_step_2()

    fake.set("workflow_action", "complete", step_completed=False)

    dialogue.generate_response(conversation, "I filled it")

    check("[F] action=complete without the flag still advances",
          conversation.current_step == 3, conversation.current_step)

    # --- an intention must never complete ------------------

    for text in ("I need to fill this", "I'll fill it",
                 "let me do it", "I am filling it"):

        fake, dialogue, conversation = deposit_at_step_2()
        fake.set("acknowledgement", "none", step_completed=False)

        response = dialogue.generate_response(conversation, text)

        check(f"[F] intention does not complete: {text!r}",
              conversation.current_step == 2, conversation.current_step)

        check(f"[F] intention restates the step: {text!r}",
              ACCOUNT_NUMBER_STEP in response, response)

    # --- the LLM fallback can never advance ----------------

    fake, dialogue, conversation = deposit_at_step_2()
    fake.next_result = fallback_understanding()

    dialogue.generate_response(conversation, "something unparseable")

    check("[F] the safe fallback never advances a step",
          conversation.current_step == 2, conversation.current_step)

    check("[F] the fallback carries step_completed = False",
          fallback_understanding()["step_completed"] is False)

    # --- a missing flag defaults to not-completed ----------

    fake, dialogue, conversation = deposit_at_step_2()
    fake.next_result = {
        "type": "question",
        "action": "none",
        "entities": entities(),
    }

    dialogue.generate_response(conversation, "where do I sign?")

    check("[F] an absent step_completed key does not advance",
          conversation.current_step == 2, conversation.current_step)

    # --- cancel still outranks completion ------------------

    fake, dialogue, conversation = deposit_at_step_2()
    fake.set("control", "cancel", step_completed=True)

    dialogue.generate_response(conversation, "I filled it, actually cancel")

    check("[F] cancel outranks completion",
          conversation.workflow_state is WorkflowState.CANCELLED,
          conversation.workflow_state)

    check("[F] a cancelled workflow did not also advance",
          conversation.current_step == 2, conversation.current_step)

    # --- completion on the last step finishes the workflow -

    fake, dialogue, conversation = deposit_at_step_3()

    fake.set("workflow_action", "complete", step_completed=True)
    dialogue.generate_response(conversation, "I entered the amount")

    check("[F] precondition: on the final step",
          conversation.current_step == 4, conversation.current_step)

    fake.set("workflow_action", "complete", step_completed=True)
    response = dialogue.generate_response(conversation, "I submitted it")

    check("[F] completing the last step completes the workflow",
          conversation.workflow_state is WorkflowState.COMPLETED,
          conversation.workflow_state)

    check("[F] and says so", response == "Workflow Completed.", response)

    # --- completion resumes a suspended workflow -----------

    fake, dialogue, conversation = deposit_at_step_2()
    conversation.suspend_workflow()

    check("[F] precondition: workflow suspended",
          conversation.workflow_state is WorkflowState.SUSPENDED)

    fake.set("workflow_action", "none", step_completed=True)
    dialogue.generate_response(conversation, "I filled the account number")

    check("[F] completion implicitly resumes a suspended workflow",
          conversation.workflow_state is WorkflowState.ACTIVE,
          conversation.workflow_state)

    check("[F] and advances exactly one step",
          conversation.current_step == 3, conversation.current_step)


# =========================================================
# MAIN
# =========================================================

def main():
    test_completion_plus_next()
    test_completion_plus_question()
    test_spelling_requests_never_complete()
    test_mid_sentence_question_detection()
    test_question_does_not_start_a_workflow()
    test_completion_contract()

    section("SUMMARY")
    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED: {failure}")
        return 1

    print()
    print("  All Phase 3.1 tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
