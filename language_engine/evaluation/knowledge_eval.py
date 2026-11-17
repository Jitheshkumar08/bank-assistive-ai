"""Knowledge retrieval evaluation (Phase 2).

Measures the retriever on evaluation/fixtures/knowledge/knowledge_p2.json:

  - top-1 / top-2 source accuracy on answerable questions, per split
  - the best score of questions the knowledge base CANNOT answer (gaps,
    unrelated) against the score of correct answers -- the evidence any
    abstention threshold has to be chosen from
  - a threshold sweep on the DEV split only, and how the chosen value (if
    any) then does on HELD-OUT
  - retrieval latency: one cold query, every query once, and the same
    queries repeated (which shows what the query-embedding cache saves)

Offline: the local embedding model only, no network, no LLM. Works against
any retriever with search(query, top_k), so it can measure the code before
and after a change.

Run from language_engine/:

    venv/Scripts/python.exe -m evaluation.knowledge_eval --name p2_after
"""

import argparse
import contextlib
import io
import json
import os
import statistics
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

ROOT = Path(__file__).resolve().parent
DEFAULT_FIXTURES = ROOT / "fixtures" / "knowledge" / "knowledge_p2.json"
DEFAULT_OUT = ROOT / "reports"

#: Candidate abstention thresholds swept on dev.
THRESHOLDS = [round(0.20 + 0.02 * i, 2) for i in range(26)]

#: A threshold is recommended only if it keeps at least this share of
#: answerable dev questions (wrongly refusing a real question is the costly error).
MIN_KEEP = 0.95


def _ms(seconds):
    return round(seconds * 1000, 2)


def production_query(question):
    """What production retrieves with: the routing text (EngineRuntime.run_turn)."""
    from app.dialogue.text_normalization import normalize_turn
    return normalize_turn(question).routing


def evaluate(retriever, items, top_k=2):
    rows = []
    for item in items:
        query = production_query(item["q"])
        started = time.perf_counter()
        results = retriever.search(query, top_k=top_k)
        elapsed = time.perf_counter() - started
        sources = [r["source"] for r in results]
        expected = item.get("sources")
        rows.append({
            "split": item["split"],
            "lang": item["lang"],
            "q": item["q"],
            "kind": item.get("kind", "answerable") if expected is None else "answerable",
            "expected": expected,
            "got": sources,
            "top_score": round(results[0]["score"], 3) if results else None,
            "top1": bool(expected and sources and sources[0] in expected),
            "top2": bool(expected and any(s in expected for s in sources[:2])),
            "ms": _ms(elapsed),
        })
    return rows


def summarize(rows):
    out = {}
    for split in ("dev", "heldout"):
        answerable = [r for r in rows if r["split"] == split and r["kind"] == "answerable"]
        unanswerable = [r for r in rows if r["split"] == split and r["kind"] != "answerable"]
        out[split] = {
            "answerable": len(answerable),
            "top1": sum(r["top1"] for r in answerable),
            "top2": sum(r["top2"] for r in answerable),
            "correct_top_scores": sorted(r["top_score"] for r in answerable if r["top1"]),
            "unanswerable_top_scores": sorted(r["top_score"] for r in unanswerable if r["top_score"] is not None),
        }
    return out


def sweep(rows):
    """(threshold, keep, reject) on dev; keep = answerable with a correct top-2 kept."""
    dev_ok = [r for r in rows if r["split"] == "dev" and r["kind"] == "answerable" and r["top2"]]
    dev_no = [r for r in rows if r["split"] == "dev" and r["kind"] != "answerable"]
    table = []
    for t in THRESHOLDS:
        keep = sum(r["top_score"] >= t for r in dev_ok) / max(1, len(dev_ok))
        reject = sum(r["top_score"] < t for r in dev_no) / max(1, len(dev_no))
        table.append({"threshold": t, "keep": round(keep, 3), "reject": round(reject, 3)})
    usable = [row for row in table if row["keep"] >= MIN_KEEP and row["reject"] > 0]
    best = max(usable, key=lambda row: (row["reject"], -row["threshold"])) if usable else None
    return table, best


def apply_threshold(rows, threshold, split):
    ok = [r for r in rows if r["split"] == split and r["kind"] == "answerable" and r["top2"]]
    no = [r for r in rows if r["split"] == split and r["kind"] != "answerable"]
    return {
        "keep": round(sum(r["top_score"] >= threshold for r in ok) / max(1, len(ok)), 3),
        "reject": round(sum(r["top_score"] < threshold for r in no) / max(1, len(no)), 3),
    }


def latency(retriever, items):
    queries = [production_query(item["q"]) for item in items]
    first = time.perf_counter()
    retriever.search("What is a passbook?", top_k=2)
    cold = time.perf_counter() - first

    def run():
        times = []
        for q in queries:
            started = time.perf_counter()
            retriever.search(q, top_k=2)
            times.append(time.perf_counter() - started)
        return times

    once = run()
    again = run()
    return {
        "cold_first_query_ms": _ms(cold),
        "first_pass_mean_ms": _ms(statistics.mean(once)),
        "first_pass_p95_ms": _ms(sorted(once)[int(0.95 * (len(once) - 1))]),
        "repeat_pass_mean_ms": _ms(statistics.mean(again)),
        "repeat_pass_p95_ms": _ms(sorted(again)[int(0.95 * (len(again) - 1))]),
        "queries": len(queries),
    }


def render_markdown(name, summary, table, best, heldout, timing, rows):
    lines = [f"# Knowledge evaluation: {name}", ""]
    for split in ("dev", "heldout"):
        s = summary[split]
        lines += [
            f"## {split}",
            f"- answerable: {s['answerable']}, top-1 {s['top1']}/{s['answerable']}, top-2 {s['top2']}/{s['answerable']}",
            f"- correct top-1 scores: {s['correct_top_scores']}",
            f"- unanswerable best scores: {s['unanswerable_top_scores']}",
            "",
        ]
    lines += ["## Abstention threshold (chosen on dev only)", ""]
    if best:
        lines += [f"- best on dev: {best}", f"- same threshold on held-out: {heldout}", ""]
    else:
        lines += [f"- no threshold keeps >= {MIN_KEEP:.0%} of answerable dev questions while rejecting any "
                  "unanswerable one: retrieval score alone cannot separate them.", ""]
    lines += ["## Latency (ms, retrieval only, CPU)", ""] + [f"- {k}: {v}" for k, v in timing.items()] + [""]
    lines += ["## Per question", "", "| split | lang | kind | top-1 | top score | got | question |",
              "|---|---|---|---|---|---|---|"]
    for r in rows:
        mark = "-" if r["kind"] != "answerable" else ("yes" if r["top1"] else ("top-2" if r["top2"] else "NO"))
        lines.append(f"| {r['split']} | {r['lang']} | {r['kind']} | {mark} | {r['top_score']} | "
                     f"{', '.join(r['got'])} | {r['q']} |")
    return "\n".join(lines) + "\n"


# ===========================================================================
# ANSWER POLICY (Phase 3A)
#
# Where does each turn END UP? Every item of knowledge_p3_answer_policy.json
# goes through the real DialogueManager routing, request policy, fast path,
# retriever and DialogueUnderstanding.answer_question -- only the LLM is
# scripted: the classifier always says "question" and the answer model
# always says MODEL_ANSWER. So this grades the engine's deterministic
# decisions (refuse, answer exactly, say it cannot verify, ask which
# service, or hand the question to the model) and what the model would be
# GIVEN (retrieved sources, session language). It says nothing about the
# wording a live model would produce.
#
# The "claims" section grades the output checks the same way: a scripted
# model answer that invents a figure or claims an action must be replaced.
# ===========================================================================

DEFAULT_POLICY_FIXTURES = ROOT / "fixtures" / "knowledge" / "knowledge_p3_answer_policy.json"
MODEL_ANSWER = "MODEL ANSWER"


class _ScriptedClient:
    """Groq stand-in for the answer call; counts requests."""

    def __init__(self, answer=MODEL_ANSWER):
        self.answer, self.requests = answer, []
        self.chat = type("Chat", (), {"completions": self})()

    def create(self, **request):
        self.requests.append(request)
        message = type("M", (), {"content": self.answer})()
        choice = type("C", (), {"message": message, "finish_reason": "stop"})()
        return type("R", (), {"choices": [choice]})()


class _Collaborator:
    """DialogueManager's understanding collaborator: a scripted classifier
    in front of the REAL answer_question."""

    def __init__(self, real):
        self.real, self.understood, self.languages = real, 0, []

    def understand(self, user_text, current_workflow=None, current_step=None, current_instruction=None):
        self.understood += 1
        return {"type": "question", "action": "explain", "step_completed": False,
                "target_workflow": None, "entities": {}}

    def answer_question(self, question, workflow_context, current_instruction,
                        recent_context=None, response_language=None):
        self.languages.append(response_language)
        return self.real.answer_question(question, workflow_context, current_instruction,
                                         recent_context=recent_context, response_language=response_language)


class _RecordingRetriever:
    def __init__(self, inner):
        self.inner, self.last = inner, None

    def search(self, query, top_k=2, filters=None):
        self.last = self.inner.search(query, top_k=top_k, filters=filters)
        return self.last

    def __getattr__(self, name):
        return getattr(self.inner, name)


def _policy_rig(retriever, fast_path):
    """(dialogue, collaborator, client, recorder, decisions) for one item."""
    from app.dialogue.llm.dialogue_understanding import DialogueUnderstanding
    from app.dialogue.manager import DialogueManager
    from app.domains import load_domain
    from app.knowledge.gaps import GapLog
    from app.workflow.loader import WorkflowLoader

    decisions = []
    recorder = _RecordingRetriever(retriever)

    real = DialogueUnderstanding.__new__(DialogueUnderstanding)
    real.client = _ScriptedClient()
    real.knowledge_retriever = recorder
    real.domain = load_domain()
    real.answer_cache = None
    real.gap_log = GapLog(path="")
    try:    # Phase 3A; absent before it, so the same rig measures both.
        from app.knowledge.answerability import for_domain
        real.answerability = for_domain(real.domain, retriever.documents)
    except ImportError:
        pass
    assess = getattr(real, "assess_answerability", None)
    if assess is not None:
        def recording_assess(*args, **kwargs):
            result = assess(*args, **kwargs)
            decisions.append(result.category if result else None)
            return result
        real.assess_answerability = recording_assess

    class RecordingFastPath:
        def __getattr__(self, name):
            return getattr(fast_path, name)

        def screen(self, text):
            found = fast_path.screen(text)
            if found is not None:
                decisions.append(found.kind)
            return found

        def lookup(self, text, language=None):
            found = fast_path.lookup(text, language)
            if found is not None:
                decisions.append(found.kind)
            return found

    dialogue = DialogueManager.__new__(DialogueManager)
    dialogue.workflow_loader = WorkflowLoader()
    dialogue.dialogue_understanding = _Collaborator(real)
    dialogue.intent_detector = None
    dialogue.fast_path = RecordingFastPath()
    return dialogue, dialogue.dialogue_understanding, real.client, recorder, decisions


def run_policy_item(item, retriever, fast_path):
    from app.conversation.manager import ConversationManager
    from app.dialogue.localization import localize_detailed

    dialogue, collaborator, client, recorder, decisions = _policy_rig(retriever, fast_path)
    conversation = ConversationManager()
    conversation.start_conversation()
    conversation.language = item["lang"]
    context = item.get("context", "resting")

    with contextlib.redirect_stdout(io.StringIO()):
        if context == "resting":
            reply = dialogue.answer_general_question(item["q"], conversation)
        else:
            if not dialogue.workflow_loader.has_workflow(context):
                raise ValueError(f"fixture names a workflow that does not exist: {context!r}")
            dialogue.start_workflow(conversation, context)
            reply = dialogue.generate_response(conversation, item["q"])

    model_called = bool(client.requests)
    if reply is None:
        got = "intent"
    elif model_called:
        got = "model"
    else:
        # The last deterministic decision taken on this turn.
        got = next((d for d in reversed(decisions) if d), "other")

    sources = [r["source"] for r in (recorder.last or [])] if model_called else []
    expected_sources = item.get("sources")
    retrieval_ok = None
    if got == "model" and expected_sources:
        retrieval_ok = any(s in expected_sources for s in sources[:2])

    # Language correctness, separately from routing: a fixed reply must
    # render completely in the session language; a model answer must be
    # REQUESTED in the session language (whether the live model complies is
    # not measurable offline).
    language_ok = None
    if reply is not None and item["lang"] in ("kn", "hi"):
        if model_called:
            language_ok = collaborator.languages[-1:] == [item["lang"]]
        else:
            status = localize_detailed(reply, item["lang"])[1]
            language_ok = status in ("translated", "mixed", "generated")

    return {
        "split": item["split"], "lang": item["lang"], "context": context, "q": item["q"],
        "expect": item["expect"], "got": got, "ok": got == item["expect"],
        "llm_calls": collaborator.understood + len(client.requests),
        "sources": sources, "expected_sources": expected_sources, "retrieval_ok": retrieval_ok,
        "language_ok": language_ok,
        "reply": None if reply is None else str(reply)[:140],
    }


def run_claims(claims):
    from app.dialogue.llm.dialogue_understanding import DialogueUnderstanding
    from app.domains import load_domain

    rows = []
    for claim in claims:
        real = DialogueUnderstanding.__new__(DialogueUnderstanding)
        real.client = _ScriptedClient(claim["output"])
        real.knowledge_retriever = _NoRetriever()
        real.domain = load_domain()
        real.answer_cache = None
        real.gap_log = None
        if hasattr(real, "assess_answerability"):
            # The claims section tests the OUTPUT checks, so the pre-answer
            # decision is bypassed and the scripted answer always comes back.
            real.assess_answerability = lambda *a, **k: None
        with contextlib.redirect_stdout(io.StringIO()):
            answer = real.answer_question(claim["q"], "No banking workflow is currently active.", "")
        got = "kept" if str(answer) == claim["output"] else "replaced"
        rows.append({"split": claim["split"], "q": claim["q"], "output": claim["output"],
                     "expect": claim["expect"], "got": got, "ok": got == claim["expect"],
                     "final": str(answer)})
    return rows


class _NoRetriever:
    version = "none"

    def search(self, query, top_k=2, filters=None):
        return []


def summarize_policy(rows, claim_rows):
    out = {}
    for split in ("dev", "heldout"):
        r = [row for row in rows if row["split"] == split]
        by_expect = {}
        for row in r:
            bucket = by_expect.setdefault(row["expect"], {"n": 0, "ok": 0})
            bucket["n"] += 1
            bucket["ok"] += row["ok"]
        retrieval = [row for row in r if row["retrieval_ok"] is not None]
        language = [row for row in r if row["language_ok"] is not None]
        cannot = [row for row in r if row["expect"] in ("dynamic", "account_specific", "clarify")]
        answerable = [row for row in r if row["expect"] == "model"]
        c = [row for row in claim_rows if row["split"] == split]
        fabricated = [row for row in c if row["expect"] == "replaced"]
        genuine = [row for row in c if row["expect"] == "kept"]
        out[split] = {
            "items": len(r),
            "routing_correct": sum(row["ok"] for row in r),
            "by_expect": by_expect,
            "retrieval_hit_top2": [sum(row["retrieval_ok"] for row in retrieval), len(retrieval)],
            "language_correct": [sum(row["language_ok"] for row in language), len(language)],
            "cannot_answer_handled": [sum(row["ok"] for row in cannot), len(cannot)],
            "answerable_wrongly_withheld": [sum(row["got"] != "model" and row["got"] != "intent"
                                                for row in answerable), len(answerable)],
            "llm_calls_total": sum(row["llm_calls"] for row in r),
            "fabricated_claims_let_through": [sum(not row["ok"] for row in fabricated), len(fabricated)],
            "genuine_answers_replaced": [sum(not row["ok"] for row in genuine), len(genuine)],
        }
    return out


def render_policy(name, summary, rows, claim_rows):
    lines = [f"# Answer-policy evaluation: {name}", "",
             "Real routing, policy, fast path, retriever and answer_question; the LLM is scripted "
             "(classifier: always 'question'; answer: a fixed string). Grades the engine's decisions "
             "and what the model is given, not live model wording.", ""]
    for split in ("dev", "heldout"):
        s = summary[split]
        lines += [f"## {split}", "",
                  f"- routing correct: {s['routing_correct']}/{s['items']}",
                  f"- cannot-answer questions handled (dynamic / account-specific / clarify): "
                  f"{s['cannot_answer_handled'][0]}/{s['cannot_answer_handled'][1]}",
                  f"- answerable questions wrongly withheld from the model: "
                  f"{s['answerable_wrongly_withheld'][0]}/{s['answerable_wrongly_withheld'][1]}",
                  f"- retrieval hit (expected article in top 2, model-answered items): "
                  f"{s['retrieval_hit_top2'][0]}/{s['retrieval_hit_top2'][1]}",
                  f"- language correct (kn/hi; fixed replies fully rendered, model asked in the session language): "
                  f"{s['language_correct'][0]}/{s['language_correct'][1]}",
                  f"- scripted fabricated answers let through: "
                  f"{s['fabricated_claims_let_through'][0]}/{s['fabricated_claims_let_through'][1]}",
                  f"- scripted genuine answers wrongly replaced: "
                  f"{s['genuine_answers_replaced'][0]}/{s['genuine_answers_replaced'][1]}",
                  f"- LLM calls for the split: {s['llm_calls_total']}",
                  "- by expected outcome: " + ", ".join(f"{k} {v['ok']}/{v['n']}" for k, v in s["by_expect"].items()),
                  ""]
    lines += ["## Failures", "", "| split | lang | context | question | expected | got | reply |", "|---|---|---|---|---|---|---|"]
    for row in rows:
        if not row["ok"] or row["retrieval_ok"] is False or row["language_ok"] is False:
            extra = []
            if row["retrieval_ok"] is False:
                extra.append(f"retrieval miss: got {row['sources']}")
            if row["language_ok"] is False:
                extra.append("language")
            got = row["got"] + (f" ({'; '.join(extra)})" if extra else "")
            lines.append(f"| {row['split']} | {row['lang']} | {row['context']} | {row['q']} | {row['expect']} | "
                         f"{got} | {(row['reply'] or '-').replace('|', '/')} |")
    lines += ["", "## Output checks on scripted answers", "", "| split | expected | got | scripted answer |",
              "|---|---|---|---|"]
    for row in claim_rows:
        lines.append(f"| {row['split']} | {row['expect']} | {row['got']} | {row['output']} |")
    return "\n".join(lines) + "\n"


def policy_main(args):
    from app.knowledge.fast_path import FastPathAnswerer
    from app.knowledge.retriever import KnowledgeRetriever

    data = json.loads(Path(args.policy_fixtures).read_text(encoding="utf-8"))
    with contextlib.redirect_stdout(io.StringIO()):
        retriever = KnowledgeRetriever()
        fast_path = FastPathAnswerer()
    rows = [run_policy_item(item, retriever, fast_path) for item in data["items"]]
    claim_rows = run_claims(data.get("claims", []))
    summary = summarize_policy(rows, claim_rows)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    name = args.name
    (out / f"{name}.json").write_text(json.dumps({"name": name, "summary": summary, "rows": rows,
                                                  "claims": claim_rows}, ensure_ascii=False, indent=2),
                                      encoding="utf-8")
    (out / f"{name}.md").write_text(render_policy(name, summary, rows, claim_rows), encoding="utf-8")
    for split in ("dev", "heldout"):
        print(split, json.dumps(summary[split], ensure_ascii=False))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--name", default="knowledge_latest")
    parser.add_argument("--suite", choices=("retrieval", "policy"), default="retrieval",
                        help="retrieval (default): the Phase 2 retrieval report; "
                             "policy: the Phase 3A answer-policy report")
    parser.add_argument("--policy-fixtures", default=str(DEFAULT_POLICY_FIXTURES))
    args = parser.parse_args(argv)

    sys.stdout.reconfigure(encoding="utf-8")
    if args.suite == "policy":
        return policy_main(args)

    items = json.loads(Path(args.fixtures).read_text(encoding="utf-8"))["items"]

    from app.knowledge.retriever import KnowledgeRetriever

    started = time.perf_counter()
    retriever = KnowledgeRetriever()
    build = time.perf_counter() - started

    timing = latency(retriever, items)
    timing["index_build_ms_including_model_load"] = _ms(build)
    retriever_fresh = retriever
    if hasattr(retriever, "clear_caches"):
        retriever_fresh.clear_caches()
    rows = evaluate(retriever_fresh, items)
    summary = summarize(rows)
    table, best = sweep(rows)
    heldout = apply_threshold(rows, best["threshold"], "heldout") if best else None

    report = {"name": args.name, "summary": summary, "sweep": table, "best_dev_threshold": best,
              "heldout_at_best": heldout, "latency": timing, "rows": rows}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{args.name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / f"{args.name}.md").write_text(render_markdown(args.name, summary, table, best, heldout, timing, rows),
                                         encoding="utf-8")

    for split in ("dev", "heldout"):
        s = summary[split]
        print(f"{split}: top-1 {s['top1']}/{s['answerable']}  top-2 {s['top2']}/{s['answerable']}")
    print("best dev threshold:", best, "| held-out:", heldout)
    print("latency:", timing)
    return 0


if __name__ == "__main__":
    sys.exit(main())
