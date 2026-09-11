"""
Domain terminology normalization for speech transcripts.

Whisper reliably mishears a small number of high-value banking
terms -- "cheque book" comes back as "Chuck Book", "Chut Book",
"Chat Book". Those variants defeat both knowledge retrieval and
dialogue understanding, because nothing downstream knows that
"chuck book" was ever meant to be a banking term.

This module is a deliberately SMALL, explicit lookup layer, not a
spelling corrector:

- Only whole phrases listed in BANKING_TERM_VARIANTS are ever
  rewritten. There is no fuzzy matching, no edit distance, and no
  attempt to repair arbitrary Whisper errors.

- Matching is word-boundary and case-insensitive, so "chuck book"
  inside a longer sentence is rewritten while unrelated words are
  left exactly as they were.

- Kannada/Hindi transcripts contain none of these ASCII phrases,
  so they pass through untouched. This layer can therefore never
  damage multilingual input.

- The caller keeps the ORIGINAL transcript. Normalization produces
  a second string used only for downstream understanding, intent
  detection and retrieval; conversation history and the printed
  transcript stay raw, so debugging still shows what Whisper
  actually heard.

The speech pipeline itself (recorder.py / stt.py) is not involved:
this runs after transcription, in the dialogue layer, which is the
smallest clean place to attach it.

DELIBERATELY NOT HANDLED HERE:
"load" -> "loan" and similar single-word confusions. "load" is an
ordinary English word, so rewriting it would silently change
sentences the customer really meant. Ambiguous-intent handling of
that kind belongs to the later speech-robustness phase.
"""

import re


# =========================================================
# CANONICAL TERM -> KNOWN TRANSCRIPT VARIANTS
#
# Keep this table small and evidence-driven. A variant belongs
# here only when it is a real, observed mis-transcription of a
# banking term AND is not a plausible ordinary English phrase in
# a banking conversation.
# =========================================================

BANKING_TERM_VARIANTS = {

    "cheque book": [
        "chuck book",
        "chuckbook",
        "chut book",
        "chutbook",
        "chat book",
        "chatbook",
        "chek book",
        "chekbook",
        "check book",
        "checkbook",
        "chequebook",
    ],

    "passbook": [
        "pass book",
        "pas book",
        "passbok",
    ],

    "deposit slip": [
        "deposits lip",
        "deposit clip",
    ],

    "withdrawal slip": [
        "withdrawal clip",
        "withdraw slip",
        "withdrawl slip",
    ],

    "account number": [
        "a c number",
        "ac number",
        "account no",
    ],
}


def _compile_patterns():
    """
    Builds the (pattern, canonical) list once at import time.

    Longer variants are compiled first so a multi-word phrase is
    matched before any shorter phrase that overlaps it.
    """

    compiled = []

    for canonical, variants in BANKING_TERM_VARIANTS.items():

        for variant in sorted(variants, key=len, reverse=True):

            pattern = re.compile(
                r"\b" + re.escape(variant) + r"\b",
                re.IGNORECASE
            )

            compiled.append((pattern, canonical))

    return compiled


_PATTERNS = _compile_patterns()


def normalize_banking_terms(text):
    """
    Returns `text` with known banking-term mis-transcriptions
    replaced by their canonical form.

    The input is never otherwise modified: casing, punctuation,
    numbers and every unlisted word are preserved. Empty or
    non-string input is returned as an empty string, matching how
    the pipeline already treats "no speech detected".
    """

    if not text:
        return ""

    normalized = str(text)

    for pattern, canonical in _PATTERNS:

        normalized = pattern.sub(canonical, normalized)

    return normalized
