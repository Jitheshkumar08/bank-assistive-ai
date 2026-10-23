"""
M9 -- CODE-MIXED ASR EVALUATION: HARNESS TESTS

Regression tests for evaluation/asr_harness.py: the dev / held-out split,
the clip inventory, loanword detection, per-clip scoring, the summaries and
the ASR-forms fixture.

WHAT IS SIMULATED

No recogniser runs here. Per-clip scoring is exercised with hand-written
hypotheses standing in for ASR output, so these tests prove the SCORING is
right -- not that recognition is. Real-speech numbers come only from
`python -m evaluation.asr_harness --audio`.

Offline: no network, no ASR model, no audio decoding.

Run from language_engine/:

    python -m debugging.test_m9_asr
"""

import hashlib
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from evaluation import asr_harness as a
from evaluation import harness as h


PASSED = []
FAILED = []

#: The forms fixture is held-out: any edit after M9's baseline must be
#: deliberate, so its hash is pinned.
FORMS_SHA256 = "81b735a708daecf24a05188a8c3fdbc181481ea62d666aacc0c76c9cec092b90"

_ENGINE = None


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def engine():
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = h.build_engine(with_retrieval=False)
    return _ENGINE


def clip(reference, hypothesis, language="kn", gold=None, has_gold=False, set_name="banking", clip_id="ivb_kn_001"):
    return {"id": clip_id, "set": set_name, "language": language, "split": a.split_of(set_name, clip_id),
            "audio": "", "audio_seconds": 3.0, "reference": reference, "gold_amount": gold,
            "has_gold_amount": has_gold, "gold_intent": None, "hypothesis": hypothesis, "provider": "test", "model": "test",
            "fallback_used": False, "error": None, "seconds": 0.0}


def test_split_is_fixed_by_id():
    check("banking 001 is dev", a.split_of("banking", "ivb_kn_001") == "dev")
    check("banking 050 is dev", a.split_of("banking", "ivb_hi_050") == "dev")
    check("banking 051 is held-out", a.split_of("banking", "ivb_kn_051") == "held-out")
    check("banking 100 is held-out", a.split_of("banking", "ivb_hi_100") == "held-out")
    check("general clips are always held-out", a.split_of("general", "iv_kn_001") == "held-out")


def test_clip_inventory():
    items = a.clips()
    check("600 clips", len(items) == 600, str(len(items)))
    check("ids are unique", len({c["id"] for c in items}) == len(items))
    dev = [c for c in items if c["split"] == "dev"]
    check("100 dev clips, 50 per language",
          len(dev) == 100 and sum(c["language"] == "kn" for c in dev) == 50)
    check("dev clips are all banking", all(c["set"] == "banking" for c in dev))
    check("every clip has a reference", all(c["reference"].strip() for c in items))
    check("every audio file exists", all(os.path.exists(c["audio"]) for c in items))
    check("gold amounts only on banking clips",
          all(c["gold_amount"] is None for c in items if c["set"] == "general"))
    check("--limit caps clips per language per set", len(a.clips(limit=2)) == 8)
    check("listing clips loads no recogniser", "app.speech.asr.factory" not in sys.modules)


def test_loanwords():
    check("native-script English words are found",
          len(a.loanwords("ನನ್ನ ಅಕೌಂಟ್ ಬ್ಯಾಲೆನ್ಸ್ ಹೇಳಿ", "kn")) == 2)
    check("an inflected loanword still counts", len(a.loanwords("ಬ್ಯಾಂಕ್ನಲ್ಲಿ ಹಣ ಇದೆ", "kn")) == 1)
    check("Hindi loanwords are found", len(a.loanwords("मेरा अकाउंट बैलेंस", "hi")) == 2)
    check("native words are not loanwords", a.loanwords("ನನಗೆ ಹಣ ಬೇಕು", "kn") == [])
    check("Latin text is not a native-script loanword", a.loanwords("my account", "hi") == [])


def test_identical_hypothesis_scores_perfectly():
    ref = "ನನ್ನ ಅಕೌಂಟ್ ಗೆ ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು"
    r = a.score_clip(clip(ref, ref, gold=5000, has_gold=True), engine())
    check("no word edits", r["word_edits"] == 0)
    check("no character edits", r["char_edits"] == 0)
    check("exact", r["exact"])
    check("code-mixed category", r["category"] == "kn-en")
    check("loanword recalled", r["loanwords_ref"] == 1 and r["loanwords_hit"] == 1)
    check("amount correct end to end", r["amount_effect"] == "correct")
    check("amount unchanged by ASR", r["asr_amount_effect"] == "correct")
    check("routing unchanged", r["intent_effect"] == "unchanged")


def test_asr_errors_are_counted():
    r = a.score_clip(clip("ನನ್ನ ಅಕೌಂಟ್ ಬ್ಯಾಲೆನ್ಸ್ ಹೇಳಿ", "ನನ್ನ ಅಕೌಂಟ ಬಾಲೆನ್ಸ್ ಹೇಳಿ"), engine())
    check("two substitutions", (r["subs"], r["dels"], r["ins"]) == (2, 0, 0), str((r["subs"], r["dels"], r["ins"])))
    check("WER numerator is the edit total", r["word_edits"] == 2)
    check("not exact", not r["exact"])
    check("a misrecognised loanword is a miss", r["loanwords_hit"] < r["loanwords_ref"])
    check("plain-Kannada clip is not code-mixed",
          a.score_clip(clip("ನನಗೆ ಹಣ ಬೇಕು", "ನನಗೆ ಹಣ ಬೇಕು"), engine())["category"] == "kn")


def test_amount_effects():
    ref = "ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು"
    wrong = a.score_clip(clip(ref, "ಆರು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು", gold=5000, has_gold=True), engine())
    check("a changed amount is wrong", wrong["amount_effect"] == "wrong" and wrong["asr_amount_effect"] == "wrong")
    lost = a.score_clip(clip(ref, "ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು", gold=5000, has_gold=True), engine())
    check("a dropped amount is lost", lost["asr_amount_effect"] == "lost")
    invented = a.score_clip(clip("ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "ಐದು ಸಾವಿರ ಜಮಾ ಮಾಡಬೇಕು"), engine())
    check("an amount ASR adds is invented", invented["asr_amount_effect"] == "invented")
    general = a.score_clip(clip(ref, ref, set_name="general", clip_id="iv_kn_001"), engine())
    check("without gold the reference parse is the target",
          general["target_amount"] == general["ref_amount"] == 5000 and general["amount_effect"] == "correct")
    declined = a.score_clip(clip("ರೂಪಾಯಿ ಕಳುಹಿಸಿ", "ರೂಪಾಯಿ ಕಳುಹಿಸಿ", gold=500, has_gold=True), engine())
    check("end to end keeps a gold amount the reference never states",
          declined["amount_effect"] == "lost" and declined["asr_amount_effect"] == "correct")


def test_routing_effects():
    ref = "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು"
    base = a.score_clip(clip(ref, ref), engine())
    check("reference starts a deposit", base["ref_decision"] == ["start", "deposit money"], str(base["ref_decision"]))
    empty = a.score_clip(clip(ref, ""), engine())
    check("empty hypothesis loses the service", empty["intent_effect"] == "service_lost"
          and empty["hyp_decision"] == ["empty"])
    swapped = a.score_clip(clip(ref, "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು"), engine())
    check("a different service is wrong_service", swapped["intent_effect"] == "wrong_service",
          str(swapped["hyp_decision"]))


def test_routing_against_gold():
    deposit = clip("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    deposit["gold_intent"] = "deposit"
    r = a.score_clip(deposit, engine())
    check("in-scope clip", r["in_scope"])
    check("reference decision is right", r["ref_vs_gold"] == "correct")
    check("ASR decision is the wrong service", r["hyp_vs_gold"] == "wrong_service")
    transfer = clip("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "")
    transfer["gold_intent"] = "transfer"
    r = a.score_clip(transfer, engine())
    check("out of scope: starting a service is counted", not r["in_scope"]
          and r["ref_vs_gold"] == "started_out_of_scope")
    check("out of scope: starting nothing is right", r["hyp_vs_gold"] == "correct")
    general = a.score_clip(clip("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", "", set_name="general", clip_id="iv_kn_001"), engine())
    check("no annotation, no gold comparison", general["ref_vs_gold"] is None and not general["in_scope"])


def test_summary_arithmetic():
    rows = [a.score_clip(clip("ಐದು ಸಾವಿರ ರೂಪಾಯಿ", "ಐದು ಸಾವಿರ ರೂಪಾಯಿ", gold=5000, has_gold=True), engine()),
            a.score_clip(clip("ಹಣ ಕಳುಹಿಸಿ ದಯವಿಟ್ಟು", "ಹಣ ಕಳಿಸಿ", clip_id="ivb_kn_002"), engine())]
    s = a.summarize_audio(rows)
    cell = s["banking|dev|kn"]
    check("pooled WER = edits / reference words", cell["wer"] == round(100 * 2 / 6, 1), str(cell["wer"]))
    check("clips counted", cell["clips"] == 2 and cell["exact"] == 1)
    check("only gold-annotated clips count as amounts", cell["amounts"] == 1 and cell["amounts_correct"] == 1)
    check("language roll-up present", s["banking|dev|kn (all)"]["clips"] == 2)
    check("the report renders", "banking / dev / kn" in a.render_audio(
        {"meta": {"name": "t"}, "summary": s, "limits": ["x"], "rows": rows}))


def test_forms_fixture_is_valid_and_frozen():
    raw = a.FORMS_FILE.read_bytes()
    check("forms fixture unchanged since the M9 baseline", hashlib.sha256(raw).hexdigest() == FORMS_SHA256)
    doc = json.loads(raw.decode("utf-8"))
    items = doc["items"]
    check("says it is text, not audio", "TEXT ONLY" in doc["description"])
    check("ids unique", len({i["id"] for i in items}) == len(items))
    check("every language group is covered", {i["lang"] for i in items} == {"kn", "hi", "en", "kn-en", "hi-en"})
    check("categories are harness categories", all(i["category"] in h.CATEGORIES for i in items))
    check("first form is the reference", all(i["forms"][0]["kind"] == "reference" for i in items))
    check("form kinds unique within an item",
          all(len({f["kind"] for f in i["forms"]}) == len(i["forms"]) for i in items))
    relabelled = [f for i in items for f in i["forms"] if "category" in f or "expected" in f]
    check("a relabelled form carries both category and expected",
          relabelled and all("category" in f and "expected" in f for f in relabelled))
    check("refusals name the workflow in progress",
          all(i.get("context", {}).get("active_workflow") for i in items if i["category"] == "refusal"))


def test_forms_use_their_own_labels():
    _, rows = a.evaluate_forms(engine())
    clipped = [r for r in rows if r["item"] == "svc-kn-901" and r["kind"] == "clipped"][0]
    check("a relabelled form is scored on its own category", clipped["category"] == "ambiguous_request"
          and clipped["relabelled"])
    agreement = a.summarize_forms(rows)["agreement_with_reference_form"]
    compared = agreement["same"] + agreement["changed"]
    check("relabelled forms are left out of reference agreement",
          compared == sum(1 for r in rows if r["kind"] != "reference" and not r["relabelled"]), str(compared))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    h.install_network_guard()
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M9 ASR HARNESS TESTS")
    print("=" * 60)

    for test in tests:
        print(f"\n{test.__name__}")
        test()

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
