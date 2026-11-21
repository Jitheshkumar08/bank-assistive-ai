"""Knowledge-gap diagnostics: questions the assistant could not answer well.

WHEN A RECORD IS WRITTEN

  not_in_knowledge     the model said the knowledge did not contain the answer
  unavailable          the LLM could not be reached or returned nothing
  validation_replaced  the answer invented a figure or claimed an action, and
                       was replaced (answer_validation)
  weak_evidence        answered, but the best retrieval score was below
                       WEAK_EVIDENCE_SCORE -- worth a reviewer's look
  dynamic_information  asked for a current bank or branch figure (rate, fee,
                       limit, timing) the knowledge does not hold; answered
                       "I can't confirm that" (answerability.py, Phase 3A)

WHAT A RECORD HOLDS -- AND DOES NOT

  question        the routing text, REDACTED: digit runs -> "#", e-mail
                  addresses -> "<email>", a name after "my name is" /
                  "मेरा नाम" / "ನನ್ನ ಹೆಸರು" -> "<name>", cut to 200
                  characters. Account, phone and amount digits never reach
                  the log.
  question_hash   SHA-256 of the redacted text, for grouping repeats
  language, outcome, detail
  context         the first 80 characters of the workflow context the
                  question was asked in (the workflow's step instructions,
                  or the resting-state note) -- engine text, never the
                  customer's
  retrieval       [{"source", "score"}] -- what was found and how well
  sources_used    the articles actually given to the model
  latency_ms      stage timings for the turn so far
  knowledge_version

Never: raw audio, the model's answer, session ids, or the conversation
history. Redaction is pattern-based: a name given any other way ("I'm
Ravi") is not recognised, which is one reason file logging is opt-in.

WHERE RECORDS GO, AND FOR HOW LONG

  memory  always: the last BUFFER_SIZE records, gone at restart. Read with
          GET /knowledge/gaps (grouped=true for one row per question).
  file    only when KNOWLEDGE_GAP_LOG names a JSONL file. Append-only; the
          engine never rotates or deletes it, so retention is the
          operator's decision (delete or rotate the file). At start-up the
          last BUFFER_SIZE records and every resolution are read back, so
          the endpoint survives a restart.

DEDUPLICATION AND REVIEW (Phase 3A)

Records are never merged on write -- how often a question is asked is the
signal. They are deduplicated at review time: grouped() / summarize() give
one row per question_hash with a count, first and last time seen, outcomes
and languages.

A maintainer closes a group with resolve(question_hash, resolution, note):
one of RESOLUTIONS, plus an optional redacted note. Resolutions are events
appended to the same file, so nothing is rewritten. A group asked again
AFTER its resolution shows as reopened.

REVIEW, NEVER AUTO-ADD

Nothing here writes knowledge. "article_added_as_draft" records that a
maintainer wrote a draft; the draft is indexed only when someone activates
it in the collection manifest (loader.py), and a time-sensitive article
only once it is marked verified.

    venv/Scripts/python.exe -m app.knowledge.gaps summarize <file.jsonl> [--open] [--out report.md]
    venv/Scripts/python.exe -m app.knowledge.gaps resolve <file.jsonl> <question_hash> <resolution> [--note TEXT]
"""

import argparse
import hashlib
import json
import os
import re
import sys
import threading
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path

#: From evaluation/reports/knowledge_p2_after.md: on the dev split, 0.44
#: keeps 95% of correctly answered questions above it and puts 60% of
#: unanswerable ones below it. A diagnostic signal -- NOT a refusal rule.
WEAK_EVIDENCE_SCORE = 0.44

BUFFER_SIZE = 500
MAX_QUESTION_CHARS = 200

NOT_IN_KNOWLEDGE = "not_in_knowledge"
UNAVAILABLE = "unavailable"
VALIDATION_REPLACED = "validation_replaced"
WEAK_EVIDENCE = "weak_evidence"
DYNAMIC_INFORMATION = "dynamic_information"

#: What a maintainer can record when closing a group.
RESOLUTIONS = (
    "article_added_as_draft",
    "article_updated",
    "answered_by_existing_article",
    "out_of_scope",
    "not_actionable",
)

RESOLUTION = "resolution"

_EMAIL = re.compile(r"\S+@\S+")
_DIGITS = re.compile(r"\d[\d\s,.-]*\d|\d")
_NAMES = [
    (re.compile(r"\b(my\s+name\s+is|my\s+name's|i\s+am\s+called)\s+[^\W\d_]+(?:\s+[^\W\d_]+){0,2}", re.IGNORECASE),
     r"\1 <name>"),
    (re.compile(r"(मेरा\s+नाम)\s+\S+"), r"\1 <name>"),
    (re.compile(r"(ನನ್ನ\s+ಹೆಸರು)\s+\S+"), r"\1 <name>"),
]


def redact(text):
    text = _EMAIL.sub("<email>", text or "")
    text = _DIGITS.sub("#", text)
    for pattern, replacement in _NAMES:
        text = pattern.sub(replacement, text)
    text = " ".join(text.split())
    return text[:MAX_QUESTION_CHARS]


def question_hash(redacted):
    return hashlib.sha256(redacted.lower().encode("utf-8")).hexdigest()[:16]


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_log(path):
    """(gap records, {question_hash: latest resolution}) from a JSONL file."""
    records, resolutions = [], {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue        # a torn last line after a crash; skip it
        if entry.get("type") == RESOLUTION:
            resolutions[entry["question_hash"]] = entry
        else:
            records.append(entry)
    return records, resolutions


class GapLog:

    def __init__(self, path=None, buffer_size=BUFFER_SIZE):
        configured = path if path is not None else os.getenv("KNOWLEDGE_GAP_LOG", "").strip()
        self.path = Path(configured) if configured else None
        self._buffer = deque(maxlen=buffer_size)
        self._resolutions = {}
        self._lock = threading.Lock()
        if self.path is not None and self.path.exists():
            try:
                records, self._resolutions = read_log(self.path)
                self._buffer.extend(records[-buffer_size:])
            except OSError as error:
                print(f"[GAPS] Could not read {self.path} ({type(error).__name__})")

    def _append(self, entry):
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as error:
            print(f"[GAPS] Could not write {self.path} ({type(error).__name__})")

    def record(self, *, question, outcome, language=None, detail=None, context=None,
               retrieval=(), sources_used=(), latency_ms=None, knowledge_version=None):
        safe = redact(question)
        entry = {
            "time": _now(),
            "question": safe,
            "question_hash": question_hash(safe),
            "language": language,
            "outcome": outcome,
            "detail": detail,
            "context": context,
            "retrieval": [{"source": r.get("source"), "score": round(float(r.get("score", 0.0)), 3)}
                          for r in retrieval],
            "sources_used": list(sources_used),
            "latency_ms": latency_ms or {},
            "knowledge_version": knowledge_version,
        }
        with self._lock:
            self._buffer.append(entry)
            self._append(entry)
        return entry

    def recent(self, limit=100):
        with self._lock:
            return list(self._buffer)[-limit:]

    def grouped(self, include_resolved=True):
        """One row per question in the buffer, most frequent first."""
        with self._lock:
            entries, resolutions = list(self._buffer), dict(self._resolutions)
        groups = summarize(entries, resolutions)
        if not include_resolved:
            groups = [g for g in groups if g["status"] != "resolved"]
        return [_serialisable(g) for g in groups]

    def resolve(self, question_hash, resolution, note=""):
        """Closes a group. Raises ValueError for an unknown resolution, KeyError for an unknown question."""
        if resolution not in RESOLUTIONS:
            raise ValueError(f"resolution must be one of {', '.join(RESOLUTIONS)}")
        with self._lock:
            if not any(e["question_hash"] == question_hash for e in self._buffer):
                raise KeyError(question_hash)
            event = {"type": RESOLUTION, "time": _now(), "question_hash": question_hash,
                     "resolution": resolution, "note": redact(note)}
            self._resolutions[question_hash] = event
            self._append(event)
        return event


# ---------------------------------------------------------------------------
# Review export
# ---------------------------------------------------------------------------

def summarize(entries, resolutions=None):
    """Groups records by question, most frequent first.

    status: "open"; "resolved" (resolved after it was last asked); or
    "reopened" (asked again after its resolution).
    """
    resolutions = resolutions or {}
    groups = {}
    for entry in entries:
        group = groups.setdefault(entry["question_hash"], {
            "question_hash": entry["question_hash"], "question": entry["question"], "count": 0,
            "first_seen": entry.get("time"), "last_seen": entry.get("time"),
            "outcomes": Counter(), "languages": Counter(), "best_source": None, "best_score": None,
        })
        group["count"] += 1
        group["last_seen"] = max(group["last_seen"] or "", entry.get("time") or "")
        group["outcomes"][entry["outcome"]] += 1
        group["languages"][entry.get("language") or "?"] += 1
        for hit in entry.get("retrieval", [])[:1]:
            if group["best_score"] is None or hit["score"] > group["best_score"]:
                group["best_source"], group["best_score"] = hit["source"], hit["score"]
    for key, group in groups.items():
        resolution = resolutions.get(key)
        group["resolution"] = resolution
        if resolution is None:
            group["status"] = "open"
        elif (group["last_seen"] or "") > resolution["time"]:
            group["status"] = "reopened"
        else:
            group["status"] = "resolved"
    return sorted(groups.values(), key=lambda g: g["count"], reverse=True)


def _serialisable(group):
    return {**group, "outcomes": dict(group["outcomes"]), "languages": dict(group["languages"])}


def render(groups):
    lines = ["# Unanswered and weakly answered questions", "",
             "Review each row: add or extend an article (as a draft) if the question is in scope, "
             "or leave it if it is out of scope, then record what you did with "
             "`python -m app.knowledge.gaps resolve`. Nothing here is added automatically.", "",
             "| count | status | question | outcomes | languages | best match (score) | hash |",
             "|---|---|---|---|---|---|---|"]
    for g in groups:
        outcomes = ", ".join(f"{k} x{v}" for k, v in Counter(g["outcomes"]).most_common())
        languages = ", ".join(f"{k} x{v}" for k, v in Counter(g["languages"]).most_common())
        best = f"{g['best_source']} ({g['best_score']})" if g["best_source"] else "-"
        status = g.get("status", "open")
        if g.get("resolution"):
            status += f": {g['resolution']['resolution']}"
        lines.append(f"| {g['count']} | {status} | {g['question']} | {outcomes} | {languages} | {best} | "
                     f"{g.get('question_hash', '')} |")
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Knowledge-gap review export")
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("summarize", help="group a KNOWLEDGE_GAP_LOG file for review")
    s.add_argument("file")
    s.add_argument("--open", action="store_true", help="leave out resolved groups")
    s.add_argument("--out", help="write markdown here instead of printing")
    r = sub.add_parser("resolve", help="record what was done about one group")
    r.add_argument("file")
    r.add_argument("question_hash")
    r.add_argument("resolution", choices=RESOLUTIONS)
    r.add_argument("--note", default="")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    if args.command == "resolve":
        log = GapLog(path=args.file, buffer_size=10 ** 9)
        try:
            event = log.resolve(args.question_hash, args.resolution, args.note)
        except KeyError:
            print(f"No record with question_hash {args.question_hash} in {args.file}")
            return 1
        print(json.dumps(event, ensure_ascii=False))
        return 0

    records, resolutions = read_log(args.file)
    groups = summarize(records, resolutions)
    if args.open:
        groups = [g for g in groups if g["status"] != "resolved"]
    report = render(groups)
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
        print(f"{len(records)} records -> {args.out}")
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
