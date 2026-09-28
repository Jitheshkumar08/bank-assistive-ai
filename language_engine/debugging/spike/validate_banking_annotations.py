"""Validate indicvoices_banking_annotations.json against the frozen manifest.

Read-only: opens the manifest and the annotation file, writes nothing. Checks the
frozen selection is untouched, the annotations cover it exactly, and every value
conforms to banking_annotation_schema.md. Prints the distribution summary and the
rows flagged for manual review, and exits non-zero on any failure.

Usage:
  python validate_banking_annotations.py [--json]
"""
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

SPIKE = Path(__file__).resolve().parent
MANIFEST = SPIKE / "indicvoices_banking_manifest.json"
ANNOTATIONS = SPIKE / "indicvoices_banking_annotations.json"
FROZEN_SHA = "02a773066224781dc9db08ed0049cc09ec7fa2de9f99d29b12aabe0799979427"

INTENTS = {"payment", "transfer", "balance", "deposit", "withdrawal", "other", "unknown"}
NEGATION = {"positive", "negative", "unclear"}
CONTROLS = {"pause", "resume", "repeat", "next", "cancel", "exit", "none"}
COMPLETION = {"completed", "not_completed", "unclear", "not_applicable"}
ID_TYPES = {"account_number", "upi_id", "reference_number", "phone_number", "ifsc",
            "card_number", "customer_id", "other"}
FIELDS = ["intent", "amount", "identifier", "negation", "control_type", "completion_signal", "notes"]
EXPECTED_TOTAL, EXPECTED_PER_LANG = 200, 100


def main():
    failures, notes = [], []

    def check(ok, msg):
        (notes if ok else failures).append(msg)

    sha = hashlib.sha256(MANIFEST.read_bytes()).hexdigest()
    check(sha == FROZEN_SHA, f"7. frozen manifest sha256 {'unchanged' if sha == FROZEN_SHA else 'CHANGED'}: {sha}")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    doc = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    utt = {u["id"]: u for u in manifest["utterances"]}
    order = [u["id"] for u in manifest["utterances"]]
    ann = doc["annotations"]
    ids = [a["id"] for a in ann]

    check(len(ann) == EXPECTED_TOTAL, f"1. rows: {len(ann)} (expected {EXPECTED_TOTAL})")
    check(ids == order, "2. row ids and order identical to the frozen manifest"
                        if ids == order else f"2. row ids differ from the manifest")
    same_text = [a["id"] for a in ann
                 if a["reference_transcript"].encode("utf-8") != utt[a["id"]]["reference_transcript"].encode("utf-8")]
    check(not same_text, "3. reference transcripts byte-for-byte identical to the manifest"
                         if not same_text else f"3. transcripts differ: {same_text[:5]}")
    check(len(set(ids)) == len(ids), f"4. duplicate ids: {len(ids) - len(set(ids))}")
    per_lang = Counter(a["language"] for a in ann)
    check(per_lang.get("kn") == EXPECTED_PER_LANG and per_lang.get("hi") == EXPECTED_PER_LANG,
          f"5. languages: kn={per_lang.get('kn', 0)}, hi={per_lang.get('hi', 0)}")
    speakers = {a["speaker_id"] for a in ann}
    check(len(speakers) == EXPECTED_TOTAL, f"6. unique speakers: {len(speakers)}")
    mism = [a["id"] for a in ann if a["speaker_id"] != utt[a["id"]]["speaker_id"]
            or a["language"] != utt[a["id"]]["language"]]
    check(not mism, "speaker_id and language match the manifest" if not mism else f"metadata differs: {mism[:5]}")

    # schema conformance
    for a in ann:
        p, ref, i = a["project_annotations"], a["reference_transcript"], a["id"]
        if sorted(p) != sorted(FIELDS):
            failures.append(f"{i}: fields {sorted(p)}")
            continue
        if p["intent"] not in INTENTS:
            failures.append(f"{i}: intent {p['intent']!r}")
        if p["negation"] not in NEGATION:
            failures.append(f"{i}: negation {p['negation']!r}")
        if p["control_type"] not in CONTROLS:
            failures.append(f"{i}: control_type {p['control_type']!r}")
        if p["completion_signal"] not in COMPLETION:
            failures.append(f"{i}: completion_signal {p['completion_signal']!r}")
        if not (p["amount"] is None or (isinstance(p["amount"], (int, float))
                                        and not isinstance(p["amount"], bool) and p["amount"] > 0)):
            failures.append(f"{i}: amount {p['amount']!r}")
        if not (p["notes"] is None or (isinstance(p["notes"], str) and p["notes"].strip())):
            failures.append(f"{i}: notes {p['notes']!r}")
        if p["negation"] in ("negative", "unclear") and not p["notes"]:
            failures.append(f"{i}: negation {p['negation']} requires notes")
        ident = p["identifier"]
        if ident is not None:
            if not isinstance(ident, list) or not ident:
                failures.append(f"{i}: identifier must be a non-empty list or null")
                continue
            for e in ident:
                if sorted(e) != ["digits", "span", "type"]:
                    failures.append(f"{i}: identifier keys {sorted(e)}")
                    continue
                if e["type"] not in ID_TYPES:
                    failures.append(f"{i}: identifier type {e['type']!r}")
                if e["digits"] is not None and not re.fullmatch(r"[0-9]+", e["digits"]):
                    failures.append(f"{i}: digits {e['digits']!r} not an ASCII digit string")
                if not isinstance(e["span"], str) or e["span"] not in ref:
                    failures.append(f"{i}: span is not an exact substring of the reference")
                if e["digits"] is None and not p["notes"]:
                    failures.append(f"{i}: null digits require notes")

    nulls = {
        "amount_null": sum(a["project_annotations"]["amount"] is None for a in ann),
        "identifier_null": sum(a["project_annotations"]["identifier"] is None for a in ann),
        "notes_null": sum(a["project_annotations"]["notes"] is None for a in ann),
        "intent_unknown": sum(a["project_annotations"]["intent"] == "unknown" for a in ann),
        "negation_unclear": sum(a["project_annotations"]["negation"] == "unclear" for a in ann),
        "completion_unclear": sum(a["project_annotations"]["completion_signal"] == "unclear" for a in ann),
        "identifier_entries_with_null_digits": sum(
            e["digits"] is None for a in ann for e in (a["project_annotations"]["identifier"] or [])),
    }
    review = [a for a in ann if a["review"]["needs_manual_review"]]

    def dist(key):
        out = {}
        for lang in ("kn", "hi"):
            out[lang] = dict(sorted(Counter(a["project_annotations"][key] for a in ann
                                            if a["language"] == lang).items()))
        out["all"] = dict(sorted(Counter(a["project_annotations"][key] for a in ann).items()))
        return out

    summary = {
        "rows": len(ann), "by_language": dict(sorted(per_lang.items())), "unique_speakers": len(speakers),
        "intent": dist("intent"), "negation": dist("negation"), "control_type": dist("control_type"),
        "completion_signal": dist("completion_signal"),
        "amount_present": {l: sum(a["project_annotations"]["amount"] is not None
                                  for a in ann if a["language"] == l) for l in ("kn", "hi")},
        "identifier_rows": {l: sum(a["project_annotations"]["identifier"] is not None
                                   for a in ann if a["language"] == l) for l in ("kn", "hi")},
        "identifier_entries_by_type": dict(sorted(Counter(
            e["type"] for a in ann for e in (a["project_annotations"]["identifier"] or [])).items())),
        "nulls_and_unclear": nulls,
        "needs_manual_review": len(review),
    }

    if "--json" in sys.argv:
        print(json.dumps({"summary": summary, "failures": failures,
                          "review": [{"id": a["id"], "reasons": a["review"]["reasons"]} for a in review]},
                         ensure_ascii=False, indent=1))
    else:
        for line in notes:
            print("OK  ", line)
        print()
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        print("\nRows needing manual review:")
        for a in review:
            print(f"  {a['id']}: " + "; ".join(a["review"]["reasons"]))
        print()
        if failures:
            print(f"FAILURES ({len(failures)}):")
            for f in failures:
                print("  -", f)
        else:
            print("All checks passed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
