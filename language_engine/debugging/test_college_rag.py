"""
Phase 3 (domain integration): the College knowledge collection.

Offline except for the local sentence encoder (already cached on disk, as for
test_retriever). No Groq, no network. Uses the SYNTHETIC fixtures in
debugging/fixtures/college_kb -- fictional institutions, every entry
verified=false -- plus temporary manifests built per test.

What must hold:

  - The manifest refuses another domain's documents, paths outside its own
    documents/ directory, unverifiable "verified" claims and edited files.
  - Production retrieval serves verified documents only.
  - A search sees one institution's documents and nothing else -- no other
    institution, no Banking article -- and says when it cannot answer.
  - Banking retrieval is unchanged.
  - Embeddings are reused; only new or edited text is encoded.
  - Unanswered questions are logged without personal data.

Run from language_engine/:

    python -m debugging.test_college_rag
"""

import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

from app.domains import BANKING, COLLEGE
from app.knowledge.collection import KnowledgeCollection, ManifestError, file_sha256
from app.knowledge.domain_retrieval import (
    ANSWERABLE,
    BELOW_THRESHOLD,
    NO_DOCUMENTS,
    UNKNOWN_INSTITUTION,
    DomainKnowledgeBase,
    IsolationError,
)
from app.knowledge.embedding_cache import EmbeddingCache
from app.knowledge.embedding_model import EMBEDDING_MODEL_NAME, get_embedding_model
from app.knowledge.retriever import KnowledgeRetriever
from app.knowledge.unanswered_log import UnansweredLog, redact

PASSED = []
FAILED = []

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures" / "college_kb"
BANKING_DOCS = HERE.parent / "app" / "knowledge" / "documents"
A, B = "test-institute-a", "test-institute-b"


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


class SpyModel:
    """The real encoder, counting every text it is asked to encode."""

    def __init__(self, model):
        self.model = model
        self.encoded = 0

    def encode(self, texts, **kwargs):
        if isinstance(texts, (list, tuple)):
            self.encoded += len(texts)
        return self.model.encode(texts, **kwargs)


MODEL = None


def model():
    global MODEL
    if MODEL is None:
        MODEL = get_embedding_model()
    return MODEL


def fixture_base(tmp, *, include_unverified=True, spy=None, log=None, manifest=None):
    return DomainKnowledgeBase(
        "college", manifest or FIXTURES / "manifest.json", min_score=COLLEGE.knowledge.min_score,
        include_unverified=include_unverified, model=spy or model(), cache_dir=Path(tmp) / "cache",
        unanswered_log=log or UnansweredLog(Path(tmp) / "log"),
    )


def collection_with(tmp, entries, files, domain="college"):
    """A temporary collection: {relative path: text} and manifest entries."""
    root = Path(tmp) / "collection"
    for relative, text in files.items():
        target = root / "documents" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps({"domain": domain, "documents": entries}), encoding="utf-8")
    return root / "manifest.json"


def entry(**overrides):
    base = dict(id="doc-1", path="inst-a/doc.md", domain="college", institution_id="inst-a",
                category="fees", document_type="official_notice", title="T", source="verified_institution_document",
                source_reference="circular 1", version="2026-27", verified=False)
    base.update(overrides)
    return base


def problems(tmp, entries, files=None, domain="college"):
    files = files if files is not None else {"inst-a/doc.md": "# T\n\n## S\n\nText."}
    try:
        KnowledgeCollection(collection_with(tmp, entries, files, domain), "college")
    except ManifestError as error:
        return error.problems
    return []


# =========================================================
# MANIFEST VALIDATION
# =========================================================

def test_manifest_refuses_cross_domain_and_escaping_entries():
    with tempfile.TemporaryDirectory() as tmp:
        check("a valid unverified entry loads", problems(tmp, [entry()]) == [])
    with tempfile.TemporaryDirectory() as tmp:
        check("an entry of another domain is refused",
              any("belongs to domain" in p for p in problems(tmp, [entry(domain="banking")])))
    with tempfile.TemporaryDirectory() as tmp:
        check("a manifest of another domain is refused",
              any("manifest domain" in p for p in problems(tmp, [entry()], domain="banking")))
    with tempfile.TemporaryDirectory() as tmp:
        escape = "../../../../app/knowledge/documents/loan.md"
        check("a path reaching Banking's documents is refused",
              any("path" in p for p in problems(tmp, [entry(path=escape)])))
    with tempfile.TemporaryDirectory() as tmp:
        absolute = str((BANKING_DOCS / "loan.md").resolve())
        check("an absolute path is refused", any("path" in p for p in problems(tmp, [entry(path=absolute)])))
    with tempfile.TemporaryDirectory() as tmp:
        check("a non-markdown path is refused",
              any("path" in p for p in problems(tmp, [entry(path="inst-a/doc.txt")], {"inst-a/doc.txt": "x"})))
    with tempfile.TemporaryDirectory() as tmp:
        check("a missing file is refused", any("not found" in p for p in problems(tmp, [entry(path="inst-a/none.md")])))
    with tempfile.TemporaryDirectory() as tmp:
        check("unknown category refused", any("category" in p for p in problems(tmp, [entry(category="gossip")])))
    with tempfile.TemporaryDirectory() as tmp:
        check("duplicate ids refused", any("duplicate" in p for p in problems(tmp, [entry(), entry()])))
    with tempfile.TemporaryDirectory() as tmp:
        check("every problem is reported at once",
              len(problems(tmp, [entry(category="x", document_type="y", institution_id="BAD ID")])) >= 3)


def test_manifest_verification_rules():
    text = "# T\n\n## S\n\nOfficial text."
    with tempfile.TemporaryDirectory() as tmp:
        found = problems(tmp, [entry(verified=True, source_reference=None)], {"inst-a/doc.md": text})
        check("verified without provenance is refused",
              all(any(word in p for p in found) for word in ("source_reference", "verified_by", "verified_on", "sha256")),
              str(found))
    with tempfile.TemporaryDirectory() as tmp:
        found = problems(tmp, [entry(verified=True, verified_by="Registrar", verified_on="2026-11-01",
                                     sha256="0" * 64)], {"inst-a/doc.md": text})
        check("verified with a stale sha256 (file edited) is refused",
              any("changed since it was verified" in p for p in found), str(found))
    with tempfile.TemporaryDirectory() as tmp:
        manifest = collection_with(tmp, [], {"inst-a/doc.md": text})
        digest = file_sha256(manifest.parent / "documents" / "inst-a" / "doc.md")
        found = problems(tmp, [entry(verified=True, verified_by="Registrar", verified_on="2026-11-01",
                                     sha256=digest)], {"inst-a/doc.md": text})
        check("verified with full provenance and matching sha256 loads", found == [], str(found))
    with tempfile.TemporaryDirectory() as tmp:
        found = problems(tmp, [entry(document_type="synthetic_fixture", source="synthetic_test_fixture",
                                     verified=True, verified_by="x", verified_on="2026-11-01")])
        check("a synthetic fixture can never be verified", any("never be verified" in p for p in found), str(found))
    with tempfile.TemporaryDirectory() as tmp:
        found = problems(tmp, [entry(document_type="synthetic_fixture")])
        check("a synthetic document must say so in its source too", any("synthetic" in p for p in found), str(found))
    with tempfile.TemporaryDirectory() as tmp:
        found = problems(tmp, [entry(verified="yes")])
        check("verified must be a boolean", any("true or false" in p for p in found), str(found))


def test_fixture_and_production_manifests():
    fixtures = KnowledgeCollection(FIXTURES / "manifest.json", "college")
    check("fixture manifest is valid", len(fixtures.documents) == 11)
    check("every fixture is unverified and synthetic",
          all(not d.verified and d.document_type == "synthetic_fixture" for d in fixtures.documents))
    check("fixtures cover two fictional institutions", fixtures.institutions() == [A, B])
    check("every fixture file carries the synthetic banner",
          all("SYNTHETIC TEST FIXTURE" in d.content for d in fixtures.documents))
    check("no fixture names a real institution",
          all("nmamit" not in d.content.lower() and "nitte" not in d.content.lower() for d in fixtures.documents))

    production = KnowledgeCollection(COLLEGE.knowledge.manifest, "college")
    check("production College collection is valid", production is not None)
    check("production College collection is empty until official documents arrive",
          production.documents == [])
    check("production collection lives outside Banking's documents",
          BANKING_DOCS.resolve() not in COLLEGE.knowledge.manifest.resolve().parents)
    check("Banking keeps its built-in knowledge base", BANKING.knowledge is None)


# =========================================================
# VERIFIED-ONLY PRODUCTION RETRIEVAL
# =========================================================

def test_production_retrieval_uses_verified_documents_only():
    with tempfile.TemporaryDirectory() as tmp:
        base = fixture_base(tmp, include_unverified=False)
        outcome = base.retrieve("What documents are required for admission?", A)
        check("unverified fixtures are not served by default", not outcome.answerable)
        check("reason: no documents", outcome.reason == NO_DOCUMENTS, outcome.reason)
        check("nothing returned", outcome.results == [])

    with tempfile.TemporaryDirectory() as tmp:
        base = DomainKnowledgeBase.for_domain(COLLEGE, model=model(), cache_dir=Path(tmp) / "c",
                                              unanswered_log=UnansweredLog(Path(tmp) / "log"))
        outcome = base.retrieve("What documents are required for admission?", "nmamit")
        check("production College KB answers nothing yet", not outcome.answerable and outcome.reason == NO_DOCUMENTS)
        check("production KB defaults to verified only", base.include_unverified is False)
        check("production min_score comes from the domain config", base.min_score == COLLEGE.knowledge.min_score)


# =========================================================
# RETRIEVAL, ATTRIBUTION, ANSWERABILITY
# =========================================================

QUESTIONS = [
    ("What documents are required for admission?", "a-admission-documents"),
    ("Which certificates should I bring when I join?", "a-admission-documents"),
    ("How much is the tuition fee?", "a-fees"),
    ("Is there a hostel for girls?", "a-hostel"),
    ("Are there college buses from the city?", "a-transport"),
    ("Where is the admission office?", "a-contacts"),
    ("When does the semester start?", "a-academic-calendar"),
    ("What is the admission process?", "a-admission-process"),
    ("ಪ್ರವೇಶಕ್ಕೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು", "a-admission-documents"),
    ("ಶುಲ್ಕ ಎಷ್ಟು", "a-fees"),
    ("ಕಾಲೇಜು ಬಸ್ ಇದೆಯೇ", "a-transport"),
]


def test_college_questions_retrieve_the_right_source():
    with tempfile.TemporaryDirectory() as tmp:
        base = fixture_base(tmp)
        latencies = []
        for question, expected in QUESTIONS:
            outcome = base.retrieve(question, A)
            latencies.append(outcome.latency_ms)
            top = outcome.results[0]["source"] if outcome.results else None
            check(f"{question!r} -> {expected}", outcome.answerable and top == expected,
                  f"{outcome.reason} top={top} score={outcome.top_score}")

        outcome = base.retrieve("What documents are required for admission?", A)
        sources = outcome.sources()
        check("results carry source attribution", sources and sources[0]["id"] == "a-admission-documents")
        check("attribution says the source is unverified and synthetic",
              sources[0]["verified"] is False and sources[0]["document_type"] == "synthetic_fixture")
        check("attribution carries institution and category",
              sources[0]["institution_id"] == A and sources[0]["category"] == "admission_documents")
        check("top_k respected", len(outcome.results) <= base.top_k)

        average = sum(latencies) / len(latencies)
        print(f"        retrieval latency: mean {average:.1f} ms, max {max(latencies):.1f} ms "
              f"over {len(latencies)} questions (retriever already built)")
        check("retrieval latency under 1 s per question", max(latencies) < 1000, f"{max(latencies):.0f} ms")


def test_unanswerable_questions_are_refused_not_guessed():
    with tempfile.TemporaryDirectory() as tmp:
        base = fixture_base(tmp)
        for question in ("How do I open a savings account?", "What is the interest rate on a loan?",
                         "How do I deposit money?", "What is the capital of France?",
                         "Who won the cricket match yesterday?"):
            outcome = base.retrieve(question, A)
            check(f"off-domain {question!r} is not answerable",
                  not outcome.answerable and outcome.reason == BELOW_THRESHOLD and outcome.results == [],
                  f"{outcome.reason} {outcome.top_score}")

        outcome = base.retrieve("When are the semester examinations?", A, category="examinations")
        check("a near-topic question narrowed to its category with no document is not answerable",
              not outcome.answerable and outcome.reason == NO_DOCUMENTS)
        outcome = base.retrieve("How much is the tuition fee?", A, category="fees")
        check("a question narrowed to a category with documents is answerable",
              outcome.answerable and outcome.results[0]["source"] == "a-fees")

        check("no institution -> not answerable",
              base.retrieve("fees?", None).reason == UNKNOWN_INSTITUTION)
        check("unknown institution -> not answerable",
              base.retrieve("fees?", "unknown-college").reason == NO_DOCUMENTS)


# =========================================================
# ISOLATION
# =========================================================

def test_institutions_are_isolated():
    with tempfile.TemporaryDirectory() as tmp:
        base = fixture_base(tmp)
        for question in ("What documents are required for admission?", "How much is the tuition fee?",
                         "Tell me about the hostel", "Are there college buses from the city?"):
            outcome = base.retrieve(question, B)
            leaked = [r["source"] for r in outcome.results if not r["source"].startswith("b-")]
            text = " ".join(r["content"] for r in outcome.results)
            check(f"B {question!r}: only B's documents", not leaked and "ALPHA" not in text, str(leaked))

            outcome = base.retrieve(question, A)
            text = " ".join(r["content"] for r in outcome.results)
            check(f"A {question!r}: none of B's documents",
                  all(r["source"].startswith("a-") for r in outcome.results) and "BETA" not in text)

        fee = base.retrieve("How much is the tuition fee?", B)
        check("B's fee question is answered from B's fee document",
              fee.answerable and "BETA-FEE" in fee.results[0]["content"])

        retriever_a, retriever_b = base.retriever_for(A), base.retriever_for(B)
        check("each institution has its own retriever", retriever_a is not retriever_b)
        check("B's retriever was never given A's text", all(s.startswith("b-") for s in retriever_b.sources))
        check("A's retriever was never given B's text", all(s.startswith("a-") for s in retriever_a.sources))


def test_college_and_banking_retrieval_are_isolated():
    banking_files = sorted(p.name for p in BANKING_DOCS.glob("*.md"))

    with tempfile.TemporaryDirectory() as tmp:
        base = fixture_base(tmp)
        college_sources = set()
        for question in ("How do I open a savings account?", "What documents do I need for a loan?",
                         "How do I fill a withdrawal slip?", "What documents are required for admission?"):
            ranked = base.retriever_for(A).search(question, top_k=50)
            college_sources.update(r["source"] for r in ranked)
        check("College retrieval never returns a Banking article", not (college_sources & set(banking_files)))
        check("College retrieval returns only fixture ids", all(s.startswith(("a-", "b-")) for s in college_sources))

    banking = KnowledgeRetriever()
    check("Banking retriever loads exactly its 15 articles", sorted(banking.sources) == banking_files
          and len(banking_files) == 15, str(banking.sources))
    results = banking.search("What documents are required for admission to the college?", top_k=15)
    check("Banking retrieval never returns College documents",
          all(r["source"] in banking_files for r in results))
    check("Banking results keep their original shape (no metadata key)",
          all(set(r) == {"source", "content", "score", "section", "query"} for r in results))
    check("Banking retriever still expands queries (unchanged default)", banking.expand_queries is True)


def test_isolation_guard_rejects_a_crossing_result():
    with tempfile.TemporaryDirectory() as tmp:
        base = fixture_base(tmp)

        class Tampered:
            sources = ["x"]

            def search(self, query, top_k=2):
                return [{"source": "b-fees", "content": "", "score": 0.9, "section": "", "query": "question",
                         "metadata": {"domain": "college", "institution_id": B, "verified": False}}]

        base._retrievers[A] = Tampered()
        try:
            base.retrieve("fees", A)
            raised = False
        except IsolationError:
            raised = True
        check("a result from another institution raises IsolationError", raised)

        class OtherDomain(Tampered):
            def search(self, query, top_k=2):
                return [{"source": "loan.md", "content": "", "score": 0.9, "section": "", "query": "question",
                         "metadata": {"domain": "banking", "institution_id": A, "verified": True}}]

        base._retrievers[A] = OtherDomain()
        try:
            base.retrieve("loan", A)
            raised = False
        except IsolationError:
            raised = True
        check("a result from another domain raises IsolationError", raised)


def test_institution_view_keeps_the_retriever_contract():
    with tempfile.TemporaryDirectory() as tmp:
        view = fixture_base(tmp).for_institution(A)
        results = view.search("What is the fee structure?", top_k=2)
        check("search returns a list of result dicts", isinstance(results, list) and results
              and {"source", "content", "score", "section", "query", "metadata"} <= set(results[0]))
        check("an unanswerable question returns []", view.search("What is the capital of France?") == [])
        check("the last outcome explains why", view.last_outcome.reason == BELOW_THRESHOLD)


# =========================================================
# EMBEDDING CACHE / INCREMENTAL INGESTION
# =========================================================

def test_embeddings_are_reused_and_only_changes_are_encoded():
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "kb"
        shutil.copytree(FIXTURES, copy)
        manifest = copy / "manifest.json"

        spy = SpyModel(model())
        first = fixture_base(tmp, spy=spy, manifest=manifest)
        first.retriever_for(A)
        built = spy.encoded
        check("first build encodes every article and section", built > 8, str(built))

        spy.encoded = 0
        second = fixture_base(tmp, spy=spy, manifest=manifest)
        second.retriever_for(A)
        check("a restart re-encodes nothing", spy.encoded == 0, str(spy.encoded))
        check("cache reports everything reused", second.cache_for(A).total_reused == built)

        q = "How much is the tuition fee?"
        cached = second.retrieve(q, A).results[0]["score"]
        fresh = KnowledgeRetriever(model=model(), documents=[d.as_retriever_document() for d in second.documents_for(A)],
                                   expand_queries=False).search(q, top_k=1)[0]["score"]
        check("cached vectors give the same scores as fresh ones", abs(cached - fresh) < 1e-5, f"{cached} vs {fresh}")

        # Add one document: only its text is encoded.
        new = copy / "documents" / A / "scholarships.md"
        new.write_text("# Scholarships at Test Institute A\n\n> SYNTHETIC TEST FIXTURE.\n\n"
                       "## Merit Scholarship\n\nA fictional merit scholarship. Fixture code: ALPHA-SCH.\n",
                       encoding="utf-8")
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["documents"].append(dict(data["documents"][0], id="a-scholarships", path=f"{A}/scholarships.md",
                                      category="scholarships", title="Scholarships at Test Institute A"))
        manifest.write_text(json.dumps(data), encoding="utf-8")

        spy.encoded = 0
        third = fixture_base(tmp, spy=spy, manifest=manifest)
        third.retriever_for(A)
        check("adding one document encodes only that document (1 article + its sections)",
              0 < spy.encoded <= 3, str(spy.encoded))
        check("the new document is retrievable",
              third.retrieve("Is there a merit scholarship?", A).results[0]["source"] == "a-scholarships")

        # Edit one document: only it is re-encoded; its old vectors are pruned.
        before = len(np.load(third.cache_for(A).path)["keys"])
        fees = copy / "documents" / A / "fees.md"
        fees.write_text(fees.read_text(encoding="utf-8").replace("11111", "33333"), encoding="utf-8")
        spy.encoded = 0
        fourth = fixture_base(tmp, spy=spy, manifest=manifest)
        fourth.retriever_for(A)
        after = len(np.load(fourth.cache_for(A).path)["keys"])
        check("editing one document re-encodes only its changed text", 0 < spy.encoded <= 3, str(spy.encoded))
        check("stale vectors of the edited text are pruned", after == before, f"{before} -> {after}")


def test_cache_ignores_vectors_from_another_model():
    with tempfile.TemporaryDirectory() as tmp:
        spy = SpyModel(model())
        cache = EmbeddingCache(spy, EMBEDDING_MODEL_NAME, "c", Path(tmp))
        cache.encode(["alpha", "beta"])
        other = EmbeddingCache(spy, "some-other-model", "c", Path(tmp))
        spy.encoded = 0
        other.encode(["alpha"])
        check("a cache written by another model is not reused", spy.encoded == 1)
        check("cache file name is sanitised", EmbeddingCache(spy, "m", "../../evil", Path(tmp)).path.parent == Path(tmp))


# =========================================================
# UNANSWERED LOG
# =========================================================

def test_unanswered_questions_are_logged_without_personal_data():
    check("emails are redacted", "[email]" in redact("mail me at student.one@example.com") and "@" not in redact("a@b.co"))
    check("reference numbers are redacted", "123456" not in redact("my NUCAT ref 123456 please"))
    check("phone numbers are redacted", "98450" not in redact("call 98450 12345"))
    check("long text is truncated", len(redact("x " * 500)) <= 200)

    with tempfile.TemporaryDirectory() as tmp:
        log = UnansweredLog(Path(tmp) / "log")
        base = fixture_base(tmp, log=log)
        base.retrieve("What is the capital of France? my email is someone@example.com, ref 99887766", A)
        base.retrieve("When are exams?", A, category="examinations")
        base.retrieve("What documents are required for admission?", A)  # answerable: not logged

        lines = log.path_for("college").read_text(encoding="utf-8").splitlines()
        records = [json.loads(line) for line in lines]
        check("each unanswerable question is logged once", len(records) == 2, str(len(records)))
        check("answerable questions are not logged",
              not any("documents are required" in r["question_redacted"] for r in records))
        raw = "\n".join(lines)
        check("no raw email or reference number in the log", "someone@example.com" not in raw and "99887766" not in raw)
        check("records carry domain, institution, reason and category",
              records[1]["domain"] == "college" and records[1]["institution_id"] == A
              and records[1]["reason"] == NO_DOCUMENTS and records[1]["category"] == "examinations")
        check("records carry a question hash for counting repeats", len(records[0]["question_sha256"]) == 64)
        check("no session or user identifiers are recorded",
              not any(k in records[0] for k in ("session_id", "user_id", "student_id", "ip")))

    with tempfile.TemporaryDirectory() as tmp:
        disabled = UnansweredLog(Path(tmp) / "log", enabled=False)
        disabled.record(domain="college", institution_id=A, question="q", reason="x")
        check("a disabled log writes nothing", not disabled.path_for("college").exists())


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("COLLEGE KNOWLEDGE COLLECTION TESTS (Phase 3)")
    print("=" * 60)

    started = time.perf_counter()
    for test in tests:
        print(f"\n{test.__name__}")
        test()

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}   ({time.perf_counter() - started:.0f} s)")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
