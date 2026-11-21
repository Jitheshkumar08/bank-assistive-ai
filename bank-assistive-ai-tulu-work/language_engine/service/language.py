"""
The effective session language, defined once (M2).

NestJS decides a visit's language and sends it with every turn and every
speech request. Inside this service that one value feeds three consumers:

    speech recognition   -- which ASR model transcribes the recording
    reply localization   -- which language the reply is rendered in
    speech synthesis     -- which voice reads the reply aloud

They used to normalise the tag separately, or not at all: synthesis reduced
'kn-IN' to 'kn' while the localizer only lowercased it (and so rendered in
English) and the ASR router looked up 'kn-in' (and found no model). This
function is the single reduction all three now share, so the same tag can
never select three different languages.

It normalises SPELLING only. It does not decide what is supported: an
unsupported language passes through unchanged and each consumer keeps its own
explicit refusal (ASR raises, synthesis returns 400, the localizer leaves the
reply in English and says so).
"""

from __future__ import annotations

from typing import Optional

DEFAULT_LANGUAGE = "en"


def normalise_language(language: Optional[str]) -> str:
    """
    Reduces a tag to its primary language subtag, lowercased.

    'en', 'en-IN', 'EN' and ' KN-IN ' become 'en', 'en', 'en' and 'kn'.
    Empty or missing means English, matching every consumer's own default.

    This is exactly the rule synthesis already applied before M2 (it was
    moved here from service/tts.py), so voice selection is unchanged.
    """
    value = (language or DEFAULT_LANGUAGE).strip().lower()

    return value.split("-")[0] if "-" in value else value
