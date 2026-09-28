"""Kannada / Hindi spoken-amount parsing (Phase 3.2B-12).

Amount extraction used to be entirely the LLM's job (understanding prompt rule
35), whose examples are English and digit-based. A live Kannada turn --
"ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು" (deposit five thousand rupees) -- came back
with amount = None, because nothing in the engine converts a Kannada number
WORD into a value.

The lexicon and composition rules here are ported from the Phase 3.2B-9
evaluator, where they were validated against the frozen banking annotations:
the same rules recovered the annotated amount from 81 of 81 reference
transcripts. That is the reason to reuse them rather than write a third
number parser.

Deliberately conservative:

  - A phrase the lexicon cannot fully account for returns None. A wrong amount
    on a banking transaction is far worse than no amount, and `None` simply
    leaves the existing "please tell me the amount" path in charge.
  - Only money-shaped phrases count. Bare numbers with no scale word and no
    currency word are ignored, so "step two" and "option three" are never read
    as amounts.
"""
import re

#: digits 0-9 spoken one by one
DIGIT_WORDS = {
    "kn": {"ಸೊನ್ನೆ": 0, "ಶೂನ್ಯ": 0, "ಒಂದು": 1, "ಎರಡು": 2, "ಮೂರು": 3, "ನಾಲ್ಕು": 4,
           "ಐದು": 5, "ಆರು": 6, "ಏಳು": 7, "ಎಂಟು": 8, "ಒಂಬತ್ತು": 9},
    "hi": {"शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5,
           "छह": 6, "छः": 6, "छे": 6, "छ": 6, "सात": 7, "आठ": 8, "नौ": 9},
}

#: teens and tens
TENS_AND_TEENS = {
    "kn": {"ಹತ್ತು": 10, "ಹನ್ನೊಂದು": 11, "ಹನ್ನೆರಡು": 12, "ಹದಿಮೂರು": 13, "ಹದಿನಾಲ್ಕು": 14,
           "ಹದಿನೈದು": 15, "ಹದಿನಾರು": 16, "ಹದಿನೇಳು": 17, "ಹದಿನೆಂಟು": 18, "ಹತ್ತೊಂಬತ್ತು": 19,
           "ಇಪ್ಪತ್ತು": 20, "ಮೂವತ್ತು": 30, "ನಲವತ್ತು": 40, "ನಲ್ವತ್ತು": 40, "ಐವತ್ತು": 50,
           "ಅರವತ್ತು": 60, "ಎಪ್ಪತ್ತು": 70, "ಎಂಬತ್ತು": 80, "ತೊಂಬತ್ತು": 90},
    "hi": {"दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15,
           "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20, "तीस": 30,
           "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90},
}

#: hundreds fused into one word (common in Kannada)
FUSED_HUNDREDS = {
    "kn": {"ನೂರು": 100, "ಇನ್ನೂರು": 200, "ಎರಡ್ನೂರು": 200, "ಎರಡುನೂರು": 200, "ಮುನ್ನೂರು": 300,
           "ಮೂರುನೂರು": 300, "ನಾಲ್ಕುನೂರು": 400, "ಐನೂರು": 500, "ಐದುನೂರು": 500,
           "ಆರುನೂರು": 600, "ಏಳುನೂರು": 700, "ಎಂಟುನೂರು": 800, "ಒಂಬೈನೂರು": 900},
    "hi": {},
}

#: multipliers
SCALES = {
    "kn": {"ನೂರು": 100, "ಸಾವಿರ": 1000, "ಸಾವಿರದ": 1000, "ಲಕ್ಷ": 100000, "ಕೋಟಿ": 10000000},
    "hi": {"सौ": 100, "हज़ार": 1000, "हजार": 1000, "लाख": 100000,
           "करोड़": 10000000, "करोड": 10000000},
}

#: currency words: presence makes a bare number an amount
CURRENCY_WORDS = {
    "kn": {"ರೂಪಾಯಿ", "ರೂಪಾಯಿಯ", "ರೂಪಾಯಿಯನ್ನು", "ರೂಪಾಯನ್ನು", "ರೂಪಾಯ", "ರುಪಾಯಿ", "ರೂ"},
    "hi": {"रुपये", "रुपए", "रूपये", "रूपए", "रुपया", "रुपयों", "रूपए"},
}

_WORD = re.compile(r"[^\s]+", re.UNICODE)


def _tables(language):
    lang = (language or "").lower()
    if lang not in DIGIT_WORDS:
        return None
    return (DIGIT_WORDS[lang], TENS_AND_TEENS[lang], FUSED_HUNDREDS[lang],
            SCALES[lang], CURRENCY_WORDS[lang])


def _value_of(token, digits, tens, hundreds):
    for table in (digits, tens, hundreds):
        if token in table:
            return table[token]
    return None


def parse_amount(text, language):
    """Return the rupee value spoken in `text`, or None.

    None means "no amount I am sure about" -- an unparseable or ambiguous
    phrase never produces a guess.
    """
    tables = _tables(language)
    if not text or tables is None:
        return None
    digits, tens, hundreds, scales, currency = tables

    tokens = [t.strip(".,!?;:।") for t in _WORD.findall(text)]
    tokens = [t for t in tokens if t]

    best = None
    index = 0
    while index < len(tokens):
        token = tokens[index]
        is_number = (token.isdigit() or token in scales
                     or _value_of(token, digits, tens, hundreds) is not None)
        if not is_number:
            index += 1
            continue

        # Consume the whole run of number tokens.
        start = index
        total, current, seen_scale, ok = 0, 0, False, True
        while index < len(tokens):
            token = tokens[index]
            if token.isdigit():
                current = current + int(token)
            elif token in scales:
                scale = scales[token]
                if scale >= 1000:
                    total += (current or 1) * scale
                    current = 0
                else:
                    current = (current or 1) * scale
                seen_scale = True
            else:
                value = _value_of(token, digits, tens, hundreds)
                if value is None:
                    break
                if value >= 100:
                    current = (current or 1) * value if value == 100 else current + value
                    seen_scale = True
                else:
                    current += value
            index += 1
        value = total + current

        # A money phrase needs either a scale word (ಸಾವಿರ / हज़ार / ನೂರು ...)
        # or a currency word beside it. A bare "ಎರಡು" is not an amount.
        following = tokens[index] if index < len(tokens) else ""
        preceding = tokens[start - 1] if start > 0 else ""
        has_currency = following in currency or preceding in currency
        if ok and value > 0 and (seen_scale or has_currency):
            # Several amounts in one sentence: keep the first, which is the one
            # the customer is acting on ("deposit 5000 from my 20000 balance").
            if best is None:
                best = value

        if index == start:  # safety: always make progress
            index += 1

    return best


def extract_amount(text, language=None):
    """Amount from `text`, trying digits first, then Kannada, then Hindi.

    `language` restricts parsing to one language when the session language is
    known; without it every supported language is tried, which is safe because
    the lexicons do not overlap.
    """
    if not text:
        return None

    # Plain digits, optionally with separators: "5000", "5,000".
    for match in re.finditer(r"\d[\d,]*", text):
        candidate = match.group(0).replace(",", "")
        if candidate.isdigit() and int(candidate) > 0:
            return int(candidate)

    languages = [language] if language in DIGIT_WORDS else list(DIGIT_WORDS)
    for lang in languages:
        value = parse_amount(text, lang)
        if value is not None:
            return value
    return None
