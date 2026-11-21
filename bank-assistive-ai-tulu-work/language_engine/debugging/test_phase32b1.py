"""
Phase 3.2B-1 regression tests -- polite control wrappers,
negation protection, the pause/resume dialogue contract,
type="control" routing, safe step_number coercion, and the
information-response honesty fix.

Six defects, all of them cases where the assistant either did
the wrong thing to a banking workflow or told the customer
something untrue about it:

  [A] "can you please repeat that" missed the exact-phrase
      control table and fell through to the LLM, so a control
      command was only as reliable as that turn's
      classification -- the exact tier the control table exists
      to avoid.

  [B] Stripping words before matching is the first thing in
      this tier that could turn a REFUSAL into a COMMAND.
      "don't pause" must never execute as "pause".

  [C] Pausing an already-paused request replied "Okay, I've
      paused this request" -- reporting a transition that did
      not happen. Resuming an already-active one replied with a
      bare instruction indistinguishable from a repeat.

  [D] The schema has a `control` TYPE but no pause/resume
      ACTION, so "I need to step away for a bit" arrived as
      type=control / action=none, matched no branch, and
      re-stated the current step. The customer asked to pause
      and the assistant carried on.

  [E] `1 <= step_number <= len(steps)` raises TypeError on the
      "3" / 3.0 / True the schema does not actually guarantee
      against, and True would silently read back step 1.

  [F] "I've noted that" was said even when nothing was
      extracted, issuing a receipt for a value the assistant
      did not hold.

Runs entirely offline: no microphone, no Groq calls, no model
downloads. DialogueUnderstanding and IntentDetector are
injected; the DialogueManager and the pipeline routing under
test are real.

Run from language_engine/:

    python -m debugging.test_phase32b1
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.workflow.loader import WorkflowLoader
from app.dialogue.manager import (
    DialogueManager,
    ACKNOWLEDGEMENT_PHRASES,
    SESSION_EXIT_PHRASES,
    WORKFLOW_CONTROL_PHRASES,
    POLITELY_WRAPPABLE_COMMANDS,
    classify_command,
    classify_polite_control,
    contains_negation,
    resolve_control_command,
    restate_current_step,
    strip_politeness,
)
from app.dialogue.llm.dialogue_understanding import (
    EMPTY_ENTITIES,
    DialogueUnderstanding,
    coerce_step_number,
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

    understand_calls is asserted on directly: a control command
    resolved in the deterministic tier must add NO LLM call.
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

    def set_raw_entities(self, message_type, action, raw_entities):
        """
        Bypasses entities() so a test can inject an entity dict
        that a real reply should never contain -- a string
        step_number, a bool, a missing key.
        """
        self.next_result = {
            "type": message_type,
            "action": action,
            "step_completed": False,
            "entities": raw_entities,
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

    IntentDetector is a total function with no abstention, so a
    control command reaching it becomes a banking request.
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
    """

    user_input = normalize_banking_terms(text)

    control = pipeline.dialogue.detect_control(user_input)

    if control == "session_exit":
        return "SESSION_EXIT"

    return pipeline._respond(control, user_input)


# =========================================================
# WORKFLOW STAGING
# =========================================================

SLIP_STEP = "Please take a withdrawal slip."
ACCOUNT_STEP = "Fill in your account number."
AMOUNT_STEP = "Enter the withdrawal amount."


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
# [A]  POLITE CONTROL WRAPPERS
# =========================================================

def test_polite_wrappers_classify():
    section("[A]  Politely wrapped pause / resume / repeat")

    polite_cases = [
        ("please pause", "pause"),
        ("can you pause", "pause"),
        ("could you pause for a moment", "pause"),
        ("can you please pause for a moment", "pause"),
        ("pause please", "pause"),
        ("just pause", "pause"),
        ("please continue", "resume"),
        ("can you continue", "resume"),
        ("could you please continue", "resume"),
        ("please resume", "resume"),
        ("resume please", "resume"),
        ("please repeat", "repeat"),
        ("can you repeat that", "repeat"),
        ("could you repeat that", "repeat"),
        ("can you please repeat that", "repeat"),
        ("would you repeat it please", "repeat"),
        ("kindly repeat that", "repeat"),
        ("say that again please", "repeat"),
        ("please say that again", "repeat"),
    ]

    for text, expected in polite_cases:
        check(
            f"[A] {text!r} -> {expected}",
            classify_command(text) == expected,
            classify_command(text),
        )

    # Punctuation and casing, as Whisper emits them.
    for text, expected in (
        ("Can you please repeat that?", "repeat"),
        ("PLEASE PAUSE.", "pause"),
        ("Can you please, repeat that", "repeat"),
    ):
        check(
            f"[A] STT form {text!r} -> {expected}",
            classify_command(text) == expected,
            classify_command(text),
        )

    # Conversational lead-ins are part of the wrapper. This is
    # what a customer actually says after being told "let me
    # know when you're ready to continue".
    for text, expected in (
        ("okay, please continue", "resume"),
        ("okay continue", "resume"),
        ("alright continue", "resume"),
        ("yes please continue", "resume"),
        ("okay repeat that", "repeat"),
        ("now repeat that please", "repeat"),
        ("yes pause", "pause"),
    ):
        check(
            f"[A] lead-in {text!r} -> {expected}",
            classify_command(text) == expected,
            classify_command(text),
        )


def test_lead_ins_do_not_cross_boundaries():
    section("[A]  Lead-ins never turn into the wrong command")

    # A bare acknowledgement stays an acknowledgement: pass 1
    # classifies it before the stripping pass is reached.
    for text, expected in (
        ("okay", "acknowledgement"),
        ("ok", "acknowledgement"),
        ("alright", "acknowledgement"),
        ("all right", "acknowledgement"),
    ):
        check(
            f"[A] bare {text!r} is still {expected}",
            classify_command(text) == expected,
            classify_command(text),
        )

    # "yes" and "done" are deliberately NOT in this tier -- either
    # can be evidence about the current step, and that judgement
    # belongs to dialogue understanding.
    for text in ("yes", "yeah", "done", "so", "now", "then"):
        check(
            f"[A] bare {text!r} is not classified here",
            classify_command(text) is None,
            classify_command(text),
        )

    # "next" and "cancel" are not politely wrappable, so a
    # lead-in cannot deterministically fire either one.
    # "yes, next" in particular must stay with the LLM
    # (understanding rule 56) so it is never read as completion.
    for text in (
        "yes next",
        "okay next",
        "yes, next",
        "okay cancel",
        "yes cancel",
        "alright stop",
    ):
        check(
            f"[A] {text!r} still reaches the LLM",
            classify_command(text) is None,
            classify_command(text),
        )


def test_polite_wrappers_do_not_widen_matching():
    section("[A]  Politeness never becomes fuzzy matching")

    # The wrapper is stripped; what is LEFT must still be an
    # exact control phrase. These leave something else over and
    # must reach the LLM untouched.
    must_be_none = [
        "can you repeat what you said about the loan rate?",
        "repeat step 3",
        "can you repeat step 2",
        "please tell me about education loans",
        "can you explain this step",
        "cancel my loan application tomorrow",
        "I want to deposit money",
        "what is a cheque book?",
        "please",
        "can you",
        "kindly",
        "could you please",
    ]

    for text in must_be_none:
        check(
            f"[A] not a control command: {text!r}",
            classify_command(text) is None,
            classify_command(text),
        )


def test_cancel_and_next_are_not_widened():
    section("[A]  cancel / next keep EXACT matching only")

    # Cancel destroys a request in progress and next is the one
    # control confusable with a request for direction. Neither
    # is politely wrappable, so neither gains a new surface to
    # fire on. Both still reach the LLM, which weighs the whole
    # sentence.

    check(
        "[A] only pause/resume/repeat are wrappable",
        POLITELY_WRAPPABLE_COMMANDS == ("pause", "resume", "repeat"),
        POLITELY_WRAPPABLE_COMMANDS,
    )

    for text in (
        "please cancel",
        "can you cancel",
        "could you please cancel that",
        "please stop",
        "can you stop this",
        "please next",
        "can you go to the next step",
        "please forget it",
    ):
        check(
            f"[A] not deterministically classified: {text!r}",
            classify_command(text) is None,
            classify_command(text),
        )

    # Session exit is likewise untouched by the politeness pass.
    for text in ("please exit", "can you exit", "kindly quit"):
        check(
            f"[A] politeness does not widen session exit: {text!r}",
            classify_command(text) is None,
            classify_command(text),
        )


def test_exact_matching_is_unchanged():
    section("[A]  Every phrase that classified before still does")

    # Pass 1 runs first and is untouched, so no existing
    # classification can have changed. "never mind" is the case
    # that proves it: it contains a negation token and would be
    # rejected by pass 2, but never reaches pass 2.

    for command, phrases in WORKFLOW_CONTROL_PHRASES.items():
        for phrase in phrases:
            check(
                f"[A] exact {phrase!r} -> {command}",
                classify_command(phrase) == command,
                classify_command(phrase),
            )

    check(
        "[A] 'never mind' -> cancel despite containing 'never'",
        classify_command("never mind") == "cancel",
        classify_command("never mind"),
    )

    for classification, phrases in ACKNOWLEDGEMENT_PHRASES.items():
        for phrase in phrases:
            check(
                f"[A] exact {phrase!r} -> {classification}",
                classify_command(phrase) == classification,
                classify_command(phrase),
            )

    for phrase in SESSION_EXIT_PHRASES:
        check(
            f"[A] exact {phrase!r} -> session_exit",
            classify_command(phrase) == "session_exit",
            classify_command(phrase),
        )

    check(
        "[A] trailing punctuation still normalizes",
        classify_command("Exit.") == "session_exit",
        classify_command("Exit."),
    )


def test_strip_politeness_unit():
    section("[A]  strip_politeness() decides nothing on its own")

    for text, expected in (
        ("can you please repeat that", "repeat"),
        ("would you repeat it please", "repeat"),
        ("pause for a moment", "pause"),
        ("just pause", "pause"),
        ("please continue", "continue"),
        ("repeat step 3", "repeat step 3"),
        ("please", "please"),
        ("", ""),
    ):
        check(
            f"[A] strip {text!r} -> {expected!r}",
            strip_politeness(text) == expected,
            strip_politeness(text),
        )

    check(
        "[A] a stripped remainder is still matched exactly",
        classify_polite_control("please continue") == "resume",
        classify_polite_control("please continue"),
    )

    check(
        "[A] nothing stripped -> pass 2 declines",
        classify_polite_control("pause") is None,
        classify_polite_control("pause"),
    )


# =========================================================
# [B]  NEGATION PROTECTION
# =========================================================

def test_negation_blocks_polite_path():
    section("[B]  A negated command is never executed")

    for text in (
        "don't pause",
        "do not pause",
        "please don't pause",
        "can you not repeat that",
        "no, don't cancel",
        "I don't want to pause",
        "never repeat that",
        "cannot continue",
        "don't continue please",
        "no need to repeat that",
    ):
        check(
            f"[B] refused, not executed: {text!r}",
            classify_command(text) is None,
            classify_command(text),
        )

    check(
        "[B] \"don't exit\" is still NOT session exit",
        classify_command("don't exit") is None,
        classify_command("don't exit"),
    )


def test_contains_negation_unit():
    section("[B]  contains_negation()")

    for text in (
        "don't pause",
        "dont pause",
        "do not pause",
        "no",
        "I cannot do this",
        "never",
        "won't continue",
    ):
        check(
            f"[B] negation detected: {text!r}",
            contains_negation(text) is True,
            contains_negation(text),
        )

    for text in (
        "pause",
        "please repeat that",
        "continue",
        "I filled my account number",
        "",
    ):
        check(
            f"[B] no negation: {text!r}",
            contains_negation(text) is False,
            contains_negation(text),
        )

    # Whisper emits a curly apostrophe.
    check(
        "[B] curly apostrophe folded: 'don’t pause'",
        contains_negation("don’t pause") is True,
        contains_negation("don’t pause"),
    )
    check(
        "[B] curly apostrophe form is not a command",
        classify_command("don’t pause") is None,
        classify_command("don’t pause"),
    )

    # "don't" must survive tokenization as ONE token.
    check(
        "[B] 'don' alone is not a negation token",
        contains_negation("don") is False,
        contains_negation("don"),
    )


def test_negation_blocks_llm_control_path():
    section("[B]  Negation guards the LLM control path too")

    for text in (
        "don't pause this please",
        "I do not want to continue right now",
        "no, don't hold on",
    ):
        check(
            f"[B] resolve_control_command declines: {text!r}",
            resolve_control_command(text) is None,
            resolve_control_command(text),
        )


def test_negated_control_does_not_change_state():
    section("[B]  A negated control leaves the workflow alone")

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("control", "none")
    dialogue.generate_response(conversation, "don't pause this please")

    check(
        "[B] the workflow is still ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[B] the step did not move",
        conversation.current_step == 3,
        conversation.current_step,
    )


# =========================================================
# [C]  PAUSE / RESUME DIALOGUE CONTRACT
# =========================================================

def test_pause_resume_contract():
    section("[C]  The pause/resume contract")

    fake, dialogue, conversation = withdraw_at_amount_step()
    conversation.add_entities({"account_number": "12345"})

    # ---- pause on ACTIVE -> suspends, confirms

    response = dialogue.handle_control_command(conversation, "pause")

    check(
        "[C] pause suspends",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[C] pause confirms the pause",
        "paused" in response.lower(),
        response,
    )
    check(
        "[C] pause does not move the step",
        conversation.current_step == 3,
        conversation.current_step,
    )

    # ---- pause on SUSPENDED -> no change, says so

    response = dialogue.handle_control_command(conversation, "pause")

    check(
        "[C] pausing twice stays SUSPENDED",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[C] the second pause says ALREADY paused",
        "already paused" in response.lower(),
        response,
    )
    check(
        "[C] the second pause does not re-confirm a transition",
        "i've paused" not in response.lower(),
        response,
    )
    check(
        "[C] pausing twice does not move the step",
        conversation.current_step == 3,
        conversation.current_step,
    )

    # ---- resume on SUSPENDED -> resumes, states the step

    response = dialogue.handle_control_command(conversation, "resume")

    check(
        "[C] resume reactivates",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[C] resume returns to the SAME step",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[C] resume states the step",
        AMOUNT_STEP in response,
        response,
    )
    check(
        "[C] resume marks the transition",
        response.startswith("Continuing."),
        response,
    )
    check(
        "[C] entities survive the pause/resume cycle",
        conversation.entities.get("account_number") == "12345",
        conversation.entities,
    )

    # ---- resume on ACTIVE -> no change, says so, still actionable

    response = dialogue.handle_control_command(conversation, "resume")

    check(
        "[C] resuming an active request stays ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[C] it says the request is ALREADY active",
        "already active" in response.lower(),
        response,
    )
    check(
        "[C] it does NOT claim a transition happened",
        not response.startswith("Continuing."),
        response,
    )
    check(
        "[C] the reply is still actionable",
        AMOUNT_STEP in response,
        response,
    )
    check(
        "[C] resuming an active request does not move the step",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_pause_resume_never_advances():
    section("[C]  Pause/resume are never evidence of completion")

    fake, dialogue, conversation = withdraw_at_amount_step()

    # The staging helper reaches step 3 through the normal
    # completion path, so it has already made LLM calls of its
    # own. Only the control turns below are under test.
    understand_before = fake.understand_calls

    for command in ("pause", "resume", "pause", "resume", "repeat"):
        dialogue.handle_control_command(conversation, command)
        check(
            f"[C] {command!r} left the step at 3",
            conversation.current_step == 3,
            conversation.current_step,
        )

    check(
        "[C] no LLM call for any deterministic control",
        fake.understand_calls == understand_before,
        (understand_before, fake.understand_calls),
    )


def test_polite_control_end_to_end():
    section("[C]  Polite control through the real pipeline")

    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    understand_before = fake.understand_calls

    response = turn(pipeline, "Can you please pause for a moment?")

    check(
        "[C] the polite pause SUSPENDED the workflow",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[C] intent detection was NOT called",
        detector.calls == [],
        detector.calls,
    )
    check(
        "[C] no LLM call was needed",
        fake.understand_calls == understand_before,
        (understand_before, fake.understand_calls),
    )
    check(
        "[C] the reply confirms the pause",
        "paused" in response.lower(),
        response,
    )

    response = turn(pipeline, "Okay, please continue.")

    check(
        "[C] the polite resume reactivated the workflow",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[C] it returned to the same step",
        AMOUNT_STEP in response and conversation.current_step == 3,
        (response, conversation.current_step),
    )
    check(
        "[C] no new workflow was started",
        conversation.current_workflow == "withdraw money",
        conversation.current_workflow,
    )

    response = turn(pipeline, "Can you repeat that?")

    check(
        "[C] the polite repeat returns the instruction",
        response == AMOUNT_STEP,
        response,
    )
    check(
        "[C] repeat did not advance",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_control_without_workflow_is_safe():
    section("[C]  Polite control with nothing active")

    fake = FakeUnderstanding()
    dialogue = make_dialogue(fake)

    for text in (
        "can you please pause",
        "please continue",
        "can you repeat that",
    ):
        conversation = fresh_conversation()
        command = classify_command(text)
        response = dialogue.handle_control_command(conversation, command)

        check(
            f"[C] {text!r} is safe with no workflow",
            isinstance(response, str) and bool(response),
            response,
        )
        check(
            f"[C] {text!r} started nothing",
            conversation.workflow_state is WorkflowState.NONE,
            conversation.workflow_state,
        )


# =========================================================
# [D]  type == "control" ROUTING
# =========================================================

def test_control_type_pauses():
    section('[D]  type="control" is routed, not ignored')

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("control", "none")
    response = dialogue.generate_response(
        conversation,
        "I need to step away for a bit"
    )

    check(
        "[D] the workflow is SUSPENDED",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[D] the step did not move",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[D] the reply confirms the pause",
        "paused" in response.lower(),
        response,
    )
    check(
        "[D] it does NOT just re-state the step",
        response != AMOUNT_STEP,
        response,
    )


def test_control_type_resumes():
    section('[D]  type="control" resume')

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("control", "none")
    dialogue.generate_response(conversation, "hold on for a moment")

    check(
        "[D] SUSPENDED before the resume",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )

    response = dialogue.generate_response(
        conversation,
        "okay let us pick up where we left off"
    )

    check(
        "[D] the workflow is ACTIVE again",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[D] it returned to the same step",
        conversation.current_step == 3 and AMOUNT_STEP in response,
        (conversation.current_step, response),
    )


def test_control_routes_through_one_contract():
    section("[D]  The LLM path shares ONE pause/resume contract")

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("control", "none")
    dialogue.generate_response(conversation, "please hold on for a moment")

    # A second natural-language pause must give the SAME
    # already-paused answer the deterministic path gives,
    # because both go through handle_control_command().
    response = dialogue.generate_response(
        conversation,
        "I still need to hold on for a moment"
    )

    check(
        "[D] still SUSPENDED",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[D] the LLM path says ALREADY paused too",
        "already paused" in response.lower(),
        response,
    )

    deterministic = dialogue.handle_control_command(conversation, "pause")

    check(
        "[D] both paths produce the identical reply",
        deterministic == response,
        (deterministic, response),
    )


def test_unresolvable_control_falls_through():
    section("[D]  An unresolvable control changes nothing")

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("control", "none")
    response = dialogue.generate_response(
        conversation,
        "something entirely unrelated"
    )

    check(
        "[D] the workflow is untouched",
        conversation.workflow_state is WorkflowState.ACTIVE
        and conversation.current_step == 3,
        (conversation.workflow_state, conversation.current_step),
    )
    check(
        "[D] a usable reply is still produced",
        isinstance(response, str) and bool(response),
        response,
    )


def test_control_beats_completion():
    section("[D]  A pause is honoured over a completion claim")

    # A message that both reports completion and asks to pause
    # honours the PAUSE. The customer resumes onto the step they
    # just did -- this file's established safe direction, since
    # the alternative moves a customer who asked to stop forward
    # into the next banking step.

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("control", "none", step_completed=True)
    response = dialogue.generate_response(
        conversation,
        "I entered it, but please hold on for a moment"
    )

    check(
        "[D] the pause was honoured",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[D] the step did NOT advance past the pause",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[D] the reply confirms the pause",
        "paused" in response.lower(),
        response,
    )


def test_resolve_control_command_unit():
    section("[D]  resolve_control_command()")

    for text, expected in (
        ("I need to step away for a bit", "pause"),
        ("can we hold on for a while", "pause"),
        ("give me a moment please", "pause"),
        ("hang on", "pause"),
        ("let us pick up where we left off", "resume"),
        ("okay let us continue with this now", "resume"),
        ("please carry on with the process", "resume"),
        ("can we proceed now", "resume"),
        ("what documents are needed", None),
        ("I filled my account number", None),
        ("", None),
    ):
        check(
            f"[D] {text!r} -> {expected}",
            resolve_control_command(text) == expected,
            resolve_control_command(text),
        )

    # Pause wins when both families appear: pausing loses
    # nothing, resuming against the customer's wish does.
    check(
        "[D] pause outranks resume when both appear",
        resolve_control_command(
            "pause now but I will continue later"
        ) == "pause",
        resolve_control_command("pause now but I will continue later"),
    )

    # Word-boundary matched.
    check(
        "[D] 'discontinued' is not a resume",
        resolve_control_command("that service was discontinued") is None,
        resolve_control_command("that service was discontinued"),
    )


def test_control_type_does_not_hijack_other_types():
    section("[D]  Only type=control reaches the control branch")

    # The same sentence classified as a question must be
    # answered, not turned into a pause.

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set("question", "none")
    response = dialogue.generate_response(
        conversation,
        "can I hold on to this slip after I continue?"
    )

    check(
        "[D] the question was answered",
        response == fake.answer,
        response,
    )
    check(
        "[D] the workflow stayed ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )
    check(
        "[D] the step did not move",
        conversation.current_step == 3,
        conversation.current_step,
    )


# =========================================================
# [E]  SAFE step_number COERCION
# =========================================================

def test_coerce_step_number_unit():
    section("[E]  coerce_step_number()")

    for value, expected in (
        (3, 3),
        ("3", 3),
        ("  3  ", 3),
        (3.0, 3),
        ("3.0", 3),
        (0, 0),
        (None, None),
        ("", None),
        ("   ", None),
        (3.5, None),
        ("three", None),
        ("step 3", None),
        ([3], None),
        ({"step": 3}, None),
        (float("nan"), None),
        (float("inf"), None),
    ):
        check(
            f"[E] coerce {value!r} -> {expected!r}",
            coerce_step_number(value) == expected
            if expected is not None
            else coerce_step_number(value) is None,
            coerce_step_number(value),
        )

    # bool is a subclass of int: True must NOT become step 1.
    check(
        "[E] True is not step 1",
        coerce_step_number(True) is None,
        coerce_step_number(True),
    )
    check(
        "[E] False is not step 0",
        coerce_step_number(False) is None,
        coerce_step_number(False),
    )


def test_step_number_coercion_in_repeat():
    section("[E]  A bad step_number never crashes a turn")

    # A string step number is honoured rather than raising
    # TypeError inside `1 <= step_number <= len(steps)`.

    fake, dialogue, conversation = withdraw_at_amount_step()

    fake.set_raw_entities(
        "workflow_action",
        "repeat",
        {"step_number": "2"},
    )
    response = dialogue.generate_response(conversation, "repeat step 2")

    check(
        "[E] a string step_number reads back that step",
        response == ACCOUNT_STEP,
        response,
    )
    check(
        "[E] repeat did not advance the workflow",
        conversation.current_step == 3,
        conversation.current_step,
    )

    # 3.0 is step 3.
    fake.set_raw_entities(
        "workflow_action", "repeat", {"step_number": 3.0}
    )
    check(
        "[E] a float step_number reads back that step",
        dialogue.generate_response(conversation, "repeat step 3")
        == AMOUNT_STEP,
    )

    # Unusable values fall back to the CURRENT step -- never a
    # crash, and never an arbitrary step.
    for bad in ("three", "", 3.5, [2], {"step": 2}):
        fake.set_raw_entities(
            "workflow_action", "repeat", {"step_number": bad}
        )
        response = dialogue.generate_response(conversation, "repeat that")
        check(
            f"[E] unusable step_number {bad!r} -> current step",
            response == AMOUNT_STEP,
            response,
        )

    # True must not silently read back step 1.
    fake.set_raw_entities(
        "workflow_action", "repeat", {"step_number": True}
    )
    response = dialogue.generate_response(conversation, "repeat that")
    check(
        "[E] True does not read back step 1",
        response == AMOUNT_STEP and response != SLIP_STEP,
        response,
    )

    # A missing entities key is still safe.
    fake.set_raw_entities("workflow_action", "repeat", {})
    check(
        "[E] a missing step_number -> current step",
        dialogue.generate_response(conversation, "repeat") == AMOUNT_STEP,
    )

    # Out of range is reported, not crashed.
    fake.set_raw_entities(
        "workflow_action", "repeat", {"step_number": "99"}
    )
    response = dialogue.generate_response(conversation, "repeat step 99")
    check(
        "[E] an out-of-range step is reported",
        "not available" in response.lower(),
        response,
    )
    check(
        "[E] the workflow survived all of it",
        conversation.workflow_state is WorkflowState.ACTIVE
        and conversation.current_step == 3,
        (conversation.workflow_state, conversation.current_step),
    )


def test_step_number_coerced_at_parse_time():
    section("[E]  Coercion also happens at parse time")

    understanding = object.__new__(DialogueUnderstanding)

    class FakeMessage:
        def __init__(self, content):
            self.content = content

    class FakeChoice:
        def __init__(self, content):
            self.message = FakeMessage(content)

    class FakeResponse:
        def __init__(self, content):
            self.choices = [FakeChoice(content)]

    result = understanding._parse_understanding(FakeResponse(
        '{"type": "workflow_action", "action": "repeat",'
        ' "entities": {"step_number": "2"}}'
    ))
    check(
        "[E] a string step_number is parsed to an int",
        result["entities"]["step_number"] == 2
        and isinstance(result["entities"]["step_number"], int),
        result["entities"],
    )

    result = understanding._parse_understanding(FakeResponse(
        '{"type": "workflow_action", "action": "repeat",'
        ' "entities": {"step_number": true}}'
    ))
    check(
        "[E] a bool step_number is parsed to None",
        result["entities"]["step_number"] is None,
        result["entities"],
    )

    result = understanding._parse_understanding(FakeResponse(
        '{"type": "question", "action": "none"}'
    ))
    check(
        "[E] a missing step_number is still None",
        result["entities"]["step_number"] is None,
        result["entities"],
    )

    result = understanding._parse_understanding(FakeResponse(
        '{"type": "workflow_action", "action": "repeat",'
        ' "entities": {"step_number": "null"}}'
    ))
    check(
        "[E] string 'null' still normalizes to None",
        result["entities"]["step_number"] is None,
        result["entities"],
    )


# =========================================================
# [F]  INFORMATION-RESPONSE HONESTY
# =========================================================

def test_information_receipt_is_honest():
    section("[F]  'I've noted that' means something WAS noted")

    fake, dialogue, conversation = withdraw_at_amount_step()

    # ---- something was actually extracted

    fake.set("information", "provide_information", amount=2000)
    response = dialogue.generate_response(conversation, "twenty thousand")

    check(
        "[F] a real value is acknowledged",
        "noted" in response.lower(),
        response,
    )
    check(
        "[F] the value was actually stored",
        conversation.entities.get("amount") == 2000,
        conversation.entities,
    )
    check(
        "[F] the instruction is still stated",
        AMOUNT_STEP in response,
        response,
    )
    check(
        "[F] information did not advance the step",
        conversation.current_step == 3,
        conversation.current_step,
    )


def test_information_with_nothing_extracted():
    section("[F]  Nothing extracted -> no false receipt")

    fake, dialogue, conversation = withdraw_at_amount_step()

    entities_before = dict(conversation.entities)

    # Classified as information, but every entity is null --
    # a muffled amount, a half-heard account number.
    fake.set("information", "provide_information")
    response = dialogue.generate_response(conversation, "it is uhh")

    check(
        "[F] it does NOT claim to have noted anything",
        "noted" not in response.lower(),
        response,
    )
    check(
        "[F] it says plainly that it did not catch it",
        "didn't catch" in response.lower(),
        response,
    )
    check(
        "[F] the instruction is still stated",
        AMOUNT_STEP in response,
        response,
    )
    check(
        "[F] nothing was stored",
        conversation.entities == entities_before,
        conversation.entities,
    )
    check(
        "[F] the step did not advance",
        conversation.current_step == 3,
        conversation.current_step,
    )
    check(
        "[F] the workflow stayed ACTIVE",
        conversation.workflow_state is WorkflowState.ACTIVE,
        conversation.workflow_state,
    )


def test_information_handler_directly():
    section("[F]  handle_information() in isolation")

    fake, dialogue, conversation = withdraw_at_amount_step()

    response = dialogue.handle_information(
        conversation, AMOUNT_STEP, {}
    )
    check(
        "[F] an empty entity dict -> no receipt",
        "noted" not in response.lower()
        and "didn't catch" in response.lower(),
        response,
    )

    response = dialogue.handle_information(
        conversation, AMOUNT_STEP, None
    )
    check(
        "[F] None entities -> no receipt, no crash",
        "noted" not in response.lower(),
        response,
    )

    response = dialogue.handle_information(
        conversation, AMOUNT_STEP, dict(EMPTY_ENTITIES)
    )
    check(
        "[F] an all-null entity set -> no receipt",
        "noted" not in response.lower(),
        response,
    )
    check(
        "[F] an all-null entity set stores nothing",
        conversation.entities == {},
        conversation.entities,
    )

    response = dialogue.handle_information(
        conversation, AMOUNT_STEP, {"amount": 500, "name": None}
    )
    check(
        "[F] one real value among nulls IS a receipt",
        "noted" in response.lower(),
        response,
    )
    check(
        "[F] only the real value is stored",
        conversation.entities == {"amount": 500},
        conversation.entities,
    )


# =========================================================
# [G]  PHASE 3.2A / 3.1 / 2.5 INVARIANTS PRESERVED
# =========================================================

def test_earlier_phase_invariants():
    section("[G]  Earlier-phase behaviour is unchanged")

    # Acknowledgements still classify and still do not resume.
    fake, dialogue, conversation = withdraw_at_amount_step()
    detector = RecordingDetector()
    pipeline = make_pipeline(dialogue, detector, conversation)

    turn(pipeline, "pause")
    response = turn(pipeline, "Thank you.")

    check(
        "[G] an acknowledgement does NOT resume",
        conversation.workflow_state is WorkflowState.SUSPENDED,
        conversation.workflow_state,
    )
    check(
        "[G] the acknowledgement reply says how to continue",
        "paused" in response.lower() and "resume" in response.lower(),
        response,
    )
    check(
        "[G] intent detection was never called",
        detector.calls == [],
        detector.calls,
    )

    # An explicit resume still works after all of the above.
    response = turn(pipeline, "resume")
    check(
        "[G] an explicit resume still resumes to the same step",
        conversation.workflow_state is WorkflowState.ACTIVE
        and conversation.current_step == 3
        and AMOUNT_STEP in response,
        (conversation.workflow_state, conversation.current_step, response),
    )

    # A real completion still advances exactly one step.
    fake.set("workflow_action", "complete", step_completed=True)
    response = turn(pipeline, "I entered the amount")
    check(
        "[G] a real completion still advances",
        conversation.current_step == 4,
        conversation.current_step,
    )

    # restate_current_step is untouched.
    check(
        "[G] restate_current_step unchanged",
        restate_current_step(AMOUNT_STEP)
        == f"{AMOUNT_STEP} Let me know when you've completed it.",
        restate_current_step(AMOUNT_STEP),
    )


# =========================================================
# RUN
# =========================================================

def main():
    test_polite_wrappers_classify()
    test_lead_ins_do_not_cross_boundaries()
    test_polite_wrappers_do_not_widen_matching()
    test_cancel_and_next_are_not_widened()
    test_exact_matching_is_unchanged()
    test_strip_politeness_unit()

    test_negation_blocks_polite_path()
    test_contains_negation_unit()
    test_negation_blocks_llm_control_path()
    test_negated_control_does_not_change_state()

    test_pause_resume_contract()
    test_pause_resume_never_advances()
    test_polite_control_end_to_end()
    test_control_without_workflow_is_safe()

    test_control_type_pauses()
    test_control_type_resumes()
    test_control_routes_through_one_contract()
    test_unresolvable_control_falls_through()
    test_control_beats_completion()
    test_resolve_control_command_unit()
    test_control_type_does_not_hijack_other_types()

    test_coerce_step_number_unit()
    test_step_number_coercion_in_repeat()
    test_step_number_coerced_at_parse_time()

    test_information_receipt_is_honest()
    test_information_with_nothing_extracted()
    test_information_handler_directly()

    test_earlier_phase_invariants()

    section("SUMMARY")

    print(f"  passed: {len(PASSED)}")
    print(f"  failed: {len(FAILED)}")

    if FAILED:
        print()
        for failure in FAILED:
            print(f"  FAILED  {failure}")
        return 1

    print()
    print("  All Phase 3.2B-1 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
