"""
M5 -- TEXT NORMALISATION AND LOANWORD CANONICALISATION

Regression tests for app/dialogue/text_normalization.py and its integration.

  1. The three representations: the original is never changed; normalized
     and routing text are what they say.
  2. Equivalent spellings meet: precomposed / combining nukta, zero-width
     characters, dandas, curly quotes, every listed loanword form.
  3. Ambiguous words are NOT mapped: ಚೆಕ್ alone, "lone", "put" verbs,
     native words.
  4. Meaning survives: for every control phrase, negation word, question
     word, amount fixture and account number in the engine, normalisation
     changes nothing the deterministic tier decides on.
  5. Integration: one normaliser for the whole engine, and conversation
     history keeps exactly what the customer said.

Offline: no model, no Groq, no network.

Run from language_engine/:

    python -m debugging.test_m5_normalization
"""

import json
import sys
from pathlib import Path

from app.conversation.manager import ConversationManager
from app.dialogue import manager as dm
from app.dialogue import multilingual_negation, multilingual_phrases, multilingual_questions
from app.dialogue.indic_numbers import extract_amount
from app.dialogue.manager import (
    ACKNOWLEDGEMENT_PHRASES,
    SESSION_EXIT_PHRASES,
    WORKFLOW_CONTROL_PHRASES,
    classify_turn,
    contains_negation,
    looks_like_a_question,
)
from app.dialogue.text_normalization import (
    LOANWORDS,
    canonicalize_loanwords,
    fold_word,
    normalize_text,
    normalize_turn,
    routing_text,
)


PASSED = []
FAILED = []

FIXTURES = Path(__file__).resolve().parent.parent / "evaluation" / "fixtures"


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def fixture_texts(category=None):
    texts = []
    for path in sorted(FIXTURES.glob("*.json")):
        for f in json.loads(path.read_text(encoding="utf-8"))["fixtures"]:
            if category is None or f["category"] == category:
                texts.append(f)
    return texts


# =========================================================
# 1  THE THREE REPRESENTATIONS
# =========================================================

def test_original_is_never_changed():
    for text in ("ನನಗೆ  ಲೋನ್‌ ಬೇಕು।", "  The Chuck Book  ", "मुझे एकाउंट से कैश विड्रॉल करना है॥",
                 "I don’t want to withdrawl", ""):
        turn = normalize_turn(text)
        check(f"original kept byte-for-byte: {text!r}", turn.original == text)


def test_each_representation():
    turn = normalize_turn("ನನಗೆ  ಲೋನ್‌ ಬೇಕು।")
    check("normalized: spacing, zero-width and danda handled, words kept",
          turn.normalized == "ನನಗೆ ಲೋನ್ ಬೇಕು.", repr(turn.normalized))
    check("routing: the loanword written in English", turn.routing == "ನನಗೆ loan ಬೇಕು.", repr(turn.routing))

    turn = normalize_turn("Where is my Chuck Book?")
    check("normalized keeps case and words", turn.normalized == "Where is my Chuck Book?")
    check("routing repairs the mis-heard term", turn.routing == "Where is my cheque book?", turn.routing)

    check("routing_text() equals normalize_turn().routing",
          all(routing_text(f["text"]) == normalize_turn(f["text"]).routing for f in fixture_texts()))


def test_routing_is_idempotent():
    bad = [f["id"] for f in fixture_texts() if routing_text(routing_text(f["text"])) != routing_text(f["text"])]
    check("routing text of routing text is unchanged, for every fixture", not bad, f"{bad}")


# =========================================================
# 2  EQUIVALENT SPELLINGS MEET
# =========================================================

def test_unicode_equivalents():
    pairs = (
        ("थोड़ा", "थोड़ा"),              # ड़ precomposed / combining
        ("ज़रा", "ज़रा"),                # ज़
        ("ಲೋನ್‌ಗೆ", "ಲೋನ್ಗೆ"),                    # zero-width non-joiner
        ("पाँच", "पांच"),                              # chandrabindu / anusvara (fold only)
        ("हज़ार", "हजार"),                              # nukta (fold only)
    )
    for a, b in pairs[:3]:
        check(f"normalize_text: {a!r} == {b!r}", normalize_text(a) == normalize_text(b))
    for a, b in pairs:
        check(f"fold_word: {a!r} == {b!r}", fold_word(a) == fold_word(b))


def test_punctuation_and_spacing():
    check("danda becomes a full stop", normalize_text("रुको।") == "रुको.")
    check("double danda becomes a full stop", normalize_text("जारी रखो॥") == "जारी रखो.")
    check("curly apostrophe becomes ASCII", normalize_text("don’t") == "don't")
    check("curly quotes become ASCII", normalize_text("“loan”") == '"loan"')
    check("no-break space and runs of spaces collapse", normalize_text("a  b   c") == "a b c")
    check("case is kept", normalize_text("Loan") == "Loan")


def test_every_loanword_form_reaches_its_canonical_word():
    wrong = []
    for canonical, forms in LOANWORDS.items():
        for form in forms:
            got = canonicalize_loanwords(form)
            if got != canonical:
                wrong.append(f"{form!r} -> {got!r} (want {canonical!r})")
    check("every listed form maps to its English word", not wrong, "; ".join(wrong))


def test_spelling_variants_agree():
    groups = (
        ("मुझे अकाउंट चाहिए", "मुझे एकाउंट चाहिए", "मुझे अकाउन्ट चाहिए"),
        ("मेरा बैलेंस", "मेरा बेलेंस", "मेरा बैलेन्स"),
        ("डिपॉजिट करना है", "डिपोजिट करना है", "डिपॉज़िट करना है"),
        ("my account balance", "my acount balence", "my accont ballance"),
        ("ಚೆಕ್ ಬುಕ್ ಬೇಕು", "ಚೆಕ್‌ಬುಕ್ ಬೇಕು", "ಚೆಕ್‌ ಬುಕ್ ಬೇಕು"),
        ("चेक बुक", "चेकबुक"),
    )
    for group in groups:
        outputs = {routing_text(t) for t in group}
        check(f"one routing text for {group[0]!r} and its variants", len(outputs) == 1, f"{outputs}")


def test_kannada_inflected_loanwords():
    for text, expected in (
        ("ಲೋನ್‌ಗೆ ಅರ್ಜಿ", "loan ಗೆ ಅರ್ಜಿ"),
        ("ಅಕೌಂಟ್‌ನಿಂದ ಹಣ", "account ನಿಂದ ಹಣ"),
        ("ಬ್ಯಾಲೆನ್ಸ್‌ನ ವಿವರ", "balance ನ ವಿವರ"),
        ("ಕ್ಯಾಶ್‌ನಲ್ಲಿ", "cash ನಲ್ಲಿ"),
        # Vowel-joined endings are left unsplit rather than respelt.
        ("ಅಕೌಂಟಿಗೆ ಹಣ", "ಅಕೌಂಟಿಗೆ ಹಣ"),
        ("ಲೋನಿಗೆ", "ಲೋನಿಗೆ"),
    ):
        got = routing_text(text)
        check(f"{text!r} -> {expected!r}", got == expected, repr(got))


# =========================================================
# 3  AMBIGUOUS WORDS ARE NOT MAPPED
# =========================================================

def test_ambiguous_and_native_words_are_untouched():
    for text in (
        "ಬ್ಯಾಲೆನ್ಸ್ ಚೆಕ್ ಮಾಡಬೇಕು",   # ಚೆಕ್ alone: check, not cheque  (ಬ್ಯಾಲೆನ್ಸ್ is mapped)
        "मेरा बैलेंस चेक करना है",
        "check my balance",
        "mujhe lone chahiye",        # lone: an English word
        "lon", "kash",
        "ಖಾತೆಗೆ ಹಣ ಹಾಕಬೇಕು",          # ಹಾಕು: put / submit
        "खाते में पैसे डालने हैं",     # डाल: put
        "ಸಾಲ ಬೇಕು", "खाता खोलना है", "पैसे जमा करने हैं", "ಹಣ ಜಮಾ ಮಾಡಬೇಕು",
        "ನಿಮ್ಮ ಅರ್ಜಿ ಹಾಕಿ",
    ):
        routed = routing_text(text)
        unchanged = [w for w in normalize_text(text).split()
                     if w not in ("ಬ್ಯಾಲೆನ್ಸ್", "बैलेंस") and w not in routed.split()]
        check(f"only listed loanwords change in {text!r}", not unchanged, f"{routed!r}")


def test_no_loanword_form_is_a_cue_word():
    forms = {fold_word(f) for forms in LOANWORDS.values() for f in forms}
    cue_lists = {
        "question words": multilingual_questions._QUESTION_WORDS,
        "how-much words": multilingual_questions._HOW_MUCH,
        "negation words": multilingual_negation._WORDS,
        "control phrases": {fold_word(p) for ps in WORKFLOW_CONTROL_PHRASES.values() for p in ps},
    }
    for name, words in cue_lists.items():
        clash = sorted(forms & set(words))
        check(f"no loanword form is one of the {name}", not clash, f"{clash}")


# =========================================================
# 4  MEANING SURVIVES
# =========================================================

def test_control_commands_keep_their_meaning():
    phrases = [p for ps in WORKFLOW_CONTROL_PHRASES.values() for p in ps] + list(SESSION_EXIT_PHRASES) \
        + [p for ps in ACKNOWLEDGEMENT_PHRASES.values() for p in ps]
    changed = [f"{p!r}: {classify_turn(p)} -> {classify_turn(routing_text(p))}"
               for p in phrases if classify_turn(routing_text(p)) != classify_turn(p)]
    check(f"all {len(phrases)} control / exit / acknowledgement phrases classify the same after routing",
          not changed, "; ".join(changed))


def test_negation_and_questions_keep_their_meaning():
    texts = [f["text"] for f in fixture_texts()]
    neg = [t for t in texts if contains_negation(routing_text(t)) != contains_negation(t)]
    question = [t for t in texts if looks_like_a_question(routing_text(t)) != looks_like_a_question(t)]
    check("negation is detected identically on every fixture after routing", not neg, f"{neg}")
    check("question shape is identical on every fixture after routing", not question, f"{question}")


def test_amounts_and_account_numbers_survive():
    changed = []
    for f in fixture_texts("amount"):
        if extract_amount(routing_text(f["text"])) != extract_amount(f["text"]):
            changed.append(f["id"])
    check("every amount fixture parses identically after routing", not changed, f"{changed}")

    for text in ("account 98765 me 2000 deposit", "ಅಕೌಂಟ್ ನಂಬರ್ 4521 ಗೆ ಎರಡು ಸಾವಿರ", "₹2,500 डिपॉजिट"):
        digits = [w for w in text.split() if any(c.isdigit() for c in w)]
        routed = routing_text(text)
        check(f"digits kept verbatim in {text!r}", all(d in routed for d in digits), routed)


# =========================================================
# 5  INTEGRATION
# =========================================================

def test_one_normaliser_for_the_engine():
    check("the phrase module re-exports the central fold", multilingual_phrases.fold is fold_word)
    check("the phrase module re-exports the central word_tokens",
          multilingual_phrases.word_tokens.__module__ == "app.dialogue.text_normalization")
    import app.dialogue.indic_numbers as numbers
    check("the amount parser uses the central fold", numbers._fold is fold_word)
    check("control normalisation builds on normalize_text",
          dm.normalize_command_text("जारी रखो॥") == "जारी रखो"
          and dm.normalize_command_text("ದಯವಿಟ್ಟು  ಮತ್ತೆ   ಹೇಳಿ") == "ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ")

    import inspect
    import app.pipeline.voice_pipeline as pipeline
    import service.engine as engine
    check("the CLI normalises through normalize_turn", "normalize_turn" in inspect.getsource(pipeline))
    check("the service normalises through normalize_turn", "normalize_turn" in inspect.getsource(engine))


def test_history_keeps_what_was_said():
    from debugging.test_service_turn import FakeUnderstanding, make_runtime, user_history

    class LoanDetector:
        def detect_intent(self, text):
            return {"intent": "apply for loan", "confidence": 0.9, "category": "BANKING_INTENT",
                    "is_banking_intent": True, "margin": 0.2, "evidence": ["apply for loan"]}

    fake = FakeUnderstanding()
    runtime = make_runtime(LoanDetector(), fake)
    conversation = ConversationManager()
    conversation.start_conversation()

    said = "ನನಗೆ  ಲೋನ್‌ ಬೇಕು।"
    runtime.run_turn(conversation, said)
    check("history holds the original, byte-for-byte", user_history(conversation) == [said],
          repr(user_history(conversation)))
    check("the turn still started the loan workflow", conversation.current_workflow == "apply for loan")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M5 NORMALISATION TESTS")
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
