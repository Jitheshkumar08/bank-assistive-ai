"""Rendering assistant replies in the session language (Phase 3.2B-12, K).

THE SITUATION THIS ADDRESSES

Every reply the engine produces is authored in English: workflow instructions
come from the workflow JSON, control and acknowledgement replies are literals in
manager.py, and knowledge answers come back from the LLM. The session language
was only ever passed to TTS, so a Kannada session heard English sentences read
by a Kannada voice. `app/translation/translator.py` is a stub that returns its
input unchanged and is called from nowhere.

WHAT THIS DOES, AND WHAT IT HONESTLY CANNOT

The assistant's OWN fixed sentences -- controls, acknowledgements, cancel, exit,
"nothing to repeat", the non-banking refusal, the unsupported-service message --
are a bounded set. They are translated here as authored data: exact, offline,
deterministic and testable.

Dynamic text is a different problem. Workflow step instructions and RAG answers
are open-ended English, and translating them needs a translation model this
project deliberately does not have yet. Rather than pretend, `localize()`
returns such text unchanged and reports that it did (`translated=False`), so the
caller and the tests can see exactly which strings are still English. Wiring a
real translator later means implementing app/translation/translator.py and
calling it from `localize()` -- one function, one call site.

REPLAY

Replay does not re-translate a stored English string by accident: the canonical
English reply is remembered, and rendering happens on the way out, so repeating
a turn in a Kannada session produces the Kannada rendering of the same reply.
"""

#: Canonical English -> {language: translation} for the assistant's own fixed
#: sentences. Keys are matched on exact, whitespace-collapsed English text.
FIXED_RESPONSES = {
    "There's nothing to repeat right now.": {
        "kn": "ಈಗ ಪುನಃ ಹೇಳಲು ಏನೂ ಇಲ್ಲ.",
        "hi": "अभी दोहराने के लिए कुछ नहीं है.",
    },
    "There's nothing active right now.": {
        "kn": "ಈಗ ಯಾವುದೇ ಪ್ರಕ್ರಿಯೆ ಚಾಲನೆಯಲ್ಲಿಲ್ಲ.",
        "hi": "अभी कोई प्रक्रिया सक्रिय नहीं है.",
    },
    "There's nothing active to cancel right now.": {
        "kn": "ರದ್ದು ಮಾಡಲು ಈಗ ಏನೂ ಇಲ್ಲ.",
        "hi": "अभी रद्द करने के लिए कुछ नहीं है.",
    },
    "There's nothing active to pause right now.": {
        "kn": "ವಿರಾಮಗೊಳಿಸಲು ಈಗ ಏನೂ ಇಲ್ಲ.",
        "hi": "अभी रोकने के लिए कुछ नहीं है.",
    },
    "There's no active request right now. What banking service would you like help with?": {
        "kn": "ಈಗ ಯಾವುದೇ ವಿನಂತಿ ಚಾಲನೆಯಲ್ಲಿಲ್ಲ. ಯಾವ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆಗೆ ಸಹಾಯ ಬೇಕು?",
        "hi": "अभी कोई अनुरोध सक्रिय नहीं है. आपको किस बैंकिंग सेवा में मदद चाहिए?",
    },
    "There's no active request to control right now. Let me know which banking service you'd like help with.": {
        "kn": "ಈಗ ನಿಯಂತ್ರಿಸಲು ಯಾವುದೇ ವಿನಂತಿ ಇಲ್ಲ. ಯಾವ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆ ಬೇಕು ಎಂದು ತಿಳಿಸಿ.",
        "hi": "अभी नियंत्रित करने के लिए कोई अनुरोध नहीं है. बताइए आपको कौन सी बैंकिंग सेवा चाहिए.",
    },
    "I can't help with that. I can help you deposit money, withdraw money, check your balance, apply for a loan or open an account. Which would you like?": {
        "kn": "ಅದಕ್ಕೆ ನಾನು ಸಹಾಯ ಮಾಡಲಾರೆ. ಹಣ ಜಮಾ, ಹಣ ತೆಗೆಯುವುದು, ಬ್ಯಾಲೆನ್ಸ್ ಪರಿಶೀಲನೆ, ಸಾಲದ ಅರ್ಜಿ ಅಥವಾ ಹೊಸ ಖಾತೆ ತೆರೆಯಲು ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ಯಾವುದು ಬೇಕು?",
        "hi": "इसमें मैं मदद नहीं कर सकता. मैं पैसे जमा करने, निकालने, बैलेंस देखने, लोन के आवेदन या नया खाता खोलने में मदद कर सकता हूँ. आपको क्या चाहिए?",
    },
    "Okay. Let me know which banking service you'd like help with.": {
        "kn": "ಸರಿ. ಯಾವ ಬ್ಯಾಂಕಿಂಗ್ ಸೇವೆ ಬೇಕು ಎಂದು ತಿಳಿಸಿ.",
        "hi": "ठीक है. बताइए आपको कौन सी बैंकिंग सेवा चाहिए.",
    },
    "You're welcome.": {"kn": "ಸ್ವಾಗತ.", "hi": "आपका स्वागत है."},
    "Okay.": {"kn": "ಸರಿ.", "hi": "ठीक है."},
    "Continuing.": {"kn": "ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ.", "hi": "जारी रख रहा हूँ."},
}

#: Sentence-level openers that are prepended to dynamic text. Translating the
#: opener alone still helps the listener, so they are handled separately.
PREFIXES = {
    "You're welcome.": {"kn": "ಸ್ವಾಗತ.", "hi": "आपका स्वागत है."},
    "Okay.": {"kn": "ಸರಿ.", "hi": "ठीक है."},
    "Continuing.": {"kn": "ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ.", "hi": "जारी रख रहा हूँ."},
}

SUPPORTED_LANGUAGES = ("en", "kn", "hi")


def _normalize(text):
    return " ".join((text or "").split())


def localize(text, language):
    """Render `text` in `language`.

    Returns (rendered_text, translated). `translated` is False when the text
    was left in English because no translation exists for it -- dynamic
    workflow instructions and knowledge answers, today. Callers can log or
    test on that flag instead of guessing.
    """
    language = (language or "en").lower()

    if not text or language == "en" or language not in SUPPORTED_LANGUAGES:
        return text, language == "en"

    normalized = _normalize(text)

    exact = FIXED_RESPONSES.get(normalized)
    if exact and language in exact:
        return exact[language], True

    # "Continuing. <instruction>" -- translate the opener, keep the rest.
    for prefix, translations in PREFIXES.items():
        if normalized.startswith(prefix) and language in translations:
            remainder = normalized[len(prefix):].strip()
            if not remainder:
                return translations[language], True
            return f"{translations[language]} {remainder}", False

    return text, False


class ResponseLocalizer:
    """Applies `localize()` at the output boundary and remembers the last reply.

    Holding the CANONICAL English reply (not the rendered one) is what makes
    replay language-correct: repeating in a Kannada session re-renders the same
    canonical reply into Kannada rather than replaying stored English.
    """

    def __init__(self, language="en"):
        self.language = (language or "en").lower()
        self.last_canonical = None
        self.last_rendered = None
        self.last_translated = None

    def set_language(self, language):
        self.language = (language or "en").lower()

    def render(self, text, remember=True):
        rendered, translated = localize(text, self.language)
        if remember and text:
            self.last_canonical = text
            self.last_rendered = rendered
            self.last_translated = translated
        return rendered

    def replay(self):
        """The last reply, re-rendered in the CURRENT session language."""
        if self.last_canonical is None:
            return None
        return self.render(self.last_canonical, remember=False)
