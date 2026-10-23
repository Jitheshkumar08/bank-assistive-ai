"""Kannada / Hindi / romanised question cues (M3).

manager.looks_like_a_question() recognised English only ("?", a leading
question word, a WH-word). Kannada and Hindi questions never matched, so in
a resting state they skipped the LLM's question classification and went
straight to IntentDetector -- which read "ಖಾತೆ ತೆರೆಯುವುದು ಹೇಗೆ" (how does
one open an account) as a request and STARTED the account-opening workflow.
The M0 harness measured 15 such questions.

WHAT A MATCH DOES -- AND DOES NOT -- DO

Exactly what an English match does. looks_like_a_question() is a
PRE-FILTER, not a decision: a match only buys the utterance the LLM's own
classification (question / help vs. workflow_action) in a resting state,
and stops it raising a workflow conflict mid-task. It never answers, starts,
cancels or advances anything by itself. A request that happens to contain a
question word ("क्या मैं पैसे निकाल सकता हूँ", can I withdraw money?) still
reaches its workflow if the LLM calls it one -- the same path as English
"can I withdraw money?".

THE WHOLE UTTERANCE, NOT ANY MARKER

  - Cues are whole words (or fixed two-word phrases), never substrings.
  - Yes/no question endings (ಬೇಕಾ, ಇದೆಯಾ, ...ಬಹುದೇ) count only on the
    LAST word, where Kannada puts them.
  - One pattern is deliberately NOT a question: asking for one's OWN
    balance with nothing but a how-much word ("ನನ್ನ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟಿದೆ",
    "मेरे खाते में कितने पैसे हैं"). That is the balance-check service,
    and IntentDetector already routes it; sending it to the LLM would only
    add a round-trip. Anything more ("मेरे खाते में कितना ब्याज मिलेगा",
    how much interest will my account earn) has no balance or money word
    and stays a question.
"""

from app.dialogue.multilingual_phrases import fold, word_tokens

KANNADA_QUESTION_WORDS = {
    "ಏನು", "ಏನ್", "ಏನಿದೆ", "ಯಾವ", "ಯಾವುದು", "ಯಾವುವು", "ಯಾವುದಕ್ಕೆ", "ಯಾರು",
    "ಯಾಕೆ", "ಏಕೆ", "ಹೇಗೆ", "ಹೇಗಿದೆ", "ಎಲ್ಲಿ", "ಎಲ್ಲಿದೆ", "ಯಾವಾಗ",
    "ಎಷ್ಟು", "ಎಷ್ಟಿದೆ", "ಎಂದರೇನು", "ಅಂದರೇನು", "ಎಂತಹ",
    # "about" / "information" / "details": a request for information.
    "ಬಗ್ಗೆ", "ಮಾಹಿತಿ", "ವಿವರ", "ವಿವರಗಳು",
}

HINDI_QUESTION_WORDS = {
    "क्या", "कैसे", "कैसा", "कैसी", "कौन", "कौनसा", "कौनसी", "कौनसे",
    "कौन-सा", "कौन-सी", "कौन-से", "क्यों", "कहाँ", "कब", "कितना", "कितने",
    "कितनी", "किस", "किसे", "किसको",
    "जानकारी", "विवरण",
}

ROMANISED_QUESTION_WORDS = {
    # Hindi
    "kya", "kaise", "kaisa", "kaisi", "kaun", "kaunsa", "kaunsi", "kaunse",
    "kyun", "kyon", "kyu", "kahan", "kahaan", "kab", "kitna", "kitne", "kitni",
    "jankari", "jaankari",
    # Kannada
    "enu", "yaava", "yava", "yaavudu", "yake", "yaake", "hege", "elli",
    "yavaga", "yaavaga", "eshtu", "eshtide", "endarenu", "andarenu", "mahiti", "bagge",
}

#: Two-word cues, matched by word PREFIX so inflection does not matter:
#: ಬೇಕಾದ ದಾಖಲೆಗಳು (the documents required), के बारे में (about).
QUESTION_PHRASES = (
    ("ಬೇಕಾದ", "ದಾಖಲೆ"),
    ("ಅಗತ್ಯ", "ದಾಖಲೆ"),
    ("बारे", "में"),
    ("bare", "me"),
    ("baare", "me"),
)

#: Yes/no question endings, on the LAST word only.
KANNADA_QUESTION_ENDINGS = (
    "ಬಹುದೇ", "ಬಹುದಾ", "ಬೇಕಾ", "ಬೇಕೇ", "ದೆಯಾ", "ದೆಯೇ",
    "ಗುತ್ತಾ", "ಗುತ್ತದೆಯೇ", "ಗುತ್ತದೆಯಾ", "ತೀರಾ", "ಸಾಧ್ಯವೇ", "ಸಾಧ್ಯವಾ",
)

# --- the own-balance exception -------------------------------------------

HOW_MUCH_WORDS = {"ಎಷ್ಟು", "ಎಷ್ಟಿದೆ", "कितना", "कितने", "कितनी", "kitna", "kitne", "kitni", "eshtu", "eshtide"}
POSSESSIVE_WORDS = {"ನನ್ನ", "ನನ್ನದು", "मेरा", "मेरे", "मेरी", "mera", "mere", "meri", "nanna"}
BALANCE_PREFIXES = ("ಬ್ಯಾಲೆನ್ಸ್", "ಶಿಲ್ಕು", "बैलेंस", "शेष", "balance")
MONEY_PREFIXES = ("ಹಣ", "ದುಡ್ಡು", "पैस", "paise", "paisa", "hana", "duddu")
ACCOUNT_PREFIXES = ("ಖಾತೆ", "ಅಕೌಂಟ್", "खात", "अकाउंट", "account", "khat")


def _folded(words):
    return {fold(w) for w in words}


_QUESTION_WORDS = _folded(KANNADA_QUESTION_WORDS | HINDI_QUESTION_WORDS | ROMANISED_QUESTION_WORDS)
_PHRASES = tuple((fold(a), fold(b)) for a, b in QUESTION_PHRASES)
_ENDINGS = tuple(fold(e) for e in KANNADA_QUESTION_ENDINGS)
_HOW_MUCH = _folded(HOW_MUCH_WORDS)
_POSSESSIVE = _folded(POSSESSIVE_WORDS)
_BALANCE = tuple(fold(p) for p in BALANCE_PREFIXES)
_MONEY = tuple(fold(p) for p in MONEY_PREFIXES)
_ACCOUNT = tuple(fold(p) for p in ACCOUNT_PREFIXES)


def question_cues(text):
    """The cues found in `text`, as a set of strings (empty when none)."""

    words = word_tokens(text)
    cues = {w for w in words if w in _QUESTION_WORDS}

    for first, second in zip(words, words[1:]):
        for a, b in _PHRASES:
            if first.startswith(a) and second.startswith(b):
                cues.add(f"{a} {b}")

    if words and words[-1].endswith(_ENDINGS):
        cues.add(f"…{words[-1]}")

    return cues


def asks_for_own_balance(text, cues=None):
    """
    "my balance -- how much": the balance-check service, not a question.

    Only when the how-much word is the ONLY cue, a first-person possessive is
    present, and the sentence names the balance, or money and the account.
    """

    cues = question_cues(text) if cues is None else cues
    if not cues or not cues <= _HOW_MUCH:
        return False

    words = word_tokens(text)
    if not any(w in _POSSESSIVE for w in words):
        return False

    def has(prefixes):
        return any(w.startswith(prefixes) for w in words)

    return has(_BALANCE) or (has(_MONEY) and has(_ACCOUNT))


def looks_like_an_indic_question(text):
    """True when `text` carries a Kannada, Hindi or romanised question cue."""

    cues = question_cues(text)
    return bool(cues) and not asks_for_own_balance(text, cues)
