"""
PROACTIVE ASSISTANCE AND DETERMINISTIC HELP

Regression tests for:
  - app/dialogue/assistance.py   the curated catalogue: field types read from
                                 the workflow definitions, offers per field
                                 with more than one wording, help per field;
  - POST /sessions/{id}/assistance  (service/main.py, service/assistance.py)
                                 whether a quiet customer is offered help, in
                                 their language, without moving anything;
  - the `help` control command  explains the current field and restates the
                                 step through the real run_turn, read-only.

ALL NEW WORDING (English, Kannada, Hindi) IS AWAITING NATIVE-SPEAKER AND
BANK REVIEW. These tests prove routing and safety, not linguistic quality.

Real: the FastAPI app (TestClient, no lifespan, so no model loads),
SessionRegistry, EngineRuntime.run_turn, DialogueManager, ConversationManager,
ResponseLocalizer and the workflow definitions. Stand-ins: dialogue
understanding (FakeUnderstanding -- what a real LLM would say is NOT tested
here), IntentDetector (RecordingDetector), and get_runtime(), replaced by a
function that FAILS the test if the assistance endpoint reaches the runtime.

Offline: no network, no model, no audio.

Run from language_engine/:

    python -m debugging.test_proactive_assistance
"""

import copy
import sys

from fastapi.testclient import TestClient

import service.engine as engine_module
import service.main as main
from app.conversation.state import SessionState, WorkflowState
from app.dialogue.assistance import (
    ACCOUNT_NUMBER,
    AMOUNT,
    FIELD_HELP,
    FIELD_TYPES,
    GENERAL,
    PROMPTS,
    SIGNATURE,
    choose_prompt,
    field_help,
    step_field,
)
from app.dialogue.localization import ResponseLocalizer, localize_detailed
from app.dialogue.manager import classify_command
from app.dialogue.workflow_conflict import WorkflowConflict, is_cancel_confirmation
from app.workflow.loader import WorkflowLoader
from debugging.test_phase32b1_control_routing import (
    FakeUnderstanding,
    RecordingDetector,
    fresh_conversation,
    make_dialogue,
)
from service.engine import FAREWELL, EngineRuntime


PASSED = []
FAILED = []

LOADER = WorkflowLoader()
CONTINUE = "Let me know when you've completed it."
NO_REQUEST = "There's no active request right now. What banking service would you like help with?"


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


def instruction(workflow, step):
    return LOADER.load_workflow(workflow)["steps"][step - 1]["instruction"]


# =========================================================
# CATALOGUE AND WORKFLOW METADATA
# =========================================================

def test_fields_come_from_the_workflow_definitions():
    section("field types are read from the workflow definitions")
    expected = {
        ("deposit money", 1): GENERAL, ("deposit money", 2): ACCOUNT_NUMBER,
        ("deposit money", 3): AMOUNT, ("deposit money", 4): GENERAL,
        ("withdraw money", 2): ACCOUNT_NUMBER, ("withdraw money", 3): AMOUNT,
        ("withdraw money", 4): SIGNATURE, ("withdraw money", 5): GENERAL,
        ("apply for loan", 1): GENERAL, ("apply for loan", 3): GENERAL,
    }
    for (workflow, step), field in expected.items():
        got = step_field(LOADER.load_workflow(workflow)["steps"][step - 1])
        check(f"{workflow} step {step} is {field}", got == field, got)

    check("a step without a field is general", step_field({"step": 1, "instruction": "x"}) == GENERAL)
    check("an unknown field value is general, never trusted",
          step_field({"field": "pin_number"}) == GENERAL)
    check("no step dict at all is general", step_field(None) == GENERAL)


def test_catalogue_shape():
    section("every field has several offers and an explanation")
    for field in FIELD_TYPES:
        variants = PROMPTS[field]
        ids = [prompt_id for prompt_id, _ in variants]
        check(f"{field}: at least two wordings", len(variants) >= 2, len(variants))
        check(f"{field}: ids are unique and field-prefixed",
              len(set(ids)) == len(ids) and all(i.startswith(field + ".") for i in ids), ids)
        check(f"{field}: every offer ends by naming the answer word",
              all(text.endswith("Just say help.") for _, text in variants))
        check(f"{field}: has an explanation", bool(FIELD_HELP.get(field)))

    for field in FIELD_TYPES:
        first = choose_prompt(field)
        second = choose_prompt(field, avoid=first[0])
        third = choose_prompt(field, avoid=second[0])
        check(f"{field}: the next offer is never the one just shown",
              second[0] != first[0] and third[0] != second[0], (first[0], second[0], third[0]))

    check("an avoid id from another field is ignored",
          choose_prompt(AMOUNT, avoid="account_number.1")[0] == "amount.1")
    check("an unknown field falls back to the general offers",
          choose_prompt("unknown")[0] == "general.1")
    check("field_help falls back to general", field_help("unknown") == FIELD_HELP[GENERAL])
    check("the example wording is kept for the account number",
          choose_prompt(ACCOUNT_NUMBER)[1].startswith(
              "Take your time. Are you having difficulty entering the account number? "
              "I can help if you need me."))


def test_everything_renders_in_kannada_and_hindi():
    section("every offer and explanation renders completely in kn and hi")
    texts = [text for variants in PROMPTS.values() for _, text in variants] + list(FIELD_HELP.values())
    for text in texts:
        for language in ("kn", "hi"):
            rendered, status = localize_detailed(text, language)
            check(f"[{language}] {text[:48]!r}", status == "translated" and rendered != text, status)


# =========================================================
# THE ASSISTANCE ENDPOINT
# =========================================================

class RuntimeForbidden(AssertionError):
    pass


def forbidden_runtime():
    raise RuntimeForbidden("the assistance endpoint reached the engine runtime")


class Api:
    def __enter__(self):
        self.saved = (main.get_runtime, engine_module.get_runtime, main.INTERNAL_TOKEN)
        main.get_runtime = forbidden_runtime
        engine_module.get_runtime = forbidden_runtime
        main.INTERNAL_TOKEN = ""
        main.registry.clear()
        self.client = TestClient(main.app, raise_server_exceptions=True)
        self.dialogue = make_dialogue(FakeUnderstanding())
        return self

    def __exit__(self, *exc):
        main.get_runtime, engine_module.get_runtime, main.INTERNAL_TOKEN = self.saved
        main.registry.clear()

    def visit(self, session_id, workflow="deposit money", step=2, language="en"):
        entry = main.registry.get_or_create(session_id, language)
        if workflow:
            self.dialogue.start_workflow(entry.conversation, workflow)
            entry.conversation.current_step = step
        return entry

    def offer(self, session_id, avoid=None):
        body = {} if avoid is None else {"avoid": avoid}
        return self.client.post(f"/sessions/{session_id}/assistance", json=body)


def workflow_state_of(entry):
    """Everything an offer must leave exactly as it found -- all but history."""
    c = entry.conversation
    return copy.deepcopy((
        c.current_step, c.workflow_state, c.workflow_conflict, c.session_state,
        c.current_intent, c.current_workflow, c.entities, c.language,
        entry.language, entry.localizer.language, entry.last_used_at,
        entry.localizer.last_canonical,
    ))


def test_offer_for_an_active_step():
    section("an active step gets an offer for its field, and nothing moves")
    with Api() as api:
        entry = api.visit("S-1", step=2)
        before = workflow_state_of(entry)
        history = len(entry.conversation.history)

        response = api.offer("S-1")
        body = response.json()
        check("200", response.status_code == 200, response.status_code)
        check("offered, for the account number",
              body["offered"] is True and body["reason"] == "offered" and body["field"] == ACCOUNT_NUMBER,
              body)
        check("the first account-number wording, in English",
              body["prompt_id"] == "account_number.1" and body["text"] == PROMPTS[ACCOUNT_NUMBER][0][1],
              body)
        check("step, state, pending question, language, idle clock: all unchanged",
              workflow_state_of(entry) == before)
        check("the offer is in history as the assistant's words, once",
              len(entry.conversation.history) == history + 1
              and entry.conversation.history[-1]["message"] == body["text"]
              and entry.conversation.history[-1]["speaker"] == "Assistant",
              entry.conversation.history[-1:])
        check("only the documented fields cross the boundary",
              set(body) == {"offered", "reason", "field", "prompt_id", "text"}, sorted(body))

        again = api.offer("S-1", avoid=body["prompt_id"]).json()
        check("the next offer is worded differently", again["prompt_id"] == "account_number.2", again)


def test_offer_per_field():
    section("the offer follows the step's field")
    cases = [("deposit money", 1, GENERAL), ("deposit money", 3, AMOUNT),
             ("withdraw money", 4, SIGNATURE), ("apply for loan", 2, GENERAL)]
    with Api() as api:
        for index, (workflow, step, field) in enumerate(cases):
            api.visit(f"S-F{index}", workflow=workflow, step=step)
            body = api.offer(f"S-F{index}").json()
            check(f"{workflow} step {step}: {field}",
                  body["offered"] and body["field"] == field and body["prompt_id"] == f"{field}.1", body)


def test_offer_in_the_visit_language():
    section("the offer is rendered in the visit's language")
    with Api() as api:
        api.visit("S-KN", step=2, language="kn")
        body = api.offer("S-KN").json()
        expected, _ = localize_detailed(PROMPTS[ACCOUNT_NUMBER][0][1], "kn")
        check("Kannada text", body["text"] == expected, body["text"])
        check("the canonical English is what history keeps",
              main.registry.peek("S-KN").conversation.history[-1]["message"] == PROMPTS[ACCOUNT_NUMBER][0][1])


def test_no_offer_when_it_does_not_fit():
    section("no offer while paused, questioned, idle, finished or ended")
    with Api() as api:
        check("unknown visit: not created, not offered",
              api.offer("S-NONE").json() == {"offered": False, "reason": "unknown_session",
                                             "field": None, "prompt_id": None, "text": None}
              and main.registry.peek("S-NONE") is None)

        cases = {}

        paused = api.visit("S-PAUSED")
        paused.conversation.suspend_workflow()
        cases["S-PAUSED"] = "paused"

        confirm = api.visit("S-CONFIRM")
        api.dialogue.handle_control_command(confirm.conversation, "cancel")
        cases["S-CONFIRM"] = "pending_question"

        switch = api.visit("S-SWITCH")
        switch.conversation.remember_workflow_conflict(WorkflowConflict("deposit money", "withdraw money"))
        cases["S-SWITCH"] = "pending_question"

        api.visit("S-IDLE", workflow=None)
        cases["S-IDLE"] = "no_active_step"

        done = api.visit("S-DONE")
        done.conversation.complete_workflow()
        cases["S-DONE"] = "no_active_step"

        gone = api.visit("S-CANCELLED")
        gone.conversation.cancel_workflow()
        cases["S-CANCELLED"] = "no_active_step"

        exited = api.visit("S-EXIT")
        exited.conversation.update_session_state(SessionState.EXITED)
        cases["S-EXIT"] = "ended"

        for session_id, reason in cases.items():
            entry = main.registry.peek(session_id)
            before = copy.deepcopy((entry.conversation.history, workflow_state_of(entry)))
            body = api.offer(session_id).json()
            check(f"{session_id}: not offered ({reason})",
                  body["offered"] is False and body["reason"] == reason and body["text"] is None, body)
            check(f"{session_id}: nothing changed, not even history",
                  copy.deepcopy((entry.conversation.history, workflow_state_of(entry))) == before)

        check("the pending cancel confirmation is still the pending question",
              is_cancel_confirmation(main.registry.peek("S-CONFIRM").conversation.workflow_conflict))


def test_busy_and_invalid():
    section("a turn in progress is 409; a malformed avoid id is refused")
    with Api() as api:
        entry = api.visit("S-BUSY")
        saved = main.SNAPSHOT_LOCK_TIMEOUT_SECONDS
        main.SNAPSHOT_LOCK_TIMEOUT_SECONDS = 0.05
        entry.lock.acquire()
        try:
            response = api.offer("S-BUSY")
        finally:
            entry.lock.release()
            main.SNAPSHOT_LOCK_TIMEOUT_SECONDS = saved
        check("409 while the turn lock is held", response.status_code == 409, response.status_code)
        check("nothing was offered or recorded", len(entry.conversation.history) == 0,
              entry.conversation.history)

        for bad in ("../x", "x" * 80, "ACCOUNT.1", "account_number"):
            response = api.offer("S-BUSY", avoid=bad)
            check(f"avoid {bad[:12]!r}: 422", response.status_code == 422, response.status_code)


def test_silence_never_advances():
    section("repeated offers -- silence -- never move a workflow")
    with Api() as api:
        entry = api.visit("S-QUIET", step=2)
        last = None
        for _ in range(10):
            body = api.offer("S-QUIET", avoid=last).json()
            last = body["prompt_id"]
        c = entry.conversation
        check("still deposit, step 2, ACTIVE, nothing pending, not exited",
              c.current_workflow == "deposit money" and c.current_step == 2
              and c.workflow_state == WorkflowState.ACTIVE and c.workflow_conflict is None
              and c.session_state != SessionState.EXITED,
              (c.current_step, c.workflow_state, c.workflow_conflict))
        check("no entities were invented", not any(c.entities.values()), c.entities)


def test_offer_never_touches_the_runtime():
    section("the endpoint never reaches the runtime (no ASR, LLM, intent model)")
    with Api() as api:
        api.visit("S-RT")
        try:
            response = api.offer("S-RT")
            check("served without the runtime", response.status_code == 200, response.status_code)
        except RuntimeForbidden as error:
            check("served without the runtime", False, str(error))


# =========================================================
# DETERMINISTIC HELP, THROUGH run_turn
# =========================================================

class Visit:
    def __init__(self, workflow="deposit money", step=2, paused=False, language="en"):
        self.fake = FakeUnderstanding()
        self.fake.set("unknown", "none")
        self.detector = RecordingDetector()
        self.runtime = EngineRuntime.__new__(EngineRuntime)
        self.runtime.dialogue = make_dialogue(self.fake)
        self.runtime.intent_detector = self.detector
        self.conversation = fresh_conversation()
        self.localizer = ResponseLocalizer(language)
        if workflow:
            self.runtime.dialogue.start_workflow(self.conversation, workflow)
            self.conversation.current_step = step
            if paused:
                self.conversation.suspend_workflow()

    def say(self, text):
        return self.runtime.run_turn(self.conversation, text, self.localizer)

    def where(self):
        c = self.conversation
        return (c.current_workflow, c.current_step, c.workflow_state, c.workflow_conflict)


def test_help_explains_and_keeps_the_step():
    section("help explains the field and restates the same step")
    cases = [("deposit money", 2, ACCOUNT_NUMBER), ("deposit money", 3, AMOUNT),
             ("withdraw money", 4, SIGNATURE), ("deposit money", 1, GENERAL)]
    for workflow, step, field in cases:
        for phrase in ("help", "help me", "I need help", "Please help."):
            v = Visit(workflow, step)
            before = v.where()
            result = v.say(phrase)
            expected = f"{FIELD_HELP[field]} {instruction(workflow, step)} {CONTINUE}"
            check(f"{workflow} step {step}, {phrase!r}: explained and restated",
                  result.canonical_reply == expected, result.canonical_reply)
            check(f"{workflow} step {step}, {phrase!r}: same step, nothing pending",
                  v.where() == before, v.where())
            check(f"{workflow} step {step}, {phrase!r}: deterministic -- no LLM, no intent detection",
                  v.fake.understand_calls == 0 and v.detector.calls == [],
                  (v.fake.understand_calls, v.detector.calls))


def test_help_in_kannada_and_hindi():
    section("ಸಹಾಯ / मदद work like help, and the reply is in the session language")
    for phrase, language in (("ಸಹಾಯ", "kn"), ("ಸಹಾಯ ಬೇಕು", "kn"), ("मदद", "hi"), ("मदद चाहिए", "hi")):
        v = Visit(language=language)
        result = v.say(phrase)
        expected = f"{FIELD_HELP[ACCOUNT_NUMBER]} {instruction('deposit money', 2)} {CONTINUE}"
        rendered, status = localize_detailed(expected, language)
        check(f"{phrase!r}: the account-number explanation", result.canonical_reply == expected,
              result.canonical_reply)
        check(f"{phrase!r}: rendered completely in {language}",
              status == "translated" and result.reply == rendered, result.reply)
        check(f"{phrase!r}: still step 2", v.conversation.current_step == 2)


def test_help_while_paused():
    section("help on a paused request explains, and the request stays paused")
    v = Visit(paused=True)
    result = v.say("help")
    check("explained, with how to resume",
          result.canonical_reply == f"{FIELD_HELP[ACCOUNT_NUMBER]} {instruction('deposit money', 2)} "
                                    "Say resume when you'd like to continue.",
          result.canonical_reply)
    check("still paused at step 2", v.where() == ("deposit money", 2, WorkflowState.SUSPENDED, None))
    check("renders completely in Kannada",
          localize_detailed(result.canonical_reply, "kn")[1] == "translated")


def test_help_does_not_answer_a_pending_question():
    section("help while a question is pending re-asks it and changes nothing")
    v = Visit()
    question = v.say("cancel").canonical_reply
    pending = v.conversation.workflow_conflict
    result = v.say("help")
    check("the cancel confirmation is asked again", result.canonical_reply == question,
          result.canonical_reply)
    check("still pending, deposit untouched",
          v.conversation.workflow_conflict == pending and v.conversation.current_step == 2
          and v.conversation.workflow_state == WorkflowState.ACTIVE)

    w = Visit()
    switch = WorkflowConflict("deposit money", "withdraw money")
    w.conversation.remember_workflow_conflict(switch)
    w.say("help")
    check("a switch question stays pending, deposit untouched",
          w.conversation.workflow_conflict == switch and w.conversation.current_step == 2
          and w.conversation.current_workflow == "deposit money")


def test_help_without_a_workflow():
    section("help with no request starts nothing")
    v = Visit(workflow=None)
    result = v.say("help")
    check("asks which service", result.canonical_reply == NO_REQUEST, result.canonical_reply)
    check("no workflow started, intent detection not consulted",
          v.conversation.current_workflow is None and v.detector.calls == [], v.detector.calls)


def test_help_is_exact_phrase_only():
    section("only the whole utterance is help")
    for text in ("help me open an account", "I need help with a loan", "helpful", "can you help"):
        check(f"{text!r} is not the help command", classify_command(text) != "help",
              classify_command(text))


def test_after_an_offer():
    section("after an offer: help explains; silence and 'yes' do not complete; done follows the rules")
    with Api() as api:
        api.visit("S-AFTER", step=2)
        api.offer("S-AFTER")
        conversation = main.registry.peek("S-AFTER").conversation

    v = Visit()
    v.conversation = conversation
    result = v.say("help")
    check("help after an offer explains the account number and keeps step 2",
          result.canonical_reply.startswith(FIELD_HELP[ACCOUNT_NUMBER]) and conversation.current_step == 2,
          result.canonical_reply)

    # Simulated LLM: says the step is NOT done. What a real model does with
    # "yes" here is not tested.
    v.fake.set("workflow_action", "none", step_completed=False)
    v.say("yes")
    check("'yes' read as not-completed keeps step 2", conversation.current_step == 2,
          conversation.current_step)

    # Simulated LLM: the customer reports the step done. The existing
    # completion rules advance exactly one step.
    v.fake.set("workflow_action", "complete", step_completed=True)
    v.say("I have written it")
    check("a reported completion advances exactly one step, by the existing rules",
          conversation.current_step == 3 and conversation.workflow_state == WorkflowState.ACTIVE,
          conversation.current_step)


def test_post_exit_help_is_refused():
    section("after exit, help gets the farewell")
    v = Visit()
    v.say("exit")
    result = v.say("help")
    check("farewell, ended", result.canonical_reply == FAREWELL and result.ended, result.canonical_reply)
    check("deposit untouched at step 2", v.conversation.current_step == 2)


# =========================================================
# VOICE-FIRST SERVICE SELECTION REUSES THE EXISTING ROUTING
# =========================================================

class ScriptedDetector:
    """IntentDetector's result shape, scripted. Records every call."""

    def __init__(self, intent="withdraw money", banking=True, category=None, withheld=False,
                 abstain_reason=None):
        self.calls = []
        self.result = {
            "intent": intent, "confidence": 0.8, "category": category or ("banking" if banking else "other"),
            "is_banking_intent": banking, "withheld_start": withheld, "abstain_reason": abstain_reason,
            "margin": 0.2,
        }

    def detect_intent(self, text):
        self.calls.append(text)
        return dict(self.result)


def spoken_visit(detector, workflow=None):
    v = Visit(workflow=workflow)
    v.detector = detector
    v.runtime.intent_detector = detector
    return v


def test_spoken_request_starts_the_workflow_through_intent_detection():
    section("a spoken request ('I want to withdraw money') starts the workflow by the existing route")
    for transcript in ("I want to withdraw money", "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು"):
        detector = ScriptedDetector("withdraw money")
        v = spoken_visit(detector)
        result = v.say(transcript)
        check(f"{transcript!r}: the one intent detector was asked, with the transcript",
              detector.calls == [transcript], detector.calls)
        check(f"{transcript!r}: withdrawal started at step 1 by the workflow engine",
              v.where() == ("withdraw money", 1, WorkflowState.ACTIVE, None), v.where())
        check(f"{transcript!r}: the first step is the reply",
              result.canonical_reply == instruction("withdraw money", 1), result.canonical_reply)


def test_ambiguous_or_unsupported_request_starts_nothing():
    section("an abstaining detector (ambiguous, unsupported) starts no workflow")
    for reason, category in (("unsupported_operation", "unsupported_operation"),
                             ("no_service_named", "other")):
        detector = ScriptedDetector(banking=False, category=category, withheld=True, abstain_reason=reason)
        v = spoken_visit(detector)
        result = v.say("send money to my brother by UPI")
        check(f"{reason}: no workflow", v.conversation.current_workflow is None
              and v.conversation.workflow_state == WorkflowState.NONE, v.where())
        check(f"{reason}: answered (clarified or refused), not silent", bool(result.canonical_reply.strip()))

    detector = ScriptedDetector("withdraw money")
    v = spoken_visit(detector)
    v.say("I don't want to withdraw money")
    check("a refused service ('I don't want to withdraw money') starts nothing",
          v.conversation.current_workflow is None, v.where())


def test_no_silent_switch_during_a_workflow():
    section("a new spoken request during a workflow never switches silently")
    detector = ScriptedDetector("withdraw money")
    v = spoken_visit(detector, workflow="deposit money")
    v.say("I want to withdraw money")
    c = v.conversation
    check("the deposit is still the workflow (or a switch question is pending) -- never a silent withdrawal",
          c.current_workflow == "deposit money" and c.workflow_state == WorkflowState.ACTIVE,
          v.where())


def main_():
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
    sys.exit(main_())
