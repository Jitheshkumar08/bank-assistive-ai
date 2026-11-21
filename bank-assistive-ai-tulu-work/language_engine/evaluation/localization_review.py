"""
Writes the M6 localisation review sheet from app/dialogue/localization_catalog.

Every English sentence, workflow step and workflow name the engine renders,
with its authored Kannada and Hindi text and the catalog's review status --
the document a native-speaker reviewer works through. Regenerate after any
catalog change:

    venv/Scripts/python.exe -m evaluation.localization_review
"""

import sys
from pathlib import Path

from app.dialogue.localization_catalog import (
    AUTHORED_BY,
    INSTRUCTIONS,
    REVIEW_STATUS,
    SENTENCES,
    UNTRANSLATED_MARKER,
    WORKFLOW_NAMES,
)

OUT = Path(__file__).resolve().parent / "reports" / "m6_localization_review.md"


def _cell(text):
    return str(text).replace("|", "\\|")


def render():
    lines = [
        "# M6 localisation review sheet",
        "",
        f"**Review status: {REVIEW_STATUS}.** Authored by: {AUTHORED_BY}.",
        "",
        "No entry below has been checked by a native speaker. Please review each Kannada and Hindi",
        "rendering for meaning, register (polite, clear, suitable for a bank counter) and natural word",
        "order, and mark corrections in the catalog (`app/dialogue/localization_catalog.py`). Slots in",
        "braces are filled at runtime: `{instruction}` with a step below, `{workflow}` / `{current}` /",
        "`{requested}` with a name below, `{n}` / `{k}` with digits.",
        "",
        "Points worth a reviewer's attention:",
        "",
        "- Workflow names are always followed by a noun (ವಿನಂತಿ / ಪ್ರಕ್ರಿಯೆ, अनुरोध / प्रक्रिया), so",
        "  case endings attach to the noun. Check the combinations read naturally.",
        "- The conflict question deliberately uses ರದ್ದು / ವಿರಾಮ / ಮುಂದುವರಿಸ and रद्द / विराम / जारी:",
        "  the engine recognises exactly those words in the customer's answer. A rewording must keep them.",
        "- The resume hint quotes 'ಮುಂದುವರಿಸಿ' / 'जारी रखो', which the engine recognises as resume.",
        "- Hindi sentences end in \".\" (as the 3.2B-12 renderings did) rather than \"।\".",
        "",
        f"## Workflow steps ({len(INSTRUCTIONS)})",
        "",
        "| English | Kannada | Hindi |",
        "|---|---|---|",
    ]
    for english, r in INSTRUCTIONS.items():
        lines.append(f"| {_cell(english)} | {_cell(r['kn'])} | {_cell(r['hi'])} |")

    names = {}
    for english, r in WORKFLOW_NAMES.items():
        names.setdefault((r["kn"], r["hi"]), []).append(english)
    lines += ["", f"## Workflow names ({len(names)})", "", "| English (display / canonical) | Kannada | Hindi |",
              "|---|---|---|"]
    for (kn, hi), english in names.items():
        lines.append(f"| {_cell(' / '.join(english))} | {_cell(kn)} | {_cell(hi)} |")

    lines += ["", f"## Sentences ({len(SENTENCES)})", "", "| English | Kannada | Hindi |", "|---|---|---|"]
    for english, r in SENTENCES:
        lines.append(f"| {_cell(english)} | {_cell(r['kn'])} | {_cell(r['hi'])} |")

    lines += ["", "## Fallback marker", "",
              "Shown before any part of a fixed reply that has no rendering (none is reachable today).", "",
              "| Kannada | Hindi |", "|---|---|",
              f"| {_cell(UNTRANSLATED_MARKER['kn'])} | {_cell(UNTRANSLATED_MARKER['hi'])} |", ""]
    return "\n".join(lines)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.write_text(render(), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
