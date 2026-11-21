"""
DETERMINISTIC STEP COMPLETION BEFORE THE LLM -- regression tests.

app/dialogue/manager.py now advances a workflow step WITHOUT calling the
LLM when, and only when, _confirmed_completion_without_llm() passes all of
its gates (resolver confirms the CURRENT step; every clause a report; no
amount; no control word or joiner; not a verbatim repeat). Everything else
takes the existing LLM path unchanged.

Offline: the understanding collaborator is a recording fake that can also
simulate Groq being unavailable. DialogueManager, ConversationManager,
WorkflowLoader, the resolver and the pipeline routing are real.

Run from language_engine/:
    python -m debugging.test_deterministic_completion
"""

import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.dialogue.llm.dialogue_understanding import EMPTY_ENTITIES, fallback_understanding
from app.dialogue.manager import DialogueManager
from app.dialogue.term_normalizer import normalize_banking_terms
from app.workflow.loader import WorkflowLoader

for _out in (sys.stdout, sys.stderr):
    if hasattr(_out, "reconfigure"):
        _out.reconfigure(encoding="utf-8", errors="replace")

PASSED, FAILED = [], []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label}   {detail}")


def section(title):
    print("\n" + "=" * 62 + f"\n{title}\n" + "=" * 62)


class FakeUnderstanding:
    """Stands in for DialogueUnderstanding (Groq). Counts every call."""

    def __init__(self, unavailable=False):
        self.unavailable = unavailable
        self.understand_calls = 0
        self.next_result = fallback_understanding()

    def set(self, message_type, action, step_completed=False, **ents):
        entities = dict(EMPTY_ENTITIES)
        entities.update(ents)
        self.next_result = {"type": message_type, "action": action, "step_completed": step_completed,
                            "target_workflow": None, "entities": entities}

    def understand(self, user_text, current_workflow=None, current_step=None, current_instruction=None):
        self.understand_calls += 1
        if self.unavailable:
            # What DialogueUnderstanding returns when Groq fails (429, timeout).
            failed = dict(fallback_understanding())
            failed["understanding_failed"] = True
            return failed
        return self.next_result

    def answer_question(self, *args, **kwargs):
        return "GENERIC ANSWER"


class Detector:
    def __init__(self, intent):
        self.intent = intent

    def detect_intent(self, text):
        return {"intent": self.intent, "confidence": 0.95}


def setup(intent, unavailable=False):
    fake = FakeUnderstanding(unavailable=unavailable)
    dialogue = object.__new__(DialogueManager)
    dialogue.workflow_loader = WorkflowLoader()
    dialogue.dialogue_understanding = fake
    conversation = ConversationManager()
    conversation.start_conversation()
    from app.pipeline.voice_pipeline import VoiceAssistantPipeline

    pipeline = object.__new__(VoiceAssistantPipeline)
    pipeline.conversation = conversation
    pipeline.dialogue = dialogue
    pipeline.intent_detector = Detector(intent)
    pipeline.tts = None
    pipeline.select_language = lambda: ("English", "en")
    pipeline.select_input_mode = lambda: "2"
    pipeline.speak = lambda *a, **k: None
    return fake, conversation, pipeline


def turn(pipeline, text):
    """One turn as run_turn does it: normalize, record history, control tier, respond."""
    user_input = normalize_banking_terms(text)
    pipeline.conversation.add_history("User", user_input)
    control = pipeline.dialogue.detect_control(user_input)
    reply = pipeline._respond(control, user_input)
    pipeline.conversation.add_history("Assistant", str(reply))
    return str(reply)


D = ["Please take a deposit slip.", "Fill in your account number.", "Enter the amount to deposit.",
     "Submit the slip along with the cash."]
W = ["Please take a withdrawal slip.", "Fill in your account number.", "Enter the withdrawal amount.",
     "Sign the withdrawal slip.", "Submit the slip to the cashier."]


def test_confirmed_without_llm():
    section("1. Confirmed completion advances WITHOUT an LLM call (deposit)")
    fake, conv, p = setup("deposit money")
    check("start: deposit step 1", turn(p, "I want to deposit money") == D[0])
    for text, want, step in [("I have taken the slip.", D[1], 2),
                             ("I have filled in the account number.", D[2], 3),
                             ("I have entered the amount.", D[3], 4)]:
        before = fake.understand_calls
        reply = turn(p, text)
        check(f"'{text}' -> step {step}, no LLM call",
              reply == want and conv.current_step == step and fake.understand_calls == before,
              f"reply={reply!r} step={conv.current_step} calls={fake.understand_calls - before}")
    check("workflow still deposit money", conv.current_intent == "deposit money", conv.current_intent)


def test_groq_unavailable():
    section("2. Groq UNAVAILABLE: confirmed completion still works; nothing else advances")
    fake, conv, p = setup("withdraw money", unavailable=True)
    check("start: withdraw step 1 (deterministic)", turn(p, "I want to withdraw money") == W[0])
    for text, want, step in [("I have taken the slip.", W[1], 2),
                             ("I have filled in the account number.", W[2], 3),
                             ("I have entered the amount.", W[3], 4),
                             ("I have signed the slip.", W[4], 5)]:
        reply = turn(p, text)
        check(f"Groq down: '{text}' -> step {step}", reply == want and conv.current_step == step,
              f"reply={reply!r} step={conv.current_step}")
    check("Groq down: no understanding call was attempted for those four", fake.understand_calls == 0,
          fake.understand_calls)
    reply = turn(p, "Where is the cashier?")
    check("Groq down: a question does NOT advance (honest 'didn't catch that')",
          conv.current_step == 5 and reply.startswith("Sorry, I didn't catch that"), reply)
    reply = turn(p, "I gave it to the counter")
    check("Groq down: a report the resolver cannot tie to step 5 does not advance",
          conv.current_step == 5 and conv.workflow_state == WorkflowState.ACTIVE,
          f"step={conv.current_step} reply={reply!r}")


def test_unconfirmed_and_ambiguous():
    section("3. Unconfirmed / ambiguous / compound -> existing LLM path, no automatic advance")
    fake, conv, p = setup("deposit money")
    turn(p, "I want to deposit money")
    for text in ["I will take the slip.", "I have not taken the slip.", "Did I take the slip?"]:
        before_calls, before_step = fake.understand_calls, conv.current_step
        fake.set("acknowledgement", "none", step_completed=False)
        turn(p, text)
        check(f"'{text}': not advanced", conv.current_step == before_step, f"step={conv.current_step}")
    fake.set("acknowledgement", "none", step_completed=False)
    before = fake.understand_calls
    turn(p, "I took it, cancel")
    check("'I took it, cancel' is NOT fast-pathed (LLM consulted so cancel keeps priority)",
          fake.understand_calls == before + 1, fake.understand_calls - before)
    fake2, conv2, p2 = setup("deposit money")
    turn(p2, "I want to deposit money")
    fake2.set("question", "next_step", step_completed=True)
    before = fake2.understand_calls
    reply = turn(p2, "I have taken the slip. Where do I get a pen?")
    check("compound 'done + question' uses the LLM (question answered) and advances once",
          fake2.understand_calls == before + 1 and conv2.current_step == 2, f"step={conv2.current_step} reply={reply!r}")


def test_amount_goes_to_llm():
    section("4. A value to extract -> LLM path (entities preserved)")
    fake, conv, p = setup("deposit money")
    turn(p, "I want to deposit money")
    turn(p, "I have taken the slip.")
    turn(p, "I have filled in the account number.")
    fake.set("information", "provide_information", step_completed=False, amount=5000)
    before = fake.understand_calls
    turn(p, "I have entered 5000 rupees.")
    check("'I have entered 5000 rupees.' consulted the LLM", fake.understand_calls == before + 1)
    check("amount entity persisted and step advanced once", conv.entities.get("amount") == 5000
          and conv.current_step == 4, f"entities={conv.entities} step={conv.current_step}")


def test_no_double_advance():
    section("5. One response advances at most one step; a verbatim repeat is not fast-pathed")
    fake, conv, p = setup("withdraw money")
    turn(p, "I want to withdraw money")
    turn(p, "I have done it.")
    check("'I have done it.' -> exactly one step (1 -> 2)", conv.current_step == 2, conv.current_step)
    before = fake.understand_calls
    fake.set("acknowledgement", "none", step_completed=False)
    turn(p, "I have done it.")
    check("identical repeat is not fast-pathed: the existing LLM path decides",
          fake.understand_calls == before + 1, fake.understand_calls - before)
    check("and it still advanced at most one step", conv.current_step <= 3, conv.current_step)


def test_controls_unchanged():
    section("6. Controls keep their behaviour (deterministic tier, no LLM)")
    fake, conv, p = setup("deposit money")
    turn(p, "I want to deposit money")
    calls = fake.understand_calls
    check("repeat restates step 1", D[0] in turn(p, "repeat") and conv.current_step == 1)
    turn(p, "pause")
    check("pause suspends", conv.workflow_state == WorkflowState.SUSPENDED, conv.workflow_state)
    reply = turn(p, "I have taken the slip.")
    check("completion while suspended resumes and advances one step (existing rule)",
          conv.workflow_state == WorkflowState.ACTIVE and conv.current_step == 2 and reply == D[1],
          f"{conv.workflow_state} {conv.current_step} {reply!r}")
    turn(p, "resume")
    check("help does not advance", "account number" in turn(p, "help").lower() and conv.current_step == 2)
    turn(p, "thank you")
    check("thank you does not advance", conv.current_step == 2)
    check("no LLM call for any control or the confirmed completion", fake.understand_calls == calls,
          fake.understand_calls - calls)


def test_service_intents_separate():
    section("7. Service intents stay separate; withdrawal uses its own workflow")
    fake, conv, p = setup("withdraw money")
    turn(p, "I want to withdraw money")
    check("withdraw workflow active", conv.current_intent == "withdraw money", conv.current_intent)
    turn(p, "I have taken the slip.")
    turn(p, "I have filled in the account number.")
    turn(p, "I have entered the amount.")
    reply = turn(p, "I have signed the slip.")
    check("withdrawal step 4 -> 5 via 'signed' (withdraw.json, not deposit)", reply == W[4] and conv.current_step == 5)
    fake2, conv2, p2 = setup("deposit money")
    turn(p2, "I want to deposit money")
    before = fake2.understand_calls
    fake2.set("acknowledgement", "none", step_completed=False)
    turn(p2, "I have signed the slip.")
    check("'signed' does not confirm a DEPOSIT step (deposit has no signature step)",
          conv2.current_step == 1 and fake2.understand_calls == before + 1, f"step={conv2.current_step}")


def test_kannada_unchanged():
    section("8. Kannada is unchanged (resolver undecided -> LLM path)")
    fake, conv, p = setup("deposit money")
    turn(p, "I want to deposit money")
    fake.set("information", "none", step_completed=True)
    before = fake.understand_calls
    turn(p, "ನಾನು ಸ್ಲಿಪ್ ತೆಗೆದುಕೊಂಡೆ")
    check("Kannada completion consults the LLM exactly as before", fake.understand_calls == before + 1)


def main():
    for test in (test_confirmed_without_llm, test_groq_unavailable, test_unconfirmed_and_ambiguous,
                 test_amount_goes_to_llm, test_no_double_advance, test_controls_unchanged,
                 test_service_intents_separate, test_kannada_unchanged):
        test()
    print("\n" + "=" * 62)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    for f in FAILED:
        print("  FAILED:", f)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
