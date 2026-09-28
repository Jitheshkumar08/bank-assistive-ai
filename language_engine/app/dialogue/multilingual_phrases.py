"""Kannada and Hindi phrases for the deterministic control tier (Phase 3.2B-12).

The tier-1 tables in manager.py were English-only, and said so. That was the
direct cause of two live failures:

    "ಧನ್ಯವಾದಗಳು"  (thanks)  -> reached IntentDetector -> withdrawal workflow
    "ಸಾಕು"        (enough)  -> scores 0.243 as "withdraw money" when idle

Both are short, unambiguous, high-frequency phrases: exactly the kind the
deterministic tier exists for. They are added here rather than in manager.py so
the English tables stay readable and the language data sits in one place.

Matching rules are inherited unchanged from manager.classify_command():
whole-utterance exact match against normalize_command_text() output, never
substring. So "ನಿಲ್ಲಿಸು" cancels, while a longer sentence that merely contains
it falls through to the normal understanding path.

Everything here is a phrase a customer says INSTEAD of a banking request. No
phrase in these tables may be ambiguous with a service request -- that is why,
for example, Kannada "ಮುಗಿಸು" (finish) is absent: it can report completion of a
step rather than ask to end the session.
"""

#: Ending the assistant session.
SESSION_EXIT_PHRASES = {
    # Kannada
    "ಹೊರಗೆ", "ನಿರ್ಗಮಿಸು", "ನಿರ್ಗಮಿಸಿ", "ವಿದಾಯ", "ಬೈ",
    # Hindi
    "बाहर", "बाहर निकलो", "निकास", "अलविदा", "बंद करो",
}

#: Workflow control, keyed by the same command names manager.py already uses.
WORKFLOW_CONTROL_PHRASES = {
    "pause": {
        # Kannada. "ವಿರಾಮಿಸು" is the verb form of ವಿರಾಮ (pause) and was
        # missing, so a live "ವಿರಾಮಿಸು" fell past this tier to the LLM and
        # came back as CANCEL -- pausing and cancelling are not
        # interchangeable, so the verb forms are listed explicitly here.
        "ವಿರಾಮ", "ವಿರಾಮಿಸು", "ವಿರಾಮಿಸಿ", "ವಿರಾಮ ಮಾಡು", "ವಿರಾಮ ಮಾಡಿ",
        "ತಡೆಯಿರಿ", "ತಡೆಯಿಸು", "ಸ್ವಲ್ಪ ನಿಲ್ಲಿ", "ಸ್ವಲ್ಪ ತಡೆಯಿರಿ", "ಒಂದು ನಿಮಿಷ",
        # Hindi
        "रुको", "ठहरो", "विराम", "एक मिनट", "थोड़ा रुको",
    },
    "resume": {
        # Kannada
        "ಮುಂದುವರಿಸಿ", "ಮುಂದುವರಿಸು", "ಮುಂದುವರೆಸಿ", "ಮುಂದುವರೆಸು",
        "ಪುನಃ ಪ್ರಾರಂಭಿಸಿ", "ಮುಂದೆ ಸಾಗಿ",
        # Hindi
        "जारी रखो", "जारी रखिए", "आगे बढ़ो", "फिर से शुरू करो",
    },
    "cancel": {
        # Kannada -- "ಸಾಕು" (enough) and "ನಿಲ್ಲಿಸು" (stop) are the two the live
        # session used; "ಬೇಡ" (don't/no need) is the common refusal.
        "ನಿಲ್ಲಿಸು", "ನಿಲ್ಲಿಸಿ", "ಸಾಕು", "ಬೇಡ", "ರದ್ದು ಮಾಡು", "ರದ್ದುಮಾಡಿ",
        # Hindi
        "रद्द करो", "रद्द करें", "कैंसिल करो", "बस", "रुक जाओ", "नहीं चाहिए",
    },
    "repeat": {
        # Kannada
        "ಮತ್ತೆ ಹೇಳಿ", "ಮತ್ತೆ ಹೇಳು", "ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ", "ಪುನಃ ಹೇಳಿ", "ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ",
        # Hindi
        "फिर से बताइए", "फिर से बताओ", "दोबारा बताइए", "दोहराइए", "फिर से कहिए",
    },
    "next": {
        # Kannada
        "ಮುಂದಿನದು", "ಮುಂದೇನು", "ಮುಂದಿನ ಹಂತ",
        # Hindi
        "अगला", "आगे क्या", "अगला कदम", "आगे क्या करना है",
    },
}

#: Standalone acknowledgements: never a banking request, in any state.
ACKNOWLEDGEMENT_PHRASES = {
    "thanks": {
        # Kannada
        "ಧನ್ಯವಾದ", "ಧನ್ಯವಾದಗಳು", "ತುಂಬಾ ಧನ್ಯವಾದಗಳು",
        # Hindi
        "धन्यवाद", "शुक्रिया", "बहुत धन्यवाद", "बहुत शुक्रिया",
    },
    "acknowledgement": {
        # Kannada
        "ಸರಿ", "ಆಯಿತು", "ಗೊತ್ತಾಯಿತು", "ಅರ್ಥವಾಯಿತು",
        # Hindi
        "ठीक है", "ठीक", "समझ गया", "समझ गयी", "अच्छा",
    },
}


# =========================================================
# REALISTIC ASR VARIANTS  (Phase 3.2B-13)
#
# IndicConformer transcribes spontaneous speech, and short control words come
# back clipped or with a stray fragment attached. Two live examples:
#
#     "ಮುಂದುವಸು"   a mangled ಮುಂದುವರಿಸು (resume) -- no exact entry can match
#     "ಹೊರಗೆ ಬ"    ಹೊರಗೆ (exit) with a one-character fragment after it
#
# Two narrow rules handle these WITHOUT a fuzzy matcher and without substring
# matching inside sentences:
#
#   1. Stem rule. Applies ONLY when the whole utterance is a single word.
#      That word must START WITH one of a handful of unambiguous control
#      stems. Because the utterance must be one word in its entirety,
#      "ಮುಂದುವರಿಸಿ ನನ್ನ ಖಾತೆಯನ್ನು ..." (a sentence) can never match.
#
#   2. Fragment rule. Drops trailing one-character tokens and retries the
#      EXACT tables. A single Kannada letter is never a word a customer
#      means on its own, and the retry is exact, so nothing new becomes a
#      control that was not already one.
#
# Both are deliberately small and auditable. Anything they do not recognise
# falls through to the LLM path exactly as before.
# =========================================================

#: Control stems for single-word Kannada utterances. Each stem must be
#: unambiguous: no stem here may begin a word with a different meaning.
KANNADA_CONTROL_STEMS = (
    ("ಮುಂದುವ", "resume"),      # ಮುಂದುವರಿಸಿ / ಮುಂದುವರೆಸು / ಮುಂದುವಸು
    ("ವಿರಾಮಿಸ", "pause"),      # ವಿರಾಮಿಸು / ವಿರಾಮಿಸಿ
    ("ನಿಲ್ಲಿಸ", "cancel"),      # ನಿಲ್ಲಿಸು / ನಿಲ್ಲಿಸಿ
    ("ನಿರ್ಗಮಿಸ", "session_exit"),
)

MAX_FRAGMENT_CHARS = 1


def classify_by_stem(normalized):
    """Control for a SINGLE-WORD utterance matching a known stem, else None."""

    if not normalized or len(normalized.split()) != 1:
        return None

    for stem, action in KANNADA_CONTROL_STEMS:
        if normalized.startswith(stem):
            return action

    return None


def strip_trailing_fragments(normalized):
    """Drop trailing one-character tokens left behind by ASR.

    Returns the shortened text, or None when there was nothing to drop.
    """

    tokens = (normalized or "").split()

    if len(tokens) < 2:
        return None

    kept = list(tokens)

    while len(kept) > 1 and len(kept[-1]) <= MAX_FRAGMENT_CHARS:
        kept.pop()

    if len(kept) == len(tokens):
        return None

    return " ".join(kept)


def merge_phrase_sets(english, additions):
    """Union of two {key: set} tables, leaving the inputs untouched."""
    merged = {key: set(value) for key, value in english.items()}
    for key, value in additions.items():
        merged.setdefault(key, set()).update(value)
    return merged
