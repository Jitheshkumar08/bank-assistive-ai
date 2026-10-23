"""
M10 DIAGNOSIS -- WHERE DO THE M9 ROUTING FAILURES COME FROM?

Investigation only. Nothing here changes production behaviour: the
production routing is called exactly as evaluation/harness.Engine calls it,
and the detector's own output (per-intent scores, anchor scores, margin,
lexical evidence) is read, never altered.

For every banking clip of M9 it records, for the REFERENCE transcript and
for the cached ASR transcript (evaluation/reports/m9_asr_hypotheses.jsonl):

  - the routing text and whether normalisation changed the decision
  - the stage (control tier / LLM gate / detector), the detector's verdict,
    raw scores, top candidates, margin and service-word evidence
  - the production decision and whether a workflow would really start

and compares both decisions with an ASSISTANT-SCOPE label. The M9
annotations were written for a payments ASR study (Phase 3.2B-9), not for
this assistant's five services, so each clip's label is mapped here, with
the mapping and every override written out in ASSISTANT_LABELS below.
These mappings are PROPOSED by the developer tooling from the annotation
notes and transcripts. NO HUMAN HAS REVIEWED THEM; clips whose label is not
clear are marked trust="review" and listed in the annotation review sheet.

Offline: M0 network guard, Hugging Face offline, no LLM call. LLM-gated
turns are reported as conditional -- what the detector WOULD decide if the
LLM handed the turn back -- and never scored as right or wrong.

Run from language_engine/:

    venv/Scripts/python.exe -m evaluation.routing_diagnosis
"""
from __future__ import annotations

import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import csv
import json
import sys
from collections import Counter, OrderedDict
from pathlib import Path

from evaluation import asr_harness as a
from evaluation import harness as h

REPORTS = a.REPORTS
NAME = "m10_diagnosis"

DEPOSIT, WITHDRAW, BALANCE = "deposit money", "withdraw money", "check account balance"
LOAN, OPEN = "apply for loan", "open new account"

#: Services that have a guided workflow definition (app/workflow/workflows).
#: The other two answer "no guided procedure yet" and change no state.
WORKFLOW_DEFINED = {DEPOSIT, WITHDRAW, LOAN}

# =========================================================
# ASSISTANT-SCOPE LABELS  (proposed, not human-verified)
# =========================================================
#
# review class:
#   valid        clearly a request for one of the five services
#   out_of_scope clearly not one of them: the right decision is to start nothing
#   clarify      ambiguous: the assistant should ask, not start
#   undetermined the label cannot be fixed confidently from the transcript
#
# expected: the service that should start, or None.

DEFAULT_BY_ANNOTATION = {
    "balance": ("valid", BALANCE, "trusted", "annotated balance check"),
    "transfer": ("out_of_scope", None, "trusted", "transfer to a person or account: not one of the five services"),
    "payment": ("out_of_scope", None, "trusted", "merchant / bill payment: not one of the five services"),
    "other": ("out_of_scope", None, "trusted", "annotated other: not one of the five services"),
}

_WALLET = ("clarify", None, "review",
           "annotated deposit, but it loads the customer's own WALLET from their bank account; the assistant's "
           "deposit workflow is a branch cash-deposit slip. Rule 2 of the annotation flags this as the call a "
           "reviewer may flip.")
_LOAN_REPAY = ("out_of_scope", None, "review",
               "a question whether a LOAN REPAYMENT can be paid through a payment app; names 'loan' but is not a "
               "loan application. A reviewer may prefer a knowledge answer or the loan desk.")
_CAPABILITY = ("clarify", None, "review",
               "a capability / limit QUESTION about the action, annotated with the action's intent (annotation "
               "rule 3); a question should be answered, not start the workflow")
_FUNDS = ("valid", BALANCE, "review",
          "asks whether the account holds enough / a stated sum: a balance check phrased as a yes/no question")

ASSISTANT_LABELS = {
    # deposits that are wallet top-ups
    **{i: _WALLET for i in ("ivb_kn_017", "ivb_kn_051", "ivb_kn_060", "ivb_kn_077", "ivb_kn_079",
                             "ivb_hi_022", "ivb_hi_055")},
    # withdrawals that are capability questions
    "ivb_kn_035": _CAPABILITY, "ivb_hi_040": _CAPABILITY,
    # a loan APPLICATION the annotation schema files under "other"
    "ivb_kn_069": ("valid", LOAN, "review",
                   "'apply for an education loan': the annotation schema files loan queries under other, but "
                   "apply-for-loan is one of the assistant's services. M9's mapping counted it out of scope."),
    # loan repayment questions
    **{i: _LOAN_REPAY for i in ("ivb_kn_056", "ivb_kn_070", "ivb_kn_082", "ivb_kn_097", "ivb_hi_013",
                                 "ivb_hi_021", "ivb_hi_030", "ivb_hi_061")},
    # balance questions phrased about sufficiency
    **{i: _FUNDS for i in ("ivb_kn_042", "ivb_kn_047", "ivb_kn_075", "ivb_kn_093", "ivb_kn_094", "ivb_kn_096",
                           "ivb_hi_056", "ivb_hi_062", "ivb_hi_081", "ivb_hi_100")},
    "ivb_hi_042": ("clarify", None, "review",
                   "asks whether the WALLET account has sufficient funds: a wallet, not a bank balance"),
    # multi-request clips
    "ivb_kn_016": ("undetermined", None, "review",
                   "two requests: check that salary was credited (a balance/statement check), then transfer 700. "
                   "Annotated other; whether the assistant should start a balance check is a product decision."),
    "ivb_kn_037": ("valid", BALANCE, "review", "balance check plus 'was 30000 received'; balance is primary"),
    "ivb_hi_089": ("valid", BALANCE, "review", "balance check plus 'was 600 received'; balance is primary"),
    "ivb_hi_011": ("valid", BALANCE, "review", "balance plus transaction history; balance is first"),
    "ivb_kn_019": ("clarify", None, "review",
                   "a complaint that the app does not show the balance; support issue, not a balance request"),
}


def assistant_label(clip_id, annotation):
    label = ASSISTANT_LABELS.get(clip_id) or DEFAULT_BY_ANNOTATION.get(annotation["intent"])
    if label is None:
        return ("undetermined", None, "review", f"annotation intent {annotation['intent']!r} has no mapping")
    return label


def m9_label(annotation):
    """What M9's routing-vs-gold table used (asr_harness.GOLD_SERVICE)."""
    return a.GOLD_SERVICE.get(annotation["intent"])


# =========================================================
# ROUTING, OBSERVED
# =========================================================

def observe(engine, text):
    """The production decision for `text`, with the detector's internals."""
    from app.dialogue.text_normalization import normalize_turn

    turn = normalize_turn(text or "")
    route = engine.route(text) if text else None
    if route is None:
        return OrderedDict(decision="empty", stage="empty")

    detected = engine.detector.detect_intent(turn.routing)
    scores = detected["scores"]
    ranked = sorted(scores, key=scores.get, reverse=True)

    # Production order (voice_pipeline._respond): control tier, LLM gate,
    # abstention gate, refusal gate, start.
    if route["stage"] == "control_tier":
        decision = f"control:{route['control']}"
    elif not detected["is_banking_intent"]:
        # M10: a withheld start that is negated still meets the refusal gate.
        decision = ("no-start:REFUSED" if detected.get("withheld_start") and route["negated"]
                    and detected.get("abstain_reason") != "troubleshooting"
                    else f"no-start:{detected['category']}")
    elif route["negated"]:
        decision = "no-start:REFUSED"
    else:
        decision = f"start:{detected['intent']}"
    conditional = route["stage"] == "llm_gate"

    # Normalisation effect: the same decision on the spelling-normalised
    # text (before loanword canonicalisation and repairs)?
    plain = engine.detector.detect_intent(turn.normalized)
    plain_decision = (f"start:{plain['intent']}" if plain["is_banking_intent"]
                      else f"no-start:{plain['category']}")
    routed_decision = (f"start:{detected['intent']}" if detected["is_banking_intent"]
                       else f"no-start:{detected['category']}")

    return OrderedDict(
        routing_text=turn.routing,
        normalization_changed_text=turn.routing != turn.normalized,
        normalization_changed_decision=plain_decision != routed_decision,
        decision_without_normalization=plain_decision,
        stage=route["stage"],
        llm_gated=conditional,
        decision=decision,
        starts=decision.startswith("start:"),
        workflow_defined=decision[6:] in WORKFLOW_DEFINED if decision.startswith("start:") else False,
        intent=detected["intent"],
        unrestricted_top=ranked[0],
        top3=[(i, scores[i]) for i in ranked[:3]],
        top_gap=round(scores[ranked[0]] - scores[ranked[1]], 3),
        best_anchor=detected["anchor_category"],
        anchor_score=detected["anchor_confidence"],
        anchor_scores=detected["anchor_scores"],
        margin=detected["margin"],
        evidence=detected["evidence"],
        category=detected["category"],
        negated=route["negated"],
    )


def started(observation):
    return observation["decision"][6:] if observation["decision"].startswith("start:") else None


def correct(observation, expected):
    if observation["llm_gated"]:
        return None                       # decided by the LLM: not scored
    return started(observation) == expected


# =========================================================
# CAUSE ATTRIBUTION
# =========================================================

def cause(observation, expected, review_class):
    """The primary reason a scored decision is wrong. One label per clip."""
    got = started(observation)
    ev = set(observation["evidence"])
    if got and expected is None:
        if not ev:
            return "no_evidence_start"
        if got in ev:
            return "service_word_in_out_of_scope_request"
        return "start_despite_other_evidence"
    if expected and got and got != expected:
        if expected in ev:
            return "named_service_overridden"     # cannot happen: narrowing restricts to evidence
        if ev:
            return "keyword_named_other_service"
        return "model_chose_wrong_service"
    if expected and not got:
        d = observation["decision"]
        if d == "no-start:REFUSED":
            return "refusal_gate_false_positive"
        if d == "no-start:AMBIGUOUS_SERVICE":
            return "narrowing_abstained"
        if d.startswith("control:"):
            return "control_tier_intercepted"
        return "anchor_beat_service"          # margin < BANKING_MARGIN
    return "other"


CAUSE_FAMILY = {
    "no_evidence_start": "rule: workflow starts with no service named (embedding nearest-service)",
    "service_word_in_out_of_scope_request": "keyword: a service word inside an out-of-scope request",
    "start_despite_other_evidence": "keyword/narrowing",
    "keyword_named_other_service": "keyword: evidence named a different service",
    "model_chose_wrong_service": "model: embeddings chose the wrong service (nothing named)",
    "refusal_gate_false_positive": "rule: refusal gate on a non-refusal",
    "narrowing_abstained": "keyword: narrowing abstained",
    "control_tier_intercepted": "rule: control tier",
    "anchor_beat_service": "model: a non-banking anchor won (margin < 0.05)",
    "named_service_overridden": "impossible by construction",
    "other": "other",
}


# =========================================================
# RUN
# =========================================================

def load_inputs():
    annotations = json.loads((a.SPIKE / "indicvoices_banking_annotations.json").read_text(encoding="utf-8"))
    by_id = {x["id"]: x for x in annotations["annotations"]}
    cached = {}
    for line in a.HYPOTHESES.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        cached[row["id"]] = row
    return by_id, cached


def diagnose_banking(engine, clips, by_id, cached):
    rows = []
    for clip in clips:
        if clip["set"] != "banking":
            continue
        ann = by_id[clip["id"]]
        p = ann["project_annotations"]
        review_class, expected, trust, reason = assistant_label(clip["id"], p)
        hyp_text = cached[clip["id"]]["hypothesis"] if clip["id"] in cached else None
        ref = observe(engine, clip["reference"])
        hyp = observe(engine, hyp_text) if hyp_text is not None else None
        ref_ok = correct(ref, expected)
        hyp_ok = correct(hyp, expected) if hyp else None

        if hyp is None:
            asr_effect = "no_hypothesis"
        elif ref["llm_gated"] or hyp["llm_gated"]:
            asr_effect = "llm_gated (not scored)"
        elif ref_ok and hyp_ok:
            asr_effect = "both_correct"
        elif ref_ok and not hyp_ok:
            asr_effect = "asr_induced_error"
        elif not ref_ok and hyp_ok:
            asr_effect = "asr_fixed_error"
        elif ref["decision"] == hyp["decision"]:
            asr_effect = "persists_same_decision"
        else:
            asr_effect = "persists_different_wrong_decision"

        rows.append(OrderedDict(
            id=clip["id"], language=clip["language"], split=clip["split"],
            category=a.score_clip.__globals__["loanwords"](clip["reference"], clip["language"]) and
            f"{clip['language']}-en" or clip["language"],
            reference=clip["reference"], hypothesis=hyp_text,
            annotation_intent=p["intent"], annotation_notes=p.get("notes"),
            annotation_flagged=bool(ann.get("review", {}).get("needs_manual_review")),
            m9_expected=m9_label(p), expected=expected, review_class=review_class, label_trust=trust,
            label_reason=reason,
            ref=ref, hyp=hyp, ref_correct=ref_ok, hyp_correct=hyp_ok,
            ref_cause=cause(ref, expected, review_class) if ref_ok is False else None,
            hyp_cause=cause(hyp, expected, review_class) if hyp_ok is False else None,
            asr_effect=asr_effect,
        ))
    return rows


def diagnose_general(engine, clips, cached):
    """No labels: only whether ASR changed the production decision, and how."""
    rows = []
    for clip in clips:
        if clip["set"] != "general" or clip["id"] not in cached:
            continue
        ref = observe(engine, clip["reference"])
        hyp = observe(engine, cached[clip["id"]]["hypothesis"])
        if ref["decision"] != hyp["decision"] or ref["stage"] != hyp["stage"]:
            rows.append(OrderedDict(id=clip["id"], language=clip["language"], reference=clip["reference"],
                                    hypothesis=cached[clip["id"]]["hypothesis"],
                                    ref_stage=ref["stage"], hyp_stage=hyp["stage"],
                                    ref_decision=ref["decision"], hyp_decision=hyp["decision"],
                                    ref_evidence=ref["evidence"], hyp_evidence=hyp["evidence"],
                                    ref_margin=ref["margin"], hyp_margin=hyp["margin"]))
    general_total = sum(1 for c in clips if c["set"] == "general")
    return general_total, rows


def diagnose_forms(engine):
    """The M9 text-form failures, with the detector's internals."""
    report = json.loads((REPORTS / "m9_forms_baseline.json").read_text(encoding="utf-8"))
    out = []
    for r in report["rows"]:
        if r["severity"] in ("critical", "miss"):
            o = observe(engine, r["text"])
            out.append(OrderedDict(item=r["item"], kind=r["kind"], lang=r["lang"], category=r["category"],
                                   text=r["text"], outcome=r["outcome"], decision=o["decision"],
                                   stage=o["stage"], margin=o["margin"], best_anchor=o["best_anchor"],
                                   evidence=o["evidence"], top3=o["top3"], negated=o["negated"]))
    return out


def margins(rows, predicate, side="ref"):
    values = sorted(r[side]["margin"] for r in rows if predicate(r))
    if not values:
        return None
    return OrderedDict(n=len(values), min=values[0], median=values[len(values) // 2], max=values[-1])


def summarize(rows, general_total, general_changes, forms):
    s = OrderedDict()
    s["clips"] = len(rows)
    s["review_class"] = OrderedDict(sorted(Counter(r["review_class"] for r in rows).items()))
    s["label_trust"] = OrderedDict(sorted(Counter(r["label_trust"] for r in rows).items()))
    s["m9_vs_assistant_label_disagreements"] = sum(r["m9_expected"] != r["expected"] for r in rows)

    for side in ("ref", "hyp"):
        scored = [r for r in rows if r[f"{side}_correct"] is not None]
        s[f"{side}_scored"] = len(scored)
        s[f"{side}_llm_gated"] = sum(1 for r in rows if r[side] and r[side]["llm_gated"])
        s[f"{side}_correct"] = sum(r[f"{side}_correct"] for r in scored)
        s[f"{side}_causes"] = OrderedDict(Counter(r[f"{side}_cause"] for r in scored
                                                  if r[f"{side}_cause"]).most_common())
        s[f"{side}_causes_trusted_labels"] = OrderedDict(Counter(
            r[f"{side}_cause"] for r in scored if r[f"{side}_cause"] and r["label_trust"] == "trusted").most_common())

    s["asr_effect"] = OrderedDict(Counter(r["asr_effect"] for r in rows).most_common())
    s["asr_effect_trusted_labels"] = OrderedDict(Counter(r["asr_effect"] for r in rows
                                                         if r["label_trust"] == "trusted").most_common())

    by = OrderedDict()
    for lang in ("kn", "hi"):
        for cls in ("valid", "out_of_scope", "clarify", "undetermined"):
            cell = [r for r in rows if r["language"] == lang and r["review_class"] == cls]
            if not cell:
                continue
            sc = [r for r in cell if r["ref_correct"] is not None]
            sh = [r for r in cell if r["hyp_correct"] is not None]
            by[f"{lang}|{cls}"] = OrderedDict(
                n=len(cell), ref_scored=len(sc), ref_correct=sum(r["ref_correct"] for r in sc),
                hyp_scored=len(sh), hyp_correct=sum(r["hyp_correct"] for r in sh),
                ref_starts=sum(r["ref"]["starts"] for r in cell),
                ref_starts_with_no_evidence=sum(r["ref"]["starts"] and not r["ref"]["evidence"] for r in cell),
                ref_llm_gated=sum(r["ref"]["llm_gated"] for r in cell))
    s["by_language_and_class"] = by

    s["normalization"] = OrderedDict(
        ref_text_changed=sum(r["ref"]["normalization_changed_text"] for r in rows),
        ref_decision_changed=sum(r["ref"]["normalization_changed_decision"] for r in rows),
        hyp_text_changed=sum(r["hyp"]["normalization_changed_text"] for r in rows if r["hyp"]),
        hyp_decision_changed=sum(r["hyp"]["normalization_changed_decision"] for r in rows if r["hyp"]),
    )

    # Model separation: margins of decisions that are right vs wrong.
    s["margins"] = OrderedDict(
        valid_correct_starts=margins(rows, lambda r: r["review_class"] == "valid" and r["ref_correct"]),
        out_of_scope_starts=margins(rows, lambda r: r["review_class"] == "out_of_scope" and r["ref"]["starts"]),
        out_of_scope_no_start=margins(rows, lambda r: r["review_class"] == "out_of_scope"
                                      and not r["ref"]["starts"] and not r["ref"]["llm_gated"]),
        out_of_scope_starts_no_evidence=margins(rows, lambda r: r["review_class"] == "out_of_scope"
                                                and r["ref"]["starts"] and not r["ref"]["evidence"]),
    )
    s["best_anchor_on_out_of_scope_starts"] = OrderedDict(Counter(
        r["ref"]["best_anchor"] for r in rows if r["review_class"] == "out_of_scope" and r["ref"]["starts"]
    ).most_common())
    s["started_service_on_out_of_scope"] = OrderedDict(Counter(
        started(r["ref"]) for r in rows if r["review_class"] == "out_of_scope" and r["ref"]["starts"]
    ).most_common())
    s["would_really_start_workflow_on_out_of_scope"] = sum(
        r["ref"]["workflow_defined"] for r in rows if r["review_class"] == "out_of_scope")

    s["general"] = OrderedDict(clips=general_total, decision_changed_by_asr=len(general_changes),
                               changes=OrderedDict(Counter(f"{c['ref_decision']} -> {c['hyp_decision']}"
                                                           for c in general_changes).most_common(12)))
    s["forms_failures"] = len(forms)
    return s


# =========================================================
# OUTPUT
# =========================================================

REVIEW_COLUMNS = ("id", "language", "split", "reference", "annotation_intent", "annotation_notes",
                  "m9_expected", "proposed_review_class", "proposed_expected", "predicted_on_reference",
                  "predicted_on_asr", "reason_for_review", "human_decision", "reviewer", "review_date")


def write_review_sheet(rows, path):
    """Every clip whose label needs a human, with blank columns for the reviewer."""
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(REVIEW_COLUMNS)
        for r in rows:
            if r["label_trust"] != "review":
                continue
            w.writerow([r["id"], r["language"], r["split"], r["reference"], r["annotation_intent"],
                        r["annotation_notes"] or "", r["m9_expected"] or "(no service)", r["review_class"],
                        r["expected"] or "(no service)", r["ref"]["decision"] + (" [LLM-gated]" if r["ref"]["llm_gated"] else ""),
                        (r["hyp"]["decision"] + (" [LLM-gated]" if r["hyp"]["llm_gated"] else "")) if r["hyp"] else "",
                        r["label_reason"], "", "", ""])


def main(argv=None):
    import argparse
    global NAME
    parser = argparse.ArgumentParser(description="M10 routing diagnosis (offline).")
    parser.add_argument("--name", default=NAME)
    NAME = parser.parse_args(argv).name
    sys.stdout.reconfigure(encoding="utf-8")
    h.install_network_guard()
    engine = h.build_engine(with_retrieval=False)
    by_id, cached = load_inputs()
    clips = a.clips()

    rows = diagnose_banking(engine, clips, by_id, cached)
    general_total, general_changes = diagnose_general(engine, clips, cached)
    forms = diagnose_forms(engine)
    summary = summarize(rows, general_total, general_changes, forms)

    report = OrderedDict(
        meta=OrderedDict(name=NAME, labels="PROPOSED by tooling from annotation notes; NOT human-verified",
                         hypotheses=a.HYPOTHESES.name, llm="not called; LLM-gated turns are not scored"),
        summary=summary, banking=rows, general_changes=general_changes, forms=forms)
    (REPORTS / f"{NAME}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if NAME == "m10_diagnosis":
        # The review sheet belongs to the diagnosis run only; later runs
        # must not overwrite it.
        write_review_sheet(rows, REPORTS / "m10_annotation_review.csv")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
