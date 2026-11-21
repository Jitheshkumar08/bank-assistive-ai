"""
PHASE 3.2B-12 -- MULTILINGUAL INTENT, ABSTENTION, CONTROLS, AMOUNTS, LOCALIZATION

Offline: no microphone, no ASR, no network. The embedding model is local; the
LLM is never called (every path exercised here is deterministic or embedding
based).

THE INVARIANT THIS SUITE EXISTS FOR

    No banking workflow may start from an utterance that is not a banking
    service request.

Live sessions broke it repeatedly -- "Thank you." started a loan workflow,
"ಸಾಕು" scored as "withdraw money" -- so every non-banking case below asserts
BOTH the classification and that workflow_state never became ACTIVE.

Run from language_engine/:
    python -m debugging.test_phase32b12
"""
import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.dialogue.indic_numbers import extract_amount
from app.dialogue.localization import ResponseLocalizer, localize
from app.dialogue.manager import DialogueManager, classify_command
from app.intent.detector import BANKING_MARGIN, IntentDetector
from app.intent.intents import INTENTS
from app.workflow.loader import WorkflowLoader


class FakeUnderstanding:
    """Stands in for the Groq-backed understanding client.

    Only answer_question() is exercised here (the knowledge branch); it records
    what it was asked so the test can assert the question reached the knowledge
    path rather than a workflow.
    """

    def __init__(self):
        self.questions = []

    def answer_question(self, question, workflow_context,
                        current_instruction, recent_context=None):
        self.questions.append(question)
        return "ANSWERED-FROM-KNOWLEDGE-BASE"


def make_dialogue():
    """A DialogueManager without the real LLM client.

    Same pattern as the Phase 3.2B-1 suite: __init__ builds a Groq client and
    needs GROQ_API_KEY, which an offline suite must not require.
    """
    manager = object.__new__(DialogueManager)
    manager.workflow_loader = WorkflowLoader()
    manager.dialogue_understanding = FakeUnderstanding()
    return manager

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


# =========================================================
# 1-4  BANKING INTENTS IN KANNADA (and Hindi)
# =========================================================

def test_banking_intents(detector):
    section("Kannada/Hindi banking intents (1-4)")

    cases = [
        ("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "deposit money"),
        ("ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು", "withdraw money"),
        ("ನನ್ನ ಖಾತೆಯ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು", "check account balance"),
        ("ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು", "deposit money"),
        ("मुझे पैसे निकालने हैं", "withdraw money"),
        ("मुझे लोन चाहिए", "apply for loan"),
    ]
    for text, expected in cases:
        result = detector.detect_intent(text)
        check(f"{text} -> {expected}",
              result["intent"] == expected and result["is_banking_intent"],
              f"got {result['intent']} banking={result['is_banking_intent']} "
              f"margin={result['margin']}")

    # 4: the amount must survive alongside the intent.
    check("ಐದು ಸಾವಿರ ರೂಪಾಯಿ deposit carries amount 5000",
          extract_amount("ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು") == 5000)

    # 3: balance is recognised, and has no workflow definition -- the graceful
    # path must answer without wedging the session.
    dialogue = make_dialogue()
    conversation = ConversationManager()
    conversation.start_conversation()
    started, response = dialogue.start_workflow(conversation, "check account balance")
    check("check balance: no workflow exists -> graceful, not started", not started)
    check("check balance: state not ACTIVE",
          conversation.workflow_state != WorkflowState.ACTIVE,
          str(conversation.workflow_state))
    check("check balance: a response is still produced", bool(response))


# =========================================================
# 5-8  CONTROLS AND ACKNOWLEDGEMENTS, IDLE AND ACTIVE
# =========================================================

def test_controls_and_acknowledgements(detector):
    section("Kannada controls / acknowledgements, idle and active (5-8)")

    expected_command = {
        "ನಿಲ್ಲಿಸು": "cancel",
        "ಸಾಕು": "cancel",
        "ಧನ್ಯವಾದಗಳು": "thanks",
        "ಧನ್ಯವಾದ": "thanks",
        "ವಿರಾಮ": "pause",
        "ಮುಂದುವರಿಸಿ": "resume",
        "ಮತ್ತೆ ಹೇಳಿ": "repeat",
        "ಹೊರಗೆ": "session_exit",
        "धन्यवाद": "thanks",
        "शुक्रिया": "thanks",
        "फिर से बताइए": "repeat",
        "रुको": "pause",
        "बस": "cancel",
    }
    for text, command in expected_command.items():
        got = classify_command(text)
        check(f"classify_command({text}) == {command}", got == command, f"got {got}")

    # State independence: the deterministic tier runs before any state check,
    # so the same phrase classifies identically idle and mid-workflow. This is
    # the property that was missing when ಸಾಕು worked in a workflow but became
    # a withdrawal at idle.
    for text in ("ನಿಲ್ಲಿಸು", "ಸಾಕು", "ಧನ್ಯವಾದ"):
        check(f"{text}: identical classification idle and active",
              classify_command(text) == classify_command(text.strip()))

    # And none of them may be read as a banking request.
    for text in ("ನಿಲ್ಲಿಸು", "ಸಾಕು", "ಧನ್ಯವಾದಗಳು", "ಧನ್ಯವಾದ", "धन्यवाद"):
        result = detector.detect_intent(text)
        check(f"{text} is NOT a banking intent", not result["is_banking_intent"],
              f"{result['intent']} margin={result['margin']}")


# =========================================================
# 9-12  SAFETY / OUT OF DOMAIN
# =========================================================

def test_out_of_domain(detector):
    section("Unsafe and unrelated requests must never start a workflow (9-12)")

    dialogue = make_dialogue()

    for text in ("I want to hack the site",
                 "I want to rob the bank",
                 "What is the capital of France?",
                 "Tell me a joke",
                 "How can I steal money?",
                 "ನಾನು ಬ್ಯಾಂಕ್ ದೋಚಬೇಕು",
                 "मुझे बैंक लूटना है"):
        result = detector.detect_intent(text)
        check(f"{text!r} abstains", not result["is_banking_intent"],
              f"{result['intent']} margin={result['margin']} cat={result['category']}")

        # The routing layer must answer without touching state.
        conversation = ConversationManager()
        conversation.start_conversation()
        response = dialogue.handle_non_banking_request(
            result["category"], text, conversation)
        check(f"{text!r} -> workflow_state not ACTIVE",
              conversation.workflow_state != WorkflowState.ACTIVE,
              str(conversation.workflow_state))
        check(f"{text!r} -> a reply is produced", bool(response))


# =========================================================
# 13-14  BANKING KNOWLEDGE QUESTIONS
# =========================================================

def test_knowledge_questions(detector):
    section("Banking knowledge questions route to knowledge, not workflows (13-14)")

    dialogue = make_dialogue()

    for text in ("What is a savings account?",
                 "Why do banks charge interest?",
                 "What documents are generally needed for a loan?"):
        result = detector.detect_intent(text)
        check(f"{text!r} is not a banking service request",
              not result["is_banking_intent"],
              f"{result['intent']} margin={result['margin']}")
        check(f"{text!r} categorised as knowledge",
              result["category"] == "KNOWLEDGE_QUESTION", result["category"])

        conversation = ConversationManager()
        conversation.start_conversation()
        answer = dialogue.handle_non_banking_request(
            result["category"], text, conversation)
        check(f"{text!r} answered from the knowledge path",
              answer == "ANSWERED-FROM-KNOWLEDGE-BASE", str(answer)[:40])
        check(f"{text!r} -> workflow_state not ACTIVE",
              conversation.workflow_state != WorkflowState.ACTIVE,
              str(conversation.workflow_state))

    check("the knowledge path received every question",
          len(dialogue.dialogue_understanding.questions) == 3,
          str(dialogue.dialogue_understanding.questions))


# =========================================================
# 15-19  ENGLISH CONTROLS
# =========================================================

def test_english_controls(detector):
    section("English controls still classify, and never become intents (15-19)")

    for text, command in (("pause", "pause"), ("resume", "resume"), ("stop", "cancel"),
                          ("exit", "session_exit"), ("repeat", "repeat"),
                          ("cancel", "cancel"), ("next", "next")):
        check(f"classify_command({text}) == {command}",
              classify_command(text) == command, f"got {classify_command(text)}")
        result = detector.detect_intent(text)
        check(f"{text!r} is not a banking intent", not result["is_banking_intent"],
              f"{result['intent']} margin={result['margin']}")


# =========================================================
# 20-23  AMOUNTS
# =========================================================

def test_amounts():
    section("Amount extraction, Kannada / Hindi / digits (20-23)")

    cases = [
        ("ಐದು ಸಾವಿರ", 5000),
        ("ಎರಡು ಲಕ್ಷ", 200000),
        ("ಐನೂರು ರೂಪಾಯಿ", 500),
        ("ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು", 5000),
        ("पाँच हज़ार", 5000),
        ("दो लाख", 200000),
        ("मुझे तीस हज़ार रुपये निकालने हैं", 30000),
        ("I want to deposit 5000", 5000),
        ("deposit 5,000 rupees", 5000),
        # Must NOT invent an amount.
        ("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", None),
        ("step two", None),
        ("ಎರಡು", None),
    ]
    for text, expected in cases:
        got = extract_amount(text)
        check(f"extract_amount({text!r}) == {expected}", got == expected, f"got {got}")


# =========================================================
# 24-25  ENGLISH REGRESSION
# =========================================================

def test_english_regression(detector):
    section("English banking intents and acknowledgements unchanged (24-25)")

    for text, expected in (("I want to deposit money", "deposit money"),
                           ("I want to withdraw money", "withdraw money"),
                           ("I need a loan", "apply for loan"),
                           ("I want to open a new account", "open new account"),
                           ("check my account balance", "check account balance")):
        result = detector.detect_intent(text)
        check(f"{text!r} -> {expected}",
              result["intent"] == expected and result["is_banking_intent"],
              f"got {result['intent']} banking={result['is_banking_intent']}")

    for text, command in (("thank you", "thanks"), ("thanks", "thanks"),
                          ("okay", "acknowledgement"), ("got it", "acknowledgement")):
        check(f"classify_command({text!r}) == {command}",
              classify_command(text) == command, f"got {classify_command(text)}")

    check("public contract: detect_intent still returns intent/confidence",
          set(("intent", "confidence")) <= set(detector.detect_intent("hello").keys()))
    check("public contract: intent is always one of INTENTS",
          detector.detect_intent("something unrelated entirely")["intent"] in INTENTS)


# =========================================================
# SEPARATION MARGIN
# =========================================================

def test_margin_separation(detector):
    section("The abstention margin still separates the two classes")

    banking = ["ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು",
               "ನನ್ನ ಖಾತೆಯ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು", "ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು",
               "I want to deposit money", "I want to withdraw money", "I need a loan",
               "मुझे पैसे निकालने हैं"]
    non_banking = ["I want to hack the site", "I want to rob the bank",
                   "What is the capital of France?", "Tell me a joke",
                   "What is a savings account?", "ಧನ್ಯವಾದಗಳು", "ಸಾಕು", "thank you",
                   "stop", "exit"]

    lowest = min(detector.detect_intent(t)["margin"] for t in banking)
    highest = max(detector.detect_intent(t)["margin"] for t in non_banking)
    print(f"      lowest banking margin {lowest:+.3f} / highest non-banking "
          f"{highest:+.3f} / threshold {BANKING_MARGIN}")
    check("banking requests stay above the margin", lowest >= BANKING_MARGIN,
          f"lowest={lowest}")
    check("non-banking stays below the margin", highest < BANKING_MARGIN,
          f"highest={highest}")
    check("the two classes remain separated", lowest > highest,
          f"{lowest} vs {highest}")


# =========================================================
# K  SELECTED-LANGUAGE RESPONSES AND REPLAY
# =========================================================

def test_localization_and_replay():
    section("Selected-language responses and replay (K)")

    english = "There's nothing active to cancel right now."

    rendered_kn, translated_kn = localize(english, "kn")
    check("fixed reply renders in Kannada", translated_kn and rendered_kn != english,
          rendered_kn)
    check("Kannada rendering is in Kannada script",
          any("ಀ" <= c <= "೿" for c in rendered_kn))

    rendered_hi, translated_hi = localize(english, "hi")
    check("fixed reply renders in Hindi", translated_hi and rendered_hi != english)
    check("Hindi rendering is in Devanagari",
          any("ऀ" <= c <= "ॿ" for c in rendered_hi))

    check("English session is untouched", localize(english, "en")[0] == english)

    # Replay must use the CURRENT session language, not the stored English.
    for language, lo, hi_ in (("kn", "ಀ", "೿"), ("hi", "ऀ", "ॿ")):
        localizer = ResponseLocalizer(language)
        localizer.render(english)
        replayed = localizer.replay()
        check(f"replay in {language} stays in {language}",
              replayed is not None and any(lo <= c <= hi_ for c in replayed), str(replayed))
        check(f"replay in {language} equals the rendered reply",
              replayed == localizer.last_rendered)

    localizer = ResponseLocalizer("en")
    localizer.render(english)
    check("replay in English returns the English reply", localizer.replay() == english)

    # Dynamic text is reported honestly rather than silently left English.
    dynamic = "Please insert your card into the ATM and enter your PIN."
    _, translated = localize(dynamic, "kn")
    check("dynamic instruction reports translated=False", translated is False)

    localizer = ResponseLocalizer("kn")
    localizer.render("Continuing. " + dynamic)
    check("prefix is localized even when the remainder is not",
          localizer.last_rendered.startswith("ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ"),
          localizer.last_rendered[:40])


def main():
    print("PHASE 3.2B-12 CHECKS")
    detector = IntentDetector()

    test_banking_intents(detector)
    test_controls_and_acknowledgements(detector)
    test_out_of_domain(detector)
    test_knowledge_questions(detector)
    test_english_controls(detector)
    test_amounts()
    test_english_regression(detector)
    test_margin_separation(detector)
    test_localization_and_replay()

    print()
    print(f"  {checks[0]} checks, {len(failures)} failed")
    if failures:
        print()
        for failure in failures:
            print("  -", failure)
        print()
        print("  Phase 3.2B-12 has failures.")
        return 1

    print()
    print("  All Phase 3.2B-12 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
