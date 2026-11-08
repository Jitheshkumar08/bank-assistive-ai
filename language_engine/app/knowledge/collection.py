"""A domain's knowledge collection: a manifest plus the documents it lists.

Banking's original knowledge base (app/knowledge/documents, read by
KnowledgeLoader) is untouched and does not use this module. Every other domain
keeps its documents in its own collection directory:

    <collection>/
        manifest.json          one entry per document, with its metadata
        documents/<...>.md     the documents; nothing outside this directory

WHAT THE MANIFEST GUARANTEES

  - Every document belongs to the collection's domain. An entry naming another
    domain is refused, so a College collection cannot list a Banking article.
  - Every path stays inside the collection's documents/ directory (no "..",
    no absolute paths), so a manifest cannot reach another domain's files.
  - Every document names its institution and category.
  - A document is VERIFIED only when someone has recorded where it came from,
    who checked it and when, and the file still has the SHA-256 they checked.
    Editing a verified file without re-confirming it makes the manifest
    invalid, rather than silently serving unchecked text as official.
  - Synthetic fixtures can never be marked verified.

Production retrieval uses verified documents only (domain_retrieval.py).
Problems are reported all at once, by entry id and field -- never by quoting
document text.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

#: Categories a College document may have. They mirror the College intent
#: catalogue (Phase 4), so retrieval can be narrowed to what was asked about.
COLLEGE_CATEGORIES = frozenset({
    "overview",
    "programmes",
    "admission_process",
    "admission_eligibility",
    "admission_documents",
    "application_deadlines",
    "fees",
    "scholarships",
    "hostel",
    "transport",
    "departments",
    "academic_calendar",
    "examinations",
    "facilities",
    "office_locations",
    "contacts",
    "student_services",
    "faq",
})

DOCUMENT_TYPES = frozenset({
    "official_policy",
    "official_notice",
    "official_prospectus",
    "official_webpage",
    "official_faq",
    "synthetic_fixture",
})

SYNTHETIC_SOURCE = "synthetic_test_fixture"

_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_INSTITUTION = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ManifestError(ValueError):
    """The manifest is invalid. `problems` lists every reason."""

    def __init__(self, problems: List[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class CollectionDocument:
    id: str
    path: Path
    domain: str
    institution_id: str
    category: str
    document_type: str
    title: str
    source: str
    source_reference: Optional[str]
    version: str
    verified: bool
    verified_by: Optional[str]
    verified_on: Optional[str]
    language: str
    sha256: str
    content: str

    def metadata(self) -> dict:
        """What retrieval returns for source attribution. Never the content."""
        return {
            "id": self.id,
            "domain": self.domain,
            "institution_id": self.institution_id,
            "category": self.category,
            "document_type": self.document_type,
            "title": self.title,
            "source": self.source,
            "source_reference": self.source_reference,
            "version": self.version,
            "verified": self.verified,
        }

    def as_retriever_document(self) -> dict:
        """The dict KnowledgeRetriever takes: source, content, metadata."""
        return {"source": self.id, "content": self.content, "metadata": self.metadata()}


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class KnowledgeCollection:
    """A validated collection for exactly one domain."""

    def __init__(self, manifest_path: Path, domain: str, categories: frozenset = COLLEGE_CATEGORIES) -> None:
        self.manifest_path = Path(manifest_path).resolve()
        self.root = self.manifest_path.parent / "documents"
        self.domain = domain
        self.categories = categories
        self.description = ""
        self.documents: List[CollectionDocument] = self._load()

    # -----------------------------------------------------------------
    # Loading and validation
    # -----------------------------------------------------------------

    def _load(self) -> List[CollectionDocument]:
        try:
            manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise ManifestError([f"manifest unreadable ({type(error).__name__})"]) from error

        problems: List[str] = []

        if manifest.get("domain") != self.domain:
            problems.append(f"manifest domain must be {self.domain!r}")

        entries = manifest.get("documents")
        if not isinstance(entries, list):
            raise ManifestError(problems + ["'documents' must be a list"])

        self.description = str(manifest.get("description", ""))
        documents, seen = [], set()

        for index, entry in enumerate(entries):
            label = f"documents[{index}]"
            if not isinstance(entry, dict):
                problems.append(f"{label}: must be an object")
                continue

            doc_id = entry.get("id")
            if not isinstance(doc_id, str) or not _ID.match(doc_id):
                problems.append(f"{label}: invalid id")
                continue
            label = doc_id
            if doc_id in seen:
                problems.append(f"{label}: duplicate id")
                continue
            seen.add(doc_id)

            document = self._entry(entry, label, problems)
            if document is not None:
                documents.append(document)

        if problems:
            raise ManifestError(problems)

        return documents

    def _entry(self, entry: dict, label: str, problems: List[str]) -> Optional[CollectionDocument]:
        before = len(problems)

        def text(name, required=True):
            value = entry.get(name)
            if value is None and not required:
                return None
            if not isinstance(value, str) or not value.strip():
                problems.append(f"{label}: '{name}' is required")
                return None
            return value.strip()

        if entry.get("domain") != self.domain:
            problems.append(f"{label}: belongs to domain {entry.get('domain')!r}, not {self.domain!r}")

        institution = text("institution_id")
        if institution and not _INSTITUTION.match(institution):
            problems.append(f"{label}: invalid institution_id")

        category = text("category")
        if category and category not in self.categories:
            problems.append(f"{label}: unknown category")

        document_type = text("document_type")
        if document_type and document_type not in DOCUMENT_TYPES:
            problems.append(f"{label}: unknown document_type")

        title, source, version = text("title"), text("source"), text("version")
        language = text("language", required=False) or "en"
        reference = text("source_reference", required=False)
        verified_by = text("verified_by", required=False)
        verified_on = text("verified_on", required=False)
        recorded_sha = text("sha256", required=False)

        verified = entry.get("verified")
        if not isinstance(verified, bool):
            problems.append(f"{label}: 'verified' must be true or false")
            verified = False

        path = self._path(text("path"), label, problems)
        content, actual_sha = "", ""
        if path is not None:
            try:
                content = path.read_text(encoding="utf-8")
                actual_sha = file_sha256(path)
            except OSError:
                problems.append(f"{label}: file not found")
            else:
                if not content.strip():
                    problems.append(f"{label}: file is empty")

        synthetic = document_type == "synthetic_fixture" or source == SYNTHETIC_SOURCE
        if synthetic and (document_type != "synthetic_fixture" or source != SYNTHETIC_SOURCE):
            problems.append(f"{label}: synthetic fixtures need document_type synthetic_fixture "
                            f"and source {SYNTHETIC_SOURCE}")

        if verified:
            if synthetic:
                problems.append(f"{label}: a synthetic fixture can never be verified")
            if not reference:
                problems.append(f"{label}: verified documents need source_reference")
            if not verified_by:
                problems.append(f"{label}: verified documents need verified_by")
            if not verified_on or not _DATE.match(verified_on):
                problems.append(f"{label}: verified documents need verified_on (YYYY-MM-DD)")
            if not recorded_sha or not _SHA256.match(recorded_sha):
                problems.append(f"{label}: verified documents need the file's sha256")
            elif actual_sha and recorded_sha != actual_sha:
                problems.append(f"{label}: file changed since it was verified (sha256 mismatch)")
        elif recorded_sha and actual_sha and recorded_sha != actual_sha:
            problems.append(f"{label}: sha256 does not match the file")

        if len(problems) != before:
            return None

        return CollectionDocument(
            id=label, path=path, domain=self.domain, institution_id=institution,
            category=category, document_type=document_type, title=title, source=source,
            source_reference=reference, version=version, verified=verified,
            verified_by=verified_by, verified_on=verified_on, language=language,
            sha256=actual_sha, content=content,
        )

    def _path(self, relative: Optional[str], label: str, problems: List[str]) -> Optional[Path]:
        if relative is None:
            return None
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or candidate.suffix != ".md":
            problems.append(f"{label}: path must be a relative .md path inside documents/")
            return None
        resolved = (self.root / candidate).resolve()
        if self.root.resolve() not in resolved.parents:
            problems.append(f"{label}: path escapes documents/")
            return None
        return resolved

    # -----------------------------------------------------------------
    # Selection
    # -----------------------------------------------------------------

    def institutions(self) -> List[str]:
        return sorted({d.institution_id for d in self.documents})

    def select(self, institution_id: str, *, include_unverified: bool = False,
               categories: Optional[frozenset] = None) -> List[CollectionDocument]:
        """
        The documents one institution may be answered from.

        Filters, in order: this collection's domain (guaranteed by
        validation), the institution, verified status, and -- when given --
        the categories. There is no "all institutions" option.
        """
        return [
            d for d in self.documents
            if d.domain == self.domain
            and d.institution_id == institution_id
            and (d.verified or include_unverified)
            and (categories is None or d.category in categories)
        ]
