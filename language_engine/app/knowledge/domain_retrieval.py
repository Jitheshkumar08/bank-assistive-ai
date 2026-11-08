"""Knowledge retrieval for a domain with its own collection (Phase 3).

Built on the existing KnowledgeRetriever -- same chunking, same scoring (mean
of whole-article and best-section similarity), same ranking -- with three
things added around it:

ISOLATION BY CONSTRUCTION

One KnowledgeRetriever per (domain, institution), built ONLY from that
institution's selectable documents. A College search for institution A runs
over a retriever that has never been given institution B's text, or any
Banking article: there is nothing to filter out afterwards, because nothing
else was ever encoded into it. Each result is still checked on the way out
(_assert_isolated) as a second line of defence.

VERIFIED ONLY, BY DEFAULT

`include_unverified` is False unless a caller sets it explicitly -- only the
debugging suites do, to retrieve from synthetic fixtures. It is not read from
the environment, so no deployment setting can make unverified text official.

ANSWERABILITY

KnowledgeRetriever always returns its top_k articles; for Banking that is by
design (retriever.py, NO ABSTENTION THRESHOLD) and is unchanged. For a domain
with a KnowledgeConfig a question is answerable only when the institution has
documents AND the best one scores at least `min_score`. Otherwise the outcome
says why, no documents are returned, and the question is logged (redacted) in
the unanswered log. The answer prompt's own rule ("say you do not have that
information") remains the last guard against invented dates, fees and rules.

`InstitutionKnowledge.search(query, top_k)` has KnowledgeRetriever's exact
contract, so the dialogue layer can use either without knowing which.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from app.knowledge.collection import KnowledgeCollection
from app.knowledge.embedding_cache import EmbeddingCache
from app.knowledge.embedding_model import EMBEDDING_MODEL_NAME, get_embedding_model
from app.knowledge.retriever import KnowledgeRetriever
from app.knowledge.unanswered_log import UnansweredLog

ANSWERABLE = "answerable"
NO_DOCUMENTS = "no_documents"
BELOW_THRESHOLD = "below_threshold"
UNKNOWN_INSTITUTION = "no_institution"


class IsolationError(RuntimeError):
    """A result crossed a domain or institution boundary. Never expected."""


@dataclass
class RetrievalOutcome:
    answerable: bool
    reason: str
    domain: str
    institution_id: Optional[str]
    results: List[dict] = field(default_factory=list)
    top_score: Optional[float] = None
    #: Time spent in the search itself (building a retriever excluded).
    latency_ms: float = 0.0

    def sources(self) -> List[dict]:
        """Attribution for an answer: one metadata record per document used."""
        return [r["metadata"] for r in self.results if "metadata" in r]


class DomainKnowledgeBase:
    """All of one domain's knowledge, searched one institution at a time."""

    def __init__(
        self,
        domain: str,
        manifest: Path,
        *,
        min_score: float,
        top_k: int = 2,
        include_unverified: bool = False,
        model=None,
        cache_dir: Optional[Path] = None,
        unanswered_log: Optional[UnansweredLog] = None,
    ) -> None:
        self.domain = domain
        self.collection = KnowledgeCollection(manifest, domain)
        self.min_score = min_score
        self.top_k = top_k
        self.include_unverified = include_unverified
        self._model = model
        self._cache_dir = cache_dir
        self.unanswered_log = unanswered_log if unanswered_log is not None else UnansweredLog.from_env()
        self._retrievers: Dict[str, Optional[KnowledgeRetriever]] = {}
        self._caches: Dict[str, EmbeddingCache] = {}
        self._lock = threading.Lock()

    @classmethod
    def for_domain(cls, config, **overrides) -> "DomainKnowledgeBase":
        """From a DomainConfig whose `knowledge` is set."""
        if config.knowledge is None:
            raise ValueError(f"Domain {config.id!r} has no knowledge collection.")
        knowledge = config.knowledge
        options = {"min_score": knowledge.min_score, "top_k": knowledge.top_k, **overrides}
        return cls(config.id, knowledge.manifest, **options)

    @property
    def model(self):
        if self._model is None:
            self._model = get_embedding_model()
        return self._model

    # -----------------------------------------------------------------
    # Per-institution retrievers
    # -----------------------------------------------------------------

    def documents_for(self, institution_id: str) -> list:
        return self.collection.select(institution_id, include_unverified=self.include_unverified)

    def retriever_for(self, institution_id: str) -> Optional[KnowledgeRetriever]:
        """The institution's own retriever, built once; None if it has no documents."""
        with self._lock:
            if institution_id in self._retrievers:
                return self._retrievers[institution_id]

            documents = self.documents_for(institution_id)
            retriever = None
            if documents:
                cache = EmbeddingCache(
                    self.model, EMBEDDING_MODEL_NAME,
                    f"{self.domain}-{institution_id}-{'all' if self.include_unverified else 'verified'}",
                    self._cache_dir,
                )
                retriever = KnowledgeRetriever(
                    model=self.model,
                    documents=[d.as_retriever_document() for d in documents],
                    # The query glossary is Banking's vocabulary; a College
                    # glossary arrives with the College intents (Phase 4/8).
                    expand_queries=False,
                    encoder=cache.encode,
                )
                cache.prune()
                self._caches[institution_id] = cache

            self._retrievers[institution_id] = retriever
            return retriever

    def cache_for(self, institution_id: str) -> Optional[EmbeddingCache]:
        return self._caches.get(institution_id)

    def reload(self) -> None:
        """Re-reads the manifest; retrievers are rebuilt (from the cache) on next use."""
        with self._lock:
            self.collection = KnowledgeCollection(self.collection.manifest_path, self.domain)
            self._retrievers.clear()
            self._caches.clear()

    # -----------------------------------------------------------------
    # Search
    # -----------------------------------------------------------------

    def retrieve(self, query: str, institution_id: Optional[str], *, top_k: Optional[int] = None,
                 category: Optional[str] = None,
                 categories: Optional[Iterable[str]] = None) -> RetrievalOutcome:
        """
        Searches one institution's documents.

        `category` / `categories` (optional) narrow the result to documents
        of those categories -- the College intent supplies them (Phase 4).
        Narrowing is applied after ranking over the institution's whole
        collection, so it never makes a weak match look strong, and a
        question about a category with no documents is NOT answered from a
        neighbouring one (the Phase 3 near-topic case).
        """
        top_k = top_k or self.top_k
        wanted = set(categories or ()) | ({category} if category else set())
        category = ",".join(sorted(wanted)) or None

        if not institution_id:
            return self._unanswerable(query, None, UNKNOWN_INSTITUTION, category)

        retriever = self.retriever_for(institution_id)
        if retriever is None:
            return self._unanswerable(query, institution_id, NO_DOCUMENTS, category)

        started = time.perf_counter()
        ranked = retriever.search(query, top_k=len(retriever.sources))
        latency = (time.perf_counter() - started) * 1000

        self._assert_isolated(ranked, institution_id)

        if wanted:
            ranked = [r for r in ranked if r["metadata"]["category"] in wanted]
            if not ranked:
                return self._unanswerable(query, institution_id, NO_DOCUMENTS, category, latency=latency)

        top_score = ranked[0]["score"] if ranked else None
        if top_score is None or top_score < self.min_score:
            return self._unanswerable(query, institution_id, BELOW_THRESHOLD, category, top_score, latency)

        return RetrievalOutcome(
            answerable=True, reason=ANSWERABLE, domain=self.domain, institution_id=institution_id,
            results=ranked[:top_k], top_score=top_score, latency_ms=latency,
        )

    def _assert_isolated(self, results: List[dict], institution_id: str) -> None:
        for result in results:
            metadata = result.get("metadata") or {}
            if (metadata.get("domain") != self.domain
                    or metadata.get("institution_id") != institution_id
                    or (not self.include_unverified and metadata.get("verified") is not True)):
                raise IsolationError("A retrieval result crossed a domain or institution boundary.")

    def _unanswerable(self, query, institution_id, reason, category, top_score=None, latency=0.0):
        self.unanswered_log.record(
            domain=self.domain, institution_id=institution_id, question=query,
            reason=reason, category=category, top_score=top_score,
        )
        return RetrievalOutcome(
            answerable=False, reason=reason, domain=self.domain, institution_id=institution_id,
            top_score=top_score, latency_ms=latency,
        )

    def for_institution(self, institution_id: str) -> "InstitutionKnowledge":
        return InstitutionKnowledge(self, institution_id)


class InstitutionKnowledge:
    """
    One institution's view, with KnowledgeRetriever's search() contract.

    An unanswerable question returns [] -- the answer prompt then has no
    grounding and says it does not have that information.
    """

    def __init__(self, base: DomainKnowledgeBase, institution_id: str) -> None:
        self.base = base
        self.institution_id = institution_id
        self.last_outcome: Optional[RetrievalOutcome] = None

    def search(self, query, top_k=2):
        self.last_outcome = self.base.retrieve(query, self.institution_id, top_k=top_k)
        return list(self.last_outcome.results)
