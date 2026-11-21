"""
PHASE 3A -- KNOWLEDGE RELIABILITY

Regression tests for:

  app/knowledge/loader.py            provenance, freshness, unlisted articles
  app/knowledge/retriever.py         expiry at query time, refresh without stale chunks
  app/knowledge/fast_path.py         no FAQ answer from an expired article
  app/knowledge/answerability.py     account-specific / dynamic / clarify
  dialogue_understanding.answer_question   the answerability hook
  app/knowledge/answer_validation.py invented times and durations
  app/knowledge/gaps.py              grouping, resolution, persistence, redaction
  service/engine.py                  refresh_knowledge swaps everything together
  service/main.py                    maintenance endpoints fail closed
  localization                       new fixed replies, explicit fallback
  multilingual knowledge             Kannada/Hindi retrieval, language passed on
  interpreter                        still isolated from banking routing

WHAT THESE TESTS DO NOT SHOW

Every LLM is a recording fake (see test_phase2_knowledge): these tests prove
what the engine decides and what the model is sent, not what a live model
writes. Passing the Kannada and Hindi checks shows that a fixed reply is
rendered from the catalog and that the model is ASKED for the session
language -- not that the renderings or the model's Kannada/Hindi are good.
The catalog is unreviewed (localization_catalog.REVIEW_STATUS).

Run from language_engine/:

    python -m debugging.test_phase3a_knowledge
"""

import ast
import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from debugging.test_phase2_knowledge import (
    DOMAIN, FixedRetriever, HashModel, conversation, manager, quiet, real_retriever, understanding,
)
from app.dialogue.localization import FixedReply, localize_detailed
from app.dialogue.localization_catalog import REVIEW_STATUS
from app.knowledge.answer_cache import AnswerCache
from app.knowledge.answer_validation import UNGROUNDED_FIGURE, validate_answer
from app.knowledge.answerability import (
    ACCOUNT_SPECIFIC, CLARIFY, DYNAMIC, AnswerabilityPolicy, for_domain, subject_words,
)
from app.knowledge.fast_path import FastPathAnswerer
from app.knowledge.gaps import DYNAMIC_INFORMATION, NOT_IN_KNOWLEDGE, GapLog, read_log, redact
from app.knowledge.loader import (
    EXPIRED, NOT_IN_MANIFEST, NOT_YET_EFFECTIVE, UNVERIFIED_TIME_SENSITIVE, KnowledgeLoader, is_current,
)
from app.knowledge.retriever import KnowledgeRetriever
from app.knowledge.structured import StructuredKnowledge

PASSED = []
FAILED = []

ROOT = Path(__file__).resolve().parent.parent
TODAY = date(2026, 10, 25)
RESTING = "No banking workflow is currently active. Answer general banking questions helpfully."
POLICY = for_domain(DOMAIN, KnowledgeLoader().load_documents())


def check(name, condition, detail=""):
    (PASSED if condition else FAILED).append(name)
    print(f"  {'PASS' if condition else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not condition else ""))


def collection(folder, articles, manifest):
    folder = Path(folder)
    for name, content in articles.items():
        (folder / name).write_text(content, encoding="utf-8")
    (folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return folder


# =========================================================
# 1  PROVENANCE AND FRESHNESS IN THE LOADER
# =========================================================

def test_loader_provenance():
    print("\n1  provenance and freshness")
    with tempfile.TemporaryDirectory() as folder:
        collection(folder, {
            "plain.md": "# Plain\n\n## Purpose\nGeneral text.",
            "rate_ok.md": "# Rate\n\n## Purpose\nThe rate is 7 percent.",
            "rate_unverified.md": "# Rate U\n\n## Purpose\nThe rate is 8 percent.",
            "rate_no_review.md": "# Rate R\n\n## Purpose\nThe rate is 9 percent.",
            "expired.md": "# Old\n\n## Purpose\nOld figure 5 percent.",
            "future.md": "# New\n\n## Purpose\nNew figure 6 percent.",
            "bad_date.md": "# Bad\n\n## Purpose\nBad date.",
            "odd_status.md": "# Odd\n\n## Purpose\nOdd.",
            "unlisted.md": "# Unlisted\n\n## Purpose\nDropped in without review.",
        }, {
            "unlisted": "skip",
            "defaults": {"status": "active"},
            "documents": {
                "plain.md": {"id": "plain-article"},
                "rate_ok.md": {"time_sensitive": True, "verification": "verified", "last_reviewed": "2026-10-01",
                               "effective_until": "2026-12-31", "source_reference": "rate card 2026-10"},
                "rate_unverified.md": {"time_sensitive": True, "last_reviewed": "2026-10-01"},
                "rate_no_review.md": {"time_sensitive": True, "verification": "verified"},
                "expired.md": {"effective_until": "2026-10-24"},
                "future.md": {"effective_date": "2026-10-26"},
                "bad_date.md": {"effective_until": "31/12/2026"},
                "odd_status.md": {"status": "Active"},
                "gone.md": {"topics": ["missing"]},
            },
        })
        loader = KnowledgeLoader(folder, today=TODAY)
        loaded = {d["source"]: d for d in loader.load_documents()}
        reasons = loader.skip_reasons

        check("only the plain and the verified, reviewed, in-date article are indexed",
              sorted(loaded) == ["plain.md", "rate_ok.md"], sorted(loaded))
        check("a manifest id is kept", loaded["plain.md"]["metadata"]["id"] == "plain-article")
        check("the id defaults to the file name", loaded["rate_ok.md"]["metadata"]["id"] == "rate_ok")
        check("verification defaults to unverified", loaded["plain.md"]["metadata"]["verification"] == "unverified")
        check("source_reference is carried", loaded["rate_ok.md"]["metadata"]["source_reference"] == "rate card 2026-10")
        check("a time-sensitive article without verification is skipped",
              reasons.get("rate_unverified.md") == UNVERIFIED_TIME_SENSITIVE, reasons)
        check("a verified time-sensitive article without a review date is skipped",
              reasons.get("rate_no_review.md") == UNVERIFIED_TIME_SENSITIVE, reasons)
        check("an expired article is skipped", reasons.get("expired.md") == EXPIRED)
        check("an article not yet effective is skipped", reasons.get("future.md") == NOT_YET_EFFECTIVE)
        check("an invalid date fails closed and is reported",
              reasons.get("bad_date.md", "").startswith("invalid date")
              and any(p.startswith("bad_date.md") for p in loader.problems), loader.problems)
        check("an unknown status is not indexed and is reported",
              "odd_status.md" in reasons and any("unknown status" in p for p in loader.problems))
        check("an unlisted file is not indexed when the manifest says skip",
              reasons.get("unlisted.md") == NOT_IN_MANIFEST and "unlisted.md" in loader.missing_metadata)
        check("a manifest entry with no file is reported",
              any(p.startswith("gone.md") for p in loader.problems), loader.problems)
        check("skipped stays a list of names (Phase 2 contract)", isinstance(loader.skipped, list)
              and "expired.md" in loader.skipped)

        later = KnowledgeLoader(folder, today=date(2027, 1, 1))
        check("the verified figure stops being served after effective_until",
              "rate_ok.md" not in {d["source"] for d in later.load_documents()})

    with tempfile.TemporaryDirectory() as folder:
        collection(folder, {"a.md": "# A\n\n## P\nA.", "b.md": "# B\n\n## P\nB."},
                   {"defaults": {"status": "active"}, "documents": {"a.md": {}}})
        loader = KnowledgeLoader(folder)
        check("without 'unlisted': 'skip' an unlisted file still loads (Phase 2 behaviour)",
              [d["source"] for d in loader.load_documents()] == ["a.md", "b.md"])
    with tempfile.TemporaryDirectory() as folder:
        (Path(folder) / "a.md").write_text("# A\n\n## P\nA.", encoding="utf-8")
        check("a folder with no manifest loads every article", len(KnowledgeLoader(folder).load_documents()) == 1)


def test_banking_manifest():
    print("\n2  the banking collection's provenance")
    loader = KnowledgeLoader()
    documents = loader.load_documents()
    manifest = loader.manifest()
    check("all 15 articles are indexed", len(documents) == 15, len(documents))
    check("nothing is skipped and nothing is broken", not loader.skip_reasons and not loader.problems,
          (loader.skip_reasons, loader.problems))
    check("unlisted articles are not indexed", manifest.get("unlisted") == "skip")
    check("every article is marked unverified (no one has verified them)",
          all(d["metadata"]["verification"] == "unverified" for d in documents))
    check("no article is time-sensitive (none states a figure)",
          all(not d["metadata"]["time_sensitive"] for d in documents))
    check("no review or effective date is invented",
          all(d["metadata"][k] is None for d in documents
              for k in ("last_reviewed", "effective_date", "effective_until", "source_reference")))
    check("every article has a stable id and a content version",
          all(d["metadata"]["id"] == d["source"][:-3] and len(d["metadata"]["version"]) == 12 for d in documents))
    import re
    check("the articles contain no figures at all (why figure questions cannot be answered)",
          not any(re.search(r"\d", d["content"]) for d in documents))


# =========================================================
# 3  FRESHNESS AT QUERY TIME, AND IN THE FAQ
# =========================================================

def test_query_time_freshness():
    print("\n3  freshness at query time")
    docs = [{"source": "old.md", "content": "# Old\n\n## Purpose\nCheque charges words.",
             "metadata": {"effective_until": "2020-01-01"}},
            {"source": "new.md", "content": "# New\n\n## Purpose\nCheque other words.", "metadata": {}}]
    r = quiet(KnowledgeRetriever, model=HashModel(), documents=docs)
    sources = [x["source"] for x in r.search("cheque charges words", top_k=2)]
    check("an article that expired after indexing is not returned", sources == ["new.md"], sources)
    check("is_current treats missing metadata as current", is_current({}) and is_current(None))

    faq = {"records": [{"id": "x", "source": "old.md", "sections": ["Purpose"], "questions": ["what is x"]}]}
    fast = quiet(FastPathAnswerer, documents=docs)
    fast.structured = StructuredKnowledge(faq=faq, terminology={}, documents=docs)
    check("an FAQ is not answered from an expired article", fast.lookup("what is x", "en") is None)
    docs[0]["metadata"] = {}
    fast.structured.rebuild(docs)
    check("...and is answered once the article is current", fast.lookup("what is x", "en") is not None)


# =========================================================
# 4  REFRESH: NO DUPLICATES, NO STALE CHUNKS, MANIFEST CHANGES
# =========================================================

def test_refresh_reliability():
    print("\n4  refresh from disk")
    with tempfile.TemporaryDirectory() as folder:
        manifest = {"unlisted": "skip", "defaults": {"status": "active"},
                    "documents": {"a.md": {}, "b.md": {}}}
        collection(folder, {"a.md": "# A\n\n## Purpose\nAlpha original sentence.",
                            "b.md": "# B\n\n## Purpose\nBeta sentence."}, manifest)
        model = HashModel()
        r = quiet(KnowledgeRetriever, model=model, loader=KnowledgeLoader(folder))
        version = r.version

        (Path(folder) / "a.md").write_text("# A\n\n## Purpose\nAlpha rewritten sentence.", encoding="utf-8")
        summary = r.refresh()
        texts = [c["text"] for c in r.chunks]
        check("an edited section replaces its old chunk", any("rewritten" in t for t in texts)
              and not any("original" in t for t in texts), texts)
        check("no article or chunk is duplicated", len(r.sources) == len(set(r.sources)) == 2
              and len(texts) == len(set(texts)))
        check("the version changes", summary["version"] != version and summary["updated"] == ["a.md"])

        manifest["documents"]["b.md"] = {"status": "draft"}
        (Path(folder) / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        summary = r.refresh()
        check("an article set back to draft leaves the index with its chunks",
              summary["removed"] == ["b.md"] and not any(c["source"] == "b.md" for c in r.chunks))

        (Path(folder) / "c.md").write_text("# C\n\n## Purpose\nUnreviewed.", encoding="utf-8")
        summary = r.refresh()
        check("a new file not in the manifest is not indexed", "c.md" not in r.sources and not summary["added"])
        check("...and the loader says why", r.loader.skip_reasons.get("c.md") == NOT_IN_MANIFEST)


def test_engine_refresh():
    print("\n5  engine refresh swaps everything together")
    from service.engine import EngineRuntime

    with tempfile.TemporaryDirectory() as folder:
        collection(folder, {"deposit_slip.md": "# Deposit Slip\n\n## Purpose\nA deposit slip pays money in.",
                            "loan_basics.md": "# Loan\n\n## Purpose\nA loan is borrowed money."},
                   {"unlisted": "skip", "defaults": {"status": "active"},
                    "documents": {"deposit_slip.md": {}, "loan_basics.md": {"topics": ["loan"]}}})
        u = understanding()
        u.knowledge_retriever = quiet(KnowledgeRetriever, model=HashModel(), loader=KnowledgeLoader(folder))
        u.answer_cache = AnswerCache()
        u.answer_cache.put("k", "cached answer")
        u.answerability = AnswerabilityPolicy(DOMAIN.answerability, ())
        d = manager()
        d.dialogue_understanding = u
        d.fast_path = quiet(FastPathAnswerer, documents=u.knowledge_retriever.documents)
        runtime = EngineRuntime.__new__(EngineRuntime)
        runtime.dialogue = d

        (Path(folder) / "extra.md").write_text("# Extra\n\nUnreviewed.", encoding="utf-8")
        summary = quiet(runtime.refresh_knowledge)
        check("the answer cache is cleared", len(u.answer_cache) == 0)
        check("answerability is rebuilt from the refreshed articles",
              "loan" in u.answerability.subjects, sorted(u.answerability.subjects)[:10])
        check("the summary says which articles were skipped and why",
              summary.get("skipped") == {"extra.md": NOT_IN_MANIFEST}, summary.get("skipped"))
        check("the summary carries manifest and FAQ problems",
              isinstance(summary.get("problems"), list) and isinstance(summary.get("faq_problems"), list)
              and summary["faq_problems"], summary.get("faq_problems"))


# =========================================================
# 6  MAINTENANCE ENDPOINTS
# =========================================================

def test_maintenance_endpoints():
    print("\n6  maintenance endpoints")
    from fastapi.testclient import TestClient
    import service.main as main

    class Runtime:
        def __init__(self):
            self.log = GapLog(path="")
            self.log.record(question="What is the IFSC code?", outcome=NOT_IN_KNOWLEDGE)
            self.log.record(question="What is the IFSC code?", outcome=NOT_IN_KNOWLEDGE)

        def refresh_knowledge(self):
            return {"version": "v2"}

        def knowledge_gaps(self, limit=100):
            return self.log.recent(limit)

        def knowledge_gap_groups(self, include_resolved=True):
            return self.log.grouped(include_resolved)

        def resolve_knowledge_gap(self, question_hash, resolution, note=""):
            return self.log.resolve(question_hash, resolution, note)

    runtime = Runtime()
    saved = (main.get_runtime, main.INTERNAL_TOKEN)
    main.get_runtime = lambda: runtime
    try:
        client = TestClient(main.app)
        main.INTERNAL_TOKEN = ""
        check("without AI_ENGINE_TOKEN refresh is switched off",
              client.post("/knowledge/refresh").status_code == 503)
        check("...and so is the gap review", client.get("/knowledge/gaps").status_code == 503)

        main.INTERNAL_TOKEN = "secret-for-test"
        check("a wrong token is refused", client.post("/knowledge/refresh",
                                                      headers={"x-internal-token": "nope"}).status_code == 401)
        check("no token is refused", client.get("/knowledge/gaps").status_code == 401)
        ok = {"x-internal-token": "secret-for-test"}
        check("the right token refreshes", client.post("/knowledge/refresh", headers=ok).json() == {"version": "v2"})
        groups = client.get("/knowledge/gaps", params={"grouped": "true"}, headers=ok).json()["groups"]
        check("the grouped view deduplicates repeats", len(groups) == 1 and groups[0]["count"] == 2, groups)
        h = groups[0]["question_hash"]
        bad = client.post(f"/knowledge/gaps/{h}/resolve", params={"resolution": "fixed it"}, headers=ok)
        check("an unknown resolution is a 400", bad.status_code == 400)
        missing = client.post("/knowledge/gaps/ffff/resolve", params={"resolution": "out_of_scope"}, headers=ok)
        check("an unknown question is a 404", missing.status_code == 404)
        done = client.post(f"/knowledge/gaps/{h}/resolve",
                           params={"resolution": "article_added_as_draft", "note": "draft ifsc.md"}, headers=ok)
        check("a resolution is recorded", done.status_code == 200 and done.json()["resolution"] == "article_added_as_draft")
        open_groups = client.get("/knowledge/gaps", params={"grouped": "true", "include_resolved": "false"},
                                 headers=ok).json()["groups"]
        check("resolved groups can be hidden", open_groups == [])
    finally:
        main.get_runtime, main.INTERNAL_TOKEN = saved


# =========================================================
# 7  ANSWERABILITY
# =========================================================

def test_answerability_rules():
    print("\n7  answerability rules")

    def category(text, context=(RESTING, ""), figures=False, recent=False):
        decision = POLICY.assess(text, evidence_has_figures=figures, context_texts=context, has_recent_context=recent)
        return decision.category if decision else None

    for text in ["Has my cheque cleared?", "Is my account active?", "Did my salary get credited?",
                 "What is the status of my loan application?"]:
        check(f"account-specific: {text}", category(text) == ACCOUNT_SPECIFIC)
    for text in ["What happens if my cheque bounces?", "Why should I keep my cheque book safe?",
                 "What happens if I write the wrong account number?"]:
        check(f"a general question is not account-specific: {text}", category(text) != ACCOUNT_SPECIFIC)

    for text in ["What is the interest rate on a home loan?", "What time does the branch close?",
                 "How much does a cheque book cost?", "What is the IFSC code of this branch?",
                 "Is the bank open on Sunday?"]:
        check(f"dynamic: {text}", category(text) == DYNAMIC)
    for text in ["What is an interest rate?", "What does minimum balance mean?", "How is interest on a loan charged?",
                 "What is the difference between NEFT and RTGS?", "What is a branch code?"]:
        check(f"a concept question is not dynamic: {text}", category(text) is None, category(text))
    check("a figure in the evidence lets the model answer",
          category("What is the interest rate on a home loan?", figures=True) is None)

    check("clarify: 'What documents do I need?' at rest", category("What documents do I need?") == CLARIFY)
    check("no clarify when the workflow names the service",
          category("What documents do I need?", context=("Step 1 (current step): Please take a withdrawal slip.",
                                                         "Please take a withdrawal slip.")) is None)
    check("no clarify when a side question was just asked", category("What documents do I need?", recent=True) is None)
    check("no clarify when the question names the service",
          category("What documents do I need to open a savings account?") is None)
    check("no clarify for a service named in romanised Hindi",
          category("naye khate ke liye kaun se documents chahiye") is None)
    check("no clarify for an unrelated question", category("What is the capital of France?") is None)

    check("Kannada 'how much ... rate' is dynamic", category("ಗೃಹ ಸಾಲದ ಬಡ್ಡಿ ದರ ಎಷ್ಟು") == DYNAMIC)
    check("Hindi 'at what time' is dynamic", category("शाखा कितने बजे बंद होती है") == DYNAMIC)
    check("a Kannada concept question is not dynamic", category("ಬಡ್ಡಿ ದರ ಎಂದರೇನು") is None)
    check("a Hindi concept question is not dynamic", category("ब्याज दर क्या होती है") is None)

    check("subject words come from article topics and terminology",
          {"loan", "deposit", "neft"} <= subject_words(KnowledgeLoader().load_documents(), DOMAIN.terminology()))
    check("an empty config decides nothing", AnswerabilityPolicy({}, ()).assess("What time is it?") is None)


def test_answer_question_hook():
    print("\n8  answer_question uses answerability")
    u = understanding(answer="MODEL")
    u.answerability = POLICY

    reply = quiet(u.answer_question, "What is the interest rate on a home loan?", RESTING, "")
    check("a figure question gets the fixed reply without an LLM call",
          isinstance(reply, FixedReply) and reply == DOMAIN.replies["dynamic_information"] and not u.client.requests)
    check("...and is recorded as a gap", [e["outcome"] for e in u.gap_log.recent()] == [DYNAMIC_INFORMATION])

    reply = quiet(u.answer_question, "Has my cheque cleared?", RESTING, "")
    check("an account-state question gets the no-access reply, no LLM call",
          reply == DOMAIN.replies["no_access"] and not u.client.requests)
    reply = quiet(u.answer_question, "What documents do I need?", RESTING, "")
    check("an underspecified question asks which service",
          reply == DOMAIN.replies["clarify_service"] and not u.client.requests)
    reply = quiet(u.answer_question, "What is a deposit slip used for?", RESTING, "")
    check("an answerable question still goes to the model", reply == "MODEL" and len(u.client.requests) == 1)

    legacy = understanding(answer="MODEL")
    reply = quiet(legacy.answer_question, "What is the interest rate on a home loan?", RESTING, "")
    check("an instance without answerability behaves as before", reply == "MODEL" and legacy.client.requests)

    article = {"source": "rates.md", "score": 0.8, "content": "# Rates\n\n## Home loan\nThe home loan rate is 8.5%."}
    u = understanding(answer="The home loan rate is 8.5%.", results=[article])
    u.answerability = POLICY
    reply = quiet(u.answer_question, "What is the interest rate on a home loan?", RESTING, "")
    check("a verified figure in the evidence is answered by the model and kept",
          reply == "The home loan rate is 8.5%." and u.client.requests)


def test_workflow_unchanged():
    print("\n9  mid-workflow")
    from debugging.test_phase2_knowledge import RecordingUnderstanding

    class Hooked(RecordingUnderstanding):
        def __init__(self):
            super().__init__()
            self.real = understanding(answer="MODEL")
            self.real.answerability = POLICY

        def answer_question(self, question, workflow_context, current_instruction,
                            recent_context=None, response_language=None):
            self.answered.append(question)
            return self.real.answer_question(question, workflow_context, current_instruction,
                                             recent_context=recent_context, response_language=response_language)

    d = manager()
    d.dialogue_understanding = Hooked()
    c = conversation("kn")
    quiet(d.start_workflow, c, "deposit money")
    step, state = c.current_step, c.workflow_state
    reply = quiet(d.generate_response, c, "What time does the branch close?")
    check("a figure question mid-workflow gets the fixed reply", str(reply).startswith(DOMAIN.replies["dynamic_information"]),
          reply)
    check("...the workflow does not move", c.current_step == step and c.workflow_state == state)
    check("...and the reply renders fully in Kannada", localize_detailed(reply, "kn")[1] == "translated",
          localize_detailed(reply, "kn"))
    reply = quiet(d.generate_response, c, "What documents do I need?")
    check("mid-workflow the workflow names the service, so no clarification",
          not str(reply).startswith("Which service"), reply)


# =========================================================
# 10  OUTPUT CHECKS: TIMES AND DURATIONS
# =========================================================

def test_validation_times():
    print("\n10  invented times and durations")
    replies = DOMAIN.replies
    for answer in ["The branch opens at 10 am.", "It closes at 4:30 pm.", "NEFT completes within 2 hours.",
                   "Approval takes 7 working days."]:
        result = validate_answer(answer, evidence="No figures here.", replies=replies)
        check(f"replaced: {answer}", not result.ok and result.issue == UNGROUNDED_FIGURE)
    for answer, evidence in [("Step 2 asks for your account number.", ""),
                             ("An EMI is usually paid every month.", ""),
                             ("Clearing takes 3 working days.", "Clearing takes 3 working days.")]:
        check(f"kept: {answer}", validate_answer(answer, evidence=evidence, replies=replies).ok)


# =========================================================
# 11  GAPS: DEDUP, RESOLUTION, PERSISTENCE, REDACTION
# =========================================================

def test_gaps():
    print("\n11  knowledge gaps")
    check("a name after 'my name is' is redacted", redact("My name is Ravi Kumar, what is IFSC?").startswith("My name is <name>"))
    check("a Hindi name is redacted", redact("मेरा नाम राम है") == "मेरा नाम <name> है")
    check("a Kannada name is redacted", redact("ನನ್ನ ಹೆಸರು ರವಿ") == "ನನ್ನ ಹೆಸರು <name>")
    check("'my name on the account' is not mangled", redact("what is my name on the account") == "what is my name on the account")

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "gaps.jsonl"
        log = GapLog(path=str(path))
        for _ in range(3):
            log.record(question="What is the IFSC code?", outcome=NOT_IN_KNOWLEDGE, language="en")
        log.record(question="What is a demand draft?", outcome=NOT_IN_KNOWLEDGE, language="hi")
        groups = log.grouped()
        check("repeats are grouped with a count", [g["count"] for g in groups] == [3, 1], groups)
        check("every group starts open", all(g["status"] == "open" for g in groups))

        h = groups[0]["question_hash"]
        try:
            log.resolve(h, "made up")
            check("an unknown resolution is refused", False)
        except ValueError:
            check("an unknown resolution is refused", True)
        try:
            log.resolve("0000", "out_of_scope")
            check("an unknown question is refused", False)
        except KeyError:
            check("an unknown question is refused", True)
        event = log.resolve(h, "article_added_as_draft", note="drafted ifsc.md, call 98450 12345")
        check("a note is redacted too", "#" in event["note"] and "98450" not in event["note"])
        check("the group is resolved", log.grouped()[0]["status"] == "resolved")
        check("resolved groups can be left out", [g["question_hash"] for g in log.grouped(include_resolved=False)] != [h])

        reloaded = GapLog(path=str(path))
        check("records and resolutions survive a restart",
              len(reloaded.recent(1000)) == 4 and reloaded.grouped()[0]["status"] == "resolved")

        # Asked again after the resolution: reopened.
        reloaded._resolutions[h] = {**reloaded._resolutions[h], "time": "2000-01-01T00:00:00Z"}
        reloaded.record(question="What is the IFSC code?", outcome=NOT_IN_KNOWLEDGE)
        check("a question asked again after its resolution is reopened",
              next(g for g in reloaded.grouped() if g["question_hash"] == h)["status"] == "reopened")

        with path.open("a", encoding="utf-8") as handle:
            handle.write('{"torn": ')
        records, resolutions = read_log(path)
        check("a torn last line is skipped, not fatal", len(records) == 5 and h in resolutions)

    from app.knowledge import gaps
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "g.jsonl"
        GapLog(path=str(path)).record(question="What is a fixed deposit?", outcome=NOT_IN_KNOWLEDGE)
        h = read_log(path)[0][0]["question_hash"]
        out = Path(folder) / "report.md"
        quiet(gaps.main, ["resolve", str(path), h, "out_of_scope"])
        quiet(gaps.main, ["summarize", str(path), "--out", str(out)])
        check("the CLI resolves and the export shows the status",
              "resolved: out_of_scope" in out.read_text(encoding="utf-8"))


# =========================================================
# 12  LOCALIZATION AND MULTILINGUAL KNOWLEDGE
# =========================================================

def test_localization():
    print("\n12  fixed replies in Kannada and Hindi")
    for key, text in DOMAIN.replies.items():
        for language in ("kn", "hi"):
            check(f"domain reply '{key}' renders fully in {language}",
                  localize_detailed(FixedReply(text), language)[1] == "translated")
    rendered, status = localize_detailed(FixedReply("This sentence has no catalog entry."), "kn")
    check("a fixed sentence with no rendering is marked, not passed off as Kannada",
          status == "fallback" and rendered != "This sentence has no catalog entry."
          and "This sentence has no catalog entry." in rendered)
    check("the catalog still says it is unreviewed", REVIEW_STATUS == "unreviewed")


def test_multilingual_knowledge():
    print("\n13  Kannada and Hindi knowledge questions")
    r = real_retriever()
    from app.dialogue.text_normalization import normalize_turn
    for text, expected in [("ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು", {"deposit_slip.md", "deposit.md"}),
                           ("ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು", {"savings_account.md"}),
                           ("पासबुक क्या होती है", {"passbook.md"}),
                           ("निकासी पर्ची पर हस्ताक्षर क्यों करना होता है", {"withdrawal_slip.md", "withdrawal.md"})]:
        sources = [x["source"] for x in r.search(normalize_turn(text).routing, top_k=2)]
        check(f"retrieves the right article: {text}", bool(expected & set(sources)), sources)

    class LanguageRecorder:
        def __init__(self):
            self.languages = []

        def understand(self, *args, **kwargs):
            return {"type": "question", "action": "explain", "step_completed": False,
                    "target_workflow": None, "entities": {}}

        def answer_question(self, question, workflow_context, current_instruction,
                            recent_context=None, response_language=None):
            self.languages.append(response_language)
            return "MODEL"

    d = manager()
    d.dialogue_understanding = LanguageRecorder()
    quiet(d.answer_general_question, "ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು", conversation("kn"))
    quiet(d.answer_general_question, "पासबुक क्या होती है", conversation("hi"))
    quiet(d.answer_general_question, "What is a deposit slip?", conversation("kn"))
    check("Kannada and Hindi questions are answered in the session language",
          d.dialogue_understanding.languages == ["kn", "hi", "kn"], d.dialogue_understanding.languages)


def test_spelling_does_not_misfire():
    print("\n14  spelling and terminology")
    fast = quiet(FastPathAnswerer)
    for text in ["Is spelling important on a cheque?", "How do I spell out the amount in words on a cheque?",
                 "What is the spelling of my name on the account?", "Can you check my balance?",
                 "spell it again"]:
        found = fast.lookup(text, "en")
        check(f"not a spelling answer: {text}", found is None or found.kind not in ("spelling",), found)
    for text, word in [("how do you spell withdrawl", "Withdrawal"), ("spelling of cheque book", "Cheque book"),
                       ("how do you spell kyc", "KYC")]:
        found = fast.lookup(text, "en")
        check(f"terminology variant answered: {text}", found is not None and found.reply.startswith(word),
              found and found.reply)
    found = fast.lookup("withdrawal ki spelling kya hai", "hi")
    check("a romanised Hindi spelling request is answered language-neutrally",
          found is not None and found.language_neutral and found.reply.startswith("withdrawal:"))
    check("'check' asks which word is meant", fast.lookup("spell check", "en").kind == "spelling_clarify")
    check("...but only in English sessions", fast.lookup("spell check", "kn") is None)


# =========================================================
# 15  INTERPRETER ISOLATION
# =========================================================

def test_interpreter_isolated():
    print("\n15  interpreter isolation")
    for relative in ("service/interpreter.py", "app/translation/interpreter_translator.py"):
        tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"))
        imported = {getattr(node, "module", None) or alias.name
                    for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))
                    for alias in node.names}
        check(f"{relative} imports nothing from routing, intent, knowledge or policy",
              not any(name and name.startswith(("app.dialogue", "app.intent", "app.knowledge", "app.policy",
                                                 "app.domains"))
                      for name in imported), imported)


# =========================================================
# 16  OFFLINE LOADING OF THE EMBEDDING MODEL
# =========================================================

def test_embedding_model_loads_locally():
    print("\n16  embedding model loads from the local cache first")
    import app.knowledge.embedding_model as embedding

    calls = []

    class Cached:
        def __init__(self, name, local_files_only=False):
            calls.append(local_files_only)

    class NotCached:
        def __init__(self, name, local_files_only=False):
            calls.append(local_files_only)
            if local_files_only:
                raise OSError("not in cache")

    saved = embedding.SentenceTransformer
    try:
        for stub, expected in ((Cached, [True]), (NotCached, [True, False])):
            calls.clear()
            embedding.SentenceTransformer = stub
            embedding.get_embedding_model.cache_clear()
            embedding.get_embedding_model()
            check(f"{stub.__name__}: load attempts {expected}", calls == expected, calls)
    finally:
        embedding.SentenceTransformer = saved
        embedding.get_embedding_model.cache_clear()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in globals().items() if name.startswith("test_")]
    print()
    print("=" * 60)
    print("PHASE 3A KNOWLEDGE RELIABILITY TESTS")
    print("=" * 60)
    for test in tests:
        test()
    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 60)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
