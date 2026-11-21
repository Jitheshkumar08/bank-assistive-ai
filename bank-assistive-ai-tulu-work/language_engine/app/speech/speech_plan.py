"""Which voice reads which part of a reply (M8).

Before M8 the voice came from the session language alone, and the whole reply
was read by it. An English sentence in a Kannada session -- the M6 marker's
English part, a knowledge answer requested in English, or an old reply read
again after the customer switched language (M2) -- was handed to the Kannada
voice whole.

THE POLICY

  1. The session language must be one the engine speaks (en, kn, hi);
     otherwise speech is refused, exactly as before.
  2. The reply is split into sentences. Each sentence is read in the
     language of its SCRIPT: Kannada script by the Kannada voice, Devanagari
     by the Hindi voice, the Latin alphabet by the English voice. The script
     is decided by WORDS, by majority, so a few English banking terms inside
     a Kannada sentence ("deposit slip") stay with the Kannada voice.
  3. A sentence with no letters at all ("5000.") joins the sentence before
     it (or after it); a tie goes to the session language.
  4. A letter from any other script (Tamil, Arabic, ...) refuses the whole
     request: speaking only part of a reply could change its meaning.
  5. Neighbouring sentences with the same voice are merged, so an ordinary
     reply is still ONE synthesis call; a mixed reply is one call per run.

The text is never changed here: segments are slices of the sanitised reply,
and joined back together they are that reply.

WHAT THIS DOES NOT ESTABLISH

That the result sounds right. Pronunciation of English words by an Indian
voice, Kannada and Hindi intelligibility, and how a voice change mid-reply
sounds all need listening tests by Kannada and Hindi speakers.
"""

import re
import unicodedata
from dataclasses import dataclass

#: The languages the engine has a voice for.
#:
#: Tulu (tcy) has no voice of its own. A Tulu session's reply carries
#: verified Tulu in Kannada script plus any English fallback, so the script
#: rule below reads the Tulu with the Kannada-trained voice and the English
#: with the English voice. That is a Kannada voice reading Tulu text, not
#: native Tulu TTS (app/tulu/tts/synthesizer.py).
SPOKEN_LANGUAGES = ("en", "kn", "hi", "tcy")

#: Script -> the language whose voice reads it.
SCRIPT_LANGUAGE = {"latin": "en", "kannada": "kn", "devanagari": "hi"}

#: Sentence boundaries: after ., ?, !, the dandas, a colon, or a closing
#: bracket (the M6 marker ends with ":)"), when followed by space.
_BOUNDARY = re.compile(r"(?<=[.?!।॥:)])\s+|\n+")

#: Joiners inside Indic words; never letters of another script.
_JOINERS = {"‌", "‍"}


class UnsupportedSpeechLanguageError(ValueError):
    """The session language has no voice."""


class UnsupportedScriptError(ValueError):
    """The text contains letters of a script no voice can read."""


@dataclass(frozen=True)
class SpeechSegment:
    text: str
    language: str


def script_of(char):
    """
    'latin', 'kannada', 'devanagari' or 'other' for a LETTER (or a vowel
    sign / mark that belongs to one); None for anything else.

    Digits, punctuation and symbols are never letters -- including the
    dandas and the Kannada and Devanagari digits, which sit inside those
    scripts' Unicode blocks.
    """
    if char in _JOINERS or not unicodedata.category(char)[0] in ("L", "M"):
        return None
    if "ಀ" <= char <= "೿":
        return "kannada"
    if "ऀ" <= char <= "ॿ":
        return "devanagari"
    if char.isascii() or "À" <= char <= "ɏ":   # incl. accented Latin
        return "latin"
    return "other"


def word_script(word):
    """The script of one word: the script of most of its letters, or None."""
    counts = {}
    for char in word:
        script = script_of(char)
        if script:
            counts[script] = counts.get(script, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def sentence_language(sentence, session_language):
    """The language to read `sentence` in, or None when it has no letters."""
    votes = {}
    for word in sentence.split():
        script = word_script(word)
        if script == "other":
            raise UnsupportedScriptError(f"cannot read the word {word!r} aloud")
        if script:
            votes[script] = votes.get(script, 0) + 1
    if not votes:
        return None
    best = max(votes.values())
    winners = [SCRIPT_LANGUAGE[s] for s, v in votes.items() if v == best]
    return session_language if session_language in winners else winners[0]


def normalise_language(language):
    value = (language or "en").strip().lower()
    return value.split("-")[0] if "-" in value else value


def plan_speech(text, session_language):
    """[SpeechSegment] reading `text` aloud, best voice for each part."""
    session = normalise_language(session_language)
    if session not in SPOKEN_LANGUAGES:
        raise UnsupportedSpeechLanguageError(f"No voice is available for language '{session}'.")

    sentences = [s for s in _BOUNDARY.split(text or "") if s and s.strip()]
    labelled = [(s.strip(), sentence_language(s, session)) for s in sentences]

    # Sentences with no letters take a neighbour's language.
    for index, (sentence, language) in enumerate(labelled):
        if language is None:
            before = next((l for _, l in reversed(labelled[:index]) if l), None)
            after = next((l for _, l in labelled[index + 1:] if l), None)
            labelled[index] = (sentence, before or after or session)

    segments = []
    for sentence, language in labelled:
        if segments and segments[-1].language == language:
            segments[-1] = SpeechSegment(f"{segments[-1].text} {sentence}", language)
        else:
            segments.append(SpeechSegment(sentence, language))
    return segments
