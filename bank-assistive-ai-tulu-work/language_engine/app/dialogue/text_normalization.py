"""Text normalisation and loanword canonicalisation (M5).

One place for every rule that rewrites a customer's words before routing.
Before M5 those rules were spread across five modules (term_normalizer,
multilingual_phrases.fold, indic_numbers._fold, manager.normalize_command_text,
and the loanword prefixes in intent/service_keywords), each with its own
idea of Unicode and spelling. They now import from here.

THREE REPRESENTATIONS OF ONE TURN

  original  -- exactly what was heard or typed. Conversation history, the
               transcript shown back to the customer and the debug log keep
               this one. Nothing here ever changes it.

  normalized -- the same words, written one way: NFC, zero-width characters
               removed, curly quotes and Indic dandas (। ॥) as ASCII
               punctuation, whitespace collapsed. Case is kept. Deterministic
               text processing (controls, cues, amounts) reads this form.

  routing   -- normalized, then known English mis-hearings repaired
               (term_normalizer: "chuck book" -> "cheque book"), then banking
               LOANWORDS written in English (ಲೋನ್ / लोन -> loan, एकाउंट ->
               account, "balence" -> balance). Intent detection, the banking
               term logic, the LLM and retrieval receive this form.

WHAT A LOANWORD MAPPING MAY DO

Only rewrite a word that IS the English banking word, in another script or a
known misspelling: ಲೋನ್ is "loan" written in Kannada. It never translates a
native word (ಸಾಲ, खाता and जमा stay as they are) and never maps a word with a
second meaning:

  - ಚೆಕ್ / चेक alone are "check" as often as "cheque" ("ಬ್ಯಾಲೆನ್ಸ್ ಚೆಕ್"),
    so only the pair with ಬುಕ್ / बुक becomes "cheque book".
  - "lone" and "lon" are English words; "kash" could be anything. Unmapped.
  - ಹಾಕು / डाल ("put") often mean a deposit, but ಅರ್ಜಿ ಹಾಕು is "submit an
    application". A verb with two meanings is never mapped to a service.

Numbers, negation words, question words and control phrases contain no
loanword in the table, so they pass through untouched -- and a test asserts
that for every cue and phrase list in the engine.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from app.dialogue.term_normalizer import normalize_banking_terms

# =========================================================
# UNICODE AND PUNCTUATION
# =========================================================

#: Invisible characters that change rendering, never meaning.
_INVISIBLE = dict.fromkeys(map(ord, "​‌‍⁠﻿­"))

#: One spelling for punctuation that has several.
_PUNCTUATION = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "′": "'",
    "“": '"', "”": '"', "„": '"',
    "।": ".",   # danda ।
    "॥": ".",   # double danda ॥
    " ": " ", " ": " ", " ": " ",
})

_NUKTA = "़"
_CHANDRABINDU = "ँ"
_ANUSVARA = "ं"
_VIRAMA_KANNADA = "್"

_EDGE_PUNCTUATION = ".,!?;:\"'()[]{}"


def nfc(text):
    """NFC form. Nukta letters (ज़, ड़) arrive precomposed or combining."""
    return unicodedata.normalize("NFC", text or "")


def normalize_text(text):
    """The `normalized` representation: one spelling, same words, same case."""
    text = nfc(text).translate(_INVISIBLE).translate(_PUNCTUATION)
    return " ".join(text.split())


def fold_word(word):
    """
    A matching key for one word.

    normalize_text() plus the variation that is spelling, not a different
    word: the Devanagari nukta (हज़ार / हजार), chandrabindu written as
    anusvara (पाँच / पांच), and Latin case. NFC alone is not enough: it
    DECOMPOSES ड़ and ज़, so the two spellings only meet once the nukta is
    gone from both.
    """
    word = normalize_text(word)
    return word.replace(_NUKTA, "").replace(_CHANDRABINDU, _ANUSVARA).lower()


def word_tokens(text):
    """Folded words of `text`, edge punctuation removed, in order."""
    out = []
    for chunk in normalize_text(text).split():
        word = fold_word(chunk.strip(_EDGE_PUNCTUATION))
        if word:
            out.append(word)
    return out


# =========================================================
# LOANWORDS
# =========================================================

#: canonical English -> the forms it is written in. Every form is the English
#: word itself, in another script or a known misspelling.
LOANWORDS = {
    "loan": ("ಲೋನ್", "ಲೋನು", "लोन"),
    "deposit": ("ಡೆಪಾಸಿಟ್", "ಡಿಪಾಸಿಟ್", "डिपॉजिट", "डिपोजिट", "डिपाजिट",
                "deposite", "diposit", "diposite", "depositt"),
    "withdraw": ("ವಿತ್ಡ್ರಾ", "ವಿಥ್ಡ್ರಾ", "विड्रॉ", "विथड्रॉ", "विड्रा", "withdrow", "widraw", "withdraww"),
    "withdrawal": ("ವಿತ್ಡ್ರಾಲ್", "विड्रॉल", "विथड्रॉल", "विड्राल", "withdrawl", "withdrawel"),
    "account": ("ಅಕೌಂಟ್", "ಅಕೌಂಟು", "अकाउंट", "एकाउंट", "अकॉउंट", "अकाउन्ट",
                "acount", "accont", "akount", "accout"),
    "balance": ("ಬ್ಯಾಲೆನ್ಸ್", "ಬ್ಯಾಲನ್ಸ್", "बैलेंस", "बेलेंस", "बैलन्स", "बैलेन्स",
                "balence", "balanse", "ballance", "belence"),
    "cash": ("ಕ್ಯಾಶ್", "कैश", "कॅश"),
    "passbook": ("ಪಾಸ್ಬುಕ್", "पासबुक", "passbuk"),
    "cheque book": ("ಚೆಕ್ಬುಕ್", "चेकबुक", "chequebuk", "chekbuk"),
}

#: Two-word forms. Only these pairs: ಚೆಕ್ / चेक alone stay as written.
LOANWORD_PAIRS = {
    ("ಚೆಕ್", "ಬುಕ್"): "cheque book",
    ("चेक", "बुक"): "cheque book",
    ("ಪಾಸ್", "ಬುಕ್"): "passbook",
    ("पास", "बुक"): "passbook",
    ("chek", "buk"): "cheque book",
    ("cheque", "buk"): "cheque book",
}

#: Kannada joins case endings to a loanword: ಲೋನ್‌ಗೆ, ಅಕೌಂಟ್‌ನಿಂದ. When a word
#: begins with one of these virama-final forms and the rest begins with a
#: consonant, the loanword is written in English and the ending kept:
#: "loan ಗೆ". Vowel-joined endings (ಅಕೌಂಟಿಗೆ, ಲೋನಿಗೆ) are left unsplit --
#: they cannot be separated without inventing a spelling.
KANNADA_INFLECTED_STEMS = ("ಲೋನ್", "ಡೆಪಾಸಿಟ್", "ವಿತ್ಡ್ರಾಲ್", "ಅಕೌಂಟ್", "ಬ್ಯಾಲೆನ್ಸ್", "ಕ್ಯಾಶ್", "ಪಾಸ್ಬುಕ್")

_SINGLE = {fold_word(form): canonical for canonical, forms in LOANWORDS.items() for form in forms}
_PAIRS = {(fold_word(a), fold_word(b)): canonical for (a, b), canonical in LOANWORD_PAIRS.items()}
_STEMS = tuple(sorted(((fold_word(s), _SINGLE[fold_word(s)]) for s in KANNADA_INFLECTED_STEMS),
                      key=lambda pair: len(pair[0]), reverse=True))


def _split_edges(chunk):
    """('(', 'ಲೋನ್', '.') -- leading punctuation, word, trailing punctuation."""
    core = chunk.strip(_EDGE_PUNCTUATION)
    if not core:
        return chunk, "", ""
    start = chunk.index(core)
    return chunk[:start], core, chunk[start + len(core):]


def _is_kannada_consonant(char):
    return "ಕ" <= char <= "ಹ"


def _canonical_word(core):
    """The English form of one word, or None when it is not a known loanword."""
    key = fold_word(core)
    if key in _SINGLE:
        return _SINGLE[key]
    for stem, canonical in _STEMS:
        rest = key[len(stem):]
        if key.startswith(stem) and rest and _is_kannada_consonant(rest[0]):
            return f"{canonical} {rest}"
    return None


def canonicalize_loanwords(text):
    """Banking loanwords in English; every other word exactly as it was."""
    chunks = normalize_text(text).split()
    out = []
    index = 0

    while index < len(chunks):
        lead, core, trail = _split_edges(chunks[index])

        if index + 1 < len(chunks):
            lead2, core2, trail2 = _split_edges(chunks[index + 1])
            pair = _PAIRS.get((fold_word(core), fold_word(core2)))
            if pair and not trail and not lead2:
                out.append(f"{lead}{pair}{trail2}")
                index += 2
                continue

        canonical = _canonical_word(core) if core else None
        out.append(f"{lead}{canonical}{trail}" if canonical else chunks[index])
        index += 1

    return " ".join(out)


# =========================================================
# THE THREE REPRESENTATIONS
# =========================================================

@dataclass(frozen=True)
class NormalizedText:
    original: str
    normalized: str
    routing: str


def routing_text(text):
    """The `routing` representation (see the module docstring)."""
    return canonicalize_loanwords(normalize_banking_terms(normalize_text(text)))


def normalize_turn(text):
    """All three representations of one turn. `original` is `text` untouched."""
    original = text if isinstance(text, str) else ""
    normalized = normalize_text(original)
    return NormalizedText(
        original=original,
        normalized=normalized,
        routing=canonicalize_loanwords(normalize_banking_terms(normalized)),
    )
