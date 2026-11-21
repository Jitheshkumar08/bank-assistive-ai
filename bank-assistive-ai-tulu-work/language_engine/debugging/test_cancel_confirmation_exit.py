"""
CANCEL CONFIRMATION AND POST-EXIT TURNS

Regression tests for the control-command audit's P1 and P3
(evaluation/reports/control_command_integration_audit.md):

  P1  A cancel is ASKED before it is carried out. A cancelled request cannot
      be resumed, and with hands-free listening one incidental "stop" is a
      complete turn. The question uses the existing pending-question slot (a
      WorkflowConflict with no requested workflow) and the existing routing;
      the workflow and its step stay exactly as they are until confirmed.

  P3  After "exit", the engine itself refuses every further turn with the
      same farewell and ended=True -- not only the frontend.

Also recorded: Hindi "बंद करो" is deliberately UNCHANGED (still an exit) in
this milestone; its meaning needs a native-speaker decision.

Real: DialogueManager, ConversationManager, WorkflowLoader, the localizer,
EngineRuntime.run_turn (so VoiceAssistantPipeline._respond is the real
router) and service.main.audio_turn. Stand-ins: dialogue understanding (the
LLM) and the intent detector, from the control-routing suite.

Offline: no network, no model, no audio.

Run from language_engine/:

    python -m debugging.test_cancel_confirmation_exit
"""

import asyncio
import io
import sys

from fastapi import UploadFile

from app.conversation.state import SessionState, WorkflowState
from app.dialogue.localization import TRANSLATED, ResponseLocalizer, localize_detailed
from app.dialogue.manager import classify_command
from app.dialogue.workflow_conflict import (
    CHOICE_CANCEL,
    CHOICE_CONTINUE,
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
CANCELLED = "Okay, I've cancelled that request. Let me know if you'd like help with something else."
STEP_2 = "Fill in your account number."


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


class Harness:
    """A deposit at step 2, driven through the real run_turn."""

    def __init__(self, language="en", step=2, paused=False):
        self.fake = FakeUnderstanding()
        self.detector = RecordingDetector()
        self.dialogue = make_dialogue(self.fake)
        self.runtime = EngineRuntime.__new__(EngineRuntime)
        self.runtime.dialogue = self.dialogue
        self.runtime.intent_detector = self.detector
        self.conversation = fresh_conversation()
        self.conversation.language = language
        self.localizer = ResponseLocalizer(language)
        self.dialogue.start_workflow(self.conversation, "deposit money")
        self.conversation.current_step = step
        if paused:
            self.conversation.suspend_workflow()

    def say(self, text):
        return self.runtime.run_turn(self.conversation, text, self.localizer)

    @property
    def state(self):
        return self.conversation.workflow_state

    @property
    def step(self):
        return self.conversation.current_step

    @property
    def pending(self):
        return self.conversation.workflow_conflict

    def untouched(self, state=WorkflowState.ACTIVE):
        return (self.state == state and self.step == 2
                and self.conversation.current_intent == "deposit money")


# =========================================================
# P1  CANCEL IS ASKED FIRST
# =========================================================

def test_first_cancel_only_asks():
    section("P1  the first cancel asks, and changes nothing")
    h = Harness()
    result = h.say("cancel")
    check("the reply is the confirmation question", result.reply == QUESTION, result.reply)
    check("the workflow and its step are untouched", h.untouched(), (h.state, h.step))
    check("a cancel confirmation is pending",
          is_cancel_confirmation(h.pending) and h.pending.current_workflow == "deposit money",
          str(h.pending))
    check("nothing reached intent detection", h.detector.calls == [], h.detector.calls)


def test_incidental_single_words_never_cancel():
    section("P1  incidental one-word cancels only ask (S1)")
    for text in ("stop", "never mind", "forget it", "ಸಾಕು", "ನಿಲ್ಲಿಸು", "ಬೇಡ",
                 "बस", "नहीं चाहिए", "रद्द करो", "saaku", "beda", "nahi chahiye"):
        h = Harness()
        result = h.say(text)
        check(f"{text!r}: asked, not cancelled",
              h.untouched() and is_cancel_confirmation(h.pending), (h.state, result.canonical_reply))


def test_confirmation():
    section("P1  an explicit second cancel confirms")
    for first, second in (("cancel", "cancel"), ("stop", "stop"), ("ಸಾಕು", "ನಿಲ್ಲಿಸು"),
                          ("बस", "रद्द करो"), ("cancel", "yes, cancel it"),
                          ("cancel", "ಹೌದು, ರದ್ದು ಮಾಡಿ"), ("cancel", "हाँ, रद्द करो"),
                          ("cancel", "ರದ್ದು")):
        h = Harness()
        h.say(first)
        result = h.say(second)
        check(f"{first!r} then {second!r}: cancelled",
              h.state == WorkflowState.CANCELLED and h.pending is None, (h.state, h.pending))
        check(f"{first!r} then {second!r}: the cancellation is reported as before",
              result.canonical_reply == CANCELLED, result.canonical_reply)


def test_refusal_keeps_everything():
    section("P1  refusing keeps the request exactly as it was")
    expected = f"Okay, I won't cancel it. {STEP_2} Let me know when you've completed it."
    for answer in ("continue", "resume", "keep it", "ಮುಂದುವರಿಸಿ", "जारी रखो",
                   "no", "No.", "don't cancel it", "ಬೇಡ", "नहीं चाहिए", "nahi chahiye", "beda",
                   "no, cancel it"):
        h = Harness()
        h.say("cancel")
        result = h.say(answer)
        check(f"{answer!r}: request untouched, question cleared",
              h.untouched() and h.pending is None, (h.state, h.step, h.pending))
        check(f"{answer!r}: says so and restates the step",
              result.canonical_reply == expected, result.canonical_reply)

    # A refusal is final for that question: a later cancel asks again.
    h = Harness()
    h.say("cancel")
    h.say("continue")
    result = h.say("cancel")
    check("cancelling again after a refusal asks again",
          result.canonical_reply == QUESTION and h.untouched(), result.canonical_reply)


def test_unclear_answers_ask_again():
    section("P1  anything that is not an answer asks again, touching nothing")
    for answer in ("what is a deposit slip?", "yes", "okay", "repeat", "next",
                   "I filled in my account number", "pause", "wait", "thanks", ""):
        h = Harness()
        h.say("cancel")
        understood = h.fake.understand_calls
        result = h.say(answer)
        if answer == "":
            # An empty turn is answered before routing, as it always was.
            check("'': the question is still pending",
                  is_cancel_confirmation(h.pending) and h.untouched())
            continue
        check(f"{answer!r}: the question is asked again",
              result.canonical_reply == QUESTION, result.canonical_reply)
        check(f"{answer!r}: still pending, nothing moved, no step advanced",
              is_cancel_confirmation(h.pending) and h.untouched(), (h.state, h.step, h.pending))
        check(f"{answer!r}: no LLM call and no intent detection",
              h.fake.understand_calls == understood and h.detector.calls == [],
              (h.fake.understand_calls, h.detector.calls))


def test_paused_request():
    section("P1  a paused request: asked in its own words, and kept paused")
    h = Harness(paused=True)
    result = h.say("cancel")
    check("the paused question names the pause",
          result.canonical_reply == f"Your deposit is currently paused. {QUESTION}",
          result.canonical_reply)
    check("still paused at step 2", h.untouched(WorkflowState.SUSPENDED), (h.state, h.step))

    result = h.say("continue")
    check("refusing does not resume it",
          h.untouched(WorkflowState.SUSPENDED) and h.pending is None, (h.state, h.pending))
    check("and says it is still paused",
          result.canonical_reply == ("Okay, I won't cancel it. That request is still paused. "
                                      "Say resume when you'd like to continue."),
          result.canonical_reply)

    h = Harness(paused=True)
    h.say("cancel")
    h.say("cancel")
    check("a paused request is cancelled only once confirmed", h.state == WorkflowState.CANCELLED)


def test_states_without_a_request():
    section("P1  no confirmation when there is nothing to lose")
    h = Harness()
    h.conversation.release_workflow()
    result = h.say("cancel")
    check("nothing active: the existing reply, no question",
          result.canonical_reply == "There's nothing active to cancel right now." and h.pending is None,
          result.canonical_reply)

    h = Harness()
    h.say("cancel")
    h.say("cancel")
    result = h.say("resume")
    check("a cancelled request still cannot be resumed",
          h.state == WorkflowState.CANCELLED and "cancelled" in result.canonical_reply.lower(),
          result.canonical_reply)


def test_a_new_workflow_clears_a_pending_question():
    section("P1  starting another request clears the question")
    h = Harness()
    h.say("cancel")
    h.dialogue.start_workflow(h.conversation, "withdraw money")
    check("load_workflow cleared the pending confirmation", h.pending is None, str(h.pending))


def test_localized_question_and_answers():
    section("P1  the question and answers in Kannada and Hindi")
    for language in ("kn", "hi"):
        for text in (QUESTION, f"Your deposit is currently paused. {QUESTION}",
                     f"Okay, I won't cancel it. {STEP_2} Let me know when you've completed it.",
                     "Okay, I won't cancel it. That request is still paused. "
                     "Say resume when you'd like to continue."):
            _, status = localize_detailed(text, language)
            check(f"[{language}] renders completely: {text[:40]!r}", status == TRANSLATED, status)

        h = Harness(language)
        result = h.say("cancel")
        check(f"[{language}] the customer hears the question in their language",
              result.reply == localize_detailed(QUESTION, language)[0], result.reply)

    # The words the localized question tells the customer to say really are
    # the two answers.
    check("ಮುಂದುವರಿಸಿ / जारी रखो are recognised as 'continue'",
          classify_command("ಮುಂದುವರಿಸಿ") == "resume" and classify_command("जारी रखो") == "resume")
    check("ರದ್ದು ಮಾಡಿ / रद्द करो select 'cancel'",
          resolve_conflict_answer("ರದ್ದು ಮಾಡಿ") == CHOICE_CANCEL
          and classify_command("रद्द करो") == "cancel")
    check("continue selects keep",  resolve_conflict_answer("continue") == CHOICE_CONTINUE)

    h = Harness("kn")
    h.say("ಸಾಕು")
    h.say("ಮುಂದುವರಿಸಿ")
    check("[kn] ಸಾಕು then ಮುಂದುವರಿಸಿ keeps the deposit at step 2", h.untouched(), (h.state, h.step))


def test_band_karo_unchanged():
    section("बंद करो -- deliberately unchanged in this milestone")
    check("'बंद करो' still classifies as session exit (pending native-speaker review)",
          classify_command("बंद करो") == "session_exit", classify_command("बंद करो"))


def test_signature_tolerant_router():
    section("the router still works with a dialogue manager that takes no text")
    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    class OldDialogue:
        def handle_control_command(self, conversation, command):
            return f"handled {command}"

    class Host:
        conversation = fresh_conversation()
        dialogue = OldDialogue()
        intent_detector = RecordingDetector()

    reply = VoiceAssistantPipeline._respond(Host(), "cancel", "cancel")
    check("an older handle_control_command(conversation, command) is still called",
          reply == "handled cancel", reply)


# =========================================================
# P3  NO TURNS AFTER EXIT
# =========================================================

def test_exit_then_more_turns():
    section("P3  every turn after exit gets the farewell")
    h = Harness()
    result = h.say("exit")
    check("exit ends the session", result.ended and h.conversation.session_state == SessionState.EXITED)
    history = list(h.conversation.history)
    understood = h.fake.understand_calls

    for text in ("cancel", "cancel", "I want to deposit money", "ಮುಂದುವರಿಸಿ",
                 "what is a cheque?", "", "exit"):
        result = h.say(text)
        check(f"after exit, {text!r}: the farewell, ended=True",
              result.canonical_reply == FAREWELL and result.ended, (result.canonical_reply, result.ended))

    check("after exit: the workflow is exactly as it was", h.untouched(), (h.state, h.step))
    check("after exit: nothing was confirmed or asked", h.pending is None, str(h.pending))
    check("after exit: history unchanged", h.conversation.history == history)
    check("after exit: no LLM call, no intent detection",
          h.fake.understand_calls == understood and h.detector.calls == [])

    h = Harness("kn")
    h.say("ನಿರ್ಗಮಿಸಿ")
    result = h.say("ಸಾಕು")
    check("[kn] after exit the farewell is in Kannada",
          result.reply == localize_detailed(FAREWELL, "kn")[0] and result.ended, result.reply)


def test_exit_while_confirmation_pending():
    section("P3  exit during a pending confirmation cancels nothing")
    h = Harness()
    h.say("cancel")
    result = h.say("bye")
    check("exit is honoured", result.ended)
    h.say("cancel")
    check("a later cancel is refused, not taken as the confirmation",
          h.untouched(), (h.state, h.step))


def test_audio_after_exit_is_not_transcribed():
    section("P3  /turn/audio after exit: no transcription, the same farewell")
    import service.engine as engine_module
    import service.main as main

    h = Harness()
    transcribed = []
    h.runtime.transcribe = lambda *args, **kwargs: transcribed.append(args) or "cancel"

    saved = engine_module._runtime
    engine_module.set_runtime(h.runtime)
    try:
        entry = main.registry.get_or_create("S-EXIT", "en")
        entry.conversation = h.conversation
        entry.localizer = h.localizer
        h.say("exit")

        upload = UploadFile(file=io.BytesIO(b"RIFF-not-really-audio"), filename="utterance.webm")
        response = asyncio.run(main.audio_turn(session_id="S-EXIT", language="en", audio=upload))

        check("the recording was not transcribed", transcribed == [], transcribed)
        check("the farewell, ended=True",
              response.reply == FAREWELL and response.ended is True, (response.reply, response.ended))
        check("the snapshot still shows the untouched workflow",
              response.workflow.state == "active" and response.workflow.step == 2,
              str(response.workflow))
    finally:
        main.registry.remove("S-EXIT")
        engine_module.set_runtime(saved)


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
