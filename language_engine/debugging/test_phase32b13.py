"""
PHASE 3.2B-13 -- LIVE-SESSION REMEDIATION

Every check here reproduces something that actually failed in a live
Kannada/English session, then asserts the fix. Offline: no mic, no ASR, no
network, no LLM (the understanding client is stubbed).

The seven live failures:

  1. understanding 400 "max completion tokens reached before generating a
     valid document" -> type=unknown -> the previous DEPOSIT workflow simply
     carried on
  2. ವಿರಾಮಿಸು  classified as cancel instead of pause
  3. ಮುಂದುವಸು  (mangled resume) classified as control but did not resume
  4. "ಹೊರಗೆ ಬ"  -> KNOWLEDGE_QUESTION -> AttributeError: 'str' object has no
     attribute 'subject'
  5. the non-banking/question path must never crash on a shape mismatch
  6. a failed understanding must not drive a workflow action
  7. "ಮತ್ತೆ ಹೇಳಿ" after a cancellation answered "That request was
     cancelled..." instead of replaying the previous response

Run from language_engine/:
    python -m debugging.test_phase32b13
"""
import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.dialogue.llm.dialogue_understanding import fallback_understanding
from app.dialogue.manager import DialogueManager, classify_command
from app.dialogue.side_question_context import (
    format_recent_context,
    next_context,
    retrieval_query,
)
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


class FailingUnderstanding:
    """Understanding client whose model never answers.

    Mirrors the live 400: the request is made, no usable document comes back,
    and fallback_understanding() is what the manager receives.
    """

    def __init__(self):
        self.calls = 0

    def understand(self, **kwargs):
        self.calls += 1
        return fallback_understanding()

    def answer_question(self, question, workflow_context,
                        current_instruction, recent_context=None):
        return "ANSWERED"


def make_dialogue(understanding=None):
    manager = object.__new__(DialogueManager)
    manager.workflow_loader = WorkflowLoader()
    manager.dialogue_understanding = understanding or FailingUnderstanding()
    return manager


def active_workflow(intent):
    """A conversation with `intent` loaded and ACTIVE.

    Set up exactly as DialogueManager.start_workflow() does it: the workflow
    SLOT holds the intent name, which the loader resolves to the JSON.
    """
    conversation = ConversationManager()
    conversation.start_conversation()
    conversation.set_intent(intent)
    conversation.load_workflow(intent)
    return conversation


# =========================================================
# A-H  KANNADA CONTROL SEMANTICS
# =========================================================

def test_kannada_controls():
    section("Kannada control semantics (A-H)")

    for text, expected in (
        ("ವಿರಾಮಿಸು", "pause"),        # A -- was cancel
        ("ವಿರಾಮ", "pause"),
        ("ನಿಲ್ಲಿಸು", "cancel"),        # B
        ("ಸಾಕು", "cancel"),           # C
        ("ಮುಂದುವರಿಸಿ", "resume"),      # D
        ("ಮುಂದುವರಿಸು", "resume"),      # E
        ("ಮುಂದುವಸು", "resume"),        # F -- ASR variant
        ("ಮುಂದುವರೆಸು", "resume"),
        ("ಮತ್ತೆ ಹೇಳಿ", "repeat"),       # G
        ("ಹೊರಗೆ", "session_exit"),     # H
        ("ಹೊರಗೆ ಬ", "session_exit"),   # H -- trailing ASR fragment
        ("ನಿರ್ಗಮಿಸು", "session_exit"),
    ):
        got = classify_command(text)
        check(f"{text} -> {expected}", got == expected, f"got {got}")

    # pause and cancel must stay distinct: the live bug merged them.
    check("pause and cancel are not interchangeable",
          classify_command("ವಿರಾಮಿಸು") != classify_command("ನಿಲ್ಲಿಸು"))

    # The narrow rules must not swallow real sentences.
    for text in ("ಮುಂದುವರಿಸಿ ನನ್ನ ಖಾತೆಯನ್ನು ತೆರೆಯಿರಿ",
                 "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು",
                 "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು"):
        check(f"sentence not swallowed by the variant rules: {text[:28]}",
              classify_command(text) is None, str(classify_command(text)))


# =========================================================
# I  ENGLISH CONTROL REGRESSION
# =========================================================

def test_english_controls():
    section("English control regression (I)")

    for text, expected in (("pause", "pause"), ("resume", "resume"),
                           ("cancel", "cancel"), ("stop", "cancel"),
                           ("exit", "session_exit"), ("repeat", "repeat"),
                           ("next", "next"), ("thank you", "thanks")):
        got = classify_command(text)
        check(f"{text!r} -> {expected}", got == expected, f"got {got}")


# =========================================================
# J-L  UNDERSTANDING FAILURE MUST NOT MOVE A WORKFLOW
# =========================================================

def test_understanding_failure_safety():
    section("A failed understanding cannot drive a workflow (J-L)")

    check("the failure fallback is marked as a failure",
          fallback_understanding().get("understanding_failed") is True)
    check("the failure fallback never claims completion",
          fallback_understanding()["step_completed"] is False)
    check("the failure fallback carries no action",
          fallback_understanding()["action"] == "none")

    for intent in ("deposit money", "withdraw money"):   # J and K
        conversation = active_workflow(intent)
        before_state = conversation.workflow_state
        before_step = conversation.current_step
        before_intent = conversation.current_intent

        dialogue = make_dialogue()
        response = dialogue.generate_response(conversation, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")

        check(f"{intent}: workflow state unchanged after failure",
              conversation.workflow_state == before_state,
              f"{before_state} -> {conversation.workflow_state}")
        check(f"{intent}: step not advanced after failure",
              conversation.current_step == before_step,
              f"{before_step} -> {conversation.current_step}")
        check(f"{intent}: intent not switched after failure",   # L
              conversation.current_intent == before_intent,
              f"{before_intent} -> {conversation.current_intent}")
        check(f"{intent}: still ACTIVE, not cancelled or completed",
              conversation.workflow_state == WorkflowState.ACTIVE,
              str(conversation.workflow_state))
        check(f"{intent}: the customer is told it was not understood",
              "didn't catch that" in response.lower(), response[:70])

    # Same guarantee in a resting state.
    conversation = active_workflow("deposit money")
    conversation.cancel_workflow()
    dialogue = make_dialogue()
    response = dialogue.generate_response(conversation, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    check("cancelled state: still cancelled after a failure",
          conversation.workflow_state == WorkflowState.CANCELLED,
          str(conversation.workflow_state))
    check("cancelled state: failure is admitted",
          "didn't catch that" in response.lower(), response[:70])


# =========================================================
# M-N  THE AttributeError PATH
# =========================================================

def test_attribute_error_path():
    section("The 'str' object has no attribute 'subject' path (M-N)")

    # M -- the shape mismatch that crashed live.
    for bad in ("", "some string", 0):
        check(f"format_recent_context({bad!r}) does not crash",
              format_recent_context(bad) == "", repr(format_recent_context(bad))[:40])
        check(f"retrieval_query with {bad!r} returns the question unchanged",
              retrieval_query("what is a savings account", bad)
              == "what is a savings account")

    check("next_context tolerates a malformed previous slot",
          next_context("not-a-record", "what is interest", "an answer").question
          == "what is interest")

    # N -- the real call path: a knowledge question with no remembered
    # exchange must answer, not raise.
    dialogue = make_dialogue()
    conversation = ConversationManager()
    conversation.start_conversation()

    for category, text in (("KNOWLEDGE_QUESTION", "ಹೊರಗೆ ಬ"),
                           ("KNOWLEDGE_QUESTION", "ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು"),
                           ("KNOWLEDGE_QUESTION", "What is a savings account?"),
                           ("UNSUPPORTED", "I want to hack the site"),
                           ("UNSUPPORTED", "ನಾನು ಬ್ಯಾಂಕ್ ದೋಚಬೇಕು"),
                           ("CONTROL", "ವಿರಾಮಿಸು"),
                           ("ACKNOWLEDGEMENT", "ಧನ್ಯವಾದಗಳು")):
        try:
            response = dialogue.handle_non_banking_request(category, text, conversation)
            ok, detail = bool(response), response[:40]
        except Exception as error:
            ok, detail = False, f"{type(error).__name__}: {error}"
        check(f"{category} / {text[:26]!r} answers without raising", ok, detail)
        check(f"{category} / {text[:26]!r} leaves state non-ACTIVE",
              conversation.workflow_state != WorkflowState.ACTIVE,
              str(conversation.workflow_state))

    # And with a remembered exchange present, the normal path still works.
    conversation.remember_side_question(
        next_context(None, "what is a savings account", "a deposit account"))
    try:
        response = dialogue.handle_non_banking_request(
            "KNOWLEDGE_QUESTION", "what is the interest on it", conversation)
        ok = bool(response)
    except Exception as error:
        ok, response = False, f"{type(error).__name__}: {error}"
    check("knowledge question with a remembered exchange still answers", ok, str(response)[:40])


# =========================================================
# 7  REPLAY AFTER CANCELLATION
# =========================================================

def test_replay_after_cancellation():
    section("Replay after cancellation (live failure 7)")

    dialogue = make_dialogue()

    conversation = active_workflow("deposit money")
    conversation.add_history("Assistant", "Step 1: Fill in the deposit slip.")
    conversation.cancel_workflow()
    conversation.add_history("Assistant", "Okay, I've cancelled that request.")

    replay = dialogue.handle_control_command(conversation, "repeat")
    check("repeat after cancel replays the previous response",
          replay == "Okay, I've cancelled that request.", str(replay)[:60])
    check("repeat after cancel does not announce 'nothing to repeat'",
          "nothing to repeat" not in replay.lower())
    check("repeat after cancel changes no state",
          conversation.workflow_state == WorkflowState.CANCELLED,
          str(conversation.workflow_state))

    # No replay target must NOT crash and must NOT invent one.
    empty = ConversationManager()
    empty.start_conversation()
    reply = dialogue.handle_control_command(empty, "repeat")
    check("repeat with no history returns the existing wording",
          reply == "There's nothing to repeat right now.", str(reply)[:60])

    # A completed workflow replays too, and English is unaffected.
    completed = active_workflow("withdraw money")
    completed.add_history("Assistant", "Step 2: Enter the amount.")
    completed.update_workflow_state(WorkflowState.COMPLETED)
    check("repeat after completion replays the previous response",
          dialogue.handle_control_command(completed, "repeat")
          == "Step 2: Enter the amount.")

    # Other resting-state controls keep their existing wording.
    cancelled = active_workflow("deposit money")
    cancelled.cancel_workflow()
    for command in ("pause", "resume", "next"):
        reply = dialogue.handle_control_command(cancelled, command)
        check(f"{command} in a cancelled state still reports the status",
              "cancelled" in reply.lower(), reply[:50])


def main():
    print("PHASE 3.2B-13 CHECKS")

    test_kannada_controls()
    test_english_controls()
    test_understanding_failure_safety()
    test_attribute_error_path()
    test_replay_after_cancellation()

    print()
    print(f"  {checks[0]} checks, {len(failures)} failed")
    if failures:
        print()
        for failure in failures:
            print("  -", failure)
        print()
        print("  Phase 3.2B-13 has failures.")
        return 1

    print()
    print("  All Phase 3.2B-13 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
