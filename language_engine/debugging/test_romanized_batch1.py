"""
ROMANISED LANGUAGE SAFETY -- BATCH 1 (audit findings G1, G2, G5, G6)

Regression tests for the Batch 1 phrase-table additions:

  G1  "nhi" is a romanised negation (multilingual_negation)
  G2  romanised "next" phrases       (multilingual_phrases.M3 ... ["next"])
  G5  romanised pause variants       (...["pause"])
  G6  romanised repeat variants      (...["repeat"])

Every phrase is AWAITING NATIVE-SPEAKER REVIEW. These tests prove what the
engine DOES with each spelling -- deterministically, with no LLM -- not that
the spelling is what a Kannada or Hindi speaker would type.

Also asserted: what Batch 1 deliberately did NOT add (G3/G4 romanised cancel
and confirmation stems, exit phrases, "band karo", "bas", "chalo", "shuru",
yes-words) still behaves exactly as before.

Real: DialogueManager, ConversationManager, WorkflowLoader, and
EngineRuntime.run_turn -- so VoiceAssistantPipeline._respond does the
routing. Stand-ins: dialogue understanding (the LLM) and the intent
detector's scores, from the control-routing suite.

Offline: no network, no model.

Run from language_engine/:

    python -m debugging.test_romanized_batch1
"""

import sys

from app.conversation.state import WorkflowState
from app.dialogue.manager import classify_command, contains_negation
from app.dialogue.workflow_conflict import WorkflowConflict, conflict_question
from debugging.test_phase32b1_control_routing import (
    FakeUnderstanding,
    RecordingDetector,
    fresh_conversation,
    make_dialogue,
)
from service.engine import EngineRuntime


PASSED = []
FAILED = []

NEW_NEXT = ["agla", "aage kya", "agla step", "aage kya karna hai",
            "mundina", "mundenu", "mundina hantha", "munde enu"]
NEW_PAUSE = ["ek second", "wait karo", "ruko zara", "ruko na",
             "swalpa iri", "tadeyiri", "ondu second"]
NEW_REPEAT = ["phir se bolo", "dobara bolo", "ek baar aur", "punah heli"]

STEP_2 = "Fill in your account number."
RESTATED = f"{STEP_2} Let me know when you've completed it."
PAUSED = "Okay, I've paused this request. Let me know when you're ready to continue."


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


class Visit:
    """A conversation driven through the real run_turn."""

    def __init__(self, workflow="deposit money", step=2, paused=False, detector=None):
        self.fake = FakeUnderstanding()
        self.detector = detector or RecordingDetector()
        self.dialogue = make_dialogue(self.fake)
        self.runtime = EngineRuntime.__new__(EngineRuntime)
        self.runtime.dialogue = self.dialogue
        self.runtime.intent_detector = self.detector
        self.conversation = fresh_conversation()
        if workflow:
            self.dialogue.start_workflow(self.conversation, workflow)
            self.conversation.current_step = step
            if paused:
                self.conversation.suspend_workflow()

    def say(self, text):
        return self.runtime.run_turn(self.conversation, text).canonical_reply

    def position(self):
        c = self.conversation
        return (c.current_intent, c.workflow_state, c.current_step)


# =========================================================
# G1  "nhi" IS A NEGATION
# =========================================================

def test_nhi_is_a_negation():
    section("G1  'nhi' is a whole-word negation")
    check("contains_negation('nhi')", contains_negation("nhi"))
    for text in ("mujhe loan nhi chahiye", "NHI", "nhi.", "loan nhi", "paise nhi nikalne"):
        check(f"negated: {text!r}", contains_negation(text))
    # Whole words only -- existing token-boundary behaviour.
    for text in ("nhilist", "abhinhi", "mujhe loan chahiye", "nhin-dekho"):
        check(f"not negated: {text!r}", not contains_negation(text))


def test_nhi_refusal_starts_nothing():
    section("G1  a refusal with 'nhi' does not start a workflow")
    for text in ("mujhe loan nhi chahiye", "mujhe loan nahi chahiye"):
        v = Visit(workflow=None, detector=RecordingDetector("apply for loan", 0.9))
        v.say(text)
        check(f"{text!r}: no workflow started",
              v.conversation.current_intent is None
              and v.conversation.workflow_state == WorkflowState.NONE, v.position())

    # The control: without the negation, the same request does start one,
    # so it is the negation -- not the stand-in detector -- that stops it.
    v = Visit(workflow=None, detector=RecordingDetector("apply for loan", 0.9))
    v.say("mujhe loan chahiye")
    check("without 'nhi' the same request starts the loan workflow",
          v.conversation.current_intent == "apply for loan"
          and v.conversation.workflow_state == WorkflowState.ACTIVE, v.position())


def test_nhi_keeps_a_pending_cancellation():
    section("G1  'nhi' as the answer to 'do you want to cancel?' keeps the request")
    v = Visit()
    v.say("cancel")
    reply = v.say("nhi")
    check("the request is kept at the same step",
          v.position() == ("deposit money", WorkflowState.ACTIVE, 2)
          and v.conversation.workflow_conflict is None, v.position())
    check("and the customer is told so",
          reply == f"Okay, I won't cancel it. {RESTATED}", reply)


def test_nhi_as_a_switch_answer_is_safe():
    section("G1  'nhi' as the answer to a workflow-switch question selects nothing")
    v = Visit()
    conflict = WorkflowConflict("deposit money", "withdraw money")
    v.conversation.remember_workflow_conflict(conflict)
    reply = v.say("nhi")
    check("the question is asked again (a negated answer picks no option)",
          reply == conflict_question(conflict), reply)
    check("nothing switched, cancelled or advanced",
          v.position() == ("deposit money", WorkflowState.ACTIVE, 2)
          and v.conversation.workflow_conflict == conflict, v.position())


# =========================================================
# G2  ROMANISED "NEXT"
# =========================================================

def test_next_is_recognised():
    section("G2  every new 'next' phrase classifies deterministically")
    for text in NEW_NEXT:
        check(f"{text!r} -> next", classify_command(text) == "next", classify_command(text))
        check(f"{text!r}: capitals and a trailing full stop still -> next",
              classify_command(text.upper() + ".") == "next")


def test_next_during_an_active_workflow():
    section("G2  next restates the step and never advances it")
    for text in NEW_NEXT:
        v = Visit()
        reply = v.say(text)
        check(f"{text!r}: restated, still step 2",
              reply == RESTATED and v.position() == ("deposit money", WorkflowState.ACTIVE, 2),
              (reply, v.position()))


def test_next_on_a_paused_workflow():
    section("G2  next on a paused request resumes it at the same step")
    for text in NEW_NEXT:
        v = Visit(paused=True)
        reply = v.say(text)
        check(f"{text!r}: resumed at step 2, not advanced",
              reply == f"Continuing. {STEP_2}"
              and v.position() == ("deposit money", WorkflowState.ACTIVE, 2),
              (reply, v.position()))


def test_next_while_idle_is_not_a_service_request():
    section("G2  next while idle starts nothing and never reaches intent detection")
    for text in NEW_NEXT:
        v = Visit(workflow=None, detector=RecordingDetector("withdraw money", 0.9))
        reply = v.say(text)
        check(f"{text!r}: no workflow, intent detection not consulted",
              v.conversation.current_intent is None and v.detector.calls == [],
              (v.position(), v.detector.calls))
        check(f"{text!r}: the existing 'nothing active' reply",
              reply == "There's no active request right now. "
                       "What banking service would you like help with?", reply)


# =========================================================
# G5  PAUSE  /  G6  REPEAT
# =========================================================

def test_new_pause_phrases():
    section("G5  each new pause phrase pauses -- never advances or cancels")
    for text in NEW_PAUSE:
        check(f"{text!r} -> pause", classify_command(text) == "pause", classify_command(text))
        check(f"{text!r} is not read as a negation", not contains_negation(text))
        v = Visit()
        reply = v.say(text)
        check(f"{text!r}: paused at step 2",
              reply == PAUSED and v.position() == ("deposit money", WorkflowState.SUSPENDED, 2),
              (reply, v.position()))


def test_new_repeat_phrases():
    section("G6  each new repeat phrase restates the step, changing nothing")
    for text in NEW_REPEAT:
        check(f"{text!r} -> repeat", classify_command(text) == "repeat", classify_command(text))
        v = Visit()
        reply = v.say(text)
        check(f"{text!r}: the current instruction, still step 2",
              reply == STEP_2 and v.position() == ("deposit money", WorkflowState.ACTIVE, 2),
              (reply, v.position()))
        v = Visit(paused=True)
        v.say(text)
        check(f"{text!r}: a paused request stays paused",
              v.position() == ("deposit money", WorkflowState.SUSPENDED, 2), v.position())


def test_new_phrases_answer_no_pending_question():
    section("none of the new phrases can answer a pending cancel confirmation")
    for text in NEW_NEXT + NEW_PAUSE + NEW_REPEAT:
        v = Visit()
        question = v.say("cancel")
        reply = v.say(text)
        check(f"{text!r}: the confirmation is asked again, nothing cancelled or paused",
              reply == question and v.position() == ("deposit money", WorkflowState.ACTIVE, 2)
              and v.conversation.workflow_conflict is not None, (reply, v.position()))


# =========================================================
# EXCLUSIONS -- deliberately unchanged in Batch 1
# =========================================================

def test_excluded_phrases_unchanged():
    section("excluded from Batch 1: still exactly as before")
    for text in ("band karo", "bas", "bas karo", "chalo", "shuru karo", "haan", "houdu",
                 "alvida", "bye bye", "vidaya", "hogtini", "tata"):
        # "raddu maadi", "radd kar do", "radd maadi" were excluded from
        # Batch 1 and added later as G3 -- see debugging/test_romanized_g3g4.py.
        check(f"{text!r} is still not a control", classify_command(text) is None,
              classify_command(text))
    check("'बंद करो' is still a session exit (pending native-speaker review)",
          classify_command("बंद करो") == "session_exit")
    check("'bye' is still the only romanised exit it ever was",
          classify_command("bye") == "session_exit")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in globals().items() if name.startswith("test_")]

    for test in tests:
        test()

    print()
    print("=" * 62)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    for failure in FAILED:
        print(f"  FAILED: {failure}")
    print("=" * 62)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
