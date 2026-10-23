"""
M4 -- INTENT DETECTION AND CODE-MIXED REQUEST ROUTING

Regression tests for:

  app/intent/service_keywords.py   lexical service evidence
  app/intent/detector.py           narrowing to the named services, and the
                                   AMBIGUOUS_SERVICE abstention
  app/intent/intent_examples.py    frame-balanced, code-mixed examples
  manager.handle_non_banking_request  the AMBIGUOUS_SERVICE reply

The safety property M4 claims is tested directly, over every sentence in
every evaluation fixture file: lexical narrowing never turns a non-banking
verdict into a banking one, and never picks a service the sentence does not
name.

Offline. The service-evidence tests need no model; the detector tests load
the local embedding model (no network), as the 3.2B-12 and -15 suites do.

Run from language_engine/:

    python -m debugging.test_m4_intent
"""

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from app.dialogue.localization import localize
from app.dialogue.manager import DialogueManager
from app.dialogue.multilingual_phrases import word_tokens
from app.intent.intent_examples import BANKING_INTENT_EXAMPLES, NON_BANKING_ANCHORS
from app.intent.intents import INTENTS
from app.intent.service_keywords import service_evidence


PASSED = []
FAILED = []

FIXTURES = Path(__file__).resolve().parent.parent / "evaluation" / "fixtures"

DEPOSIT, WITHDRAW, BALANCE, LOAN, OPEN = INTENTS[0], INTENTS[1], INTENTS[2], INTENTS[3], INTENTS[4]


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def all_fixtures():
    out = []
    for path in sorted(FIXTURES.glob("*.json")):
        out += json.loads(path.read_text(encoding="utf-8"))["fixtures"]
    return out


def _key(text):
    return " ".join(word_tokens(text))


# =========================================================
# NO LEAKAGE
# =========================================================

def test_no_m4_example_is_an_evaluation_sentence():
    from app.intent.intent_examples import M4_BANKING_INTENT_EXAMPLES, M4_KNOWLEDGE_ANCHORS

    fixtures = {_key(f["text"]): f["id"] for f in all_fixtures()}
    added = [t for texts in M4_BANKING_INTENT_EXAMPLES.values() for t in texts] + list(M4_KNOWLEDGE_ANCHORS)

    leaked = [f"{t!r} = {fixtures[_key(t)]}" for t in added if _key(t) in fixtures]
    check("no M4 example or anchor equals an evaluation fixture", not leaked, "; ".join(leaked))

    held_out = {_key(f["text"]) for f in json.loads(
        (FIXTURES / "m4_heldout.json").read_text(encoding="utf-8"))["fixtures"]}
    every = [t for texts in BANKING_INTENT_EXAMPLES.values() for t in texts] + \
            [t for texts in NON_BANKING_ANCHORS.values() for t in texts]
    check("no example or anchor of any phase equals a held-out sentence",
          not [t for t in every if _key(t) in held_out])


def test_report_pre_m4_overlap():
    # NOT a failure: a known caveat on the M0/M3 numbers. Some fixtures were
    # taken verbatim from the 3.2B-12 examples and anchors (their `source`
    # says so), so the detector matches them exactly and they are trivially
    # correct. Printed so the count stays visible in every run.
    from app.intent.intent_examples import M4_BANKING_INTENT_EXAMPLES, M4_KNOWLEDGE_ANCHORS

    m4 = {_key(t) for texts in M4_BANKING_INTENT_EXAMPLES.values() for t in texts} | \
         {_key(t) for t in M4_KNOWLEDGE_ANCHORS}
    every = [t for texts in BANKING_INTENT_EXAMPLES.values() for t in texts] + \
            [t for texts in NON_BANKING_ANCHORS.values() for t in texts]
    older = {_key(t) for t in every} - m4
    overlap = sorted(f["id"] for f in all_fixtures() if _key(f["text"]) in older)
    print(f"  INFO  {len(overlap)} fixtures equal a pre-M4 example or anchor: {', '.join(overlap)}")
    check("the overlap is only with pre-M4 examples", True)


# =========================================================
# FRAME BALANCE
# =========================================================

def _scripts(text):
    has_kn = any("ಀ" <= c <= "೿" for c in text)
    has_hi = any("ऀ" <= c <= "ॿ" for c in text)
    has_latin = any("a" <= c.lower() <= "z" for c in text)
    return has_kn, has_hi, has_latin


def test_every_service_has_examples_in_every_script_mix():
    for intent in INTENTS:
        kinds = {"kannada": 0, "hindi": 0, "kannada+latin": 0, "hindi+latin": 0, "latin": 0}
        for text in BANKING_INTENT_EXAMPLES[intent]:
            kn, hi, latin = _scripts(text)
            if kn:
                kinds["kannada+latin" if latin else "kannada"] += 1
            elif hi:
                kinds["hindi+latin" if latin else "hindi"] += 1
            elif latin:
                kinds["latin"] += 1
        missing = [k for k, v in kinds.items() if v == 0]
        check(f"{intent}: examples in every script mix", not missing, f"missing {missing}; {kinds}")


def test_every_service_has_the_shared_kannada_frames():
    frames = {"ನಾನು ... ಬಯಸುತ್ತೇನೆ": "ಬಯಸುತ್ತೇನೆ", "... ಬಂದಿದ್ದೇನೆ": "ಬಂದಿದ್ದೇನೆ"}
    for intent in (DEPOSIT, WITHDRAW, BALANCE, LOAN, OPEN):
        for label, marker in frames.items():
            check(f"{intent}: has a '{label}' example",
                  any(marker in t for t in BANKING_INTENT_EXAMPLES[intent]))


# =========================================================
# LEXICAL SERVICE EVIDENCE
# =========================================================

def test_service_words_in_every_script():
    for text, expected in (
        ("I want to deposit cash", {DEPOSIT}), ("ಹಣ ಜಮಾ ಮಾಡಬೇಕು", {DEPOSIT}),
        ("पैसे जमा करने हैं", {DEPOSIT}), ("ಡೆಪಾಸಿಟ್ ಮಾಡಬೇಕು", {DEPOSIT}), ("paise jama karne hai", {DEPOSIT}),
        ("I need to withdraw", {WITHDRAW}), ("पैसे निकालने हैं", {WITHDRAW}), ("ವಿತ್‌ಡ್ರಾ ಮಾಡಬೇಕು", {WITHDRAW}),
        ("paise nikalne hai", {WITHDRAW}), ("ನಗದು ಹಿಂಪಡೆಯಬೇಕು", {WITHDRAW}),
        ("I need a loan", {LOAN}), ("ನನಗೆ ಸಾಲ ಬೇಕು", {LOAN}), ("ಸಾಲಕ್ಕೆ ಅರ್ಜಿ", {LOAN}),
        ("ನನಗೆ ಲೋನ್ ಬೇಕು", {LOAN}), ("ನಾನು ಲೋನ್‌ಗೆ ಅರ್ಜಿ ಹಾಕಬೇಕು", {LOAN}), ("मुझे कर्ज चाहिए", {LOAN}),
        ("शिक्षा ऋण", {LOAN}), ("mujhe loan chahiye", {LOAN}),
        ("check my balance", {BALANCE}), ("ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು", {BALANCE}), ("बैलेंस चेक", {BALANCE}),
        ("ಖಾತೆಯ ಶಿಲ್ಕು", {BALANCE}),
        ("open a new account", {OPEN}), ("ಹೊಸ ಖಾತೆ ತೆರೆಯಬೇಕು", {OPEN}), ("नया खाता खोलना है", {OPEN}),
        ("मुझे बचत खाता खुलवाना है", {OPEN}), ("account open madbeku", {OPEN}), ("hosa account beku", {OPEN}),
    ):
        got = set(service_evidence(text))
        check(f"{text!r} names {sorted(expected)}", got == expected, f"got {sorted(got)}")


def test_shared_verb_tege_is_disambiguated():
    check("ಹಣ ತೆಗೆ is a withdrawal", service_evidence("ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು") == {WITHDRAW})
    check("ಖಾತೆಯಿಂದ ಹಣ ತೆಗೆ is a withdrawal", service_evidence("ಖಾತೆಯಿಂದ ಹಣ ತೆಗೆಯಬೇಕು") == {WITHDRAW})
    check("ಖಾತೆ ತೆಗೆ (no money word) is account opening", service_evidence("ನನಗೆ ಖಾತೆ ತೆಗೆಯಬೇಕು") == {OPEN})
    check("ಲೋನ್ ತೆಗೆದುಕೊಳ್ಳು (take a loan) is a loan, not a withdrawal",
          service_evidence("ಲೋನ್ ತೆಗೆದುಕೊಳ್ಳಬೇಕು") == {LOAN})


def test_words_that_must_not_count():
    # "ಖಾತೆಗೆ ಹಣ ಹಾಕಬೇಕು" (put money INTO the account) is never account
    # opening. Until M10 it named no service at all; M10 reads a put-in verb
    # with money as deposit phrasing (service_keywords, "SERVICE PHRASING"),
    # which is also how the M0 fixture svc-kn-02 labels this sentence.
    into_account = service_evidence("ಖಾತೆಗೆ ಹಣ ಹಾಕಬೇಕು")
    check("into the account is not account opening", OPEN not in into_account, f"got {sorted(into_account)}")
    check("into the account is a deposit (M10 phrasing)", into_account == {DEPOSIT}, f"got {sorted(into_account)}")

    for text in (
        "ಸಾಲಿನಲ್ಲಿ ನಿಲ್ಲಬೇಕಾ",      # ಸಾಲು = a queue
        "I need money",
        "ನನಗೆ ಹಣ ಬೇಕು",
        "बाहर निकलो",               # exit: निकल, not निकाल
        "my account",
        "thank you",
    ):
        check(f"no service named: {text!r}", service_evidence(text) == frozenset(),
              f"got {sorted(service_evidence(text))}")


def test_two_services_named_are_both_reported():
    check("loan repayment by deposit names both",
          service_evidence("ಸಾಲ ತೀರಿಸಲು ಹಣ ಜಮಾ ಮಾಡಬೇಕು") == {LOAN, DEPOSIT})


# =========================================================
# THE DETECTOR (local embedding model)
# =========================================================

_DETECTOR = None


def detector():
    global _DETECTOR
    if _DETECTOR is None:
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            from app.intent.detector import IntentDetector

            _DETECTOR = IntentDetector()
    return _DETECTOR


def test_narrowing_never_widens_and_never_picks_an_unnamed_service():
    from app.intent.detector import BANKING_MARGIN

    widened, unnamed = [], []
    for fixture in all_fixtures():
        text = fixture["text"]
        result = detector().detect_intent(text)
        evidence = set(result["evidence"])
        unrestricted_margin = max(result["scores"].values()) - max(result["anchor_scores"].values())

        # Rounded to 3 places in the result; allow for that.
        if result["is_banking_intent"] and unrestricted_margin < BANKING_MARGIN - 0.001:
            widened.append(fixture["id"])
        if result["is_banking_intent"] and evidence and result["intent"] not in evidence:
            unnamed.append(fixture["id"])

    check("no sentence became banking because of narrowing", not widened, f"{widened}")
    check("no sentence went to a service it does not name", not unnamed, f"{unnamed}")


def test_targeted_wrong_service_fixtures():
    # Every wrong-service fixture from the M0 baseline and the M3 report.
    for text, expected in (
        ("ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಸಾಲ ಬೇಕು", LOAN),
        ("ನನಗೆ ಖಾತೆ ತೆಗೆಯಬೇಕು", OPEN),
        ("ಲೋನ್ ಪಡೆಯಬೇಕು", LOAN),
        ("ನಾನು ಲೋನ್‌ಗೆ ಅರ್ಜಿ ಹಾಕಬೇಕು", LOAN),
        ("ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಬೇಕು", LOAN),
        ("ನನಗೆ cash withdraw ಮಾಡಬೇಕು", WITHDRAW),
        ("ನನಗೆ cash deposit ಮಾಡಬೇಕು", DEPOSIT),
        ("ನನಗೆ ಮನೆ ಕಟ್ಟಲು ಸಾಲ ಬೇಕು", LOAN),
    ):
        result = detector().detect_intent(text)
        correct = result["is_banking_intent"] and result["intent"] == expected
        safe = not result["is_banking_intent"]
        check(f"{text!r}: {expected} or a safe abstention", correct or safe,
              f"got {result['intent']} banking={result['is_banking_intent']}")
        check(f"{text!r}: routed to {expected}", correct,
              f"got {result['intent']} banking={result['is_banking_intent']} category={result['category']}")


def test_genuine_requests_still_route():
    for text, expected in (
        ("I want to deposit money.", DEPOSIT), ("I want to withdraw money.", WITHDRAW),
        ("I want to check my balance.", BALANCE), ("I want to apply for a loan.", LOAN),
        ("I want to open a new account.", OPEN),
        ("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", DEPOSIT), ("ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು", WITHDRAW),
        ("मुझे पैसे जमा करने हैं", DEPOSIT), ("मुझे पैसे निकालने हैं", WITHDRAW),
        ("मुझे लोन चाहिए", LOAN), ("मुझे नया खाता खोलना है", OPEN),
        ("mujhe loan chahiye", LOAN), ("account open madbeku", OPEN),
    ):
        result = detector().detect_intent(text)
        check(f"{text!r} -> {expected}",
              result["is_banking_intent"] and result["intent"] == expected,
              f"got {result['intent']} banking={result['is_banking_intent']}")


def test_non_requests_still_abstain():
    for text in ("thank you", "ಧನ್ಯವಾದಗಳು", "धन्यवाद", "I want to rob the bank",
                 "what is a savings account", "ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು", "बचत खाता क्या है"):
        result = detector().detect_intent(text)
        check(f"abstains: {text!r}", not result["is_banking_intent"], f"category {result['category']}")


def test_contract_is_additive():
    result = detector().detect_intent("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು")
    for key in ("intent", "confidence", "category", "is_banking_intent", "margin",
                "scores", "anchor_scores", "evidence"):
        check(f"result carries {key!r}", key in result)


# =========================================================
# THE AMBIGUOUS_SERVICE REPLY
# =========================================================

def test_ambiguous_service_asks_and_is_localized():
    dialogue = DialogueManager.__new__(DialogueManager)
    reply = dialogue.handle_non_banking_request("AMBIGUOUS_SERVICE", "ಏನೋ ಬೇಕು", None)
    check("asks which service", reply == "Okay. Let me know which banking service you'd like help with.", reply)
    for language in ("kn", "hi"):
        rendered, translated = localize(reply, language)
        check(f"the reply is already rendered in {language}", translated and rendered != reply, rendered)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M4 INTENT TESTS")
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
