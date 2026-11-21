"""Kannada / Hindi spoken-amount parsing (Phase 3.2B-12, hardened in M1).

Amount extraction is the LLM's job first (understanding prompt rule 35).
This module only FILLS A GAP: DialogueManager calls extract_amount() when the
model returned no amount, so a Kannada or Hindi amount spoken as words
("ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು") is not lost.

WHAT M1 CHANGED, AND WHY

The M0 evaluation harness found that this parser returned WRONG amounts --
not missing ones -- for ordinary speech:

    "पच्चीस हज़ार रुपये"   (25,000)  -> 1000
    "ಇಪ್ಪತ್ತೈದು ಸಾವಿರ"    (25,000)  -> 1000
    "ढाई हज़ार"           (2,500)   -> 1000
    "5 ಸಾವಿರ ರೂಪಾಯಿ"      (5,000)   -> 5
    "account 1234 me 5000 jama"   -> 1234

and, on the 200 annotated IndicVoices banking transcripts, picked the
cancelled amount in "stop the 700, send 300 instead" and summed spoken dates
into amounts. Each has one of four causes, and each is fixed here:

  1. Missing words. Hindi numbers 21-99 are separate words, and Kannada fuses
     tens and units into one word (ಇಪ್ಪತ್ತು + ಐದು -> ಇಪ್ಪತ್ತೈದು). Neither
     was in the lexicon. Both are now complete for 1-99.

  2. An unknown word before a scale word was silently dropped, and the scale
     word alone became 1 x scale. A scale word with no multiplier now counts
     only when nothing precedes it, or a word that cannot be a number (see
     BARE_SCALE_LEAD_WORDS). Otherwise the phrase is unparseable.

  3. Digits were taken first, before any scale word: "5 ಸಾವಿರ" became 5.
     Digits and number words now go through one phrase parser.

  4. The first number in the sentence won. Now an account / step / phone
     number is never an amount, and two DIFFERENT amounts in one sentence
     return None -- the parser cannot know which one the customer is acting on.

THE RULE THAT DECIDES EVERYTHING ELSE

A wrong amount on a banking transaction is far worse than no amount. None
leaves the existing "please tell me the amount" path in charge. So every
ambiguity resolves to None:

  - a number phrase that is not a well-formed number ("ಎರಡು ಮೂರು ಸಾವಿರ",
    "two-three thousand"; dates such as "इक्कीस बारह दो हज़ार उन्नीस")
  - a fraction with no scale word to make it whole ("ढाई रुपये")
  - two different amounts in one sentence
  - a money-shaped phrase that could not be parsed, even if another number
    elsewhere could be

Only money-shaped phrases count as amounts: a scale word (ಸಾವಿರ / हज़ार /
thousand / k ...) or a currency word or symbol beside the number. The one
exception is a lone digit string ("I want to deposit 5000"), which has always
been accepted and still is, as long as it is the only number present and is
not an account, step or phone number.

NOT HANDLED (returns None, never a guess): number words in English ("five
thousand") or romanised Hindi / Kannada ("paanch hazaar") -- the LLM covers
English; digit-by-digit speech ("ಐದು ಸೊನ್ನೆ ಸೊನ್ನೆ"); English numerals
spoken in Devanagari ("टू हंड्रेड").
"""
import re
from fractions import Fraction

from app.dialogue.text_normalization import fold_word

# =========================================================
# LEXICON
# =========================================================

#: digits 0-9 spoken one by one
DIGIT_WORDS = {
    "kn": {"ಸೊನ್ನೆ": 0, "ಶೂನ್ಯ": 0, "ಒಂದು": 1, "ಎರಡು": 2, "ಮೂರು": 3, "ನಾಲ್ಕು": 4,
           "ಐದು": 5, "ಆರು": 6, "ಏಳು": 7, "ಎಂಟು": 8, "ಒಂಬತ್ತು": 9},
    "hi": {"शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5,
           "छह": 6, "छः": 6, "छे": 6, "छ": 6, "सात": 7, "आठ": 8, "नौ": 9},
}

#: 10-99. Kannada lists teens and round tens here; its fused compounds
#: (21-99) are generated below. Hindi lists every number, because each one
#: is its own word.
TENS_AND_TEENS = {
    "kn": {"ಹತ್ತು": 10, "ಹನ್ನೊಂದು": 11, "ಹನ್ನೆರಡು": 12, "ಹದಿಮೂರು": 13, "ಹದಿನಾಲ್ಕು": 14,
           "ಹದಿನೈದು": 15, "ಹದಿನಾರು": 16, "ಹದಿನೇಳು": 17, "ಹದಿನೆಂಟು": 18, "ಹತ್ತೊಂಬತ್ತು": 19,
           "ಇಪ್ಪತ್ತು": 20, "ಮೂವತ್ತು": 30, "ನಲವತ್ತು": 40, "ನಲ್ವತ್ತು": 40, "ಐವತ್ತು": 50,
           "ಅರವತ್ತು": 60, "ಎಪ್ಪತ್ತು": 70, "ಎಂಬತ್ತು": 80, "ತೊಂಬತ್ತು": 90},
    "hi": {
        "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15, "पन्द्रह": 15,
        "सोलह": 16, "सत्रह": 17, "अठारह": 18, "अट्ठारह": 18, "उन्नीस": 19,
        "बीस": 20, "इक्कीस": 21, "बाईस": 22, "तेईस": 23, "चौबीस": 24, "पच्चीस": 25,
        "छब्बीस": 26, "सत्ताईस": 27, "अट्ठाईस": 28, "उनतीस": 29,
        "तीस": 30, "इकतीस": 31, "इकत्तीस": 31, "बत्तीस": 32, "तैंतीस": 33, "चौंतीस": 34,
        "पैंतीस": 35, "छत्तीस": 36, "सैंतीस": 37, "अड़तीस": 38, "उनतालीस": 39, "उनचालीस": 39,
        "चालीस": 40, "इकतालीस": 41, "बयालीस": 42, "तैंतालीस": 43, "चवालीस": 44, "चौवालीस": 44,
        "पैंतालीस": 45, "छियालीस": 46, "सैंतालीस": 47, "अड़तालीस": 48, "उनचास": 49,
        "पचास": 50, "इक्यावन": 51, "बावन": 52, "तिरपन": 53, "तिरेपन": 53, "चौवन": 54, "चव्वन": 54,
        "पचपन": 55, "छप्पन": 56, "सत्तावन": 57, "अट्ठावन": 58, "उनसठ": 59,
        "साठ": 60, "इकसठ": 61, "बासठ": 62, "तिरसठ": 63, "चौंसठ": 64, "पैंसठ": 65,
        "छियासठ": 66, "सड़सठ": 67, "सरसठ": 67, "अड़सठ": 68, "उनहत्तर": 69,
        "सत्तर": 70, "इकहत्तर": 71, "बहत्तर": 72, "तिहत्तर": 73, "चौहत्तर": 74, "पचहत्तर": 75,
        "छिहत्तर": 76, "सतहत्तर": 77, "अठहत्तर": 78, "उन्यासी": 79, "उनासी": 79,
        "अस्सी": 80, "इक्यासी": 81, "बयासी": 82, "तिरासी": 83, "चौरासी": 84, "पचासी": 85,
        "छियासी": 86, "सत्तासी": 87, "अट्ठासी": 88, "नवासी": 89,
        "नब्बे": 90, "इक्यानवे": 91, "बानवे": 92, "तिरानवे": 93, "चौरानवे": 94,
        "पंचानवे": 95, "पंचानबे": 95, "छियानवे": 96, "सत्तानवे": 97, "अट्ठानवे": 98,
        "निन्यानवे": 99, "निन्यानबे": 99,
    },
}

#: hundreds fused into one word (common in Kannada). Oblique forms ending in
#: ನೂರ ("ಐನೂರ ಐವತ್ತು") are generated below.
FUSED_HUNDREDS = {
    "kn": {"ನೂರು": 100, "ಇನ್ನೂರು": 200, "ಎರಡ್ನೂರು": 200, "ಎರಡುನೂರು": 200, "ಮುನ್ನೂರು": 300,
           "ಮೂರುನೂರು": 300, "ನಾನೂರು": 400, "ನಾಲ್ಕುನೂರು": 400, "ಐನೂರು": 500, "ಐದುನೂರು": 500,
           "ಆರುನೂರು": 600, "ಏಳುನೂರು": 700, "ಎಂಟುನೂರು": 800, "ಒಂಬೈನೂರು": 900,
           "ಒಂಬತ್ತುನೂರು": 900},
    "hi": {},
}

#: multipliers. ನೂರು/सौ are both a value (100) and a multiplier ("ಎರಡು ನೂರು").
SCALES = {
    "kn": {"ನೂರು": 100, "ಸಾವಿರ": 1000, "ಸಾವಿರದ": 1000, "ಲಕ್ಷ": 100000, "ಲಕ್ಷದ": 100000,
           "ಕೋಟಿ": 10000000},
    "hi": {"सौ": 100, "हज़ार": 1000, "हजार": 1000, "लाख": 100000,
           "करोड़": 10000000, "करोड": 10000000},
}

#: Latin scale words, accepted after DIGITS only ("5 thousand", "2 lakh").
#: As a bare word they never start an amount: "five thousand" stays None.
LATIN_SCALES = {
    "hundred": 100, "hundreds": 100, "thousand": 1000, "thousands": 1000,
    "lakh": 100000, "lakhs": 100000, "lac": 100000, "lacs": 100000,
    "crore": 10000000, "crores": 10000000,
}

#: currency words: presence makes a bare number an amount
CURRENCY_WORDS = {
    "kn": {"ರೂಪಾಯಿ", "ರೂಪಾಯಿಯ", "ರೂಪಾಯಿಯನ್ನು", "ರೂಪಾಯನ್ನು", "ರೂಪಾಯನ್ನ", "ರೂಪಾಯ", "ರುಪಾಯಿ",
           "ರೂ", "ರೂಪಾಯಿಗಳು", "ರೂಪಾಯಿಗಳನ್ನು"},
    "hi": {"रुपये", "रुपए", "रूपये", "रूपए", "रुपया", "रुपयों", "रु", "रू"},
}

LATIN_CURRENCY_WORDS = {"₹", "rs", "inr", "rupee", "rupees"}

#: Fractional number words. They need a scale word to become whole:
#: "डेढ़ लाख" is 150,000, "ढाई" on its own is not an amount.
FRACTION_WORDS = {
    "kn": {},  # generated below: ಒಂದೂವರೆ (1.5) ... ಹತ್ತೂವರೆ (10.5)
    "hi": {"डेढ़": Fraction(3, 2), "डेढ": Fraction(3, 2), "ढाई": Fraction(5, 2)},
}

#: Hindi fraction modifiers, applied to the number after them:
#: "साढ़े तीन हज़ार" = 3,500, "सवा लाख" = 125,000, "पौने दो लाख" = 175,000.
#: सवा alone before a scale word means 1¼.
FRACTION_MODIFIERS = {
    "साढ़े": ("plus", Fraction(1, 2)),
    "सवा": ("plus", Fraction(1, 4)),
    "पौने": ("minus", Fraction(1, 4)),
}

#: A number right after one of these is an identifier, never an amount.
IDENTIFIER_WORDS = {
    # English
    "account", "acct", "acc", "a/c", "ac", "no", "number", "num", "step",
    "otp", "pin", "id", "mobile", "phone", "cif", "ifsc", "card",
    # romanised
    "khata", "khaata", "nambar",
    # Kannada
    "ಖಾತೆ", "ಅಕೌಂಟ್", "ಸಂಖ್ಯೆ", "ನಂಬರ್", "ಹಂತ", "ಫೋನ್", "ಮೊಬೈಲ್",
    # Hindi
    "खाता", "अकाउंट", "संख्या", "नंबर", "नम्बर", "चरण", "कदम", "स्टेप", "फोन", "फ़ोन", "मोबाइल",
}

#: A scale word with no number before it ("हज़ार रुपये", "और सौ रुपये")
#: means one of that scale ONLY after one of these, or at the start. After
#: any other word the parser cannot rule out an unknown number word it
#: failed to recognise, so the phrase is unparseable.
BARE_SCALE_LEAD_WORDS = {
    "and", "a", "only", "just", "me", "i", "of", "amount", "sum",
    "और", "तथा", "मुझे", "मैं", "हमें", "मेरे", "मेरा", "सिर्फ", "केवल", "कुल", "बस",
    "ಮತ್ತು", "ನನಗೆ", "ನಾನು", "ನನ್ನ", "ಕೇವಲ", "ಒಟ್ಟು", "ಬರೀ",
    # Words meaning "amount": "बीमित राशि सौ रुपये" (an insured amount of a
    # hundred rupees) is one of the annotated IndicVoices transcripts.
    "राशि", "रकम", "ಮೊತ್ತ",
}

_PUNCTUATION = ".,!?;:।॥\"'()[]{}/-"

# A whole whitespace chunk that is a number: 5000, 5,000, 1,50,000, 2.5, 5k,
# optionally behind ₹ or rs. Digits glued to letters ("2nd", "10am") are not.
_DIGIT_CHUNK = re.compile(r"^(?:₹|rs\.?)?(\d[\d,]*(?:\.\d+)?)(k)?$", re.IGNORECASE)
# Spoken dates and times, which are never amounts: 15/08/2024, 15-08-24, 10:30.
_DATE_OR_TIME = re.compile(r"\b\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}\b|\b\d{1,2}:\d{2}\b")


# One spelling per word, applied to the lexicon and to the input alike. Since
# M5 this is the engine's single definition (text_normalization.fold_word):
# NFC, zero-width characters removed, the nukta dropped (हज़ार / हजार),
# chandrabindu as anusvara (पाँच / पांच), Latin lowercased.
_fold = fold_word


_KN_VOWEL_SIGNS = {"ಒ": "ೊ", "ಎ": "ೆ", "ಐ": "ೈ", "ಆ": "ಾ", "ಏ": "ೇ"}


def _kannada_compounds():
    """
    21-99 as Kannada speakers fuse them.

    The tens word loses its final ು. A unit beginning with a vowel joins as
    that vowel's sign (ಇಪ್ಪತ್ತ + ೈದು -> ಇಪ್ಪತ್ತೈದು); a unit beginning with a
    consonant is attached in each of the three spellings in use
    (ಇಪ್ಪತ್ಮೂರು, ಇಪ್ಪತ್ತಮೂರು, ಇಪ್ಪತ್ತುಮೂರು).
    """
    out = {}
    tens = {w: v for w, v in TENS_AND_TEENS["kn"].items() if v >= 20}
    for tens_word, tens_value in tens.items():
        stem = tens_word[:-1]            # ಇಪ್ಪತ್ತು -> ಇಪ್ಪತ್ತ
        clipped = tens_word[:-2]         # ಇಪ್ಪತ್ತು -> ಇಪ್ಪತ್
        for unit_word, unit_value in DIGIT_WORDS["kn"].items():
            if unit_value == 0:
                continue
            first = unit_word[0]
            if first in _KN_VOWEL_SIGNS:
                forms = [stem + _KN_VOWEL_SIGNS[first] + unit_word[1:]]
            else:
                forms = [clipped + unit_word, stem + unit_word, tens_word + unit_word]
            for form in forms:
                out[form] = tens_value + unit_value
    return out


def _kannada_fractions():
    """ಒಂದೂವರೆ (1.5) ... ಹತ್ತೂವರೆ (10.5): the number's final ು becomes ೂ + ವರೆ."""
    numbers = {**{w: v for w, v in DIGIT_WORDS["kn"].items() if v > 0},
               **{w: v for w, v in TENS_AND_TEENS["kn"].items() if v == 10}}
    return {word[:-1] + "ೂವರೆ": Fraction(value) + Fraction(1, 2)
            for word, value in numbers.items() if word.endswith("ು")}


def _oblique_hundreds():
    """ಐನೂರ / ಏಳುನೂರ ...: the oblique form used before a following number."""
    return {word[:-1]: value for word, value in FUSED_HUNDREDS["kn"].items()}


FRACTION_WORDS["kn"] = _kannada_fractions()


def _build_lexicon(language):
    """{folded word: (kind, value)} for one language."""
    lexicon = {}

    def add(table, kind):
        for word, value in table.items():
            lexicon[_fold(word)] = (kind, Fraction(value) if kind != "mod" else value)

    add(DIGIT_WORDS[language], "num")
    add(TENS_AND_TEENS[language], "num")
    add(FUSED_HUNDREDS[language], "num")
    if language == "kn":
        add(_kannada_compounds(), "num")
        add(_oblique_hundreds(), "num")
    add(FRACTION_WORDS[language], "num")
    add(SCALES[language], "scale")   # ನೂರು resolves to a scale; same value either way
    if language == "hi":
        add(FRACTION_MODIFIERS, "mod")
    for word in CURRENCY_WORDS[language]:
        lexicon[_fold(word)] = ("currency", None)
    return lexicon


_LEXICONS = {language: _build_lexicon(language) for language in DIGIT_WORDS}
_LATIN_SCALES = {_fold(w): Fraction(v) for w, v in LATIN_SCALES.items()}
_LATIN_CURRENCY = {_fold(w) for w in LATIN_CURRENCY_WORDS}
_IDENTIFIERS = {_fold(w) for w in IDENTIFIER_WORDS}
_BARE_SCALE_LEADS = {_fold(w) for w in BARE_SCALE_LEAD_WORDS}
_HINDI_GIVE = _fold("दो")  # "दो" is also the verb "give"


# =========================================================
# TOKENS
# =========================================================

def _tokens(text, lexicon):
    """
    [(kind, value, folded word)] where kind is one of
    digit / num / scale / mod / currency / word.

    A digit chunk with a k suffix becomes a digit followed by a scale, so
    "5k" and "5 ಸಾವಿರ" take the same path.
    """
    text = _DATE_OR_TIME.sub(" <date> ", text)
    out = []

    for chunk in text.split():
        stripped = chunk.strip(_PUNCTUATION)

        if stripped.startswith("₹") and len(stripped) > 1:
            out.append(("currency", None, "₹"))
            stripped = stripped[1:]

        match = _DIGIT_CHUNK.match(stripped) if stripped else None
        if match:
            digits = match.group(1).replace(",", "")
            if stripped[:1].lower() == "r":   # "rs500"
                out.append(("currency", None, "rs"))
            if digits.replace(".", "", 1).isdigit():
                out.append(("digit", Fraction(digits), digits))
                if match.group(2):
                    out.append(("scale", Fraction(1000), "k"))
                continue

        word = _fold(stripped)
        if not word:
            continue
        if word in lexicon:
            kind, value = lexicon[word]
        elif word in _LATIN_SCALES:
            kind, value = "scale", _LATIN_SCALES[word]
        elif word in _LATIN_CURRENCY:
            kind, value = "currency", None
        else:
            kind, value = "word", None
        out.append((kind, value, word))

    return out


# =========================================================
# ONE NUMBER PHRASE
# =========================================================

class _Unparseable(Exception):
    """The phrase is number-shaped but not a well-formed number."""


def _whole(value):
    return value.denominator == 1


def _value_of_phrase(items, bare_scale_ok):
    """
    Value of one contiguous run of number tokens, Indian system.

    Raises _Unparseable for anything that is not one well-formed number --
    which is how dates, digit-by-digit speech and approximations ("two-three
    thousand") end up as None rather than as a sum.
    """
    total = Fraction(0)
    current = None
    last_big = None
    pending = None
    previous_kind = None
    legacy_decimal = False

    for index, (kind, value, word) in enumerate(items):

        if kind == "mod":
            if current is not None or pending is not None:
                raise _Unparseable(word)
            pending = (word, value)

        elif kind in ("num", "digit"):
            if pending is not None:
                modifier_word, (operation, amount) = pending
                pending = None
                if not _whole(value) or not 1 <= value < 100:
                    raise _Unparseable(modifier_word)
                value = value + amount if operation == "plus" else value - amount

            if current is None:
                current = value
                legacy_decimal = kind == "digit" and not _whole(value)
            else:
                # Two numbers side by side form one number only as tens then
                # units ("ಇಪ್ಪತ್ತು ಐದು"), or hundreds then the rest
                # ("ಐನೂರು ಐವತ್ತು"). Anything else -- "ಎರಡು ಮೂರು", a digit
                # beside a word, 18 then 11 in a spoken date -- is not.
                if kind == "digit" or previous_kind == "digit":
                    raise _Unparseable(word)
                if not _whole(current) or not _whole(value) or value >= 100:
                    raise _Unparseable(word)
                low = current % 100
                if not (low == 0 or (low >= 20 and low % 10 == 0 and 1 <= value <= 9)):
                    raise _Unparseable(word)
                current += value

        elif kind == "scale":
            if pending is not None:
                modifier_word, (operation, amount) = pending
                pending = None
                if modifier_word != _fold("सवा"):
                    raise _Unparseable(modifier_word)
                current = Fraction(1) + amount

            if current is None:
                # A scale word with no number before it.
                if index != 0 or not bare_scale_ok:
                    raise _Unparseable(word)
                current = Fraction(1)

            if value == 100:
                if current >= 100:
                    raise _Unparseable(word)
                current = current * 100
                if not _whole(current):
                    raise _Unparseable(word)
            else:
                if last_big is not None and value >= last_big:
                    raise _Unparseable(word)
                product = current * value
                if not _whole(product):
                    raise _Unparseable(word)
                total += product
                current = None
                last_big = value
            legacy_decimal = False

        previous_kind = kind

    if pending is not None:
        raise _Unparseable("modifier without a number")

    if current is not None and not _whole(current):
        if not legacy_decimal:
            # A fraction with no scale word: "ढाई रुपये" is not a whole amount.
            raise _Unparseable("fraction without a scale")
        # "500.50": a plain decimal keeps its whole rupees, exactly as before M1.
        current = Fraction(int(current))

    value = total + (current or 0)
    if value <= 0:
        raise _Unparseable("zero")
    return int(value)


def _phrases(tokens):
    """
    Split tokens into number runs. Yields dicts describing each run and the
    words around it.

    A Hindi "दो" right after a scale word, at the very end of the utterance,
    is the verb "give" ("दो हज़ार दो" = "give two thousand"), not 2.
    """
    index = 0
    while index < len(tokens):
        if tokens[index][0] not in ("digit", "num", "scale", "mod"):
            index += 1
            continue

        start = index
        while index < len(tokens) and tokens[index][0] in ("digit", "num", "scale", "mod"):
            index += 1
        end = index

        if (end - start >= 2 and end == len(tokens)
                and tokens[end - 1][2] == _HINDI_GIVE and tokens[end - 2][0] == "scale"):
            end -= 1

        items = tokens[start:end]
        before = tokens[start - 1] if start > 0 else None
        after = tokens[end] if end < len(tokens) else None

        yield {
            "items": items,
            "before": before,
            "after": after,
            "has_scale": any(kind == "scale" for kind, _, _ in items)
                         or any(kind == "num" and value >= 100 for kind, value, _ in items),
            "has_currency": (before is not None and before[0] == "currency")
                            or (after is not None and after[0] == "currency"),
            "digits_only": all(kind == "digit" for kind, _, _ in items),
            "identifier": before is not None and before[2] in _IDENTIFIERS,
            "bare_scale_ok": before is None or before[2] in _BARE_SCALE_LEADS
                             or before[0] == "currency",
        }

        index = max(end, start + 1)


def _extract(text, lexicon):
    """The amount in `text` using one merged lexicon, or None."""
    tokens = _tokens(text, lexicon)
    values = []

    for phrase in _phrases(tokens):
        if phrase["identifier"]:
            # "account 1234": never an amount, whatever is around it.
            continue

        money_shaped = phrase["has_scale"] or phrase["has_currency"]

        try:
            value = _value_of_phrase(phrase["items"], phrase["bare_scale_ok"])
        except _Unparseable:
            if money_shaped:
                # The customer named an amount we could not read. Returning
                # some OTHER number from the sentence would be a guess.
                return None
            continue

        if money_shaped or phrase["digits_only"]:
            values.append(value)

    distinct = set(values)
    if len(distinct) != 1:
        # None found, or two different amounts ("stop the 700, send 300").
        return None
    return values[0]


_MERGED = {}
for _language, _table in _LEXICONS.items():
    _MERGED.update(_table)


def parse_amount(text, language):
    """Return the rupee value spoken in `text`, or None.

    `language` selects the Kannada or Hindi number words; any other language
    returns None, as before. None means "no amount I am sure about" -- an
    unparseable or ambiguous phrase never produces a guess.
    """
    lexicon = _LEXICONS.get((language or "").lower())
    if not text or lexicon is None:
        return None
    return _extract(text, lexicon)


def extract_amount(text, language=None):
    """Amount from `text`: digits, Kannada and Hindi number words, together.

    `language` restricts the number words to one language when the session
    language is known; without it every supported language is used, which is
    safe because the lexicons do not overlap (different scripts).
    """
    if not text:
        return None
    lexicon = _LEXICONS.get((language or "").lower(), _MERGED)
    return _extract(text, lexicon)
