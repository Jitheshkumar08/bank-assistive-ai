"""
ROMANISED G3 / G4 -- CANCEL PHRASES AND CANCEL ANSWER WORDS

G3: three romanised cancel phrases join M3_WORKFLOW_CONTROL_PHRASES["cancel"]:
    Hindi "radd kar do"; Kannada "raddu maadi", "radd maadi".
G4: the whole tokens "radd" and "raddu" join
    workflow_conflict.CHOICE_WORDS[CHOICE_CANCEL] -- the vocabulary read only
    while a closed question (cancel confirmation or workflow switch) is pending.

ALL NEW PHRASES AND WORDS ARE AWAITING NATIVE-SPEAKER REVIEW. These tests
prove what the engine does with the spellings; they say nothing about whether
a native speaker would use them.

WHAT IS SIMULATED

The LLM is the control-routing suite's FakeUnderstanding, set either to
"unknown" or FORCED to "cancel". Nothing here says how a real model labels
any sentence.

Real: EngineRuntime.run_turn, VoiceAssistantPipeline._respond,
DialogueManager, ConversationManager and the workflow definitions.

Offline: no network, no model.

Run from language_engine/:

    python -m debugging.test_romanized_g3g4
"""

import sys

from app.conversation.state import SessionState, WorkflowState
from app.dialogue.manager import classify_command
from app.dialogue.multilingual_phrases import M3_WORKFLOW_CONTROL_PHRASES
from app.dialogue.workflow_conflict import (
    CHOICE_CANCEL,
    CHOICE_WORDS,
    INDIC_CHOICE_STEMS,
    WorkflowConflict,
    conflict_question,
    is_cancel_confirmation,
    resolve_conflict_answer,
)
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
PAUSED_QUESTION = f"Your deposit is currently paused. {QUESTION}"
STEP_2 = "Fill in your account number."
KEPT = f"Okay, I won't cancel it. {STEP_2} Let me know when you've completed it."
CANCELLED_REPLY = "Okay, I've cancelled that request. Let me know if you'd like help with something else."

G3_PHRASES = ["radd kar do", "raddu maadi", "radd maadi"]
G4_ANSWERS = ["radd", "raddu", "haan radd karo", "houdu raddu maadi", "radd it", "yes raddu"]
NEGATED = ["radd mat karo", "radd nahi karna", "raddu maadi beda", "raddu beda"]
LOOKALIKES = ["raddi", "raddi wala form", "raddi paper", "raddiwala"]

SWITCH = WorkflowConflict("deposit money", "withdraw money")


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
    """A deposit at step 2 (or no workflow), driven through the real run_turn."""

    def __init__(self, llm="unknown", paused=False, workflow=True, pending=None):
        self.fake = FakeUnderstanding()
        self.label(llm)
        self.dialogue = make_dialogue(self.fake)
        self.runtime = EngineRuntime.__new__(EngineRuntime)
        self.runtime.dialogue = self.dialogue
        self.runtime.intent_detector = RecordingDetector()
        self.conversation = fresh_conversation()
        if workflow:
            self.dialogue.start_workflow(self.conversation, "deposit money")
            self.conversation.current_step = 2
            if paused:
                self.conversation.suspend_workflow()
        if pending == "confirm":
            self.say("cancel")
        elif pending == "switch":
            self.conversation.remember_workflow_conflict(SWITCH)

    def label(self, llm):
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
        return (c.current_intent, c.current_workflow, c.workflow_state, c.current_step,
                c.workflow_conflict, c.session_state)


# =========================================================
# TABLES AND PURE FUNCTIONS
# =========================================================

def test_tables():
    section("G3 phrases are cancel; G4 words are whole cancel tokens only")
    for phrase in G3_PHRASES:
        check(f"{phrase!r} is in the romanised cancel table",
              phrase in M3_WORKFLOW_CONTROL_PHRASES["cancel"])
        check(f"{phrase!r} classifies as cancel", classify_command(phrase) == "cancel",
              classify_command(phrase))
    for word in ("radd", "raddu"):
        check(f"{word!r} is a whole-token cancel answer word", word in CHOICE_WORDS[CHOICE_CANCEL])
    check("no Latin-script stem was added (radd is never a prefix match)",
          not any(stem.isascii() for stem, _ in INDIC_CHOICE_STEMS))
    check("native stems unchanged",
          ("ರದ್ದು", CHOICE_CANCEL) in INDIC_CHOICE_STEMS and ("रद्द", CHOICE_CANCEL) in INDIC_CHOICE_STEMS)
    check("bare 'radd' / 'raddu' are NOT control commands (answer words only)",
          classify_command("radd") is None and classify_command("raddu") is None)
    for text in G4_ANSWERS:
        check(f"{text!r} selects cancel as an answer", resolve_conflict_answer(text) == CHOICE_CANCEL,
              resolve_conflict_answer(text))
    for text in LOOKALIKES:
        check(f"{text!r}: not a command", classify_command(text) is None, classify_command(text))
        check(f"{text!r}: selects no answer", resolve_conflict_answer(text) is None,
              resolve_conflict_answer(text))
    for text in ("haan radd karo", "houdu raddu maadi"):
        check(f"{text!r} is not a standalone command (G4 is answer-only)",
              classify_command(text) is None, classify_command(text))


# =========================================================
# G3 -- A FIRST REQUEST ONLY ASKS
# =========================================================

def test_g3_active_asks_then_confirms():
    section("G3 on an active workflow: asks first, an explicit cancel confirms")
    for phrase in G3_PHRASES:
        v = Visit()
        result = v.say(phrase)
        check(f"{phrase!r}: NOT cancelled, still at step 2", v.at_step_2(), (v.state,))
        check(f"{phrase!r}: confirmation question pending and asked",
              is_cancel_confirmation(v.pending) and result.canonical_reply == QUESTION,
              (str(v.pending), result.canonical_reply))
        check(f"{phrase!r}: deterministic, the LLM was not consulted", v.fake.understand_calls == 0,
              v.fake.understand_calls)

        for confirm in ("cancel", phrase, "radd", "raddu", "haan radd karo", "houdu raddu maadi"):
            w = Visit()
            w.say(phrase)
            result = w.say(confirm)
            check(f"{phrase!r} then {confirm!r}: cancelled, question cleared",
                  w.state == WorkflowState.CANCELLED and w.pending is None
                  and result.canonical_reply == CANCELLED_REPLY, (w.state, result.canonical_reply))


def test_g3_paused_asks_then_confirms():
    section("G3 on a paused workflow: asks first, kept paused on refusal")
    for phrase in G3_PHRASES:
        v = Visit(paused=True)
        result = v.say(phrase)
        check(f"paused, {phrase!r}: still paused at step 2, the paused question asked",
              v.at_step_2(WorkflowState.SUSPENDED) and is_cancel_confirmation(v.pending)
              and result.canonical_reply == PAUSED_QUESTION, (v.state, result.canonical_reply))
        v.say("raddu")
        check(f"paused, {phrase!r} then 'raddu': cancelled",
              v.state == WorkflowState.CANCELLED and v.pending is None, (v.state,))

        w = Visit(paused=True)
        w.say(phrase)
        w.say("radd mat karo")
        check(f"paused, {phrase!r} then 'radd mat karo': kept paused, question cleared",
              w.at_step_2(WorkflowState.SUSPENDED) and w.pending is None, (w.state, w.pending))


def test_negated_requests_keep_the_workflow():
    section("negated requests never cancel")
    for text in NEGATED:
        v = Visit()
        v.say(text)
        check(f"{text!r} (LLM unknown): still active at step 2, no question",
              v.at_step_2() and v.pending is None, (v.state, v.pending))

        w = Visit(pending="confirm")
        result = w.say(text)
        check(f"confirmation pending, {text!r}: kept, question cleared",
              w.at_step_2() and w.pending is None and result.canonical_reply == KEPT,
              (w.state, result.canonical_reply))

        x = Visit(pending="switch")
        result = x.say(text)
        check(f"switch pending, {text!r}: nothing changes, switch question re-asked",
              x.at_step_2() and x.pending == SWITCH
              and result.canonical_reply == conflict_question(SWITCH), (x.snapshot(), result.canonical_reply))


# =========================================================
# G4 -- PENDING QUESTIONS
# =========================================================

def test_g4_confirmation_pending():
    section("G4 while a cancel confirmation is pending")
    for answer in G4_ANSWERS:
        v = Visit(pending="confirm")
        understood = v.fake.understand_calls
        result = v.say(answer)
        check(f"{answer!r}: cancels, question cleared",
              v.state == WorkflowState.CANCELLED and v.pending is None
              and result.canonical_reply == CANCELLED_REPLY, (v.state, result.canonical_reply))
        check(f"{answer!r}: the LLM was not consulted", v.fake.understand_calls == understood)


def test_g4_switch_pending():
    section("G4 while a workflow-switch question is pending: same as answering 'cancel'")
    reference = Visit(pending="switch")
    reference.say("cancel it and withdraw")
    for answer in G4_ANSWERS + G3_PHRASES:
        v = Visit(pending="switch")
        v.say(answer)
        check(f"{answer!r}: deposit replaced by withdrawal, nothing pending",
              v.conversation.current_intent == "withdraw money" and v.state == WorkflowState.ACTIVE
              and v.pending is None, v.snapshot())
        check(f"{answer!r}: same outcome as 'cancel it and withdraw'",
              v.snapshot() == reference.snapshot(), (v.snapshot(), reference.snapshot()))


def test_lookalikes_are_not_cancel():
    section("'raddi' (scrap paper) is never a cancel command or answer")
    for text in LOOKALIKES:
        v = Visit()
        v.say(text)
        check(f"active, {text!r}: untouched, nothing pending", v.at_step_2() and v.pending is None,
              (v.state, v.pending))

        w = Visit(pending="confirm")
        before = w.pending
        result = w.say(text)
        check(f"confirmation pending, {text!r}: not an answer, re-asked, nothing changed",
              w.at_step_2() and w.pending == before and result.canonical_reply == QUESTION,
              (w.state, result.canonical_reply))

        x = Visit(pending="switch")
        result = x.say(text)
        check(f"switch pending, {text!r}: not an answer, re-asked, nothing changed",
              x.at_step_2() and x.pending == SWITCH
              and result.canonical_reply == conflict_question(SWITCH), (x.snapshot(), result.canonical_reply))

        y = Visit(paused=True)
        y.say(text)
        check(f"paused, {text!r}: still paused, nothing pending",
              y.at_step_2(WorkflowState.SUSPENDED) and y.pending is None, (y.state, y.pending))


# =========================================================
# UNCHANGED PATHS
# =========================================================

def test_no_workflow_is_unchanged():
    section("no workflow: a G3 phrase behaves exactly like 'cancel'")
    for phrase in G3_PHRASES:
        reference = Visit(workflow=False)
        expected = reference.say("cancel")
        v = Visit(workflow=False)
        result = v.say(phrase)
        check(f"{phrase!r}: same reply and state as 'cancel'",
              result.canonical_reply == expected.canonical_reply and v.snapshot() == reference.snapshot(),
              (result.canonical_reply, expected.canonical_reply))
        check(f"{phrase!r}: no workflow, nothing pending", v.conversation.current_workflow is None
              and v.pending is None, v.snapshot())
    for text in ("radd", "raddu") + tuple(LOOKALIKES):
        v = Visit(workflow=False)
        v.say(text)
        check(f"no workflow, {text!r}: no workflow started, nothing pending, not exited",
              v.conversation.current_workflow is None and v.pending is None
              and v.conversation.session_state != SessionState.EXITED, v.snapshot())


def test_llm_cancel_path_still_asks():
    section("an LLM-labelled cancel still only asks")
    for text in ("haan radd karo", "houdu raddu maadi", "radd kar dijiye", "raddi wala form"):
        v = Visit(llm="cancel")
        result = v.say(text)
        check(f"LLM=cancel, {text!r}: the LLM path was used", v.fake.understand_calls == 1,
              v.fake.understand_calls)
        check(f"LLM=cancel, {text!r}: not cancelled, question asked",
              v.at_step_2() and is_cancel_confirmation(v.pending) and result.canonical_reply == QUESTION,
              (v.state, result.canonical_reply))
    for phrase in G3_PHRASES:
        v = Visit(llm="cancel")
        v.say(phrase)
        check(f"LLM=cancel, {phrase!r}: table path, asked, LLM not consulted",
              v.at_step_2() and is_cancel_confirmation(v.pending) and v.fake.understand_calls == 0)


def test_post_exit_guard():
    section("after exit, every G3/G4 turn gets the farewell and changes nothing")
    v = Visit()
    v.say("exit")
    understood = v.fake.understand_calls
    for text in G3_PHRASES + G4_ANSWERS + LOOKALIKES:
        result = v.say(text)
        check(f"after exit, {text!r}: farewell, ended",
              result.canonical_reply == FAREWELL and result.ended, result.canonical_reply)
    check("deposit exactly as it was, nothing pending, still EXITED, no LLM call",
          v.at_step_2() and v.pending is None
          and v.conversation.session_state == SessionState.EXITED
          and v.fake.understand_calls == understood, v.snapshot())


def test_exit_and_batch1_unchanged():
    section("exit phrases, बंद करो and Batch 1 are untouched")
    check("'बंद करो' is still a session exit", classify_command("बंद करो") == "session_exit",
          classify_command("बंद करो"))
    check("'radd karo' is still cancel", classify_command("radd karo") == "cancel")
    for phrase, command in (("agla", "next"), ("ek second", "pause"), ("dobara bolo", "repeat")):
        check(f"Batch 1 {phrase!r} is still {command}", classify_command(phrase) == command,
              classify_command(phrase))


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
