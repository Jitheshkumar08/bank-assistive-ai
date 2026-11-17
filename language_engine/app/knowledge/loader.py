"""Loading a knowledge collection: markdown articles plus their metadata.

A collection is a folder of markdown articles and an optional
manifest.json describing them (see documents/manifest.json). The manifest
is metadata only -- services, topics, status, review dates -- so an article
is still written and edited as plain markdown.

Each document is returned as

    {"source": "deposit_slip.md", "content": "...", "metadata": {...}}

"source" and "content" are the contract every existing caller relies on;
"metadata" is added. metadata["version"] is the first 12 hex digits of the
SHA-256 of the content, derived on every load, so it changes exactly when
the article changes and can never be stale. metadata["id"] is the article's
stable id: the manifest's "id", or the file name without ".md".

Only articles whose status is "active" are returned. A "draft" article --
new knowledge waiting for review -- stays on disk and out of the index
until someone changes its status.

PROVENANCE AND FRESHNESS (Phase 3A)

The manifest schema is extended, not replaced. Per article (or in
"defaults"):

  source_reference   where the content comes from (a document, URL or
                     person); null when the article is project-authored
  authority          who stands behind it (existing field)
  verification       "verified" or "unverified" (default "unverified")
  last_reviewed      ISO date a reviewer last checked it (existing field)
  effective_date     ISO date from which it applies (existing field)
  effective_until    ISO date after which it no longer applies
  time_sensitive     true for content that goes stale -- rates, fees,
                     limits, timings, deadlines

An article is NOT indexed, and `skip_reasons` says why, when:

  - its status is not "active"                          "status: draft"
  - it is time-sensitive but not verified, or verified
    without a last_reviewed date                        "time-sensitive, unverified"
  - its effective_date is in the future                 "not yet effective"
  - its effective_until is in the past                  "expired"
  - a date is not a valid ISO date (fail closed)        "invalid date: ..."
  - it is not listed in a manifest whose "unlisted"
    setting is "skip"                                   "not in manifest"

So a bank figure cannot become authoritative without a reviewer marking
it verified, and it stops being served when it expires. Expiry is also
checked at query time (is_current), so an article that expires while the
service runs is not served until the next refresh notices.

UNLISTED ARTICLES. A manifest with "unlisted": "skip" (the banking
collection) indexes only articles it lists: a markdown file dropped into
the folder is new, unreviewed knowledge and stays out of the index until
someone adds it to the manifest. A manifest without that setting keeps the
Phase 2 behaviour -- an unlisted article is loaded with the defaults and
reported in `missing_metadata` -- and a folder with no manifest at all
loads every article, as before.

`problems` lists anything a maintainer should fix: manifest entries whose
file is missing, unknown status values, invalid dates.
"""

import hashlib
import json
from datetime import date
from pathlib import Path

DEFAULT_DOCUMENTS = Path(__file__).parent / "documents"
MANIFEST_NAME = "manifest.json"

ACTIVE = "active"
VERIFIED = "verified"
KNOWN_STATUSES = {"active", "draft", "retired"}

#: Sections that instruct the assistant rather than describe banking.
#: Shared by the retriever (not indexed) and evidence (not sent).
META_SECTIONS = {"Questions", "General Questions"}

#: Skip reasons.
NOT_IN_MANIFEST = "not in manifest"
UNVERIFIED_TIME_SENSITIVE = "time-sensitive, unverified"
NOT_YET_EFFECTIVE = "not yet effective"
EXPIRED = "expired"


def content_version(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:12]


def parse_date(value):
    """A date from an ISO string, None for null; raises ValueError otherwise."""
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def freshness_problem(metadata, today=None):
    """Why an article must not be served today, or None."""
    today = today or date.today()
    try:
        effective_from = parse_date(metadata.get("effective_date"))
        effective_until = parse_date(metadata.get("effective_until"))
        reviewed = parse_date(metadata.get("last_reviewed"))
    except ValueError as error:
        return f"invalid date: {error}"

    if metadata.get("time_sensitive") and (metadata.get("verification") != VERIFIED or reviewed is None):
        return UNVERIFIED_TIME_SENSITIVE
    if effective_from is not None and effective_from > today:
        return NOT_YET_EFFECTIVE
    if effective_until is not None and effective_until < today:
        return EXPIRED
    return None


def is_current(metadata, today=None):
    return freshness_problem(metadata or {}, today) is None


class KnowledgeLoader:

    def __init__(self, documents_path=None, today=None):
        self.documents_path = Path(documents_path) if documents_path else DEFAULT_DOCUMENTS
        #: Fixed date for tests; None means the real date at each load.
        self.today = today
        self.missing_metadata = []
        self.skipped = []
        self.skip_reasons = {}
        self.problems = []

    def manifest(self):
        path = self.documents_path / MANIFEST_NAME
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def load_documents(self):
        manifest = self.manifest()
        defaults = manifest.get("defaults", {})
        described = manifest.get("documents", {})
        collection = manifest.get("collection")
        domain = manifest.get("domain")
        skip_unlisted = manifest.get("unlisted") == "skip"
        today = self.today or date.today()

        self.missing_metadata, self.skipped, self.skip_reasons, self.problems = [], [], {}, []
        documents = []

        files = sorted(self.documents_path.glob("*.md"))
        present = {f.name for f in files}
        for name in sorted(set(described) - present):
            self.problems.append(f"{name}: listed in the manifest but the file does not exist")

        def skip(name, reason):
            self.skipped.append(name)
            self.skip_reasons[name] = reason

        # Sorted: index order, and so every derived version, is the same on
        # every machine (glob order is filesystem-dependent).
        for file_path in files:

            content = file_path.read_text(encoding="utf-8")
            listed = file_path.name in described

            if not listed and described:
                self.missing_metadata.append(file_path.name)
                if skip_unlisted:
                    skip(file_path.name, NOT_IN_MANIFEST)
                    continue

            metadata = {
                "services": [],
                "topics": [],
                "verification": "unverified",
                **defaults,
                **described.get(file_path.name, {}),
                "collection": collection,
                "domain": domain,
                "version": content_version(content),
            }
            metadata.setdefault("id", file_path.stem)

            status = metadata.get("status", ACTIVE)
            if status not in KNOWN_STATUSES:
                self.problems.append(f"{file_path.name}: unknown status {status!r}")
            if status != ACTIVE:
                skip(file_path.name, f"status: {status}")
                continue

            problem = freshness_problem(metadata, today)
            if problem is not None:
                if problem.startswith("invalid date"):
                    self.problems.append(f"{file_path.name}: {problem}")
                skip(file_path.name, problem)
                continue

            documents.append({
                "source": file_path.name,
                "content": content,
                "metadata": metadata,
            })

        return documents
