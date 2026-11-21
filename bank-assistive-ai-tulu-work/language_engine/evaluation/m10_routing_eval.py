"""
M10 -- ROUTING-SAFETY EVALUATION

Scores the production routing decision on evaluation/fixtures/m10_dev.json
(and, with --fixtures, any harness fixture file) against the decision each
fixture expects (`m10_expect`, see fixtures/M10_LABEL_POLICY.md):

    start:<service>   the workflow for that service starts
    clarify           nothing starts; the assistant asks which service
    decline           nothing starts; the assistant says it does not offer it
    question          nothing starts; the question is answered
    refusal           nothing starts and no workflow conflict is raised
    amount:<n> / control:<cmd>   scored by the M0 harness unchanged

The decision mirrors VoiceAssistantPipeline._respond in order: control tier,
LLM gate (not called offline: LLM-gated rows are reported, never scored),
abstention gate (with M10's withheld-start refusal rule when present),
refusal gate, start.

Offline: M0 network guard, Hugging Face offline, no LLM.

Run from language_engine/:

    venv/Scripts/python.exe -m evaluation.m10_routing_eval --name m10_dev_before
"""
from __future__ import annotations

import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import argparse
import json
import sys
from collections import Counter, OrderedDict
from pathlib import Path

from evaluation import harness as h

ROOT = Path(__file__).resolve().parent
DEV = ROOT / "fixtures" / "m10_dev.json"
REPORTS = ROOT / "reports"

WORKFLOW_DEFINED = {"deposit money", "withdraw money", "apply for loan"}

#: Detector categories answered by the "which service?" sentence.
CLARIFY_CATEGORIES = {"AMBIGUOUS_SERVICE"}
#: Detector categories answered by the "I can't help with that ..." sentence.
DECLINE_CATEGORIES = {"UNSUPPORTED_OPERATION", "UNSUPPORTED", "OUT_OF_DOMAIN"}


def decide(engine, text):
    """The production decision for `text`, plus what produced it."""
    from app.dialogue.text_normalization import routing_text

    route = engine.route(text)
    detected = engine.detector.detect_intent(routing_text(text))
    base = OrderedDict(stage=route["stage"], category=detected.get("category"), margin=detected.get("margin"),
                       evidence=detected.get("evidence"), intent=detected.get("intent"),
                       withheld=detected.get("withheld_start"), negated=route["negated"])
    if route["stage"] == "control_tier":
        return OrderedDict(decision=f"control:{route['control']}", **base)
    if route["stage"] == "llm_gate":
        # The LLM decides offline-unknowably; also record what happens if it
        # hands the turn back (classifies it as not a question).
        handed_back = _after_gate(detected, route)
        return OrderedDict(decision="llm_gate", if_handed_back=handed_back, **base)
    return OrderedDict(decision=_after_gate(detected, route), **base)


def _after_gate(detected, route):
    """Abstention gate, refusal gate, start: _respond after the LLM gate."""
    if not detected["is_banking_intent"]:
        if (detected.get("withheld_start") and detected.get("abstain_reason") != "troubleshooting"
                and route["negated"]):
            return "refused"
        category = detected.get("category")
        if category in CLARIFY_CATEGORIES:
            return "clarify"
        if category in DECLINE_CATEGORIES:
            return "decline"
        if category == "KNOWLEDGE_QUESTION":
            return "answer"
        return f"no-start:{category}"
    if route["negated"]:
        return "refused"
    return f"start:{detected['intent']}"


def score(expect, got, fixture, engine):
    """(outcome, scored) for one fixture."""
    decision = got["decision"]
    started = decision.startswith("start:")

    if expect.startswith(("amount:", "control:")) or fixture["category"] == "refusal":
        result = h.evaluate_fixture(engine, fixture)
        if result["severity"] == "unscored":
            return "llm_gated", False
        return ("correct" if result["severity"] == "ok" else result["outcome"]), True

    if decision == "llm_gate":
        return "llm_gated", False

    if expect.startswith("start:"):
        if decision == expect:
            return "correct", True
        if started:
            return "wrong_service", True
        return f"missed ({decision})", True

    if started:
        return "false_start", True
    wanted = {"clarify": "clarify", "decline": "decline", "question": "answer"}[expect]
    if decision == wanted:
        return "correct", True
    return f"no_start_other_reply ({decision})", True


def evaluate(engine, fixtures):
    rows = []
    for f in fixtures:
        expect = f.get("m10_expect") or _expect_from_harness(f)
        if expect is None:
            continue
        got = decide(engine, f["text"])
        outcome, scored = score(expect, got, f, engine)
        rows.append(OrderedDict(id=f["id"], lang=f["lang"], family=f.get("family", f["category"]),
                                policy=f.get("policy", "settled"), text=f["text"], expect=expect,
                                decision=got["decision"], outcome=outcome, scored=scored,
                                real_workflow=got["decision"][6:] in WORKFLOW_DEFINED if got["decision"].startswith("start:") else False,
                                detail=got))
    return rows


def _expect_from_harness(f):
    """m10_expect for an older harness fixture (no m10 label)."""
    c, e = f["category"], f["expected"]
    if c == "service_request":
        return f"start:{e['intent']}"
    if c == "ambiguous_request":
        return "clarify"
    if c == "knowledge_question":
        return "question"
    if c == "refusal":
        return "refusal"
    return None


def rate(n, d):
    return None if not d else round(100 * n / d, 1)


def summarize(rows):
    def block(cell):
        scored = [r for r in cell if r["scored"]]
        start_expected = [r for r in scored if r["expect"].startswith("start:")]
        no_start_expected = [r for r in scored if not r["expect"].startswith(("start:", "amount:", "control:"))]
        clar = [r for r in scored if r["expect"] == "clarify"]
        dec = [r for r in scored if r["expect"] == "decline"]
        q = [r for r in scored if r["expect"] == "question"]
        return OrderedDict(
            fixtures=len(cell), scored=len(scored), llm_gated=sum(r["outcome"] == "llm_gated" for r in cell),
            correct=sum(r["outcome"] == "correct" for r in scored),
            correct_intent=f"{sum(r['outcome'] == 'correct' for r in start_expected)}/{len(start_expected)}",
            correct_intent_rate=rate(sum(r["outcome"] == "correct" for r in start_expected), len(start_expected)),
            wrong_service=sum(r["outcome"] == "wrong_service" for r in start_expected),
            false_starts=f"{sum(r['outcome'] == 'false_start' for r in no_start_expected)}/{len(no_start_expected)}",
            false_start_rate=rate(sum(r["outcome"] == "false_start" for r in no_start_expected), len(no_start_expected)),
            false_starts_into_real_workflow=sum(r["outcome"] == "false_start" and r["real_workflow"]
                                                for r in no_start_expected),
            clarify_correct=f"{sum(r['outcome'] == 'correct' for r in clar)}/{len(clar)}",
            decline_correct=f"{sum(r['outcome'] == 'correct' for r in dec)}/{len(dec)}",
            decline_no_start=f"{sum(r['outcome'] != 'false_start' for r in dec)}/{len(dec)}",
            question_correct=f"{sum(r['outcome'] == 'correct' for r in q)}/{len(q)}",
            # LLM-gated rows that should not start a workflow: would one start
            # if the LLM handed the turn back?
            gated_no_start_expected=sum(1 for r in cell if r["outcome"] == "llm_gated"
                                        and not r["expect"].startswith(("start:", "amount:", "control:"))),
            gated_would_start=sum(1 for r in cell if r["outcome"] == "llm_gated"
                                  and not r["expect"].startswith(("start:", "amount:", "control:"))
                                  and str(r["detail"].get("if_handed_back", "")).startswith("start:")),
            outcomes=OrderedDict(Counter(r["outcome"] for r in cell).most_common()),
        )

    # "approved:Dn" rows (team-approved policy decisions) count in the
    # headline and are also shown on their own; "pending" rows do not.
    settled = [r for r in rows if r["policy"] != "pending"]
    out = OrderedDict(all_settled=block(settled),
                      approved_policy=block([r for r in rows if str(r["policy"]).startswith("approved:")]),
                      pending_policy=block([r for r in rows if r["policy"] == "pending"]))
    out["by_family"] = OrderedDict((fam, block([r for r in settled if r["family"] == fam]))
                                   for fam in sorted({r["family"] for r in settled}))
    out["by_language"] = OrderedDict((lang, block([r for r in settled if r["lang"] == lang]))
                                     for lang in h.LANGUAGE_GROUPS if any(r["lang"] == lang for r in settled))
    return out


def render(report):
    s = report["summary"]
    lines = [f"# M10 routing evaluation: {report['meta']['name']}", "",
             f"Fixtures: `{report['meta']['fixtures']}`. Text only, offline, no LLM: LLM-gated rows are not "
             "scored. Labels are author-labelled (not native-speaker reviewed); `pending` rows depend on an open "
             "policy decision and are kept out of the headline; `approved:Dn` rows count in it.", "",
             "| Slice | scored | LLM-gated | correct intent | wrong service | false starts | into real workflow | "
             "clarify ok | decline ok | decline: nothing started | question ok | gated, would start if handed back |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]

    def line(name, c):
        return (f"| {name} | {c['scored']} | {c['llm_gated']} | {c['correct_intent']} | {c['wrong_service']} | "
                f"{c['false_starts']} | {c['false_starts_into_real_workflow']} | {c['clarify_correct']} | "
                f"{c['decline_correct']} | {c['decline_no_start']} | {c['question_correct']} | "
                f"{c['gated_would_start']}/{c['gated_no_start_expected']} |")

    lines.append(line("**all settled**", s["all_settled"]))
    lines.append(line("of which approved-policy rows (D1/D3/D5)", s["approved_policy"]))
    lines.append(line("pending policy", s["pending_policy"]))
    for k, c in s["by_family"].items():
        lines.append(line(f"family: {k}", c))
    for k, c in s["by_language"].items():
        lines.append(line(f"lang: {k}", c))
    lines += ["", "## Every row not correct", "", "| id | policy | text | expected | decision | outcome |",
              "|---|---|---|---|---|---|"]
    lines += [f"| {r['id']} | {r['policy']} | {h._md_escape(r['text'])} | {r['expect']} | {r['decision']} | {r['outcome']} |"
              for r in report["rows"] if r["outcome"] != "correct"]
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="M10 routing-safety evaluation (offline).")
    parser.add_argument("--name", required=True)
    parser.add_argument("--fixtures", default=str(DEV))
    args = parser.parse_args(argv)

    sys.stdout.reconfigure(encoding="utf-8")
    h.install_network_guard()
    engine = h.build_engine(with_retrieval=False)
    document, _ = h.load_fixtures(Path(args.fixtures))
    rows = evaluate(engine, document["fixtures"])
    report = OrderedDict(meta=OrderedDict(name=args.name, fixtures=Path(args.fixtures).name),
                         summary=summarize(rows), rows=rows)
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / f"{args.name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n",
                                               encoding="utf-8")
    (REPORTS / f"{args.name}.md").write_text(render(report), encoding="utf-8")
    print(render(report).split("## Every")[0])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
