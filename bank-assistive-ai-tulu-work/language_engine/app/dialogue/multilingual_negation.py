"""Kannada / Hindi / romanised negation (M3).

manager.contains_negation() matched English words only. Its callers are the
guards that stop a REFUSAL from being executed as a REQUEST:

  - the workflow-conflict detector ("I don't want to withdraw" during a
    deposit must not ask "cancel the deposit and start a withdrawal?")
  - the conflict-answer reader ("don't cancel it" must not cancel)
  - the polite-control pass and the pause/resume resolver
  - since M3, the routing layer's refusal gate (a resting-state refusal
    must not start the workflow it refuses)

so in Kannada and Hindi every one of them was off. The M0 harness measured
the result: eight refusals raised conflicts, and "रद्द मत करो" (don't
cancel) answered a conflict question with CANCEL.

WHAT COUNTS

Whole words only, after manager-independent folding (multilingual_phrases.
word_tokens), never a substring of the sentence:

  Hindi     नहीं / नही (not), मत (don't)
  Kannada   ಬೇಡ (don't want) and verbs ending in it (ತೆಗೆಯಬೇಡಿ, don't
            withdraw); ಇಲ್ಲ / ಅಲ್ಲ (not); and the negative verb ending
            ...ಲ್ಲ (ತೆಗೆಯಲ್ಲ, I won't withdraw; ಬೇಕಿಲ್ಲ, not needed)
  romanised nahi / nahin / nhi, mat, beda, illa, alla, bekilla

WHAT DOES NOT, ON PURPOSE

  - ಎಲ್ಲ / ಎಲ್ಲಾ ("all") end like the negative verb ending. The ending rule
    therefore needs a word of at least five characters, which ಇಲ್ಲ, ಅಲ್ಲ
    and ಎಲ್ಲ are not; the first two are matched as whole words instead.
  - ना / न and romanised "na", "nai": tag questions ("है ना?") and the
    adjective "new" (नई / nai) make them unsafe on their own.

A false negative costs the same as before M3 (the guard is off for that
sentence). A false positive costs one turn: the refusal gate answers
"Okay..." and the customer says it again. Neither direction can start,
cancel or advance a workflow by itself.
"""

from app.dialogue.multilingual_phrases import fold, word_tokens

HINDI_NEGATION_WORDS = {"नहीं", "नही", "मत"}

KANNADA_NEGATION_WORDS = {"ಬೇಡ", "ಬೇಡಾ", "ಇಲ್ಲ", "ಇಲ್ಲಾ", "ಅಲ್ಲ"}

#: Imperative / desiderative negatives: ತೆಗೆಯಬೇಡ, ತೆಗೆಯಬೇಡಿ, ಮಾಡಬೇಡಾ.
KANNADA_NEGATIVE_SUFFIXES = ("ಬೇಡ", "ಬೇಡಿ", "ಬೇಡಾ")

#: The negative verb ending: ತೆಗೆಯಲ್ಲ, ಮಾಡಲ್ಲ, ಬೇಕಿಲ್ಲ, ಗೊತ್ತಿಲ್ಲ.
KANNADA_NEGATIVE_ENDING = "ಲ್ಲ"
KANNADA_NEGATIVE_ENDING_MIN_LENGTH = 5

#: Words that end like a negative and are not one.
KANNADA_NOT_NEGATIVE = {"ಎಲ್ಲ", "ಎಲ್ಲಾ"}

#: "nhi" (Batch 1, G1) is the common chat spelling of "nahi" -- AWAITING
#: NATIVE-SPEAKER REVIEW. Whole word only, like every entry here.
ROMANISED_NEGATION_WORDS = {"nahi", "nahin", "nhi", "mat", "beda", "bedaa", "illa", "alla", "bekilla"}

_WORDS = {fold(w) for w in HINDI_NEGATION_WORDS | KANNADA_NEGATION_WORDS | ROMANISED_NEGATION_WORDS}
_SUFFIXES = tuple(fold(s) for s in KANNADA_NEGATIVE_SUFFIXES)
_NOT_NEGATIVE = {fold(w) for w in KANNADA_NOT_NEGATIVE}


def is_negating_word(word):
    """True for one folded word that negates."""

    if word in _NOT_NEGATIVE:
        return False

    if word in _WORDS or word.endswith(_SUFFIXES):
        return True

    return word.endswith(KANNADA_NEGATIVE_ENDING) and len(word) >= KANNADA_NEGATIVE_ENDING_MIN_LENGTH


def contains_indic_negation(text):
    """True when `text` contains a Kannada, Hindi or romanised negating word."""

    return any(is_negating_word(word) for word in word_tokens(text))
