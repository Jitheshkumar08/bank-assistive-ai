"""
CANCELLATION SAFETY, STEP 1 -- NO LLM-TRIGGERED CANCEL WITHOUT CONFIRMATION

Regression tests for DialogueManager.generate_response() step 7: when dialogue
understanding (the LLM) labels a turn action == "cancel", the workflow is NOT
cancelled. The turn goes through handle_control_command(), exactly like a
table cancel phrase: "do you want to cancel?" is asked, held in the one
pending-question slot, and only an explicit confirmation cancels.

WHAT IS SIMULATED

The LLM is the control-routing suite's FakeUnderstanding, FORCED to return
action "cancel" -- including for refusals a real model should not label
cancel ("don't cancel it"). These tests prove what the engine does WITH such
a label. They say nothing about how a real model labels any sentence.

Real: EngineRuntime.run_turn, VoiceAssistantPipeline._respond,
DialogueManager, ConversationManager and the workflow definitions.

Offline: no network, no model.

Run from language_engine/:

    python -m debugging.test_llm_cancel_confirmation
"""

import sys

from app.conversation.state import SessionState, WorkflowState
from app.dialogue.workflow_conflict import WorkflowConflict, conflict_question, is_cancel_confirmation
from debugging.test_phase32b1_control_routing import (
    FakeUnderstanding,
    RecordingDetector,
    fresh_conversation,
    make_dialogue,
)
from service.engine import FAREWELL, EngineRuntime


PASSED = []
FAILED = []

QUESTION = "Do you want to cancel the deposit? Say cancel to confirm, or continue to keep it."
STEP_2 = "Fill in your account number."
KEPT = f"Okay, I won't cancel it. {STEP_2} Let me know when you've completed it."
CANCELLED_REPLY = "Okay, I've cancelled that request. Let me know if you'd like help with something else."

#: Cancels the tables do not know, which therefore reach the LLM.
UNKNOWN_TO_THE_TABLES = ["please cancel it", "I want to cancel this deposit",
                         "cancel kar dijiye", "radd kar dijiye"]


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
    """A deposit at step 2, driven through the real run_turn."""

    def __init__(self, llm="cancel", paused=False):
        self.fake = FakeUnderstanding()
        self.label(llm)
        self.dialogue = make_dialogue(self.fake)
        self.runtime = EngineRuntime.__new__(EngineRuntime)
        self.runtime.dialogue = self.dialogue
        self.runtime.intent_detector = RecordingDetector()
        self.conversation = fresh_conversation()
        self.dialogue.start_workflow(self.conversation, "deposit money")
        self.conversation.current_step = 2
        if paused:
            self.conversation.suspend_workflow()

    def label(self, llm):
        """What the fake LLM says about every turn from now on."""
        if llm == "cancel":
            self.fake.set("workflow_action", "cancel")
        else:
            self.fake.set("unknown", "none")

    def say(self, text):
        return self.runtime.run_turn(self.conversation, text)

    @property
    def state(self):
        return self.conversation.workflow_state

    @property
    def pending(self):
        return self.conversation.workflow_conflict

    def at_step_2(self, state=WorkflowState.ACTIVE):
        c = self.conversation
        return (c.current_intent == "deposit money" and c.workflow_state == state
                and c.current_step == 2)

    def snapshot(self):
        c = self.conversation
        return (c.current_intent, c.workflow_state, c.current_step, c.workflow_conflict,
                c.session_state, len(c.history))


# =========================================================
# THE BYPASS IS CLOSED
# =========================================================

def test_llm_cancel_only_asks():
    section("an LLM-labelled cancel asks, and changes nothing")
    for text in UNKNOWN_TO_THE_TABLES:
        v = Visit()
        result = v.say(text)
        check(f"{text!r}: the LLM was consulted (this is the LLM path)",
              v.fake.understand_calls == 1, v.fake.understand_calls)
        check(f"{text!r}: NOT cancelled -- deposit still active at step 2",
              v.at_step_2(), (v.state, v.conversation.current_step))
        check(f"{text!r}: a cancel confirmation is pending",
              is_cancel_confirmation(v.pending) and v.pending.current_workflow == "deposit money",
              str(v.pending))
        check(f"{text!r}: the confirmation question is asked",
              result.canonical_reply == QUESTION, result.canonical_reply)


def test_explicit_confirmation_cancels():
    section("a second, explicit cancel confirms through the existing resolver")
    for answer in ("cancel", "yes, cancel it", "रद्द करो", "ನಿಲ್ಲಿಸು"):
        v = Visit()
        v.say("please cancel it")
        understood = v.fake.understand_calls
        result = v.say(answer)
        check(f"{answer!r}: cancelled, question cleared",
              v.state == WorkflowState.CANCELLED and v.pending is None, (v.state, v.pending))
        check(f"{answer!r}: the cancellation is reported", result.canonical_reply == CANCELLED_REPLY,
              result.canonical_reply)
        check(f"{answer!r}: answered without asking the LLM again",
              v.fake.understand_calls == understood, v.fake.understand_calls)


def test_mislabelled_refusal_cannot_cancel():
    section("a refusal the LLM mislabels as cancel cannot cancel")
    for text in ("don't cancel it", "do not cancel", "radd mat karo"):
        v = Visit()
        v.say(text)
        check(f"{text!r} labelled cancel: still active at step 2",
              v.at_step_2(), (v.state, v.conversation.current_step))
        check(f"{text!r} labelled cancel: only a question is pending",
              is_cancel_confirmation(v.pending), str(v.pending))

        # The customer then says no -- still with the LLM saying "cancel".
        for answer in ("no", "don't cancel it", "continue"):
            w = Visit()
            w.say(text)
            result = w.say(answer)
            check(f"{text!r} then {answer!r}: kept, unchanged, question cleared",
                  w.at_step_2() and w.pending is None, (w.state, w.pending))
            check(f"{text!r} then {answer!r}: says so", result.canonical_reply == KEPT,
                  result.canonical_reply)


def test_paused_request():
    section("a paused request: asked, and kept paused on refusal")
    v = Visit(paused=True)
    result = v.say("please cancel it")
    check("still paused at step 2", v.at_step_2(WorkflowState.SUSPENDED), (v.state,))
    check("the paused form of the question",
          result.canonical_reply == f"Your deposit is currently paused. {QUESTION}",
          result.canonical_reply)
    v.say("continue")
    check("refusing keeps it paused", v.at_step_2(WorkflowState.SUSPENDED) and v.pending is None)


# =========================================================
# PENDING-QUESTION PRIORITY
# =========================================================

def outcome_with(llm, pending, answer):
    v = Visit(llm=llm)
    v.conversation.remember_workflow_conflict(pending)
    result = v.say(answer)
    return v, result


def test_switch_question_is_not_overwritten():
    section("a pending workflow-switch question is never overwritten by the LLM path")
    switch = WorkflowConflict("deposit money", "withdraw money")

    for answer in ("hmm, let me think", "please cancel it", "continue", "pause it",
                   "don't cancel it"):
        with_cancel, reply_a = outcome_with("cancel", switch, answer)
        with_unknown, reply_b = outcome_with("unknown", switch, answer)
        check(f"{answer!r}: the LLM label changes nothing (same outcome, same reply)",
              with_cancel.snapshot() == with_unknown.snapshot()
              and reply_a.canonical_reply == reply_b.canonical_reply,
              (with_cancel.snapshot(), with_unknown.snapshot()))
        check(f"{answer!r}: the LLM was not consulted while the question was pending",
              with_cancel.fake.understand_calls == 0, with_cancel.fake.understand_calls)
        check(f"{answer!r}: no cancel confirmation replaced the switch question",
              not is_cancel_confirmation(with_cancel.pending), str(with_cancel.pending))

    unclear, reply = outcome_with("cancel", switch, "hmm, let me think")
    check("an unreadable answer re-asks the switch question, untouched",
          unclear.at_step_2() and unclear.pending == switch
          and reply.canonical_reply == conflict_question(switch), reply.canonical_reply)


def test_pending_confirmation_is_not_reset():
    section("a pending cancel confirmation is answered, never re-asked by the LLM path")
    for answer in ("hmm, let me think", "what is a deposit slip?"):
        v = Visit()
        v.say("cancel")
        before = v.pending
        result = v.say(answer)
        check(f"{answer!r}: the same question, still pending, deposit untouched",
              v.pending == before and v.at_step_2() and result.canonical_reply == QUESTION,
              (v.pending, v.state, result.canonical_reply))


# =========================================================
# UNCHANGED PATHS
# =========================================================

def test_table_cancel_still_asks():
    section("the table cancel path is unchanged: it asks first")
    for text in ("cancel", "stop", "ಸಾಕು", "बस", "cancel karo"):
        v = Visit(llm="unknown")
        result = v.say(text)
        check(f"{text!r}: asked, not cancelled, no LLM call",
              v.at_step_2() and is_cancel_confirmation(v.pending)
              and result.canonical_reply == QUESTION and v.fake.understand_calls == 0,
              (v.state, v.fake.understand_calls, result.canonical_reply))


def test_normal_progress_is_unchanged():
    section("a normal completion still advances one step")
    v = Visit(llm="unknown")
    v.fake.set("workflow_action", "complete", step_completed=True)
    v.say("I filled in my account number")
    check("step 2 -> 3, still active, nothing pending",
          v.conversation.current_step == 3 and v.state == WorkflowState.ACTIVE and v.pending is None,
          (v.conversation.current_step, v.state))


def test_post_exit_turns_stay_blocked():
    section("after exit, an LLM-labelled cancel is refused like every turn")
    v = Visit()
    v.say("exit")
    understood = v.fake.understand_calls
    for text in ("please cancel it", "cancel", "don't cancel it"):
        result = v.say(text)
        check(f"after exit, {text!r}: the farewell, ended",
              result.canonical_reply == FAREWELL and result.ended, result.canonical_reply)
    check("the deposit is exactly as it was, nothing pending",
          v.at_step_2() and v.pending is None, (v.state, v.pending))
    check("still EXITED, and the LLM was never consulted",
          v.conversation.session_state == SessionState.EXITED and v.fake.understand_calls == understood)


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
