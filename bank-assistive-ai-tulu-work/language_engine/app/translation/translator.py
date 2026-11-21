class Translator:
    """
    Independent translation module.

    Currently:
    - English → English
    - Kannada → Kannada
    - Hindi → Hindi

    This module is intentionally kept independent
    so Tulu support can be added later.
    """

    def __init__(self):
        print("Translator Ready ✅")

    def translate(
        self,
        text,
        source_language,
        target_language
    ):
        if not text:
            return ""

        source_language = self._normalize_language(
            source_language
        )

        target_language = self._normalize_language(
            target_language
        )

        # No translation required
        if source_language == target_language:
            return text

        # -------------------------------------------------
        # Translation will be added here
        # -------------------------------------------------
        #
        # Example future flow:
        #
        # Kannada → Tulu
        # Tulu → Kannada
        #
        # For now, return the original text safely.
        # -------------------------------------------------

        return text

    def _normalize_language(self, language):

        if not language:
            return "en"

        language = language.lower().strip()

        if "-" in language:
            language = language.split("-")[0]

        language_map = {
            "english": "en",
            "kannada": "kn",
            "hindi": "hi",
            "tulu": "tcy",
            "en": "en",
            "kn": "kn",
            "hi": "hi",
            "tcy": "tcy"
        }

        return language_map.get(
            language,
            language
        )