"""
PHASE 3.2B-9 -- INDICVOICES BANKING ASR BASELINE (Whisper small)

Benchmarks the EXISTING production STT (app.speech.stt.SpeechToText, unmodified)
on the 200 frozen banking clips in indicvoices_banking_manifest.json, and scores
the banking-safety metrics against the frozen first-pass annotations in
indicvoices_banking_annotations.json. Baseline only: no other ASR model is run,
installed or compared here.

Run from language_engine/:

    $env:PYTHONIOENCODING = "utf-8"
    .\\venv\\Scripts\\python.exe -m debugging.spike.benchmark_indicvoices_banking_asr --transcribe
    .\\venv\\Scripts\\python.exe -m debugging.spike.benchmark_indicvoices_banking_asr --analyse

--transcribe appends one JSON line per clip to indicvoices_banking_asr_raw.jsonl
and resumes where it stopped. --analyse is offline.

WER/CER scoring reuses the Phase 3.2B-8 evaluator by import (normalise_for_scoring,
align_counts, score_utterance, aggregate), unchanged, so these numbers are directly
comparable with the 400-clip general baseline. The banking-safety rules (amount,
identifier, intent cue) are new and are validated against the reference transcripts
before they are applied to hypotheses: a rule that cannot recover the annotated
value from the reference is reported as NOT MEASURABLE for that row instead of
being scored.

Nothing here writes to the frozen manifest or the annotation file.
"""
import argparse
import hashlib
import json
import platform
import statistics
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

from debugging.spike.benchmark_asr import normalise_for_scoring
from debugging.spike.benchmark_indicvoices_asr import (
    DIGIT_WORDS, LANG_NAME, NEGATION_RULE_TEXT, NORMALISATION_RULES, SEED,
    aggregate, cpu_name, is_negation, pct, score_utterance, sha256_file,
)

SPIKE_DIR = Path(__file__).resolve().parent
MANIFEST_FILE = SPIKE_DIR / "indicvoices_banking_manifest.json"
ANNOTATION_FILE = SPIKE_DIR / "indicvoices_banking_annotations.json"
AUDIO_INDEX_FILE = SPIKE_DIR / "indicvoices_banking_audio_index.json"
RAW_FILE = SPIKE_DIR / "indicvoices_banking_asr_raw.jsonl"
RESULTS_FILE = SPIKE_DIR / "indicvoices_banking_asr_results.json"
REPORT_FILE = SPIKE_DIR / "indicvoices_banking_asr_report.md"

FROZEN_MANIFEST_SHA = "02a773066224781dc9db08ed0049cc09ec7fa2de9f99d29b12aabe0799979427"
LANGS = ["kn", "hi"]
FLAGGED = ["ivb_kn_001", "ivb_kn_016", "ivb_kn_072", "ivb_hi_097"]

# ---------------------------------------------------------------------------
# banking evaluation lexicons (evaluation only; production is untouched)
# ---------------------------------------------------------------------------

# Value words for amount composition. Digit words 0-9 come from the 3.2B-8 lexicon.
TENS_AND_TEENS = {
    "kn": {"ಹತ್ತು": 10, "ಹನ್ನೊಂದು": 11, "ಹನ್ನೆರಡು": 12, "ಹದಿಮೂರು": 13, "ಹದಿನಾಲ್ಕು": 14,
           "ಹದಿನೈದು": 15, "ಹದಿನಾರು": 16, "ಹದಿನೇಳು": 17, "ಹದಿನೆಂಟು": 18, "ಹತ್ತೊಂಬತ್ತು": 19,
           "ಇಪ್ಪತ್ತು": 20, "ಮೂವತ್ತು": 30, "ನಲವತ್ತು": 40, "ನಲ್ವತ್ತು": 40, "ಐವತ್ತು": 50,
           "ಅರವತ್ತು": 60, "ಎಪ್ಪತ್ತು": 70, "ಎಂಬತ್ತು": 80, "ತೊಂಬತ್ತು": 90},
    "hi": {"दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15, "सोलह": 16,
           "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20, "तीस": 30, "चालीस": 40,
           "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90},
}
# Hundreds written as one word (Kannada fuses these).
FUSED_HUNDREDS = {
    "kn": {"ನೂರು": 100, "ಇನ್ನೂರು": 200, "ಎರಡ್ನೂರು": 200, "ಎರಡುನೂರು": 200, "ಮುನ್ನೂರು": 300,
           "ಮೂರುನೂರು": 300, "ನಾಲ್ಕುನೂರು": 400, "ಐನೂರು": 500, "ಐದುನೂರು": 500, "ಆರುನೂರು": 600,
           "ಏಳುನೂರು": 700, "ಎಂಟುನೂರು": 800, "ಒಂಬೈನೂರು": 900, "ಒಂಭೈನೂರು": 900},
    "hi": {},
}
SCALES = {
    "kn": {"ನೂರು": 100, "ಸಾವಿರ": 1000, "ಸಾವಿರದ": 1000, "ಲಕ್ಷ": 100000, "ಕೋಟಿ": 10000000},
    "hi": {"सौ": 100, "हज़ार": 1000, "हजार": 1000, "हज़ारों": 1000, "लाख": 100000,
           "करोड़": 10000000, "करोड": 10000000},
}
CURRENCY = {
    "kn": ["ರೂಪಾಯಿ", "ರುಪಾಯಿ", "ರೂಪಾಯ", "ರೂಪಾಯಿಯ", "ರೂಪಾಯನ್ನ", "ರೂ"],
    "hi": ["रुपये", "रुपए", "रूपये", "रूपए", "रुपया", "रूपये", "रुपयों"],
}
# English numerals spoken inside Kannada/Hindi utterances (identifiers and a few amounts).
# NOT mapped on purpose: English "eight" written ಏಟ್/ಎಟ್/एट, because that is also how the "@"
# of a UPI ID is spoken ("ಎಟ್ ದ ರೇಟ್", "एट द रेट"). Mapping it would inject a false 8 into every
# UPI ID. Hindi "ऐट" is kept because that spelling is used for the numeral in this set.
ENGLISH_NUMERALS = {
    "kn": {"ಜ಼ೀರೋ": 0, "ಜೀರೋ": 0, "ಒನ್": 1, "ಟು": 2, "ತ್ರೀ": 3, "ಥ್ರೀ": 3,
           "ಫೋರ್": 4, "ಫೈವ್": 5, "ಸಿಕ್ಸ್": 6, "ಸೆವೆನ್": 7, "ಸೆವನ್": 7,
           "ನೈನ್": 9, "ಟೆನ್": 10, "ಹಂಡ್ರೆಡ್": 100},
    "hi": {"ज़ीरो": 0, "जीरो": 0, "वन": 1, "टू": 2, "थ्री": 3, "फ़ोर": 4, "फोर": 4, "फाइव": 5,
           "फ़ाइव": 5, "सिक्स": 6, "सेवन": 7, "ऐट": 8, "नाइन": 9, "टेन": 10,
           "हंड्रेड": 100, "थाउज़ेंड": 1000, "थाउजेंड": 1000},
}
# Spelling variants of digit words seen in these references, added to the 3.2B-8 digit lexicon.
# NOT added on purpose: "साथ" (a spelling of सात 7, but also the common word "with") and "नो"
# (a spelling of नौ 9, but also "no"). Mapping either would inject false digits into hypotheses,
# so the identifiers that depend on them are reported as not measurable instead.
DIGIT_VARIANTS = {"kn": {}, "hi": {"छ": 6, "दौ": 2}}
# Repeat words that expand a following numeral, per the annotation schema.
REPEAT_WORDS = {"kn": {"ಡಬಲ್": 2, "ಡಬ್ಬಲ್": 2, "ತ್ರಿಬಲ್": 3, "ಟ್ರಿಪಲ್": 3},
                "hi": {"डबल": 2, "ट्रिपल": 3, "तिबल": 3}}

# Intent cues: substrings of the normalised text that carry the requested action.
# Used ONLY for intent-cue survival, never as an intent classifier.
INTENT_CUES = {
    "transfer": {"kn": ["ಟ್ರಾನ್ಸ್ಫರ್", "ಟ್ರಾನ್ಸ್ವರ್", "ಟ್ರಾನ್ಸ್ಫ಼ರ್", "ಕಳಿಸು", "ಕಳಿಸ", "ಕಳ್ಸ", "ದೇಣಿಗೆ"],
                 "hi": ["ट्रांसफ़र", "ट्रांसफर", "ट्रान्सफर", "भेज", "दान", "भुगतान"]},
    "payment": {"kn": ["ಪೇಮೆಂಟ್", "ಪಾವತಿ", "ಪೇ", "ಬಿಲ್", "ರೀಚಾರ್ಜ್"],
                "hi": ["भुगतान", "पेमेंट", "बिल", "रिचार्ज", "पे"]},
    "balance": {"kn": ["ಬ್ಯಾಲೆನ್ಸ್", "ಎಷ್ಟು ಹಣ", "ಎಷ್ಟು ದುಡ್ಡು", "ಇರುತ್ತಾ", "ಇದೆಯಾ", "ದುಡ್ಡಿದೆಯಾ", "ಹಣ ಇದೆ"],
                "hi": ["बैलेंस", "शेष", "कितना", "कितने", "पर्याप्त", "बाकी"]},
    "deposit": {"kn": ["ಹಾಕ", "ಟ್ರಾನ್ಸ್ಫರ್", "ವ್ಯಾಲೆಟ್"], "hi": ["जोड़", "वॉलेट", "ट्रांसफ़र", "ट्रांसफर"]},
    "withdrawal": {"kn": ["ವಿಡ್ರಾ", "ತೆಗೆ", "ನಗದು"], "hi": ["निकाल", "निकास"]},
}

_n = normalise_for_scoring
TENS_AND_TEENS = {l: {_n(k): v for k, v in d.items()} for l, d in TENS_AND_TEENS.items()}
FUSED_HUNDREDS = {l: {_n(k): v for k, v in d.items()} for l, d in FUSED_HUNDREDS.items()}
SCALES = {l: {_n(k): v for k, v in d.items()} for l, d in SCALES.items()}
CURRENCY = {l: [_n(w) for w in ws] for l, ws in CURRENCY.items()}
ENGLISH_NUMERALS = {l: {_n(k): v for k, v in d.items()} for l, d in ENGLISH_NUMERALS.items()}
REPEAT_WORDS = {l: {_n(k): v for k, v in d.items()} for l, d in REPEAT_WORDS.items()}
# Local digit lexicon: the 3.2B-8 words plus this set's spelling variants. The imported
# DIGIT_WORDS is never mutated.
DIGITS = {l: {**DIGIT_WORDS[l], **{_n(k): v for k, v in DIGIT_VARIANTS[l].items()}} for l in ("kn", "hi")}
INTENT_CUES = {i: {l: [_n(c) for c in cs] for l, cs in d.items()} for i, d in INTENT_CUES.items()}

AMOUNT_RULE = (
    "An amount is read from a maximal run of number tokens (digit words 0-9, teens and tens, "
    "fused hundreds, scale words 100/1000/100000/10000000, English numerals spoken in native "
    "script, and ASCII digit tokens). A run composes in the usual Indian way: units add, a scale "
    "multiplies what precedes it and 1000+ scales close a group. A run containing a token the "
    "lexicon does not know is left UNPARSED and never guessed. The check asks whether the "
    "annotated amount appears among the values recoverable from the hypothesis."
)
IDENTIFIER_RULE = (
    "Digits are recovered from the hypothesis by mapping digit words, English numerals in native "
    "script and ASCII digit tokens to characters, expanding 'double'/'triple' before a numeral, "
    "and concatenating. An identifier counts as preserved only when its annotated digit string "
    "appears as a contiguous substring of that stream, so leading zeros and digit order are "
    "enforced. An identifier whose digit string cannot be recovered from its own REFERENCE by "
    "this rule is reported as not measurable rather than scored as an error."
)
INTENT_RULE = (
    "This is NOT intent classification. For each row whose annotated intent is one of the five "
    "specific banking intents, a small cue list per intent and language is checked against the "
    "normalised text. A row is measurable only when the reference itself contains a cue for its "
    "annotated intent; the metric then reports whether any cue for that same intent survives in "
    "the hypothesis. It answers 'did the words that carry this action survive', not 'would a "
    "classifier still get the intent right'. Rows annotated other/unknown have no fixed cue set "
    "and are excluded."
)


# ---------------------------------------------------------------------------
# number / digit recovery
# ---------------------------------------------------------------------------

def _value_of(tok, lang):
    for table in (DIGITS[lang], TENS_AND_TEENS[lang], FUSED_HUNDREDS[lang], ENGLISH_NUMERALS[lang]):
        if tok in table:
            return table[tok]
    return None


def _is_number_token(tok, lang):
    return (_value_of(tok, lang) is not None or tok in SCALES[lang]
            or tok in REPEAT_WORDS[lang] or tok.isdigit())


def number_runs(tokens, lang):
    runs, run = [], []
    for tok in list(tokens) + [None]:
        if tok is not None and (_is_number_token(tok, lang) or tok in CURRENCY[lang]):
            run.append(tok)
            continue
        core = [t for t in run if t not in CURRENCY[lang]]
        if core:
            runs.append(core)
        run = []
    return runs


def compose(run, lang):
    """Return (value, ok). ok is False when any token is unknown to the lexicon."""
    total, current, seen = 0, 0, False
    for tok in run:
        if tok in REPEAT_WORDS[lang]:
            return None, False
        if tok.isdigit():
            current = current * 1000 + int(tok) if current and len(tok) == 3 else (current or 0) + int(tok)
            seen = True
            continue
        if tok in SCALES[lang]:
            scale = SCALES[lang][tok]
            if scale >= 1000:
                total += (current or 1) * scale
                current = 0
            else:
                current = (current or 1) * scale
            seen = True
            continue
        v = _value_of(tok, lang)
        if v is None:
            return None, False
        if v >= 100:
            current = (current or 1) * v if v == 100 else current + v
        else:
            current += v
        seen = True
    value = total + current
    return (value, True) if seen and value > 0 else (None, False)


def amount_candidates(text, lang):
    """Values recoverable from text, plus whether any number run was left unparsed."""
    tokens = normalise_for_scoring(text).split()
    values, unparsed = set(), 0
    for run in number_runs(tokens, lang):
        value, ok = compose(run, lang)
        if ok:
            values.add(value)
            digits = [t for t in run if t.isdigit()]
            if len(digits) == len(run) and len(digits) > 1:
                values.add(int("".join(digits)))
            for t in run:
                if t.isdigit():
                    values.add(int(t))
        else:
            unparsed += 1
        # A short run of bare digit words can also be an amount read out digit by digit
        # ("five zero zero" = 500). Capped at 4 tokens so account numbers are not read as amounts.
        if 2 <= len(run) <= 4 and all(t in DIGITS[lang] for t in run):
            values.add(int("".join(str(DIGITS[lang][t]) for t in run)))
    return values, unparsed


def banking_digit_stream(text, lang):
    """Digit characters recoverable from text, with double/triple expansion."""
    tokens = normalise_for_scoring(text).split()
    out, repeat = [], 1
    for tok in tokens:
        if tok in REPEAT_WORDS[lang]:
            repeat = REPEAT_WORDS[lang][tok]
            continue
        d = None
        if tok in DIGITS[lang]:
            d = str(DIGITS[lang][tok])
        elif tok in ENGLISH_NUMERALS[lang] and ENGLISH_NUMERALS[lang][tok] <= 9:
            d = str(ENGLISH_NUMERALS[lang][tok])
        elif tok.isdigit():
            d = tok
        if d is None:
            repeat = 1
            continue
        out.append(d * repeat)
        repeat = 1
    return "".join(out)


# ---------------------------------------------------------------------------
# transcription
# ---------------------------------------------------------------------------

def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def check_frozen():
    sha = sha256_file(MANIFEST_FILE)
    if sha != FROZEN_MANIFEST_SHA:
        sys.exit(f"frozen manifest sha256 changed: {sha}")
    return sha


def read_raw():
    rows = {}
    if RAW_FILE.exists():
        with open(RAW_FILE, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    r = json.loads(line)
                    rows[r["id"]] = r
    return rows


def transcribe(limit_per_language=None):
    import torch
    from app.speech.stt import SpeechToText

    check_frozen()
    manifest = load_json(MANIFEST_FILE)
    index = {c["id"]: c for c in load_json(AUDIO_INDEX_FILE)["clips"]}
    utterances = manifest["utterances"]

    print("verifying 200 WAV checksums against the extraction index ...")
    for u in utterances:
        c = index.get(u["id"])
        if not c or c["status"] != "extracted":
            sys.exit(f"{u['id']}: not extracted")
        path = SPIKE_DIR / c["audio_file"]
        if not path.exists():
            sys.exit(f"{u['id']}: missing {path}")
        if sha256_file(path) != c["wav_sha256"]:
            sys.exit(f"{u['id']}: wav sha256 mismatch")
        if c["samples"] != u["samples"] or c["duration_seconds"] != u["duration_seconds"]:
            sys.exit(f"{u['id']}: extracted clip does not match the manifest row")

    done = read_raw()
    todo = [u for u in utterances if u["id"] not in done]
    if limit_per_language:
        keep, seen = [], Counter()
        for u in todo:
            if seen[u["language"]] < limit_per_language:
                keep.append(u)
                seen[u["language"]] += 1
        todo = keep
    print(f"{len(done)} already transcribed; {len(todo)} to go")
    if not todo:
        return

    started = time.perf_counter()
    stt = SpeechToText()
    load_seconds = time.perf_counter() - started

    warm = todo[0]
    torch.manual_seed(SEED)
    started = time.perf_counter()
    stt.transcribe(str(SPIKE_DIR / index[warm["id"]]["audio_file"]), language=warm["language"])
    warmup_seconds = time.perf_counter() - started
    print(f"model load {load_seconds:.2f}s (excluded); warm-up {warmup_seconds:.2f}s on "
          f"{warm['id']} (discarded)")

    session = {
        "started": datetime.now().isoformat(timespec="seconds"),
        "model_load_seconds": round(load_seconds, 3),
        "warmup_clip": warm["id"],
        "warmup_seconds_discarded": round(warmup_seconds, 3),
        "torch_threads": torch.get_num_threads(),
        "torch_seed_per_clip": SEED,
        "resumed_with_completed": len(done),
    }
    with open(SPIKE_DIR / "indicvoices_banking_asr_sessions.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(session, ensure_ascii=False) + "\n")

    for n, u in enumerate(todo, 1):
        path = SPIKE_DIR / index[u["id"]]["audio_file"]
        torch.manual_seed(SEED)
        error, hyp = None, ""
        started = time.perf_counter()
        try:
            out = stt.transcribe(str(path), language=u["language"])
            hyp = out["text"]
        except Exception as e:
            error = repr(e)
        latency = time.perf_counter() - started
        rec = {
            "id": u["id"], "language": u["language"], "speaker_id": u["speaker_id"],
            "reference": u["reference_transcript"], "hypothesis": hyp,
            "latency_seconds": round(latency, 4), "audio_seconds": u["duration_seconds"],
            "rtf": round(latency / u["duration_seconds"], 4), "error": error,
            "status": "error" if error else "ok",
            "wav_sha256": index[u["id"]]["wav_sha256"],
            "transcribed_at": datetime.now().isoformat(timespec="seconds"),
        }
        with open(RAW_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"[{u['language']} {n}/{len(todo)}] {u['id']} {latency:.2f}s "
              f"rtf={rec['rtf']:.2f}" + (f" ERROR {error}" if error else ""), flush=True)


# ---------------------------------------------------------------------------
# banking-safety scoring
# ---------------------------------------------------------------------------

def amount_rows(ann, scored):
    rows = []
    for a in ann:
        target = a["project_annotations"]["amount"]
        if target is None:
            continue
        s = scored[a["id"]]
        lang = a["language"]
        ref_vals, ref_unparsed = amount_candidates(a["reference_transcript"], lang)
        hyp_vals, hyp_unparsed = amount_candidates(s["hypothesis"], lang)
        measurable = target in ref_vals
        if not measurable:
            verdict = "not_measurable_reference_rule_miss"
        elif target in hyp_vals:
            verdict = "exact"
        elif not hyp_vals and not hyp_unparsed:
            verdict = "missing"
        elif hyp_vals:
            verdict = "incorrect"
        else:
            verdict = "unclear"
        rows.append({
            "id": a["id"], "language": lang, "annotated_amount": target,
            "reference_values": sorted(ref_vals), "hypothesis_values": sorted(hyp_vals),
            "hypothesis_unparsed_runs": hyp_unparsed, "verdict": verdict,
            "extra_values": sorted(hyp_vals - ref_vals),
            "wrong_script": s["wrong_script"], "empty": s["empty"],
            "flagged_row": a["id"] in FLAGGED,
        })
    return rows


def identifier_rows(ann, scored):
    rows = []
    for a in ann:
        idents = a["project_annotations"]["identifier"]
        if not idents:
            continue
        s = scored[a["id"]]
        lang = a["language"]
        ref_stream = banking_digit_stream(a["reference_transcript"], lang)
        hyp_stream = banking_digit_stream(s["hypothesis"], lang)
        for k, e in enumerate(idents):
            digits = e["digits"]
            if digits is None:
                verdict = "not_measurable_annotation_digits_null"
            elif digits not in ref_stream:
                verdict = "not_measurable_reference_rule_miss"
            elif digits in hyp_stream:
                verdict = "exact"
            elif not hyp_stream:
                verdict = "missing"
            else:
                verdict = "incorrect"
            rows.append({
                "id": a["id"], "entry": k, "language": lang, "type": e["type"],
                "annotated_digits": digits, "digits_len": len(digits) if digits else None,
                "reference_digit_stream": ref_stream, "hypothesis_digit_stream": hyp_stream,
                "verdict": verdict,
                "extra_digits_in_hypothesis": (
                    len(hyp_stream) - len(digits) if digits and digits in hyp_stream else None),
                "wrong_script": s["wrong_script"], "empty": s["empty"],
                "flagged_row": a["id"] in FLAGGED,
            })
    return rows


def intent_rows(ann, scored):
    rows = []
    for a in ann:
        intent = a["project_annotations"]["intent"]
        if intent not in INTENT_CUES:
            continue
        s = scored[a["id"]]
        lang = a["language"]
        cues = INTENT_CUES[intent][lang]
        ref_norm, hyp_norm = s["reference_normalised"], s["hypothesis_normalised"]
        ref_hits = [c for c in cues if c in ref_norm]
        hyp_hits = [c for c in cues if c in hyp_norm]
        rows.append({
            "id": a["id"], "language": lang, "intent": intent,
            "reference_cues": ref_hits, "hypothesis_cues": hyp_hits,
            "verdict": ("not_measurable_no_cue_in_reference" if not ref_hits
                        else "cue_survived" if hyp_hits else "cue_lost"),
            "wrong_script": s["wrong_script"], "empty": s["empty"],
            "flagged_row": a["id"] in FLAGGED,
        })
    return rows


def verdict_counts(rows, key="verdict", langs=True):
    out = {"all": dict(sorted(Counter(r[key] for r in rows).items()))}
    if langs:
        for l in LANGS:
            out[l] = dict(sorted(Counter(r[key] for r in rows if r["language"] == l).items()))
    return out


def basic_counts(items):
    """Raw edit counts that aggregate() reports only as rates."""
    return {
        "substitutions": sum(x["sub"] for x in items),
        "deletions": sum(x["del"] for x in items),
        "insertions": sum(x["ins"] for x in items),
        "reference_words": sum(x["ref_words"] for x in items),
        "utterances_wer_ge_100pct": sum(x["wer"] >= 1 for x in items),
        "utterances_wer_0": sum(x["wer"] == 0 for x in items),
        "wrong_script_rate": round(sum(x["wrong_script"] for x in items) / len(items), 4),
    }


def analyse():
    sha = check_frozen()
    manifest = load_json(MANIFEST_FILE)
    ann_doc = load_json(ANNOTATION_FILE)
    raw = read_raw()
    utterances = manifest["utterances"]
    missing = [u["id"] for u in utterances if u["id"] not in raw]
    if missing:
        sys.exit(f"{len(missing)} clips not transcribed yet, e.g. {missing[:5]}")

    scored_list = [score_utterance(u, raw[u["id"]]) for u in utterances]
    scored = {s["id"]: s for s in scored_list}
    ann = ann_doc["annotations"]

    by_lang = {l: [s for s in scored_list if s["language"] == l] for l in LANGS}
    keep = [s for s in scored_list if s["id"] not in FLAGGED]

    amounts = amount_rows(ann, scored)
    idents = identifier_rows(ann, scored)
    intents = intent_rows(ann, scored)

    neg = [{"id": a["id"], "language": a["language"],
            "reference": a["reference_transcript"], "hypothesis": scored[a["id"]]["hypothesis"],
            "reference_negation_tokens": scored[a["id"]]["negation_ref"],
            "hypothesis_negation_tokens": scored[a["id"]]["negation_hyp"],
            "negation_token_survived": bool(scored[a["id"]]["negation_hyp"]),
            "notes": a["project_annotations"]["notes"],
            "wer": scored[a["id"]]["wer"], "wrong_script": scored[a["id"]]["wrong_script"]}
           for a in ann if a["project_annotations"]["negation"] == "negative"]
    control = [{"id": a["id"], "language": a["language"],
                "control_type": a["project_annotations"]["control_type"],
                "reference": a["reference_transcript"], "hypothesis": scored[a["id"]]["hypothesis"],
                "wer": scored[a["id"]]["wer"], "wrong_script": scored[a["id"]]["wrong_script"],
                "notes": a["project_annotations"]["notes"]}
               for a in ann if a["project_annotations"]["control_type"] != "none"]
    completion = [{"id": a["id"], "language": a["language"],
                   "completion_signal": a["project_annotations"]["completion_signal"],
                   "reference": a["reference_transcript"], "hypothesis": scored[a["id"]]["hypothesis"],
                   "wer": scored[a["id"]]["wer"], "wrong_script": scored[a["id"]]["wrong_script"],
                   "notes": a["project_annotations"]["notes"]}
                  for a in ann if a["project_annotations"]["completion_signal"] != "not_applicable"]

    sessions = []
    sess_file = SPIKE_DIR / "indicvoices_banking_asr_sessions.jsonl"
    if sess_file.exists():
        sessions = [json.loads(l) for l in sess_file.read_text(encoding="utf-8").splitlines() if l.strip()]

    import torch
    import whisper
    model_path = Path.home() / ".cache" / "whisper" / "small.pt"

    results = {
        "phase": "3.2B-9",
        "track": "BANKING_ASR baseline (Whisper small); no other model run or compared",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "manifest": {"file": MANIFEST_FILE.name, "sha256": sha,
                     "dataset_revision": manifest["dataset"]["revision"],
                     "split": manifest["dataset"]["split"], "clips": len(utterances)},
        "annotations": {"file": ANNOTATION_FILE.name, "sha256": sha256_file(ANNOTATION_FILE),
                        "status": ann_doc["status"], "annotator": ann_doc["annotator"]["type"],
                        "human_verified": ann_doc["annotator"]["human_verified"]},
        "audio": {"file": AUDIO_INDEX_FILE.name, "sha256": sha256_file(AUDIO_INDEX_FILE),
                  "extracted": load_json(AUDIO_INDEX_FILE)["summary"]["extracted"],
                  "md5_verified": load_json(AUDIO_INDEX_FILE)["summary"]["md5_verified"]},
        "system_under_test": {
            "implementation": "app.speech.stt.SpeechToText (unmodified) -> whisper.load_model('small'); "
                              "model.transcribe(path, language=<code>, fp16=False)",
            "model": "whisper small",
            "model_file": str(model_path),
            "model_file_sha256": sha256_file(model_path) if model_path.exists() else None,
            "decoding": "openai-whisper transcribe() defaults: greedy at T=0 (beam_size=None), "
                        "temperature fallback 0.2..1.0 (single sample) when compression ratio > 2.4 "
                        "or avg logprob < -1.0, no_speech_threshold 0.6, "
                        "condition_on_previous_text=True, no initial prompt",
            "language_codes": {"kn": "kn", "hi": "hi"},
            "openai_whisper": getattr(whisper, "__version__", "unknown"),
            "torch": torch.__version__,
            "no_preprocessing_added": "audio is passed to SpeechToText as the extracted 16 kHz mono "
                                      "PCM16 WAV path; whisper's own ffmpeg load and log-mel are the "
                                      "only preprocessing",
        },
        "hardware": {"cpu": cpu_name(), "python": platform.python_version(),
                     "platform": platform.platform(), "device": "cpu",
                     "torch_threads": sessions[-1]["torch_threads"] if sessions else torch.get_num_threads()},
        "run_sessions": sessions,
        "latency_definition": "wall time of SpeechToText.transcribe() per clip (audio load via ffmpeg + "
                              "log-mel + decode); model load and one warm-up clip excluded",
        "normalisation": NORMALISATION_RULES,
        "by_language": {l: aggregate(by_lang[l]) for l in LANGS},
        "by_language_counts": {l: basic_counts(by_lang[l]) for l in LANGS},
        "overall": aggregate(scored_list),
        "overall_counts": basic_counts(scored_list),
        "sensitivity_excluding_flagged_rows": {
            "excluded": FLAGGED,
            "reason": "first-pass annotations the annotator could not settle from the reference alone",
            "by_language": {l: aggregate([s for s in keep if s["language"] == l]) for l in LANGS},
            "overall": aggregate(keep),
        },
        "banking_safety": {
            "annotation_caveat": "Scored against FIRST-PASS project annotations that have not been "
                                 "independently human-verified. Treat every figure here as indicative.",
            "intent": {"rule": INTENT_RULE, "rows": len(intents), "counts": verdict_counts(intents),
                       "by_intent": {i: dict(sorted(Counter(
                           r["verdict"] for r in intents if r["intent"] == i).items()))
                           for i in sorted({r["intent"] for r in intents})},
                       "detail": intents},
            "amount": {"rule": AMOUNT_RULE, "rows": len(amounts), "counts": verdict_counts(amounts),
                       "extra_value_rows": sum(bool(r["extra_values"]) for r in amounts),
                       "detail": amounts},
            "identifier": {"rule": IDENTIFIER_RULE, "rows": len({r["id"] for r in idents}),
                           "entries": len(idents), "counts": verdict_counts(idents),
                           "digits_total": sum(r["digits_len"] or 0 for r in idents),
                           "detail": idents},
            "negation": {"n": len(neg), "caveat": "n=3: descriptive only, not statistically meaningful.",
                         "rule": NEGATION_RULE_TEXT, "cases": neg},
            "control": {"n": len(control), "caveat": "n=1: descriptive only, not an accuracy metric.",
                        "cases": control},
            "completion": {"n": len(completion),
                           "caveat": "n=1: descriptive only, not an accuracy metric.",
                           "cases": completion},
        },
        "per_utterance": scored_list,
    }
    with open(RESULTS_FILE, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("wrote", RESULTS_FILE)
    write_report(results)
    return results


def _pct(x, digits=1):
    return "n/a" if x is None else f"{100 * x:.{digits}f}%"


def write_report(res):
    lines = []
    a = lines.append
    m, sut, hw = res["manifest"], res["system_under_test"], res["hardware"]
    a("# IndicVoices banking ASR baseline (Whisper small) — Phase 3.2B-9\n")
    a(f"Generated {res['generated']}. Baseline only: no other ASR model was run, installed or "
      "compared in this step.\n")
    a("| | |")
    a("|---|---|")
    a(f"| Clips | {m['clips']} frozen banking clips from `{m['file']}` (sha256 `{m['sha256'][:12]}…`), "
      f"IndicVoices revision `{m['dataset_revision'][:12]}…`, split `{m['split']}` |")
    a(f"| Audio | extracted per the frozen manifest, {res['audio']['md5_verified']}/{res['audio']['extracted']} "
      "verified against the FLAC STREAMINFO MD5 |")
    a(f"| Model | Whisper small, file sha256 `{(sut['model_file_sha256'] or '?')[:12]}…`; "
      f"openai-whisper {sut['openai_whisper']}, torch {sut['torch']} |")
    a(f"| Implementation | {sut['implementation']} |")
    a(f"| Decoding | {sut['decoding']} |")
    a(f"| Hardware | {hw['cpu']}, {hw['device']}, {hw['torch_threads']} torch threads, python {hw['python']} |")
    a(f"| Latency | {res['latency_definition']} |")
    a(f"| Annotations | `{res['annotations']['file']}`, first pass, human_verified="
      f"{str(res['annotations']['human_verified']).lower()} |\n")

    a("## Core ASR metrics\n")
    a("| Metric | Kannada | Hindi | Overall |")
    a("|---|---|---|---|")
    rows = [
        ("Clips / speakers", lambda s, c: f"{s['clips']} / {s['speakers']}"),
        ("Audio (min)", lambda s, c: f"{s['audio_minutes']:.1f}"),
        ("WER", lambda s, c: _pct(s["wer"])),
        ("CER", lambda s, c: _pct(s["cer"])),
        ("Substitutions", lambda s, c: f"{c['substitutions']} ({_pct(s['sub_rate'])})"),
        ("Deletions", lambda s, c: f"{c['deletions']} ({_pct(s['del_rate'])})"),
        ("Insertions", lambda s, c: f"{c['insertions']} ({_pct(s['ins_rate'])})"),
        ("Median clip WER", lambda s, c: _pct(s["utterance_wer_median"])),
        ("Clips with WER = 0", lambda s, c: f"{c['utterances_wer_0']}"),
        ("Clips with WER >= 100%", lambda s, c: f"{c['utterances_wer_ge_100pct']}"),
        ("Empty hypotheses", lambda s, c: f"{s['empty_outputs']}"),
        ("Wrong script", lambda s, c: f"{s['wrong_script_outputs']} ({_pct(c['wrong_script_rate'])})"),
        ("Failed calls", lambda s, c: f"{s['failed_outputs']}"),
        ("Latency mean / median / p95 / max (s)",
         lambda s, c: "{mean:.1f} / {median:.1f} / {p95:.1f} / {max:.1f}".format(**s["latency_seconds"])),
        ("RTF total / median", lambda s, c: f"{s['rtf_aggregate']:.2f} / {s['rtf_median']:.2f}"),
    ]
    for label, fn in rows:
        kn = fn(res["by_language"]["kn"], res["by_language_counts"]["kn"])
        hi = fn(res["by_language"]["hi"], res["by_language_counts"]["hi"])
        ov = fn(res["overall"], res["overall_counts"])
        a(f"| {label} | {kn} | {hi} | {ov} |")
    a("")
    a("WER and CER are micro averages (total edits / total reference units), scored after the "
      "Phase 3.2B-7 normalisation reused unchanged. Number words versus digits, and native script "
      "versus Latin, are NOT normalised away and count as errors.\n")

    sens = res["sensitivity_excluding_flagged_rows"]
    a("### Sensitivity: excluding the 4 flagged annotation rows\n")
    a(f"Excluded: {', '.join(f'`{i}`' for i in sens['excluded'])} — {sens['reason']}.\n")
    a("| Metric | Kannada | Hindi | Overall |")
    a("|---|---|---|---|")
    a(f"| Clips | {sens['by_language']['kn']['clips']} | {sens['by_language']['hi']['clips']} | "
      f"{sens['overall']['clips']} |")
    a(f"| WER | {_pct(sens['by_language']['kn']['wer'])} | {_pct(sens['by_language']['hi']['wer'])} | "
      f"{_pct(sens['overall']['wer'])} |")
    a(f"| CER | {_pct(sens['by_language']['kn']['cer'])} | {_pct(sens['by_language']['hi']['cer'])} | "
      f"{_pct(sens['overall']['cer'])} |")
    a("")

    bs = res["banking_safety"]
    a("## Banking-safety metrics\n")
    a(f"**{bs['annotation_caveat']}**\n")

    a("### A. Intent cue survival\n")
    a(f"{bs['intent']['rule']}\n")
    a("| Verdict | Kannada | Hindi | All |")
    a("|---|---|---|---|")
    for v in sorted(bs["intent"]["counts"]["all"]):
        a(f"| {v} | {bs['intent']['counts']['kn'].get(v, 0)} | {bs['intent']['counts']['hi'].get(v, 0)} "
          f"| {bs['intent']['counts']['all'][v]} |")
    a("")
    a("By annotated intent: " + ", ".join(
        f"{i} {json.dumps(c, ensure_ascii=False)}" for i, c in bs["intent"]["by_intent"].items()) + "\n")

    a("### B. Amount preservation\n")
    a(f"{bs['amount']['rule']}\n")
    a("| Verdict | Kannada | Hindi | All |")
    a("|---|---|---|---|")
    for v in sorted(bs["amount"]["counts"]["all"]):
        a(f"| {v} | {bs['amount']['counts']['kn'].get(v, 0)} | {bs['amount']['counts']['hi'].get(v, 0)} "
          f"| {bs['amount']['counts']['all'][v]} |")
    a("")
    a(f"Rows whose hypothesis carries a value the reference does not: {bs['amount']['extra_value_rows']}.\n")

    a("### C. Identifier preservation\n")
    a(f"{bs['identifier']['rule']}\n")
    a(f"{bs['identifier']['entries']} identifier entries across {bs['identifier']['rows']} rows, "
      f"{bs['identifier']['digits_total']} annotated digits.\n")
    a("| Verdict | Kannada | Hindi | All |")
    a("|---|---|---|---|")
    for v in sorted(bs["identifier"]["counts"]["all"]):
        a(f"| {v} | {bs['identifier']['counts']['kn'].get(v, 0)} | "
          f"{bs['identifier']['counts']['hi'].get(v, 0)} | {bs['identifier']['counts']['all'][v]} |")
    a("")

    a("### D. Negation (n=3)\n")
    a(f"**{bs['negation']['caveat']}** Three rows in 200 carry an annotated negation, so this is a "
      "description of three cases, not a rate.\n")
    for c in bs["negation"]["cases"]:
        a(f"- **{c['id']}** ({LANG_NAME[c['language']]}, WER {_pct(c['wer'], 0)}"
          f"{', wrong script' if c['wrong_script'] else ''}): reference negation tokens "
          f"{c['reference_negation_tokens'] or '[]'}, hypothesis negation tokens "
          f"{c['hypothesis_negation_tokens'] or '[]'} → survived: "
          f"{'yes' if c['negation_token_survived'] else 'no'}")
    a("")

    a("### E. Control and completion (n=1 each)\n")
    a(f"**{bs['control']['caveat']}** The frozen set contains exactly one annotated control command "
      "and one completion signal, so no accuracy can be computed.\n")
    for c in bs["control"]["cases"]:
        a(f"- control `{c['control_type']}` — **{c['id']}** ({LANG_NAME[c['language']]}), "
          f"WER {_pct(c['wer'], 0)}{', wrong script' if c['wrong_script'] else ''}")
    for c in bs["completion"]["cases"]:
        a(f"- completion `{c['completion_signal']}` — **{c['id']}** ({LANG_NAME[c['language']]}), "
          f"WER {_pct(c['wer'], 0)}{', wrong script' if c['wrong_script'] else ''}")
    a("")

    a("## Annotation limitations\n")
    a("- The annotations are a **first-pass project annotation**, produced by reading the reference "
      "transcripts. They have **not** been independently human-verified, so every banking-safety "
      "figure above is indicative rather than ground truth.")
    a("- Four rows stay flagged and unresolved: " + ", ".join(f"`{i}`" for i in FLAGGED) +
      ". They are included in the main tables with their current annotation and removed in the "
      "sensitivity table above.")
    a("- Negation (n=3), control (n=1) and completion (n=1) are too rare in this set to support any "
      "rate. They are reported case by case.")
    a("- Amount and identifier rules are validated against the reference before being applied: a row "
      "whose annotated value cannot be recovered from its own reference is reported as not "
      "measurable instead of being counted as an ASR error.\n")

    a("## Training-data / contamination considerations\n")
    a("- **Whisper small** (OpenAI) was trained on about 680,000 hours of weakly supervised audio "
      "collected from the web. OpenAI has not published the dataset contents, so it cannot be "
      "verified from the project's information whether any of these recordings, or IndicVoices "
      "itself, appear in that training data. This report does not claim these clips were unseen.")
    a(f"- These 200 clips come from the IndicVoices **{m['split']}** split (recorded in the frozen "
      "manifest's `split_rationale`: the valid split has too few Digital Payment Commands speakers "
      "once the quality rules and the general-set speaker exclusion are applied).")
    a("- That matters for what comes next: models trained on IndicVoices train, which includes "
      "AI4Bharat's own Indian-language models, may have seen these exact recordings. A later "
      "candidate scoring better here could be doing so because it trained on this material. Each "
      "candidate's training data must be checked and stated before any comparison is drawn.")
    a("- IndicVoices release date versus Whisper small's training cut-off is not established here, "
      "so no timing argument is made either way.\n")

    a("## Files\n")
    a(f"- `{RAW_FILE.name}` — one JSON line per clip (id, language, speaker, reference, hypothesis, "
      "latency, duration, RTF, status/error)")
    a(f"- `{RESULTS_FILE.name}` — full metrics, per-utterance scores and banking-safety detail")
    a(f"- `{REPORT_FILE.name}` — this report")
    a(f"- `{AUDIO_INDEX_FILE.name}` — extraction record for the 200 WAVs")
    a("- The previous general-track files (`indicvoices_asr_raw.jsonl`, "
      "`indicvoices_asr_results.json`, `indicvoices_asr_report.md`) are untouched.\n")

    REPORT_FILE.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print("wrote", REPORT_FILE)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--transcribe", action="store_true")
    p.add_argument("--analyse", action="store_true")
    p.add_argument("--limit-per-language", type=int, default=None)
    args = p.parse_args()
    if args.transcribe:
        transcribe(args.limit_per_language)
    if args.analyse:
        analyse()
    if not (args.transcribe or args.analyse):
        p.print_help()


if __name__ == "__main__":
    main()
