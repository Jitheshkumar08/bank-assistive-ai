"""Rendering assistant replies in the session language (3.2B-12, rebuilt in M6).

THE CONTRACT, UNCHANGED SINCE 3.2B-12

The engine composes every reply in canonical English, and that English is what
conversation history keeps and what the LLM is later shown. Rendering into the
session language happens once, at the output boundary (ResponseLocalizer, used
by the CLI loop and EngineRuntime.run_turn). Replay re-renders the remembered
English reply, so "ಮತ್ತೆ ಹೇಳಿ" repeats in the CURRENT language.

WHAT M6 CHANGED

Before M6 only eleven whole sentences had renderings, matched exactly; every
workflow instruction, the conflict question, cancellations and most status
messages stayed English in a Kannada or Hindi session.

The engine builds its fixed replies from a bounded set of sentences, some
with slots ("Okay." + "{instruction}" + "Let me know when you've completed
it."). localization_catalog lists every one of them with authored Kannada
and Hindi renderings, and this module reads a reply back into that sequence
of sentences and renders each one, slots included.

THREE KINDS OF TEXT, THREE RULES

  fixed       the engine's own sentences. Rendered from the catalog.
  generated   written by the LLM (knowledge answers). Marked GeneratedText at
              its source in DialogueManager, and passed through UNCHANGED:
              localising it is M7's job, and a template can never match it.
  composed    a generated answer followed by a fixed instruction
              ("{answer} {next_instruction}"). Built with compose(); the
              fixed part is rendered, the generated part passed through.

THE FALLBACK POLICY (for Kannada and Hindi)

A fixed reply is never shown in English as if it were Kannada or Hindi. Any
part of it the catalog cannot read is kept in English but preceded by an
explicit marker in the session language -- "(ಈ ಭಾಗ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತ್ರ
ಲಭ್ಯವಿದೆ:)" -- and the result reports translated=False. A coverage test
asserts no reply the engine can compose today reaches that path.

English sessions, and languages the engine does not support at all, are
returned unchanged, exactly as before (unsupported languages are refused
explicitly elsewhere: ASR raises, TTS returns 400).
"""

import re
from functools import lru_cache

from app.dialogue.localization_catalog import (
    INSTRUCTIONS,
    SENTENCES,
    UNTRANSLATED_MARKER,
    WORKFLOW_NAMES,
)

SUPPORTED_LANGUAGES = ("en", "kn", "hi")

#: Outcome of one rendering, reported by localize_detailed().
ENGLISH = "english"                    # an English session: nothing to do
TRANSLATED = "translated"              # every fixed sentence rendered
FALLBACK = "fallback"                  # some fixed text kept in English, marked
GENERATED = "generated"                # LLM text, passed through (M7)
MIXED = "mixed"                        # composed: fixed part rendered, LLM part passed through
UNSUPPORTED_LANGUAGE = "unsupported_language"


# =========================================================
# MARKING TEXT BY ORIGIN
# =========================================================

class GeneratedText(str):
    """Text written by the LLM. Behaves as a str everywhere else.

    `language` (M7) is the language the LLM was asked to answer in -- the
    session language at the time -- or None when unknown.
    """

    language = None

    def __new__(cls, text, language=None):
        obj = super().__new__(cls, text)
        obj.language = language
        return obj


class FixedReply(str):
    """A fixed engine sentence returned from a path that otherwise carries LLM
    text (Phase 2: a policy refusal, or an answer replaced by validation).

    Rendered like any fixed reply. Its only purpose is to tell
    mark_generated() not to label it as LLM-written, which would make the
    output boundary pass the English through untranslated.
    """


class ComposedReply(str):
    """A reply built from parts, some generated. Remembers which is which."""

    parts = ()

    def __new__(cls, parts):
        text = " ".join(p for p in parts if p)
        obj = super().__new__(cls, text)
        obj.parts = tuple(p for p in parts if p)
        return obj


def compose(*parts):
    """Join reply parts with spaces, keeping each part's origin."""
    if not any(isinstance(p, GeneratedText) for p in parts):
        return " ".join(p for p in parts if p)
    return ComposedReply(parts)


# =========================================================
# READING A FIXED REPLY BACK INTO SENTENCES
# =========================================================

_SLOT = re.compile(r"\{(\w+)\}")
_NAME_SLOTS = {"workflow", "workflow2", "current", "requested"}
_NUMBER_SLOTS = {"n", "k"}


def _alternation(values):
    return "(?:" + "|".join(re.escape(v) for v in sorted(values, key=len, reverse=True)) + ")"


_INSTRUCTION_RE = _alternation(INSTRUCTIONS)
_NAME_RE = _alternation(WORKFLOW_NAMES)


def _compile(template):
    """English template -> regex with one named group per distinct slot."""
    pattern, seen, position = "", set(), 0
    for match in _SLOT.finditer(template):
        pattern += re.escape(template[position:match.start()])
        slot = match.group(1)
        if slot in seen:
            pattern += f"(?P={slot})"
        else:
            seen.add(slot)
            body = (_INSTRUCTION_RE if slot == "instruction"
                    else _NAME_RE if slot in _NAME_SLOTS
                    else r"\d+" if slot in _NUMBER_SLOTS
                    else None)
            if body is None:
                raise ValueError(f"unknown slot {{{slot}}} in {template!r}")
            pattern += f"(?P<{slot}>{body})"
        position = match.end()
    pattern += re.escape(template[position:])
    return re.compile(pattern)


#: Every instruction is also a sentence on its own.
_UNITS = [(_compile(t), r) for t, r in SENTENCES] + \
         [(re.compile(re.escape(i)), r) for i, r in INSTRUCTIONS.items()]


def _parse(text):
    """
    The reply as a list of ("unit", renderings, slots) and ("unknown", text).

    Chooses the reading with the least unknown text. Units are separated by
    single spaces, as the engine composes them.
    """

    @lru_cache(maxsize=None)
    def best(position):
        if position >= len(text):
            return 0, ()

        options = []
        for regex, renderings in _UNITS:
            match = regex.match(text, position)
            if not match:
                continue
            end = match.end()
            if end == len(text) or text[end] == " ":
                cost, rest = best(end + 1)
                options.append((cost, (("unit", renderings, match.groupdict()),) + rest))

        space = text.find(" ", position)
        end = len(text) if space == -1 else space
        cost, rest = best(end + 1)
        options.append((cost + (end - position), (("unknown", text[position:end]),) + rest))

        return min(options, key=lambda option: option[0])

    return list(best(0)[1])


def _render_unit(renderings, slots, language):
    rendered = renderings[language]
    for slot, value in slots.items():
        if slot == "instruction":
            value = INSTRUCTIONS[value][language]
        elif slot in _NAME_SLOTS:
            value = WORKFLOW_NAMES[value][language]
        rendered = rendered.replace("{" + slot + "}", value)
    return rendered


def _render_fixed(text, language):
    """(rendered, complete) for a fixed reply in Kannada or Hindi."""
    out, complete, in_unknown = [], True, False
    for piece in _parse(" ".join(text.split())):
        if piece[0] == "unit":
            out.append(_render_unit(piece[1], piece[2], language))
            in_unknown = False
        else:
            if not in_unknown:
                out.append(UNTRANSLATED_MARKER[language])
                in_unknown = True
            out.append(piece[1])
            complete = False
    return " ".join(out), complete


# =========================================================
# PUBLIC API
# =========================================================

def localize_detailed(text, language):
    """(rendered_text, status) -- status is one of the constants above."""
    language = (language or "en").lower()

    if not text:
        return text, ENGLISH if language == "en" else TRANSLATED
    if language == "en":
        return text, ENGLISH
    if language not in SUPPORTED_LANGUAGES:
        return text, UNSUPPORTED_LANGUAGE

    if isinstance(text, GeneratedText):
        # An answer the LLM was asked to write in ENGLISH, now shown in a
        # Kannada or Hindi session (a replay after a language switch), is
        # marked the same way as untranslated fixed text (M7). Any other
        # LLM answer passes through as written.
        if text.language == "en":
            return f"{UNTRANSLATED_MARKER[language]} {text}", FALLBACK
        return text, GENERATED

    if isinstance(text, ComposedReply):
        out, complete, generated = [], True, False
        for part in text.parts:
            if isinstance(part, GeneratedText):
                if part.language == "en":       # see the GeneratedText rule above
                    out.append(f"{UNTRANSLATED_MARKER[language]} {part}")
                    complete = False
                else:
                    out.append(str(part))
                generated = True
            else:
                rendered, ok = _render_fixed(part, language)
                out.append(rendered)
                complete = complete and ok
        status = FALLBACK if not complete else MIXED if generated else TRANSLATED
        return " ".join(out), status

    rendered, complete = _render_fixed(text, language)
    return rendered, TRANSLATED if complete else FALLBACK


def localize(text, language):
    """
    (rendered_text, translated) -- the 3.2B-12 contract.

    `translated` is True only when the whole reply is in the session language
    as authored: an English session, or every fixed sentence rendered. It is
    False for marked fallbacks, LLM-written text, and unsupported languages.
    """
    if not text:
        return text, (language or "en").lower() == "en"   # as in 3.2B-12
    rendered, status = localize_detailed(text, language)
    return rendered, status in (ENGLISH, TRANSLATED)


class ResponseLocalizer:
    """Applies localize() at the output boundary and remembers the last reply.

    Holding the CANONICAL English reply (not the rendered one) is what makes
    replay language-correct: repeating in a Kannada session re-renders the same
    canonical reply into Kannada rather than replaying stored English.
    """

    def __init__(self, language="en"):
        self.language = (language or "en").lower()
        self.last_canonical = None
        self.last_rendered = None
        self.last_translated = None
        self.last_status = None

    def set_language(self, language):
        self.language = (language or "en").lower()

    def render(self, text, remember=True):
        rendered, status = localize_detailed(text, self.language)
        translated = status in (ENGLISH, TRANSLATED)
        if remember and text:
            self.last_canonical = text
            self.last_rendered = rendered
            self.last_translated = translated
            self.last_status = status
        return rendered

    def replay(self):
        """The last reply, re-rendered in the CURRENT session language."""
        if self.last_canonical is None:
            return None
        return self.render(self.last_canonical, remember=False)
