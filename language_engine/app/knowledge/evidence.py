"""Turning retrieved articles into the evidence block an answer prompt sees.

Three things happen between search() and the prompt:

  1. META SECTIONS ARE REMOVED. Each article ends with a "Questions" section
     that addresses the assistant ("The assistant should not state ...").
     That is an instruction living inside retrieved data. Retrieved text is
     untrusted data and the prompt's own rules already cover those limits,
     so the sections are dropped rather than presented as evidence.
  2. REPEATED SENTENCES ARE DROPPED. Overlapping articles (withdrawal.md /
     withdrawal_slip.md, loan.md / loan_basics.md) restate each other; a
     sentence already given by a higher-ranked article is not repeated.
  3. A BUDGET IS APPLIED. Articles are added best first until
     MAX_CONTEXT_CHARS; the last one is cut at a sentence end, never
     mid-sentence. Today's two articles are ~2 KB together, far under the
     budget -- it exists so a larger collection cannot silently blow up
     the prompt.

Every block is labelled with its source so the answer is traceable.
"""

import re

from app.knowledge.loader import META_SECTIONS

#: Upper bound on evidence text in one prompt.
MAX_CONTEXT_CHARS = 4000

META_HEADINGS = {heading.lower() for heading in META_SECTIONS}

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def strip_meta_sections(content):
    """The article without its assistant-facing "Questions" sections."""
    out, skipping = [], False
    for line in (content or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("#") and not stripped.startswith("# "):
            skipping = stripped.lstrip("#").strip().lower() in META_HEADINGS
        if not skipping:
            out.append(line)
    return "\n".join(out).strip()


def _key(sentence):
    return " ".join(re.sub(r"[^\w\s]", " ", sentence.lower()).split())


def build_evidence(results, max_chars=MAX_CONTEXT_CHARS):
    """
    (evidence_text, used_sources) from search() results, best first.

    `evidence_text` keeps the long-standing "Source: <name>" block format.
    """
    blocks, used, seen, remaining = [], [], set(), max_chars

    for result in results or []:
        if remaining <= 0:
            break
        source = result.get("source", "unknown")
        kept_lines = []
        for line in strip_meta_sections(result.get("content", "")).splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                kept_lines.append(line)
                continue
            sentences = []
            for sentence in _SENTENCE_END.split(stripped):
                key = _key(sentence)
                if key and key in seen:
                    continue
                seen.add(key)
                sentences.append(sentence)
            if sentences:
                kept_lines.append(" ".join(sentences))

        # Drop headings left with no body under them.
        body_lines, pending = [], None
        for line in kept_lines:
            if line.strip().startswith("#"):
                pending = line
            elif line.strip():
                if pending is not None:
                    body_lines.append(pending)
                    pending = None
                body_lines.append(line)
        text = "\n".join(body_lines).strip()
        if not text:
            continue

        if len(text) > remaining:
            cut = text[:remaining]
            end = max(cut.rfind(". "), cut.rfind(".\n"))
            text = cut[: end + 1] if end > 0 else ""
            if not text:
                break

        blocks.append(f"Source: {source}\n{text}")
        used.append(source)
        remaining -= len(text)

    return "\n\n".join(blocks), used
