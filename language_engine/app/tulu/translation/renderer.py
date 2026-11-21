"""English workflow replies -> verified Tulu (mapping-based translation).

METHOD

This is a MAPPING-BASED translation system, not neural machine translation.
No Tulu MT model exists that could be validated (see the audit), so the
engine's canonical English reply is rendered sentence-by-sentence from a
table of native-speaker Tulu renderings. The table is built from the
dataset's assistant utterances, each tied to the exact deposit.json
instruction it renders (the dataset document states that mapping).

  - A sentence with a verified rendering is shown in Kannada-script Tulu
    (transliterated from the authoritative Romanized form) and, through the
    Kannada-trained voice, spoken.
  - A sentence without one stays in ENGLISH, unchanged. It is never
    machine-translated, never guessed, and never relabelled as Tulu.
  - A disputed rendering (D04, two conflicting wordings) is not used until a
    native speaker confirms one.

  - An instruction rendered differently by two datasets is a conflict and
    is not used (today both datasets render "Fill in your account number."
    identically, so there is no conflict).

Covered today: deposit steps 1-3 and withdrawal steps 1-5. Loan, balance,
account opening and every other intent have NO verified Tulu in the
workspace, so they are answered in English.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from app.tulu.data.dataset import (assistant_utterances, control_replies, dataset_names,
                                   disputed_ids, load_dataset, step_text)
from app.tulu.normalization.text import roman_to_kannada

TRANSLATED = "translated"          # every sentence verified Tulu
PARTIAL = "partial"                # some verified Tulu, rest English
UNTRANSLATED = "untranslated"      # no verified Tulu: English unchanged

#: Output scripts. Kannada script is what the voice reads; Romanized is the
#: authoritative annotation.
KANNADA = "kannada"
ROMAN = "roman"


@dataclass(frozen=True)
class TuluRendering:
    english: str
    tulu_romanized: str
    tulu_kannada: str
    source_id: str
    review_status: str


def _candidates() -> dict[str, list[dict]]:
    """English instruction -> every assistant utterance rendering it (all datasets)."""
    out: dict[str, list[dict]] = {}
    for utt in assistant_utterances():
        out.setdefault(step_text(utt), []).append(utt)
    return out


@lru_cache(maxsize=1)
def conflicts() -> dict[str, list[str]]:
    """English instructions rendered DIFFERENTLY by two datasets: never rendered."""
    disputed = disputed_ids()
    found = {}
    for english, utts in _candidates().items():
        texts = {u["tulu_romanized"] for u in utts if u["id"] not in disputed}
        if len(texts) > 1:
            found[english] = sorted(f"{u['id']}: {u['tulu_romanized']}" for u in utts)
    return found


@lru_cache(maxsize=1)
def verified_renderings() -> dict[str, TuluRendering]:
    """English instruction -> verified Tulu, excluding disputed and conflicting entries."""
    disputed = disputed_ids()
    conflicting = conflicts()
    table = {}
    for english, utts in _candidates().items():
        usable = [u for u in utts if u["id"] not in disputed]
        if not usable or english in conflicting:
            continue
        utt = usable[0]
        table[english] = TuluRendering(
            english=english,
            tulu_romanized=utt["tulu_romanized"],
            tulu_kannada=roman_to_kannada(utt["tulu_romanized"]),
            source_id="+".join(u["id"] for u in usable),
            review_status=("Romanized: team-verified annotation; "
                           "Kannada script: machine transliteration pending native review"),
        )
    return table


@lru_cache(maxsize=1)
def control_acknowledgements() -> dict[str, TuluRendering]:
    """
    Control group (C01-C04) -> its one shared assistant reply, as dataset-
    supplied Tulu. Used as an ACKNOWLEDGEMENT placed before the engine's own
    reply to the control action (e.g. "Okay, I'll repeat it slowly." + the
    repeated instruction). Native-speaker verification of these sentences is
    NOT stated in the dataset; review_status says so.
    """
    return {
        group: TuluRendering(
            english=utt["english_meaning"],
            tulu_romanized=utt["tulu_romanized"],
            tulu_kannada=roman_to_kannada(utt["tulu_romanized"]),
            source_id=utt["id"],
            review_status=("Romanized: dataset-supplied, native-speaker verification not stated; "
                           "English is a working gloss; Kannada script: machine transliteration pending review"),
        )
        for group, utt in control_replies().items()
    }


def coverage(workflow: str | None = None) -> dict:
    """Per workflow: which instructions have verified Tulu, and why not."""
    table = verified_renderings()
    conflicting = conflicts()
    disputed = disputed_ids()
    result = {}
    for name in dataset_names():
        data = load_dataset(name)
        if data["workflow"] is None or (workflow and data["workflow"] != workflow):
            continue
        rows = {}
        for k in sorted(data["step_instructions"], key=int):
            english = data["step_instructions"][k]["text"]
            if english in table:
                rows[english] = "verified"
            elif english in conflicting:
                rows[english] = "conflicting renderings (awaiting native-speaker confirmation)"
            elif any(u["id"] in disputed for u in _candidates().get(english, [])):
                rows[english] = "disputed (awaiting native-speaker confirmation)"
            else:
                rows[english] = "no verified Tulu"
        result[data["workflow"]] = rows
    return result[workflow] if workflow else result


def render(text: str, script: str = KANNADA) -> tuple[str, str]:
    """(rendered_text, status). English that has no verified Tulu is kept."""
    if not text:
        return text, TRANSLATED
    table = verified_renderings()
    rendered = str(text)
    replaced = 0
    for english in sorted(table, key=len, reverse=True):
        if english in rendered:
            entry = table[english]
            rendered = rendered.replace(
                english, entry.tulu_kannada if script == KANNADA else entry.tulu_romanized)
            replaced += 1
    if not replaced:
        return str(text), UNTRANSLATED
    if script == KANNADA and not re.search(r"[A-Za-z]", rendered):
        return rendered, TRANSLATED
    if script == ROMAN:
        leftover = rendered
        for entry in table.values():
            leftover = leftover.replace(entry.tulu_romanized, "")
        return rendered, TRANSLATED if not re.search(r"[A-Za-z]", leftover) else PARTIAL
    return rendered, PARTIAL
