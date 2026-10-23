"""
M1 -- AMOUNT PARSER SAFETY

Regression tests for app/dialogue/indic_numbers.py after M1.

Runs entirely offline: no model, no Groq, no network. The parser is pure.

Three layers:

  1. Every amount the M0 harness found WRONG, at its correct value.
  2. Boundary cases for each safety rule: an unknown number word before a
     scale word, a fraction with no scale word, two different amounts, dates,
     identifiers, the Hindi verb "दो" (give), digit-by-digit speech.
  3. The 200 annotated IndicVoices banking reference transcripts
     (debugging/spike/indicvoices_banking_annotations.json): zero wrong
     amounts, and every clip that does not match its annotation is one of the
     documented abstentions below. A new mismatch fails the suite.

Run from language_engine/:

    python -m debugging.test_m1_amounts
"""

import json
import sys
from pathlib import Path

from app.dialogue.indic_numbers import extract_amount, parse_amount


PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def table(cases):
    for text, expected in cases:
        got = extract_amount(text)
        check(f"{text!r} -> {expected}", got == expected, f"got {got}")


# =========================================================
# 1  EVERY M0 WRONG AMOUNT
# =========================================================

def test_m0_wrong_amounts_are_now_correct():
    table([
        # Hindi 21-99
        ("पच्चीस हज़ार रुपये", 25000),
        ("पैंतीस सौ रुपये", 3500),
        # Kannada fused compounds
        ("ಇಪ್ಪತ್ತೈದು ಸಾವಿರ ರೂಪಾಯಿ", 25000),
        ("ಮೂವತ್ತೈದು ಸಾವಿರ", 35000),
        ("ತೊಂಬತ್ತೊಂಬತ್ತು ಸಾವಿರ", 99000),
        # Fractions
        ("ढाई हज़ार रुपये", 2500),
        ("डेढ़ लाख रुपये", 150000),
        ("ಒಂದೂವರೆ ಲಕ್ಷ ರೂಪಾಯಿ", 150000),
        ("ಎರಡೂವರೆ ಸಾವಿರ", 2500),
        # Digit plus scale
        ("5 ಸಾವಿರ ರೂಪಾಯಿ", 5000),
        ("5 हज़ार रुपये", 5000),
        ("10 ಸಾವಿರ deposit ಮಾಡಬೇಕು", 10000),
        ("deposit 5k", 5000),
        # Amount versus account number
        ("account 1234 me 5000 jama", 5000),
        ("into account 12345 deposit 5000", 5000),
    ])


# =========================================================
# 2  WHAT WAS ALREADY RIGHT STAYS RIGHT
# =========================================================

def test_previously_supported_amounts_are_unchanged():
    table([
        # The 3.2B-12 cases, verbatim.
        ("ಐದು ಸಾವಿರ", 5000),
        ("ಎರಡು ಲಕ್ಷ", 200000),
        ("ಐನೂರು ರೂಪಾಯಿ", 500),
        ("ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು", 5000),
        ("पाँच हज़ार", 5000),
        ("दो लाख", 200000),
        ("मुझे तीस हज़ार रुपये निकालने हैं", 30000),
        ("I want to deposit 5000", 5000),
        ("deposit 5,000 rupees", 5000),
        ("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", None),
        ("step two", None),
        ("ಎರಡು", None),
        # Native digits, nukta spellings, currency symbols, Indian grouping.
        ("೫೦೦೦ ರೂಪಾಯಿ", 5000),
        ("मुझे ५००० रुपये जमा करने हैं", 5000),
        ("हज़ार रुपये", 1000),
        ("हज़ार रुपये", 1000),
        ("बीस हजार", 20000),
        ("ಎರಡು ಸಾವಿರದ ಐನೂರು ರೂಪಾಯಿ", 2500),
        ("₹5000", 5000),
        ("Rs. 5,000 please", 5000),
        ("Rs.5000", 5000),
        ("1,50,000 rupees", 150000),
        # A plain decimal keeps its whole rupees, exactly as before M1.
        ("500.50", 500),
    ])


def test_public_interface():
    check("parse_amount(kn) reads Kannada", parse_amount("ಐದು ಸಾವಿರ", "kn") == 5000)
    check("parse_amount(hi) reads Hindi", parse_amount("पाँच हज़ार", "hi") == 5000)
    check("parse_amount(kn) ignores Hindi words", parse_amount("पाँच हज़ार", "kn") is None)
    check("parse_amount for an unsupported language is None", parse_amount("ಐದು ಸಾವಿರ", "en") is None)
    check("parse_amount(None text) is None", parse_amount("", "kn") is None)
    check("extract_amount(empty) is None", extract_amount("") is None)
    check("extract_amount(None) is None", extract_amount(None) is None)
    check("extract_amount with a session language", extract_amount("ಐದು ಸಾವಿರ", "kn") == 5000)
    check("extract_amount with a language reads digits", extract_amount("5000 rupees", "hi") == 5000)


# =========================================================
# 3  NEW COVERAGE
# =========================================================

def test_hindi_one_to_ninety_nine():
    table([
        ("इक्कीस हज़ार", 21000), ("सत्ताईस सौ रुपये", 2700), ("उनतालीस हज़ार", 39000),
        ("पैंतालीस हज़ार", 45000), ("इक्यावन हज़ार", 51000), ("निन्यानवे हज़ार", 99000),
        ("अट्ठासी सौ रुपये", 8800), ("पचहत्तर हज़ार", 75000), ("अड़तीस हज़ार", 38000),
        ("पंद्रह सौ रुपये", 1500), ("बारह रुपये", 12),
        ("दो हज़ार पाँच सौ रुपये", 2500), ("दो लाख पचास हज़ार", 250000),
        ("पाँच सौ पचपन रुपये", 555),
    ])


def test_kannada_compounds():
    table([
        ("ಇಪ್ಪತ್ತೊಂದು ಸಾವಿರ", 21000), ("ಇಪ್ಪತ್ಮೂರು ಸಾವಿರ", 23000), ("ಇಪ್ಪತ್ತಮೂರು ಸಾವಿರ", 23000),
        ("ಇಪ್ಪತ್ತುಮೂರು ಸಾವಿರ", 23000), ("ನಲವತ್ತೆಂಟು ಸಾವಿರ", 48000), ("ನಲ್ವತ್ತೈದು ಸಾವಿರ", 45000),
        ("ಐವತ್ನಾಲ್ಕು ಸಾವಿರ", 54000), ("ಅರವತ್ತಾರು ಸಾವಿರ", 66000), ("ಎಪ್ಪತ್ತೇಳು ಸಾವಿರ", 77000),
        ("ಎಂಬತ್ತೆರಡು ಸಾವಿರ", 82000),
        ("ಇಪ್ಪತ್ತು ಐದು ಸಾವಿರ", 25000),          # spaced tens + units
        ("ನಾನೂರು ರೂಪಾಯಿ", 400),
        ("ಐನೂರ ಐವತ್ತು ರೂಪಾಯಿ", 550),             # oblique hundreds
        ("ಎರಡು ಲಕ್ಷದ ಐವತ್ತು ಸಾವಿರ", 250000),
    ])


def test_fractions():
    table([
        ("डेढ़ सौ रुपये", 150), ("ढाई सौ रुपये", 250),
        ("साढ़े तीन हज़ार", 3500), ("साढ़े पाँच सौ रुपये", 550),
        ("सवा लाख रुपये", 125000), ("सवा दो लाख", 225000), ("पौने दो लाख", 175000),
        ("ಮೂರೂವರೆ ಸಾವಿರ", 3500), ("ಹತ್ತೂವರೆ ಸಾವಿರ", 10500),
        ("2.5 lakh", 250000), ("1.5 ಲಕ್ಷ", 150000), ("2.5k", 2500),
        # A fraction must end in a whole number of rupees.
        ("ढाई रुपये", None),
        ("ಒಂದೂವರೆ ರೂಪಾಯಿ", None),
        ("साढ़े", None),
        ("साढ़े हज़ार", None),
        ("2.55 thousand", 2550),
        ("2.5555 thousand", None),           # 2555.5 rupees is not whole
    ])


def test_digit_plus_scale():
    table([
        ("5 thousand rupees", 5000), ("2 lakh", 200000), ("3 crore", 30000000),
        ("5K", 5000), ("5 ಸಾವಿರ 500 ರೂಪಾಯಿ", 5500), ("20 हज़ार", 20000),
    ])


# =========================================================
# 4  SAFETY: NONE RATHER THAN A GUESS
# =========================================================

def test_unknown_word_before_a_scale_is_not_an_amount():
    table([
        ("पच्चीसी हज़ार रुपये", None),        # misspelt number word
        ("ಇಪ್ಪತ್ತೈದ ಸಾವಿರ", None),            # clipped number word
        ("five thousand rupees", None),       # English number words are the LLM's job
        ("paanch hazaar rupaye", None),
        ("deposit thousand rupees", None),    # a verb could be hiding a number
        # ... but a bare scale word stays valid where nothing can hide.
        ("हज़ार रुपये", 1000),
        ("और सौ रुपये", 100),
        ("बीमित राशि सौ रुपये चुनें", 100),
        ("ಸಾವಿರ ರೂಪಾಯಿ ಬೇಕು", 1000),
    ])


def test_malformed_number_sequences_are_not_amounts():
    table([
        ("ಎರಡು ಮೂರು ಸಾವಿರ", None),            # "two-three thousand": an approximation
        ("दो तीन हज़ार", None),
        ("ಐದು ಸೊನ್ನೆ ಸೊನ್ನೆ ರೂಪಾಯಿ", None),    # digit-by-digit: out of scope, never a sum
        ("पाँच हज़ार दो लाख", None),           # scales out of order
        ("ಐನೂರು ನೂರು", None),
        ("5 ಐದು ಸಾವಿರ", None),                # digit beside a number word
        ("5000 2000 rupees", None),
    ])


def test_dates_and_identifiers_are_not_amounts():
    table([
        ("15/08/2024", None), ("transfer on 15-08-2024", None), ("at 10:30", None),
        ("I paid on 2nd", None),
        ("इक्कीस बारह दो हज़ार उन्नीस से इक्कीस एक दो हज़ार उन्नीस तक", None),
        ("ಹದಿನೆಂಟು ಹನ್ನೊಂದು ಎರಡು ಸಾವಿರದ ಹದಿನೆಂಟನೇ ತಾರೀಖು", None),
        ("account number 1234567890", None),
        ("my account no 4521", None),
        ("I am on step 2", None),
        ("खाता नंबर 4521 में दो हज़ार जमा", 2000),
        ("ಖಾತೆ ಸಂಖ್ಯೆ 4521 ಗೆ ಎರಡು ಸಾವಿರ", 2000),
        ("deposit 5000 into account 1234", 5000),
        ("account 5000 rupees", None),         # an identifier is never an amount
    ])


def test_two_different_amounts_are_not_guessed():
    table([
        ("सात सौ रुपये भेजना बंद करें और तीन सौ रुपये भेजें", None),
        ("ಒಂದು ಸಾವಿರ ರೂಪಾಯನ್ನು ನಿಲ್ಲಿಸಿ ಎರಡು ಸಾವಿರ ರೂಪಾಯಿ ಕಳಿಸಿ", None),
        ("deposit 5000 from my 20000 balance", None),
        # The same amount said twice is still one amount.
        ("पाँच हज़ार, हाँ पाँच हज़ार रुपये", 5000),
        ("5000 rupees, 5000", 5000),
    ])


def test_hindi_do_as_give():
    table([
        ("मुझे दो हज़ार दो", 2000),              # "give me two thousand"
        ("दो हज़ार दो सौ रुपये", 2200),           # दो inside the number is still 2
        ("दो हज़ार", 2000),
    ])


# =========================================================
# 5  THE 200 ANNOTATED INDICVOICES TRANSCRIPTS
# =========================================================

ANNOTATIONS = Path(__file__).parent / "spike" / "indicvoices_banking_annotations.json"

#: Clips that do not match their annotation, each with the reason. Every one
#: is an abstention except ivb_kn_016, whose amount IS spoken but the
#: annotation records the clip's first request (a status check) instead.
DOCUMENTED_MISMATCHES = {
    "ivb_kn_002": "two amounts (stop 1000, send 2000): abstains, was 1000",
    "ivb_kn_096": "digit-by-digit 'ಐದು ಸೊನ್ನೆ ಸೊನ್ನೆ' (500): out of M1 scope, abstains, was 5",
    "ivb_hi_009": "two amounts (stop 700, send 300): abstains, was 700",
    "ivb_hi_010": "two amounts (stop 200, send 800): abstains, was 200",
    "ivb_hi_029": "two amounts (stop 9000, send 30000): abstains, was 9000",
    "ivb_hi_071": "two amounts (stop 6000, send 4000): abstains, was 6000",
    "ivb_hi_092": "two amounts (stop 60000, send 100): abstains, was 60000",
    "ivb_hi_045": "English numerals in Devanagari ('टू हंड्रेड'): out of scope, abstains as before",
    "ivb_kn_016": "700 is spoken (a secondary transfer); annotation records the primary status check",
}


def test_annotated_transcripts():
    data = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    wrong, undocumented = [], []

    for item in data["annotations"]:
        expected = item["project_annotations"].get("amount")
        got = extract_amount(item["reference_transcript"])

        if got == expected:
            continue
        if expected is not None and got is not None:
            wrong.append(f"{item['id']}: expected {expected}, got {got}")
        if item["id"] not in DOCUMENTED_MISMATCHES:
            undocumented.append(f"{item['id']}: expected {expected}, got {got}")

    check(f"{len(data['annotations'])} annotated transcripts were read", len(data["annotations"]) == 200)
    check("zero wrong amounts on the annotated transcripts", not wrong, "; ".join(wrong))
    check("every mismatch is a documented one", not undocumented, "; ".join(undocumented))

    still_mismatching = {item["id"] for item in data["annotations"]
                         if extract_amount(item["reference_transcript"])
                         != item["project_annotations"].get("amount")}
    stale = sorted(set(DOCUMENTED_MISMATCHES) - still_mismatching)
    check("no documented mismatch has silently started matching", not stale,
          f"now matching, remove from the list: {stale}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M1 AMOUNT PARSER SAFETY TESTS")
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
