"""
M9 -- CODE-MIXED SPEECH-RECOGNITION EVALUATION

Two measurements, kept apart because they answer different questions.

1. REAL SPEECH (--audio). The production recogniser (app/speech/asr,
   create_recognizer(): IndicConformer for Kannada and Hindi, Whisper for
   English and as fallback) is run over the IndicVoices clips already on
   disk, and its transcripts are scored against their reference transcripts:
   WER, CER, exact match, English-loanword and banking-term recognition,
   amount preservation (against the annotated amounts where they exist), and
   the change ASR errors cause downstream (the same routing as production,
   on the reference vs. on the hypothesis).

   What exists on disk, and what it can and cannot show:
     banking   200 clips (100 kn, 100 hi), "Digital Payment Commands", from
               IndicVoices' TRAIN split -- which IndicConformer was very
               likely trained on, so these numbers are OPTIMISTIC.
     general   400 clips (200 kn, 200 hi), IndicVoices VALIDATION split:
               a cleaner measurement, but not banking content.
     English, and code-switching with English in Latin script: NO audio.
     Those categories cannot be measured from speech here at all.

   The split was fixed before any result existed: banking clips 001-050 of
   each language are DEV (the only data any fix may be based on); banking
   051-100 and every general clip are HELD-OUT.

2. ASR OUTPUT FORMS (--text). evaluation/fixtures/asr/m9_asr_forms.json gives,
   for each reference utterance, the forms an ASR system writes it in
   (English words in native script as IndicConformer writes them, in Latin
   as Whisper or a typist writes them, numbers as words or digits, clipped
   or with fillers). Each form goes through the production routing and is
   scored against the reference's label. These are TEXT, written to mirror
   documented ASR behaviour -- not recognised audio -- and they measure how
   robust the language layer is to ASR output, not how accurate ASR is.

Offline by construction: the M0 network guard is installed and Hugging Face
is forced offline; the models are read from the local cache.

Run from language_engine/:

    venv/Scripts/python.exe -m evaluation.asr_harness --audio --name m9_asr_baseline
    venv/Scripts/python.exe -m evaluation.asr_harness --text --name m9_forms_baseline
"""
from __future__ import annotations

import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import argparse
import contextlib
import io
import json
import sys
import time
from collections import Counter, OrderedDict
from pathlib import Path

from evaluation import harness as h

ROOT = Path(__file__).resolve().parent
SPIKE = ROOT.parent / "debugging" / "spike"
REPORTS = ROOT / "reports"
FORMS_FILE = ROOT / "fixtures" / "asr" / "m9_asr_forms.json"
HYPOTHESES = REPORTS / "m9_asr_hypotheses.jsonl"

SETS = {
    "banking": (SPIKE / "indicvoices_banking_manifest.json", SPIKE / "corpus" / "indicvoices_banking"),
    "general": (SPIKE / "indicvoices_general_manifest.json", SPIKE / "corpus" / "indicvoices"),
}

#: English words written in Kannada / Hindi script, for the CODE-MIXED
#: category and loanword recognition. Evaluation-only; fixed before results.
#: A clip whose reference contains one is "kn-en" / "hi-en".
LOANWORD_MARKERS = {
    "kn": ("ಬ್ಯಾಂಕ್", "ಅಕೌಂಟ್", "ಟ್ರಾನ್ಸ್ಫರ್", "ಬ್ಯಾಲೆನ್ಸ್", "ಮೊಬೈಲ್", "ಫೋನ್", "ನಂಬರ್", "ಆಪ್", "ಗೂಗಲ್",
           "ಪೇ", "ಕಾರ್ಡ್", "ಕ್ರೆಡಿಟ್", "ಡೆಬಿಟ್", "ಲೋನ್", "ಚೆಕ್", "ಪಾಸ್ಬುಕ್", "ಆನ್ಲೈನ್", "ಯುಪಿಐ", "ಪೇಮೆಂಟ್",
           "ರೀಚಾರ್ಜ್", "ಬಿಲ್", "ಇನ್ಶೂರೆನ್ಸ್", "ಅಲರ್ಟ್", "ಮೆಸೇಜ್", "ಓಟಿಪಿ", "ಪಿನ್", "ಎಟಿಎಂ", "ಸ್ಟೇಟ್ಮೆಂಟ್",
           "ಟ್ರಾನ್ಸಾಕ್ಷನ್", "ಡೆಪಾಸಿಟ್", "ಕ್ಯಾಶ್", "ವ್ಯಾಲೆಟ್", "ಪೇಟಿಎಂ", "ಫೋನ್ಪೇ"),
    "hi": ("बैंक", "अकाउंट", "ट्रांसफर", "बैलेंस", "मोबाइल", "फोन", "नंबर", "ऐप", "गूगल", "पे", "कार्ड",
           "क्रेडिट", "डेबिट", "लोन", "चेक", "पासबुक", "ऑनलाइन", "यूपीआई", "पेमेंट", "रिचार्ज", "बिल",
           "इंश्योरेंस", "अलर्ट", "मैसेज", "ओटीपी", "पिन", "एटीएम", "स्टेटमेंट", "ट्रांजैक्शन", "डिपॉजिट",
           "कैश", "वॉलेट", "पेटीएम", "फोनपे"),
}


#: Annotated intents (first pass, not human-verified) that name one of the
#: assistant's services. Every other annotated intent (transfer, payment,
#: other) is outside them: the right decision is to start nothing.
GOLD_SERVICE = {"balance": "check account balance", "deposit": "deposit money", "withdrawal": "withdraw money"}


def split_of(set_name, clip_id):
    """DEV or HELD-OUT, fixed before any result: see the module docstring."""
    if set_name == "banking" and int(clip_id.rsplit("_", 1)[1]) <= 50:
        return "dev"
    return "held-out"


# =========================================================
# 1  REAL SPEECH
# =========================================================

def clips(limit=None):
    out = []
    annotations = json.loads((SPIKE / "indicvoices_banking_annotations.json").read_text(encoding="utf-8"))
    gold = {a["id"]: a["project_annotations"] for a in annotations["annotations"]}
    for set_name, (manifest, audio_dir) in SETS.items():
        utterances = json.loads(manifest.read_text(encoding="utf-8"))["utterances"]
        per_language = Counter()
        for u in utterances:
            if limit and per_language[u["language"]] >= limit:
                continue
            per_language[u["language"]] += 1
            out.append({
                "id": u["id"], "set": set_name, "language": u["language"],
                "split": split_of(set_name, u["id"]),
                "audio": str(audio_dir / u["language"] / f"{u['id']}.wav"),
                "audio_seconds": u.get("duration_seconds"),
                "reference": u["reference_transcript"],
                "gold_amount": gold.get(u["id"], {}).get("amount") if set_name == "banking" else None,
                "gold_intent": gold.get(u["id"], {}).get("intent") if set_name == "banking" else None,
                "has_gold_amount": set_name == "banking",
            })
    return out


def transcribe_all(items):
    """Production recogniser over every clip; cached so scoring is repeatable."""
    cached = {}
    if HYPOTHESES.exists():
        for line in HYPOTHESES.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            cached[row["id"]] = row

    missing = [c for c in items if c["id"] not in cached]
    if missing:
        from app.speech.asr import create_recognizer

        with contextlib.redirect_stdout(io.StringIO()):
            recognizer = create_recognizer()
        with HYPOTHESES.open("a", encoding="utf-8") as out:
            for index, clip in enumerate(missing, 1):
                started = time.perf_counter()
                row = {"id": clip["id"], "language": clip["language"]}
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        result = recognizer.transcribe(clip["audio"], language=clip["language"])
                    row.update(hypothesis=result.text, provider=result.provider, model=result.model,
                               fallback_used=result.fallback_used, error=None)
                except Exception as error:     # recorded, never hidden
                    row.update(hypothesis="", provider=None, model=None, fallback_used=None,
                               error=f"{type(error).__name__}: {error}")
                row["seconds"] = round(time.perf_counter() - started, 3)
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
                cached[clip["id"]] = row
                if index % 25 == 0:
                    print(f"  transcribed {index}/{len(missing)}", file=sys.stderr)
    return [dict(c, **{k: cached[c["id"]][k] for k in ("hypothesis", "provider", "model", "fallback_used",
                                                      "error", "seconds")}) for c in items]


def _scoring():
    from debugging.spike.benchmark_asr import levenshtein, normalise_for_scoring
    from debugging.spike.benchmark_indicvoices_asr import align_counts
    return levenshtein, normalise_for_scoring, align_counts


def _marker_set(language):
    from app.dialogue.text_normalization import fold_word
    return tuple(fold_word(m) for m in LOANWORD_MARKERS[language])


def loanwords(text, language):
    """English words written in native script in `text` (folded tokens)."""
    from app.dialogue.text_normalization import word_tokens
    markers = _marker_set(language)
    return [w for w in word_tokens(text) if w.startswith(markers)]


def score_clip(clip, engine):
    levenshtein, normalise, align = _scoring()
    from app.dialogue.indic_numbers import extract_amount
    from app.dialogue.text_normalization import routing_text
    from app.intent.service_keywords import service_evidence
    from app.knowledge.query_preparation import knowledge_terms

    ref, hyp = clip["reference"], clip["hypothesis"] or ""
    ref_n, hyp_n = normalise(ref), normalise(hyp)
    ref_w, hyp_w = ref_n.split(), hyp_n.split()
    s, d, i = align(ref_w, hyp_w)
    ref_c, hyp_c = ref_n.replace(" ", ""), hyp_n.replace(" ", "")

    ref_loan, hyp_loan = loanwords(ref, clip["language"]), loanwords(hyp, clip["language"])
    remaining = list(hyp_loan)
    loan_hits = 0
    for w in ref_loan:
        if w in remaining:
            remaining.remove(w)
            loan_hits += 1

    ref_route, hyp_route = routing_text(ref), routing_text(hyp)
    ref_terms = set(knowledge_terms(ref_route)) | set(service_evidence(ref_route))
    hyp_terms = set(knowledge_terms(hyp_route)) | set(service_evidence(hyp_route))

    ref_amount, hyp_amount = extract_amount(ref_route), extract_amount(hyp_route)
    target = clip["gold_amount"] if clip["has_gold_amount"] else ref_amount

    r, hy = engine.route(ref), engine.route(hyp) if hyp else None

    def decision(route):
        if route is None:
            return ("empty",)
        if route["stage"] != "detector":
            return (route["stage"],)
        if route["is_banking"] and not h._refused(route):
            return ("start", route["intent"])
        return ("no-start", route["category"])

    rd, hd = decision(r), decision(hy)
    if rd == hd:
        intent_effect = "unchanged"
    elif rd[0] == "start" and hd[0] == "start":
        intent_effect = "wrong_service"
    elif rd[0] == "start":
        intent_effect = "service_lost"
    elif hd[0] == "start":
        intent_effect = "service_invented"
    else:
        intent_effect = "changed_non_service"

    def amount_outcome(expected):
        if hyp_amount == expected:
            return "correct"
        if expected is None:
            return "invented"
        return "lost" if hyp_amount is None else "wrong"

    # End to end: against the annotated amount (banking) -- this includes
    # what M1 deliberately declines on the reference itself. ASR effect:
    # against the amount parsed from the REFERENCE, which isolates what
    # recognition errors did.
    amount_effect = amount_outcome(target)
    asr_amount_effect = amount_outcome(ref_amount)

    def against_gold(d):
        # Banking clips only: was the decision right for the annotated intent?
        if not clip.get("gold_intent"):
            return None
        wanted = GOLD_SERVICE.get(clip["gold_intent"])
        started = d[1] if d[0] == "start" else None
        if wanted:
            return "correct" if started == wanted else ("wrong_service" if started else "no_start")
        return "started_out_of_scope" if started else "correct"

    category = f"{clip['language']}-en" if ref_loan else clip["language"]
    return OrderedDict(
        id=clip["id"], set=clip["set"], split=clip["split"], language=clip["language"], category=category,
        reference=ref, hypothesis=hyp, provider=clip["provider"], fallback_used=clip["fallback_used"],
        error=clip["error"], audio_seconds=clip["audio_seconds"], seconds=clip["seconds"],
        ref_words=len(ref_w), word_edits=s + d + i, subs=s, dels=d, ins=i,
        ref_chars=len(ref_c), char_edits=levenshtein(ref_c, hyp_c), exact=ref_n == hyp_n,
        latin_in_hypothesis=any("a" <= ch.lower() <= "z" for ch in hyp),
        loanwords_ref=len(ref_loan), loanwords_hit=loan_hits,
        terms_ref=sorted(ref_terms), terms_hyp=sorted(hyp_terms),
        target_amount=target, ref_amount=ref_amount, hyp_amount=hyp_amount,
        has_amount=target is not None, amount_effect=amount_effect,
        asr_amount_effect=asr_amount_effect,
        ref_decision=list(rd), hyp_decision=list(hd), intent_effect=intent_effect,
        gold_intent=clip.get("gold_intent"), in_scope=clip.get("gold_intent") in GOLD_SERVICE,
        ref_vs_gold=against_gold(rd), hyp_vs_gold=against_gold(hd),
    )


def summarize_audio(rows):
    def block(cell):
        words = sum(r["ref_words"] for r in cell) or 1
        chars = sum(r["ref_chars"] for r in cell) or 1
        loan = sum(r["loanwords_ref"] for r in cell)
        terms = [(t in r["terms_hyp"]) for r in cell for t in r["terms_ref"]]
        amounts = [r for r in cell if r["has_amount"]]
        return OrderedDict(
            clips=len(cell),
            audio_minutes=round(sum(r["audio_seconds"] or 0 for r in cell) / 60, 1),
            wer=round(100 * sum(r["word_edits"] for r in cell) / words, 1),
            cer=round(100 * sum(r["char_edits"] for r in cell) / chars, 1),
            exact=sum(r["exact"] for r in cell),
            loanwords=loan,
            loanword_recall=round(100 * sum(r["loanwords_hit"] for r in cell) / loan, 1) if loan else None,
            banking_terms=len(terms),
            banking_term_recall=round(100 * sum(terms) / len(terms), 1) if terms else None,
            amounts=len(amounts),
            amounts_correct=sum(r["amount_effect"] == "correct" for r in amounts),
            amounts_wrong=sum(r["amount_effect"] == "wrong" for r in cell),
            amounts_lost=sum(r["amount_effect"] == "lost" for r in cell),
            amounts_invented=sum(r["amount_effect"] == "invented" for r in cell),
            asr_amount=OrderedDict(sorted(Counter(r["asr_amount_effect"] for r in cell
                                                  if r["ref_amount"] is not None or r["hyp_amount"] is not None
                                                  ).items())),
            intent=OrderedDict(sorted(Counter(r["intent_effect"] for r in cell).items())),
            in_scope=sum(r["in_scope"] for r in cell),
            in_scope_ref_correct=sum(r["in_scope"] and r["ref_vs_gold"] == "correct" for r in cell),
            in_scope_hyp_correct=sum(r["in_scope"] and r["hyp_vs_gold"] == "correct" for r in cell),
            out_of_scope=sum(r["gold_intent"] is not None and not r["in_scope"] for r in cell),
            out_of_scope_ref_started=sum(r["ref_vs_gold"] == "started_out_of_scope" for r in cell),
            out_of_scope_hyp_started=sum(r["hyp_vs_gold"] == "started_out_of_scope" for r in cell),
            errors=sum(1 for r in cell if r["error"]),
            fallbacks=sum(1 for r in cell if r["fallback_used"]),
            latin_in_hypothesis=sum(r["latin_in_hypothesis"] for r in cell),
        )

    out = OrderedDict()
    for set_name in SETS:
        for split in ("dev", "held-out"):
            for category in ("kn", "kn-en", "hi", "hi-en"):
                cell = [r for r in rows if r["set"] == set_name and r["split"] == split and r["category"] == category]
                if cell:
                    out[f"{set_name}|{split}|{category}"] = block(cell)
            for language in ("kn", "hi"):
                cell = [r for r in rows if r["set"] == set_name and r["split"] == split and r["language"] == language]
                if cell:
                    out[f"{set_name}|{split}|{language} (all)"] = block(cell)
    return out


def render_audio(report):
    lines = [f"# M9 ASR evaluation on real speech: {report['meta']['name']}", "",
             "Production recogniser on the IndicVoices clips on disk. Scored with the Phase 3.2B-7 "
             "normalisation, unchanged (number words vs digits and native vs Latin script count as errors).", "",
             "**Banking clips are from IndicVoices' train split, which IndicConformer was very likely trained on: "
             "those numbers are optimistic. General clips are from the validation split. There is no English "
             "audio and no Latin-script code-switching audio, so those categories are not measured here.**", "",
             "| Set / split / category | clips | min | WER % | CER % | exact | loanwords (recall %) | banking terms "
             "(recall %) | amount vs gold: correct / wrong / lost / invented | amount vs reference (ASR effect) | intent: unchanged / wrong service / lost / "
             "invented / other | errors | fallbacks |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for key, c in report["summary"].items():
        it = c["intent"]
        lines.append(
            f"| {key.replace('|', ' / ')} | {c['clips']} | {c['audio_minutes']} | {c['wer']} | {c['cer']} | {c['exact']} "
            f"| {c['loanwords']} ({c['loanword_recall'] if c['loanword_recall'] is not None else '–'}) "
            f"| {c['banking_terms']} ({c['banking_term_recall'] if c['banking_term_recall'] is not None else '–'}) "
            f"| {c['amounts_correct']}/{c['amounts']} · {c['amounts_wrong']} · {c['amounts_lost']} · {c['amounts_invented']} "
            f"| {', '.join(f'{k} {v}' for k, v in c['asr_amount'].items()) or '–'} "
            f"| {it.get('unchanged', 0)} / {it.get('wrong_service', 0)} / {it.get('service_lost', 0)} / "
            f"{it.get('service_invented', 0)} / {it.get('changed_non_service', 0)} | {c['errors']} | {c['fallbacks']} |")
    lines += ["", "## Routing against the annotated intent (banking clips)", "",
              "Annotations are first-pass and not human-verified. In scope: the annotated intent is one of the "
              "assistant's services (balance, deposit, withdrawal); the right decision is to start it. Out of "
              "scope (transfer, payment, other): the right decision is to start nothing.", "",
              "| Set / split / category | in scope | correct on reference | correct on ASR | out of scope | "
              "started on reference | started on ASR |", "|---|---|---|---|---|---|---|"]
    for key, c in report["summary"].items():
        if key.startswith("banking") and c["in_scope"] + c["out_of_scope"]:
            lines.append(f"| {key.replace('|', ' / ')} | {c['in_scope']} | {c['in_scope_ref_correct']} | "
                         f"{c['in_scope_hyp_correct']} | {c['out_of_scope']} | {c['out_of_scope_ref_started']} | "
                         f"{c['out_of_scope_hyp_started']} |")
    lines += ["", "## Clips where ASR changed the amount or the routing decision", "",
              "| Clip | split | category | effect | reference | hypothesis |", "|---|---|---|---|---|---|"]
    for r in report["rows"]:
        effects = []
        if r["asr_amount_effect"] != "correct":
            effects.append(f"ASR changed the amount ({r['asr_amount_effect']}): {r['ref_amount']} -> {r['hyp_amount']}")
        if r["intent_effect"] != "unchanged":
            effects.append(f"routing {r['intent_effect']}: {'/'.join(map(str, r['ref_decision']))} -> "
                           f"{'/'.join(map(str, r['hyp_decision']))}")
        if effects:
            lines.append(f"| {r['id']} | {r['split']} | {r['category']} | {'; '.join(effects)} "
                         f"| {h._md_escape(r['reference'][:90])} | {h._md_escape(r['hypothesis'][:90])} |")
    lines += ["", "## Limits", ""] + [f"- {x}" for x in report["limits"]] + [""]
    return "\n".join(lines)


AUDIO_LIMITS = (
    "No English audio and no recording with English in Latin script exist on disk: English and "
    "Latin-script code-switching are not measured from speech.",
    "'Code-mixed' here means English words SPOKEN inside Kannada / Hindi and written in native script in "
    "the reference (LOANWORD_MARKERS). It is the only code-mixing the corpus contains.",
    "Banking clips come from the IndicVoices train split (likely in IndicConformer's training data): optimistic.",
    "IndicVoices clips are read prompts, mostly clean; branch-counter noise, accents and spontaneous "
    "speech are not represented.",
    "Downstream routing is compared reference-vs-hypothesis through the offline router; the LLM gate is "
    "not called, so LLM-gated turns count as unchanged when both sides are gated.",
)


# =========================================================
# 2  ASR OUTPUT FORMS (TEXT)
# =========================================================

def evaluate_forms(engine):
    document = json.loads(FORMS_FILE.read_text(encoding="utf-8"))
    rows = []
    for item in document["items"]:
        for form in item["forms"]:
            # A form that loses what the reference said (a clipped request
            # no longer naming a service) carries its own label.
            relabelled = "category" in form
            category = form.get("category", item["category"])
            fixture = {"id": f"{item['id']}/{form['kind']}", "lang": item["lang"], "category": category,
                       "text": form["text"], "expected": form.get("expected", item["expected"]),
                       "source": "m9-forms"}
            if item.get("context"):
                fixture["context"] = item["context"]
            result = h.evaluate_fixture(engine, fixture)
            rows.append(OrderedDict(item=item["id"], lang=item["lang"], category=category,
                                    kind=form["kind"], text=form["text"], relabelled=relabelled,
                                    outcome=result["outcome"], severity=result["severity"]))
    return document, rows


def summarize_forms(rows):
    out = OrderedDict()
    for key_name, key in (("kind", lambda r: r["kind"]), ("language group", lambda r: r["lang"]),
                          ("category", lambda r: r["category"])):
        table = OrderedDict()
        for value in sorted({key(r) for r in rows}):
            cell = [r for r in rows if key(r) == value]
            table[value] = OrderedDict([("n", len(cell))] + [(s, sum(r["severity"] == s for r in cell))
                                                             for s in h.SEVERITIES])
        out[key_name] = table

    # Robustness: does a non-reference form get the same outcome as the
    # item's reference form? Relabelled forms are scored on their own label
    # only; comparing them with the reference would count a correct change.
    by_item = {}
    for r in rows:
        if not r["relabelled"]:
            by_item.setdefault(r["item"], {})[r["kind"]] = r["outcome"]
    same = changed = 0
    changes = []
    for item, forms in by_item.items():
        ref = forms.get("reference")
        for kind, outcome in forms.items():
            if kind == "reference":
                continue
            if outcome == ref:
                same += 1
            else:
                changed += 1
                changes.append(OrderedDict(item=item, kind=kind, reference=ref, form=outcome))
    out["agreement_with_reference_form"] = OrderedDict(same=same, changed=changed, changes=changes)
    return out


def render_forms(report):
    s = report["summary"]
    lines = [f"# M9 ASR output forms (text): {report['meta']['name']}", "",
             "**Text fixtures, not recognised audio.** Each reference utterance is written in the forms an ASR "
             "system produces; each form goes through the production routing and is scored against the "
             "reference's label. This measures the language layer's robustness to ASR output.", ""]
    for key_name in ("kind", "language group", "category"):
        lines += [f"## By {key_name}", "", "| | n | correct | critical | miss | unscored |", "|---|---|---|---|---|---|"]
        for value, c in s[key_name].items():
            lines.append(f"| {value} | {c['n']} | {c['ok']} | {c['critical']} | {c['miss']} | {c['unscored']} |")
        lines.append("")
    a = s["agreement_with_reference_form"]
    lines += ["## Same outcome as the reference form", "",
              f"{a['same']} forms agree with their reference form; {a['changed']} do not.", ""]
    if a["changes"]:
        lines += ["| Item | form | reference outcome | form outcome |", "|---|---|---|---|"]
        lines += [f"| {c['item']} | {c['kind']} | {c['reference']} | {c['form']} |" for c in a["changes"]]
        lines.append("")
    lines += ["## Every form that was not correct", "", "| Item | kind | text | outcome |", "|---|---|---|---|"]
    lines += [f"| {r['item']} | {r['kind']} | {h._md_escape(r['text'])} | {r['outcome']} ({r['severity']}) |"
              for r in report["rows"] if r["severity"] != "ok"]
    return "\n".join(lines) + "\n"


# =========================================================
# ENTRY POINT
# =========================================================

def main(argv=None):
    parser = argparse.ArgumentParser(description="M9 ASR evaluation (offline).")
    parser.add_argument("--audio", action="store_true", help="score the production recogniser on real clips")
    parser.add_argument("--text", action="store_true", help="score ASR output forms through the routing")
    parser.add_argument("--name", required=True)
    parser.add_argument("--limit", type=int, help="clips per language per set (smoke runs)")
    args = parser.parse_args(argv)

    sys.stdout.reconfigure(encoding="utf-8")
    h.install_network_guard()
    engine = h.build_engine(with_retrieval=False)
    REPORTS.mkdir(parents=True, exist_ok=True)

    if args.audio:
        items = transcribe_all(clips(args.limit))
        rows = [score_clip(c, engine) for c in items]
        report = OrderedDict(meta=OrderedDict(name=args.name, clips=len(rows), hypotheses=HYPOTHESES.name),
                             summary=summarize_audio(rows), limits=list(AUDIO_LIMITS), rows=rows)
        (REPORTS / f"{args.name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n",
                                                   encoding="utf-8")
        (REPORTS / f"{args.name}.md").write_text(render_audio(report), encoding="utf-8")
        print(f"{len(rows)} clips scored -> {REPORTS / (args.name + '.md')}")

    if args.text:
        document, rows = evaluate_forms(engine)
        report = OrderedDict(meta=OrderedDict(name=args.name, items=len(document["items"]), forms=len(rows)),
                             summary=summarize_forms(rows), rows=rows)
        (REPORTS / f"{args.name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n",
                                                   encoding="utf-8")
        (REPORTS / f"{args.name}.md").write_text(render_forms(report), encoding="utf-8")
        print(f"{len(document['items'])} items, {len(rows)} forms scored -> {REPORTS / (args.name + '.md')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
