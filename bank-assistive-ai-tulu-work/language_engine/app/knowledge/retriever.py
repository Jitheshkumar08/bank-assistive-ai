"""Knowledge retrieval over the banking articles (rebuilt in M7).

WHAT WAS WRONG

Each article was embedded WHOLE. The embedding model reads at most 128
tokens, so 11 of the 15 articles were cut off -- loan_basics.md was 37%
visible, account_opening_requirements.md 43% -- and a question about a later
section (loan tenure, instalments, cheque book safekeeping) could not match
the section that answers it.

WHAT IT DOES NOW

  1. Every article is also split at its "## " sections. Each chunk carries
     the article title and heading ("Loan Basics. Tenure. ..."), and none
     exceeds the model's window (longest: 82 tokens). The "Questions"
     sections are left out: they are instructions to the assistant, not
     banking content.
  2. An article scores the MEAN of its whole-article score and its best
     section score. Chosen on the M0-M5 evaluation questions plus a probe of
     late-section questions (the fresh M7 set was not used):

         scoring                 dev top-1   late sections   total
         whole article           68 / 71     11 / 16         79 / 87
         best section only       63 / 71     15 / 16         78 / 87
         mean of the two         67 / 71     14 / 16         81 / 87

     Sections alone rank worse on ordinary questions; the whole article alone
     cannot see late sections. The mean keeps both signals.
  3. The question is searched as asked, and -- when it names knowledge-base
     terms in Kannada, Hindi or romanised form -- also as those English terms
     (query_preparation). An article keeps its better score. On the same dev
     questions this alone raised top-1 from 60 to 68 of 71.
  4. search() still returns WHOLE articles: the answer prompt is given the
     full text, never a fragment. (Phase 2: evidence.build_evidence() removes
     the meta "Questions" sections and repeated sentences before the prompt.)

NO ABSTENTION THRESHOLD

The weakest correct article on dev scored 0.308; the strongest match for a
question the knowledge base cannot answer scored 0.578. No cut-off separates
them, so retrieval always returns its top_k articles, as before, and the
answer prompt's existing rule ("say you do not have that information") is the
safe fallback. MIN_SCORE stays None until a measurement supports a value.
Phase 2 re-measured this on evaluation/fixtures/knowledge/knowledge_p2.json and the
conclusion stands (see evaluation/reports/knowledge_p2_after.md): a low score
is recorded as WEAK EVIDENCE for the knowledge-gap report, never used to
refuse.

The public contract is unchanged: search(query, top_k) -> [{"source",
"content", "score"}], best first. Keys added: "section" (the best section's
heading), "query" (which query matched) and, in Phase 2, "metadata".

PHASE 2 ADDITIONS

  5. RARE-TERM MATCHING. The embedding model reads "NEFT" or "branch code"
     as near-noise, although each appears verbatim in exactly one article.
     A query word that occurs in at most RARE_DF articles (and is not a
     stop word) adds LEXICAL_BOOST / article-frequency to each article
     containing it. Chosen on the dev split of
     evaluation/fixtures/knowledge/knowledge_p2.json, then checked on held-out.
  6. METADATA. Each result carries the article's manifest metadata
     (services, topics, version, review dates). search(..., filters=...)
     restricts candidates, e.g. filters={"services": "withdraw money"}.
  7. CACHING. Query embeddings are cached (bounded LRU). They do not depend
     on the articles, so a refresh does not invalidate them; anything that
     does depend on the articles keys on `version`.
  8. REFRESH. refresh() reloads the collection and re-embeds only articles
     whose content changed. The index is keyed by source, so a refresh can
     never index an article twice, and the swap is atomic for concurrent
     searches. `version` changes exactly when indexed content changes.

PHASE 3A

  9. FRESHNESS AT QUERY TIME. An article whose effective_until has passed
     (or whose effective_date has not arrived) is skipped by search() even
     before the next refresh removes it from the index (loader.is_current).
"""

import hashlib
import threading
from collections import OrderedDict

import numpy

from app.dialogue.text_normalization import word_tokens
from app.knowledge.embedding_model import get_embedding_model
from app.knowledge.loader import META_SECTIONS, KnowledgeLoader, content_version, is_current
from app.knowledge.query_preparation import retrieval_queries
from app.observability.latency import stage

#: A section longer than this many characters is split at sentence ends, so
#: no chunk is cut off by the model's 128-token window.
MAX_CHUNK_CHARS = 450

#: See NO ABSTENTION THRESHOLD above.
MIN_SCORE = None

#: Rare-term matching (5 above). A word is "rare" when at most RARE_DF
#: articles contain it.
RARE_DF = 2
LEXICAL_BOOST = 0.15

#: Words too common in questions to count as evidence, however rare they are
#: in the articles.
STOP_WORDS = frozenset("""
a an the is are was were be been am do does did can could would should will
shall may might must i me my we our you your he she it its they them their
this that these those what which who whom whose why how when where there here
of in on at to for from by with about into over under as and or not no yes
if then so than too very just also please tell explain mean means meaning
need want get got give make made have has had know like one any some all
""".split())

#: Bounded cache of query embeddings.
EMBEDDING_CACHE_SIZE = 512


def chunk_document(source, content):
    """[{"source", "title", "heading", "text"}] for one markdown article."""
    title, heading, buffer, chunks = "", "", [], []

    def flush():
        body = " ".join(" ".join(buffer).split())
        buffer.clear()
        if not body:
            return
        # Split a long section at sentence ends, never mid-sentence.
        pieces, current = [], ""
        for sentence in body.replace(". ", ".\n").split("\n"):
            if current and len(current) + len(sentence) > MAX_CHUNK_CHARS:
                pieces.append(current)
                current = sentence
            else:
                current = f"{current} {sentence}".strip()
        if current:
            pieces.append(current)
        for piece in pieces:
            label = ". ".join(p for p in (title, heading) if p)
            chunks.append({"source": source, "title": title, "heading": heading,
                           "text": f"{label}. {piece}" if label else piece})

    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            flush()
            title = stripped[2:].strip()
        elif stripped.startswith("#"):
            flush()
            heading = stripped.lstrip("#").strip()
        elif stripped:
            buffer.append(stripped)
    flush()

    return chunks


def matches_filters(metadata, filters):
    """Whether an article's metadata satisfies every filter (any listed value)."""
    for key, wanted in (filters or {}).items():
        wanted = set(wanted) if isinstance(wanted, (list, tuple, set)) else {wanted}
        value = metadata.get(key)
        values = set(value) if isinstance(value, (list, tuple, set)) else {value}
        if not wanted & values:
            return False
    return True


class _Index:
    """Everything a search reads, swapped as one object by refresh()."""

    def __init__(self, documents, chunks, document_embeddings, chunk_embeddings):
        self.documents = documents
        self.sources = [d["source"] for d in documents]
        self.content = {d["source"]: d["content"] for d in documents}
        self.metadata = {d["source"]: d.get("metadata") or {} for d in documents}
        self.chunks = chunks
        self.document_embeddings = document_embeddings
        self.chunk_embeddings = chunk_embeddings

        # Article frequency of every word in the indexed (non-meta) text.
        self.terms = {source: set() for source in self.sources}
        for chunk in chunks:
            self.terms[chunk["source"]].update(word_tokens(chunk["text"]))
        frequency = {}
        for words in self.terms.values():
            for word in words:
                frequency[word] = frequency.get(word, 0) + 1
        self.frequency = frequency

        self.version = hashlib.sha256("|".join(
            f"{s}:{content_version(self.content[s])}" for s in self.sources
        ).encode("utf-8")).hexdigest()[:12]


class KnowledgeRetriever:

    def __init__(self, model=None, documents=None, scoring="mean", expand_queries=True,
                 min_score=MIN_SCORE, lexical_boost=LEXICAL_BOOST, loader=None,
                 encoder=None):
        """`scoring` is "mean" (production), "whole" or "sections" -- the
        alternatives exist so the choice above stays measurable. So does
        `lexical_boost` (0 turns rare-term matching off).

        Domain integration (Phase 3), optional and unused by Banking:

        `encoder`  a callable texts -> normalised vectors used for the
                   articles and sections instead of encoding them afresh
                   (app/knowledge/embedding_cache.py). Queries are always
                   encoded by `model`. None = exactly the previous behaviour.
        `metadata` a document dict may carry a "metadata" mapping; it is
                   returned with that document's results, for source
                   attribution.
        """

        print("Loading knowledge retrieval model...")

        self.model = model or get_embedding_model()
        self.loader = loader or KnowledgeLoader()
        self.scoring = scoring
        self.expand_queries = expand_queries
        self.min_score = min_score
        self.lexical_boost = lexical_boost

        self._encoder = encoder
        self._lock = threading.RLock()
        self._embedding_cache = OrderedDict()
        self.embedding_cache_hits = 0
        self._index = None

        self._install(documents if documents is not None else self.loader.load_documents())

        print(
            f"Knowledge Retriever Ready ✅ "
            f"({len(self.documents)} documents, {len(self.chunks)} sections)"
        )

    # -----------------------------------------------------
    # Index construction and refresh
    # -----------------------------------------------------

    def _encode_reusing(self, texts, keys, reuse):
        """Embeddings for `texts`, encoding only those whose key is not in `reuse`."""
        missing = [i for i, key in enumerate(keys) if key not in reuse]
        fresh = {}
        if missing:
            batch = [texts[i] for i in missing]
            # Phase 3: a domain's embedding cache encodes articles and sections.
            encoded = (self._encoder(batch) if self._encoder is not None
                       else self.model.encode(batch, normalize_embeddings=True))
            fresh = {i: encoded[n] for n, i in enumerate(missing)}
        rows = [fresh[i] if i in fresh else reuse[key] for i, key in enumerate(keys)]
        if not rows:
            return numpy.zeros((0, 0))
        return numpy.vstack([numpy.asarray(row) for row in rows])

    def _build(self, documents, previous=None):
        """A new _Index, reusing the embeddings of unchanged articles and sections."""
        reuse_documents, reuse_chunks = {}, {}
        if previous is not None:
            for source, embedding in zip(previous.sources, previous.document_embeddings):
                reuse_documents[(source, previous.content[source])] = embedding
            for chunk, embedding in zip(previous.chunks, previous.chunk_embeddings):
                reuse_chunks[(chunk["source"], chunk["text"])] = embedding

        # One entry per source: a collection listing an article twice is
        # indexed once (the later entry wins), never duplicated.
        unique = list({d["source"]: d for d in documents}.values())
        chunks = [c for d in unique for c in chunk_document(d["source"], d["content"])
                  if c["heading"] not in META_SECTIONS]

        document_embeddings = self._encode_reusing(
            [d["content"] for d in unique], [(d["source"], d["content"]) for d in unique], reuse_documents)
        chunk_embeddings = self._encode_reusing(
            [c["text"] for c in chunks], [(c["source"], c["text"]) for c in chunks], reuse_chunks)

        return _Index(unique, chunks, document_embeddings, chunk_embeddings)

    def _install(self, documents, previous=None):
        index = self._build(documents, previous)
        with self._lock:
            self._index = index
        return index

    def refresh(self, documents=None):
        """
        Reloads the collection (or uses `documents`) and re-indexes it.

        Returns {"added", "updated", "removed", "unchanged", "version",
        "previous_version"}. Unchanged articles are not re-embedded.
        """
        previous = self._index
        new_documents = documents if documents is not None else self.loader.load_documents()
        index = self._install(new_documents, previous)

        before, after = previous.content, index.content
        return {
            "added": sorted(set(after) - set(before)),
            "removed": sorted(set(before) - set(after)),
            "updated": sorted(s for s in after if s in before and before[s] != after[s]),
            "unchanged": sum(1 for s in after if s in before and before[s] == after[s]),
            "version": index.version,
            "previous_version": previous.version,
        }

    def clear_caches(self):
        with self._lock:
            self._embedding_cache.clear()
            self.embedding_cache_hits = 0

    # Read-only views, kept for existing callers and tests.
    documents = property(lambda self: self._index.documents)
    sources = property(lambda self: self._index.sources)
    chunks = property(lambda self: self._index.chunks)
    document_embeddings = property(lambda self: self._index.document_embeddings)
    chunk_embeddings = property(lambda self: self._index.chunk_embeddings)
    version = property(lambda self: self._index.version)
    _content = property(lambda self: self._index.content)

    def metadata(self, source):
        return dict(self._index.metadata.get(source, {}))

    # -----------------------------------------------------
    # Scoring
    # -----------------------------------------------------

    def _embed(self, text):
        with self._lock:
            cached = self._embedding_cache.get(text)
            if cached is not None:
                self._embedding_cache.move_to_end(text)
                self.embedding_cache_hits += 1
                return cached
        with stage("embedding"):
            embedding = self.model.encode(text, normalize_embeddings=True)
        with self._lock:
            self._embedding_cache[text] = embedding
            while len(self._embedding_cache) > EMBEDDING_CACHE_SIZE:
                self._embedding_cache.popitem(last=False)
        return embedding

    def _lexical(self, index, text):
        """{source: boost} from query words that are rare in the collection."""
        if not self.lexical_boost:
            return {}
        boosts = {}
        for word in set(word_tokens(text)):
            if len(word) < 3 or word in STOP_WORDS:
                continue
            frequency = index.frequency.get(word, 0)
            if not 0 < frequency <= RARE_DF:
                continue
            for source, words in index.terms.items():
                if word in words:
                    boosts[source] = max(boosts.get(source, 0.0), self.lexical_boost / frequency)
        return boosts

    def _article_scores(self, text, index=None):
        """{source: (score, best section heading)} for one query."""
        index = index or self._index
        query = self._embed(text)
        whole = dict(zip(index.sources, (index.document_embeddings @ query).tolist()))

        sections = {}
        for chunk, score in zip(index.chunks, (index.chunk_embeddings @ query).tolist()):
            if chunk["source"] not in sections or score > sections[chunk["source"]][0]:
                sections[chunk["source"]] = (score, chunk["heading"])

        lexical = self._lexical(index, text)

        out = {}
        for source in index.sources:
            section_score, heading = sections.get(source, (whole[source], ""))
            if self.scoring == "whole":
                score = whole[source]
            elif self.scoring == "sections":
                score = section_score
            else:
                score = (whole[source] + section_score) / 2
            out[source] = (score + lexical.get(source, 0.0), heading)
        return out

    def search(self, query, top_k=2, filters=None):

        with self._lock:
            index = self._index

        if not index.sources:
            return []

        with stage("retrieval"):
            queries = retrieval_queries(query) if self.expand_queries else [query]
            best = {}

            for which, text in enumerate(queries):
                for source, (score, heading) in self._article_scores(text, index).items():
                    if filters and not matches_filters(index.metadata[source], filters):
                        continue
                    if not is_current(index.metadata[source]):
                        continue
                    if source not in best or score > best[source][0]:
                        best[source] = (score, heading, "question" if which == 0 else "terms")

            ranked = sorted(best.items(), key=lambda item: item[1][0], reverse=True)

            results = []
            for source, (score, heading, matched) in ranked[:top_k]:
                if self.min_score is not None and score < self.min_score:
                    break
                results.append({
                    "source": source,
                    "content": index.content[source],
                    "score": float(score),
                    "section": heading,
                    "query": matched,
                    "metadata": dict(index.metadata[source]),
                })

        return results
