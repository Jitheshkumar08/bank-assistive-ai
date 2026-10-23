"""
M3 -- KANNADA / HINDI QUESTION, NEGATION, POLITENESS AND CONTROL CUES

Regression tests for:

  app/dialogue/multilingual_questions.py   question cues
  app/dialogue/multilingual_negation.py    refusals
  app/dialogue/multilingual_phrases.py     code-mixed / romanised controls,
                                           Indic politeness wrappers
  manager.py / voice_pipeline.py           the hooks, the stem-rule
                                           negation guard and the refusal gate

Each rule is tested with the sentences it must catch AND the nearby
sentences it must leave alone: genuine requests, words that merely look
like cues, longer sentences that contain a control word.

Offline: no model, no Groq, no network. The routing tests use a stand-in
detector so the real VoiceAssistantPipeline._respond runs without loading
the embedding model.

Run from language_engine/:

    python -m debugging.test_m3_language_cues
"""

import json
import sys
import unicodedata
from pathlib import Path

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.dialogue import manager as dm
from app.dialogue.manager import (
    DialogueManager,
    WORKFLOW_CONTROL_PHRASES,
    classify_turn,
    contains_negation,
    looks_like_a_question,
)
from app.dialogue.multilingual_questions import asks_for_own_balance
from app.dialogue.workflow_conflict import CONFLICT_CONTROL_CHOICES, resolve_conflict_answer
from app.pipeline.voice_pipeline import VoiceAssistantPipeline
from app.workflow.loader import WorkflowLoader


PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


# =========================================================
# A  QUESTION CUES
# =========================================================

def test_targeted_questions_are_question_shaped():
    for text in (
        # The six named in the M3 approval.
        "ಸಾಲ ಪಡೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು",
        "लोन के लिए कौन से दस्तावेज़ चाहिए",
        "ಖಾತೆ ತೆರೆಯಲು ಏನು ಬೇಕು",
        "खाता खोलने के लिए क्या चाहिए",
        "ಹಣ ಜಮಾ ಮಾಡುವುದು ಹೇಗೆ",
        "बै लेंस कैसे चेक करें",
        # Each cue family.
        "ಬ್ಯಾಂಕ್ ಯಾಕೆ ಬಡ್ಡಿ ಕೊಡುತ್ತದೆ",
        "ಠೇವಣಿ ಚೀಟಿ ಎಲ್ಲಿ ಸಿಗುತ್ತದೆ",
        "ಉಳಿತಾಯ ಖಾತೆ ತೆರೆಯಲು ಬೇಕಾದ ದಾಖಲೆಗಳು",
        "ನನಗೆ ಖಾತೆ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ",
        "ಹಣ ತೆಗೆಯಲು ಪಾಸ್‌ಬುಕ್ ಬೇಕಾ",
        "बैंक ब्याज क्यों देता है",
        "जमा पर्ची कहाँ मिलेगी",
        "जमा पर्ची कहां मिलेगी",
        "बचत खाते के बारे में जानकारी चाहिए",
        "पैसे निकालने के लिए पासबुक चाहिए क्या",
        "loan ke liye kya documents chahiye",
        "balance kaise check kare",
        "loan tegeyalu yaava documents beku",
        "deposit slip elli sigutte",
    ):
        check(f"question: {text}", looks_like_a_question(text))


def test_genuine_requests_are_not_question_shaped():
    for text in (
        "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "ನಾನು ಹತ್ತು ಸಾವಿರ ರೂಪಾಯಿ ತೆಗೆಯಬೇಕು", "ನನಗೆ ಲೋನ್ ಬೇಕು",
        "ನನಗೆ ಎಲ್ಲ ಹಣ ತೆಗೆಯಬೇಕು", "ನನಗೆ ಮನೆ ಕಟ್ಟಲು ಸಾಲ ಬೇಕು",
        "मुझे पैसे जमा करने हैं", "मुझे लोन चाहिए", "मुझे नया खाता खोलना है",
        "मुझे account open करना है", "mujhe loan chahiye", "nanage loan beku",
        "account open madbeku", "mera balance check karna hai",
        # Words that START like a cue but are not one.
        "ಏನಾದರೂ ಹಣ ಜಮಾ ಮಾಡಬೇಕು",          # ಏನಾದರೂ = anything
        "mujhe kabhi bhi paise nikalne hai",  # kabhi = ever, not kab
    ):
        check(f"request: {text}", not looks_like_a_question(text))


def test_every_m0_service_request_stays_a_request():
    path = Path(__file__).resolve().parent.parent / "evaluation" / "fixtures" / "multilingual_v1.json"
    fixtures = json.loads(path.read_text(encoding="utf-8"))["fixtures"]
    flagged = [f["text"] for f in fixtures
               if f["category"] == "service_request" and looks_like_a_question(f["text"])]
    check("no M0 service request became question-shaped", not flagged, f"{flagged}")


def test_own_balance_is_a_request_not_a_question():
    for text in ("ನನ್ನ ಖಾತೆಯ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು", "ನನ್ನ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟಿದೆ", "ನನ್ನ ಖಾತೆಯಲ್ಲಿ ಎಷ್ಟು ಹಣವಿದೆ",
                 "मेरा बैलेंस कितना है", "मेरे खाते में कितने पैसे हैं",
                 "mera balance kitna hai", "nanna balance eshtu"):
        check(f"own balance, not a question: {text}",
              asks_for_own_balance(text) and not looks_like_a_question(text))

    for text in ("मेरे खाते में कितना ब्याज मिलेगा",   # interest: no balance or money word
                 "ಸಾಲದ ಬಡ್ಡಿ ದರ ಎಷ್ಟು",              # no possessive
                 "बैलेंस कितना होना चाहिए",            # no possessive
                 "ನನ್ನ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು ಮತ್ತು ಹೇಗೆ ನೋಡುವುದು"):  # a second, real question word
        check(f"still a question: {text}", looks_like_a_question(text))


def test_endings_count_only_on_the_last_word():
    check("ಬೇಕಾ at the end is a question", looks_like_a_question("ಪಾಸ್‌ಬುಕ್ ಬೇಕಾ"))
    check("ಬೇಕಾದರೆ (if needed) mid-sentence is not", not looks_like_a_question("ಬೇಕಾದರೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು"))


def test_english_question_detection_is_unchanged():
    check("English question", looks_like_a_question("What is a cheque book?"))
    check("English WH-word", looks_like_a_question("for admission letter what type is that"))
    check("English request", not looks_like_a_question("I want to deposit money"))
    check("English request with 'is'", not looks_like_a_question("the money that is in my account"))


# =========================================================
# B  NEGATION AND REFUSALS
# =========================================================

def test_targeted_refusals_are_negated():
    for text in (
        "ನನಗೆ ಹಣ ತೆಗೆಯುವುದು ಬೇಡ", "मुझे लोन नहीं चाहिए", "mujhe loan nahi chahiye", "ನನಗೆ ಲೋನ್ ಬೇಡ",
        "ನನಗೆ ಸಾಲ ಬೇಕಿಲ್ಲ", "ನಾನು ಹಣ ತೆಗೆಯಲ್ಲ", "ಹಣ ತೆಗೆಯಬೇಡಿ", "ರದ್ದು ಮಾಡಬೇಡಿ",
        "पैसे मत निकालो", "रद्द नहीं करना", "मुझे नही चाहिए", "paise mat nikalo",
        "nanage loan beda", "cancel mat karo", "ನನಗೆ loan ಬೇಡ",
        "I don't want to withdraw", "I do not need a loan",
    ):
        check(f"negated: {text}", contains_negation(text))


def test_positive_requests_are_not_negated():
    for text in (
        "ನನಗೆ ಎಲ್ಲ ಹಣ ತೆಗೆಯಬೇಕು",     # ಎಲ್ಲ (all) ends like the negative ending
        "ನನಗೆ ಎಲ್ಲಾ ಹಣ ಬೇಕು",
        "ನನಗೆ ಸಾಲ ಬೇಕು", "ನನಗೆ ಲೋನ್ ಬೇಕು", "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "ನನ್ನ ಬೇಡಿಕೆ ಸಾಲ",            # ಬೇಡಿಕೆ (demand) begins with ಬೇಡ
        "मुझे लोन चाहिए", "मुझे नई पासबुक चाहिए",  # नई = new
        "नमस्ते मुझे पैसे निकालने हैं", "मुझे पैसे जमा करने हैं ना",
        "mujhe loan chahiye", "nanage loan beku", "mujhe nai passbook chahiye",
        "I need a loan",
    ):
        check(f"not negated: {text}", not contains_negation(text))


def test_refusal_gate_in_a_resting_state():
    for text, refused_service in (
        ("मुझे लोन नहीं चाहिए", "apply for loan"),
        ("ನನಗೆ ಹಣ ತೆಗೆಯುವುದು ಬೇಡ", "withdraw money"),
        ("mujhe loan nahi chahiye", "apply for loan"),
        ("I don't want to withdraw money", "withdraw money"),
    ):
        host = routing_host(refused_service)
        reply = VoiceAssistantPipeline._respond(host, None, text)
        check(f"refusal starts nothing: {text}",
              host.conversation.workflow_state == WorkflowState.NONE
              and host.conversation.current_workflow is None, reply)
        check(f"refusal gets the acknowledgement reply: {text}",
              reply == "Okay. Let me know if you'd like help with anything else.", reply)


def test_genuine_requests_still_start_their_workflow():
    for text, service in (("मुझे लोन चाहिए", "apply for loan"),
                          ("ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು", "withdraw money"),
                          ("ನನಗೆ ಎಲ್ಲ ಹಣ ತೆಗೆಯಬೇಕು", "withdraw money"),
                          ("I want to deposit money", "deposit money")):
        host = routing_host(service)
        VoiceAssistantPipeline._respond(host, None, text)
        check(f"request starts {service}: {text}",
              host.conversation.workflow_state == WorkflowState.ACTIVE
              and host.conversation.current_workflow == service)


def test_refusals_do_not_raise_conflicts_mid_task():
    for text, other in (("ನನಗೆ ಹಣ ತೆಗೆಯುವುದು ಬೇಡ", "withdraw money"),
                        ("मुझे पैसे नहीं निकालने", "withdraw money"),
                        ("ನನಗೆ ಲೋನ್ ಬೇಡ", "apply for loan"),
                        ("mujhe loan nahi chahiye", "apply for loan")):
        dialogue = offline_dialogue(other)
        conflict = dialogue._detect_workflow_conflict(active_deposit(), text)
        check(f"no conflict for a refusal: {text}", conflict is None, str(conflict))

    dialogue = offline_dialogue("withdraw money")
    conflict = dialogue._detect_workflow_conflict(active_deposit(), "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    check("a genuine different request still raises the conflict",
          conflict is not None and conflict.requested_workflow == "withdraw money")


def test_questions_do_not_raise_conflicts_mid_task():
    dialogue = offline_dialogue("withdraw money")
    for text in ("ಹಣ ತೆಗೆಯುವುದು ಹೇಗೆ", "पैसे निकालने के लिए क्या चाहिए"):
        check(f"no conflict for a question: {text}",
              dialogue._detect_workflow_conflict(active_deposit(), text) is None)


# =========================================================
# C  POLITENESS AND CONTROL COMMANDS
# =========================================================

def test_targeted_controls():
    for text, expected in (
        ("ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ", "repeat"), ("कृपया दोबारा बताइए", "repeat"),
        ("matte heli", "repeat"), ("phir se batao", "repeat"),
        ("ruko", "pause"), ("रुक जाओ", "pause"), ("ruk jao", "pause"),
        ("cancel karo", "cancel"), ("cancel maadi", "cancel"),
        ("ದಯವಿಟ್ಟು ಮುಂದುವರಿಸಿ", "resume"), ("कृपया जारी रखिए", "resume"),
        ("jaari rakho", "resume"), ("munduvarisi", "resume"), ("continue karo", "resume"),
        ("ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ನಿಲ್ಲಿ", "pause"), ("ज़रा रुकिए", "pause"), ("थोड़ा रुकिए", "pause"),
        ("please ruko", "pause"), ("pause ಮಾಡಿ", "pause"), ("pause करो", "pause"),
        ("ದಯವಿಟ್ಟು repeat ಮಾಡಿ", "repeat"), ("कृपया repeat कीजिए", "repeat"),
        ("dayavittu matte heli", "repeat"), ("cancel ಮಾಡಿ", "cancel"), ("cancel करो", "cancel"),
        ("nillisi", "cancel"), ("ಥ್ಯಾಂಕ್ಸ್", "thanks"), ("dhanyavaad", "thanks"),
    ):
        got = classify_turn(text)
        check(f"{text!r} -> {expected}", got == expected, f"got {got}")


def test_controls_that_must_not_fire():
    for text in (
        "ದಯವಿಟ್ಟು ನಿಲ್ಲಿಸಿ",          # cancel is never politely wrappable
        "please cancel karo",
        "cancel karo mera loan application",   # a sentence, not a command
        "ruko mujhe paise nikalne hain",
        "ನಿಲ್ಲಿಸಬೇಡಿ",                 # don't stop: the stem rule must not cancel
        "ಮುಂದುವರಿಸಬೇಡಿ",               # don't continue
        "कृपया रद्द मत करो",
    ):
        check(f"no control: {text}", classify_turn(text) is None, f"got {classify_turn(text)}")


def test_nukta_spelling_does_not_matter():
    precomposed = "थोड़ा रुको"            # ड़ as one code point
    combining = "थोड़ा रुको"         # ड + nukta
    check("the two spellings really differ", precomposed != combining)
    check("precomposed ड़ matches", classify_turn(precomposed) == "pause")
    check("combining ड़ matches", classify_turn(combining) == "pause")
    check("precomposed ज़ in a polite wrapper", classify_turn("ज़रा रुकिए") == "pause")
    check("combining ज़ in a polite wrapper", classify_turn("ज़रा रुकिए") == "pause")


def test_control_tables_and_conflict_resolver_agree():
    # The defect M3 fixed: "रुक जाओ" was cancel to the control tier and
    # pause to the conflict resolver. For every exact pause / resume / cancel
    # phrase, the resolver must either say nothing or say the same thing.
    expected_choice = {"pause": "pause", "resume": "continue", "cancel": "cancel"}
    disagreements = []
    for command in ("pause", "resume", "cancel"):
        for phrase in sorted(WORKFLOW_CONTROL_PHRASES[command]):
            resolved = None if contains_negation(phrase) else resolve_conflict_answer(phrase)
            if resolved not in (None, expected_choice[command]):
                disagreements.append(f"{phrase!r}: control={command}, resolver={resolved}")
            if CONFLICT_CONTROL_CHOICES.get(command) != expected_choice[command]:
                disagreements.append(f"CONFLICT_CONTROL_CHOICES[{command}]")
    check("every control phrase means the same thing to the conflict resolver",
          not disagreements, "; ".join(disagreements))


def test_every_table_phrase_classifies_as_its_command():
    wrong = []
    for command, phrases in WORKFLOW_CONTROL_PHRASES.items():
        for phrase in phrases:
            got = classify_turn(phrase)
            if got != command:
                wrong.append(f"{phrase!r}: {got} (table says {command})")
    check("every control phrase classifies as its own command", not wrong, "; ".join(wrong))


def test_tables_are_stored_in_nfc():
    bad = [p for phrases in WORKFLOW_CONTROL_PHRASES.values() for p in phrases
           if unicodedata.normalize("NFC", p) != p]
    check("control tables are NFC", not bad, f"{bad}")


# =========================================================
# STAND-INS
# =========================================================

class FixedDetector:
    def __init__(self, intent):
        self.intent = intent

    def detect_intent(self, text):
        return {"intent": self.intent, "confidence": 0.9, "category": "BANKING_INTENT",
                "is_banking_intent": True, "margin": 0.2}


def offline_dialogue(intent):
    dialogue = DialogueManager.__new__(DialogueManager)
    dialogue.intent_detector = FixedDetector(intent)
    dialogue.workflow_loader = WorkflowLoader()
    return dialogue


class _Host:
    def __init__(self, intent):
        self.conversation = ConversationManager()
        self.dialogue = offline_dialogue(intent)
        self.intent_detector = self.dialogue.intent_detector


def routing_host(intent):
    return _Host(intent)


def active_deposit():
    conversation = ConversationManager()
    conversation.set_intent("deposit money")
    conversation.load_workflow("deposit money")
    return conversation


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M3 LANGUAGE CUE TESTS")
    print("=" * 60)

    for test in tests:
        print(f"\n{test.__name__}")
        test()

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
