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
     full text, never a fragment.

NO ABSTENTION THRESHOLD

The weakest correct article on dev scored 0.308; the strongest match for a
question the knowledge base cannot answer scored 0.578. No cut-off separates
them, so retrieval always returns its top_k articles, as before, and the
answer prompt's existing rule ("say you do not have that information") is the
safe fallback. MIN_SCORE stays None until a measurement supports a value.

The public contract is unchanged: search(query, top_k) -> [{"source",
"content", "score"}], best first. Two keys are added: "section" (the best
section's heading) and "query" (which query matched).
"""

from app.knowledge.embedding_model import get_embedding_model
from app.knowledge.loader import KnowledgeLoader
from app.knowledge.query_preparation import retrieval_queries

#: A section longer than this many characters is split at sentence ends, so
#: no chunk is cut off by the model's 128-token window.
MAX_CHUNK_CHARS = 450

#: Sections that instruct the assistant rather than describe banking.
META_SECTIONS = {"Questions", "General Questions"}

#: See NO ABSTENTION THRESHOLD above.
MIN_SCORE = None


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


class KnowledgeRetriever:

    def __init__(self, model=None, documents=None, scoring="mean", expand_queries=True,
                 min_score=MIN_SCORE):
        """`scoring` is "mean" (production), "whole" or "sections" -- the
        alternatives exist so the choice above stays measurable."""

        print("Loading knowledge retrieval model...")

        self.model = model or get_embedding_model()
        self.loader = KnowledgeLoader()
        self.documents = documents if documents is not None else self.loader.load_documents()
        self.scoring = scoring
        self.expand_queries = expand_queries
        self.min_score = min_score

        self.sources = [d["source"] for d in self.documents]
        self._content = {d["source"]: d["content"] for d in self.documents}
        self.chunks = [c for d in self.documents for c in chunk_document(d["source"], d["content"])
                       if c["heading"] not in META_SECTIONS]

        self.document_embeddings = self.model.encode(
            [d["content"] for d in self.documents], normalize_embeddings=True
        )
        self.chunk_embeddings = self.model.encode(
            [c["text"] for c in self.chunks], normalize_embeddings=True
        )

        print(
            f"Knowledge Retriever Ready ✅ "
            f"({len(self.documents)} documents, {len(self.chunks)} sections)"
        )

    def _article_scores(self, text):
        """{source: (score, best section heading)} for one query."""
        query = self.model.encode(text, normalize_embeddings=True)
        whole = dict(zip(self.sources, (self.document_embeddings @ query).tolist()))

        sections = {}
        for chunk, score in zip(self.chunks, (self.chunk_embeddings @ query).tolist()):
            if chunk["source"] not in sections or score > sections[chunk["source"]][0]:
                sections[chunk["source"]] = (score, chunk["heading"])

        out = {}
        for source in self.sources:
            section_score, heading = sections.get(source, (whole[source], ""))
            if self.scoring == "whole":
                score = whole[source]
            elif self.scoring == "sections":
                score = section_score
            else:
                score = (whole[source] + section_score) / 2
            out[source] = (score, heading)
        return out

    def search(self, query, top_k=2):

        queries = retrieval_queries(query) if self.expand_queries else [query]
        best = {}

        for which, text in enumerate(queries):
            for source, (score, heading) in self._article_scores(text).items():
                if source not in best or score > best[source][0]:
                    best[source] = (score, heading, "question" if which == 0 else "terms")

        ranked = sorted(best.items(), key=lambda item: item[1][0], reverse=True)

        results = []
        for source, (score, heading, matched) in ranked[:top_k]:
            if self.min_score is not None and score < self.min_score:
                break
            results.append({
                "source": source,
                "content": self._content[source],
                "score": float(score),
                "section": heading,
                "query": matched,
            })

        return results
