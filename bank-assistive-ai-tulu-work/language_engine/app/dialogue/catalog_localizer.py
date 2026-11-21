"""A ResponseLocalizer with a domain's own sentence catalog (domain integration, Phase 4).

The engine's contract is unchanged (localization.py): replies are composed in
canonical English, history keeps the English, and rendering into the session
language happens once at the output boundary -- so "repeat" after a language
switch replays in the new language.

Banking's fixed sentences live in localization_catalog.py and are untouched.
Another domain brings its own catalog (SentenceCatalog) and its sessions get a
CatalogLocalizer, which:

  - renders a fixed reply sentence by sentence from the DOMAIN catalog;
  - passes LLM-written text (GeneratedText) through exactly as the base
    localizer does, including its marking of English answers shown in a
    Kannada/Hindi session;
  - falls back to the base localizer for anything its catalog cannot read,
    so a shared engine sentence (e.g. "I did not catch that...") is still
    rendered from the shared catalog, and genuinely unknown text is still
    MARKED rather than shown as if translated.

Catalog templates may contain {topic} / {topic2} slots, filled from the
catalog's topic names.

DATA TEXT (Phase 5)

Some reply text is neither a catalog sentence nor model-written: a campus
place name or a route step from the verified campus map, or a catalog sentence
whose slot holds such data ("Here are the directions to {place}."). It is
built as RenderedText -- canonical English plus the renderings the DATA itself
provides (SentenceCatalog.fill) -- and rendered from those renderings. A
language the data has no rendering for is shown in English, MARKED, exactly
like untranslated fixed text. Nothing is ever machine-translated here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from app.dialogue.localization import (
    ENGLISH,
    FALLBACK,
    GENERATED,
    MIXED,
    SUPPORTED_LANGUAGES,
    TRANSLATED,
    ComposedReply,
    GeneratedText,
    ResponseLocalizer,
    localize_detailed,
)
from app.dialogue.localization_catalog import UNTRANSLATED_MARKER

#: Slots read back from rendered text (filled from the catalog's topics).
_SLOT = re.compile(r"\{(topic2?)\}")
#: Every slot, including DATA slots filled by SentenceCatalog.fill().
_ANY_SLOT = re.compile(r"\{(\w+)\}")


class RenderedText(str):
    """
    Reply text that carries its own renderings (see "DATA TEXT" above).

    The str value is the canonical English; `renderings` maps a language to
    the text to show in it. Behaves as a str everywhere else, so history and
    logs keep the English.
    """

    renderings: Dict[str, str] = {}

    def __new__(cls, text, renderings=None):
        obj = super().__new__(cls, text)
        obj.renderings = {k: v for k, v in dict(renderings or {}).items() if k != "en" and v}
        return obj


def compose_parts(*parts):
    """Join reply parts, keeping each part's origin when any part needs it."""
    parts = tuple(p for p in parts if p)
    if any(isinstance(p, (GeneratedText, RenderedText, ComposedReply)) for p in parts):
        flat = []
        for part in parts:
            flat.extend(part.parts if isinstance(part, ComposedReply) else (part,))
        return ComposedReply(flat)
    return " ".join(parts)


@dataclass(frozen=True)
class SentenceCatalog:
    """sentences: [(english template, {lang: rendering})]; topics: {english: {lang: name}}."""

    sentences: Tuple[Tuple[str, Dict[str, str]], ...]
    topics: Dict[str, Dict[str, str]] = field(default_factory=dict)
    review_status: str = "unreviewed"

    def __post_init__(self) -> None:
        for template, renderings in self.sentences:
            missing = [lang for lang in SUPPORTED_LANGUAGES if lang != "en" and lang not in renderings]
            if missing:
                raise ValueError(f"{template!r} has no rendering for {missing}")
            for lang, text in renderings.items():
                if set(_ANY_SLOT.findall(text)) != set(_ANY_SLOT.findall(template)):
                    raise ValueError(f"{template!r}: slots differ in its {lang} rendering")
        for name, renderings in self.topics.items():
            if any(lang not in renderings for lang in SUPPORTED_LANGUAGES if lang != "en"):
                raise ValueError(f"topic {name!r} lacks a rendering")

    def english(self, template: str, **slots: str) -> str:
        """A template filled in English -- the canonical reply text."""
        if template not in {t for t, _ in self.sentences}:
            raise KeyError(template)
        return template.format(**slots)

    def fill(self, template: str, **slots) -> RenderedText:
        """
        A template whose slots hold DATA, as RenderedText.

        A slot value is a plain str (the same in every language: a number,
        a code) or a RenderedText (a place name with its own renderings).
        A place name with no rendering in a language keeps its English form
        inside that language's sentence -- it is a proper name, not text to
        translate; the sentence around it is still the catalog's.
        """
        renderings = dict(self.sentences).get(template)
        if renderings is None:
            raise KeyError(template)

        def value(slot, language):
            if isinstance(slot, RenderedText) and language != "en":
                return slot.renderings.get(language, str(slot))
            return str(slot)

        english = template.format(**{k: value(v, "en") for k, v in slots.items()})
        return RenderedText(english, {
            language: rendering.format(**{k: value(v, language) for k, v in slots.items()})
            for language, rendering in renderings.items()
        })


class _CompiledCatalog:
    def __init__(self, catalog: SentenceCatalog) -> None:
        self.catalog = catalog
        names = sorted(catalog.topics, key=len, reverse=True)
        topic = "|".join(re.escape(n) for n in names) or r"(?!x)x"
        units = []
        for template, renderings in catalog.sentences:
            pattern, position = "", 0
            for match in _SLOT.finditer(template):
                pattern += re.escape(template[position:match.start()])
                pattern += f"(?P<{match.group(1)}>{topic})"
                position = match.end()
            pattern += re.escape(template[position:])
            units.append((re.compile(pattern), renderings))
        # Longest template first, so a sentence is never read as a shorter one.
        self.units = sorted(units, key=lambda unit: -len(unit[0].pattern))

    def parse(self, text: str) -> Optional[List[Tuple[Dict[str, str], Dict[str, str]]]]:
        """[(renderings, slots)] when every part of `text` is a catalog sentence, else None."""
        text, position, out = " ".join(text.split()), 0, []
        while position < len(text):
            for regex, renderings in self.units:
                match = regex.match(text, position)
                if match and (match.end() == len(text) or text[match.end()] == " "):
                    out.append((renderings, match.groupdict()))
                    position = match.end() + 1
                    break
            else:
                return None
        return out

    def render(self, text: str, language: str) -> Optional[str]:
        parts = self.parse(text)
        if parts is None:
            return None
        rendered = []
        for renderings, slots in parts:
            sentence = renderings[language]
            for slot, value in slots.items():
                sentence = sentence.replace("{" + slot + "}", self.catalog.topics[value][language])
            rendered.append(sentence)
        return " ".join(rendered)


class CatalogLocalizer(ResponseLocalizer):
    """ResponseLocalizer that reads the domain catalog first. See the module docstring."""

    def __init__(self, language: str = "en", catalog: Optional[SentenceCatalog] = None) -> None:
        super().__init__(language)
        if catalog is None:
            raise ValueError("CatalogLocalizer needs a catalog.")
        self._compiled = _CompiledCatalog(catalog)

    def _fixed(self, text: str) -> Tuple[str, bool]:
        """(rendered, complete) for fixed text: domain catalog, else the shared one."""
        own = self._compiled.render(text, self.language)
        if own is not None:
            return own, True
        rendered, status = localize_detailed(text, self.language)
        return rendered, status in (ENGLISH, TRANSLATED)

    def _data(self, text: RenderedText) -> Tuple[str, bool]:
        """(rendered, complete) for data text: its own rendering, else marked English."""
        rendering = text.renderings.get(self.language)
        if rendering:
            return rendering, True
        return f"{UNTRANSLATED_MARKER[self.language]} {text}", False

    def localize_detailed(self, text: str) -> Tuple[str, str]:
        language = self.language
        if not text or language == "en" or language not in SUPPORTED_LANGUAGES:
            return localize_detailed(text, language)
        if isinstance(text, GeneratedText):
            return localize_detailed(text, language)
        if isinstance(text, RenderedText):
            rendered, complete = self._data(text)
            return rendered, TRANSLATED if complete else FALLBACK
        if isinstance(text, ComposedReply):
            out, complete, generated = [], True, False
            for part in text.parts:
                if isinstance(part, RenderedText):
                    rendered, ok = self._data(part)
                    out.append(rendered)
                    complete = complete and ok
                elif isinstance(part, GeneratedText):
                    rendered, status = localize_detailed(part, language)
                    out.append(rendered)
                    complete = complete and status != FALLBACK
                    generated = True
                else:
                    rendered, ok = self._fixed(part)
                    out.append(rendered)
                    complete = complete and ok
            return " ".join(out), (FALLBACK if not complete else MIXED if generated else TRANSLATED)
        rendered, complete = self._fixed(text)
        return rendered, TRANSLATED if complete else FALLBACK

    def render(self, text, remember=True):
        rendered, status = self.localize_detailed(text)
        if remember and text:
            self.last_canonical = text
            self.last_rendered = rendered
            self.last_translated = status in (ENGLISH, TRANSLATED)
            self.last_status = status
        return rendered


def catalog_localizer_factory(catalog: SentenceCatalog):
    """A localizer factory for DomainConfig: language -> CatalogLocalizer."""
    def make(language: str) -> CatalogLocalizer:
        return CatalogLocalizer(language, catalog)
    return make


__all__: Sequence[str] = ("SentenceCatalog", "CatalogLocalizer", "RenderedText", "compose_parts",
                          "catalog_localizer_factory", "GENERATED")
