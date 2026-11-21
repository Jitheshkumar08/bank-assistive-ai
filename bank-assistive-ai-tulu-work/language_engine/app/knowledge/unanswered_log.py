"""A record of questions the knowledge base could not answer (Phase 3).

Its purpose is to show which official documents are missing, so each line
keeps what helps with that -- domain, institution, category, why it was not
answerable, the best score -- and as little as possible of what the user said.

PRIVACY

  - The question is REDACTED before it is written: e-mail addresses, and every
    run of three or more digits (reference numbers, phone numbers, ranks,
    amounts), become placeholders, and the text is cut to 200 characters.
  - A SHA-256 of the normalised question lets repeated questions be counted
    without keeping more of them.
  - No session id, user id, IP address or language-model output is written.
  - The file lives under language_engine/runtime/ (git-ignored), or
    UNANSWERED_LOG_DIR; UNANSWERED_LOG_DIR=off disables it.

Writing never raises: a full disk must not cost the user their answer.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DEFAULT_LOG_DIR = Path(__file__).resolve().parents[2] / "runtime" / "unanswered"

MAX_REDACTED_CHARS = 200

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
_DIGITS = re.compile(r"\d[\d\s/-]{2,}\d|\d{3,}")


def redact(text: str) -> str:
    text = _EMAIL.sub("[email]", text or "")
    text = _DIGITS.sub("[number]", text)
    text = " ".join(text.split())
    return text[:MAX_REDACTED_CHARS]


def question_hash(text: str) -> str:
    return hashlib.sha256(" ".join((text or "").lower().split()).encode("utf-8")).hexdigest()


class UnansweredLog:
    def __init__(self, directory: Optional[Path] = None, enabled: bool = True) -> None:
        self.directory = Path(directory) if directory else DEFAULT_LOG_DIR
        self.enabled = enabled
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "UnansweredLog":
        configured = os.getenv("UNANSWERED_LOG_DIR", "").strip()
        if configured.lower() == "off":
            return cls(enabled=False)
        return cls(Path(configured) if configured else None)

    def path_for(self, domain: str) -> Path:
        return self.directory / f"{domain}.jsonl"

    def record(self, *, domain: str, institution_id: Optional[str], question: str, reason: str,
               category: Optional[str] = None, top_score: Optional[float] = None) -> None:
        if not self.enabled:
            return

        line = {
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "domain": domain,
            "institution_id": institution_id,
            "category": category,
            "reason": reason,
            "top_score": None if top_score is None else round(float(top_score), 3),
            "question_sha256": question_hash(question),
            "question_redacted": redact(question),
        }

        try:
            with self._lock:
                self.directory.mkdir(parents=True, exist_ok=True)
                with self.path_for(domain).open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(line, ensure_ascii=False) + "\n")
        except OSError:
            pass
