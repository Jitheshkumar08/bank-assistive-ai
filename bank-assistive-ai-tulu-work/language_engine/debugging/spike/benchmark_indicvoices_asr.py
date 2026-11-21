"""
PHASE 3.2B-8 -- INDICVOICES GENERAL-TRACK ASR BASELINE (Whisper small)

Benchmarks the EXISTING production STT (app.speech.stt.SpeechToText,
unmodified) on the 400 frozen IndicVoices clips listed in
indicvoices_general_manifest.json. General ASR only: no intent, entity or
workflow expectations exist for these clips.

Run from language_engine/:

    $env:PYTHONIOENCODING = "utf-8"
    .\\venv\\Scripts\\python.exe -m debugging.spike.benchmark_indicvoices_asr --transcribe
    .\\venv\\Scripts\\python.exe -m debugging.spike.benchmark_indicvoices_asr --analyse

--transcribe appends one JSON line per clip to indicvoices_asr_raw.jsonl and
resumes where it stopped. --analyse is offline: it scores the raw file and
writes indicvoices_asr_results.json, indicvoices_asr_report.md and
indicvoices_asr_error_analysis.md.

SCORING reuses the Phase 3.2B-7 evaluator (normalise_for_scoring,
levenshtein) unchanged, so these numbers are comparable with that corpus.
Nothing is estimated: a clip with no transcription is scored as missing.
"""

import argparse
import hashlib
import json
import platform
import random
import statistics
import sys
import time
import unicodedata
import zlib
from collections import Counter, defaultdict
from pathlib import Path

from debugging.spike.benchmark_asr import levenshtein, normalise_for_scoring

SPIKE_DIR = Path(__file__).resolve().parent
MANIFEST_FILE = SPIKE_DIR / "indicvoices_general_manifest.json"
RAW_FILE = SPIKE_DIR / "indicvoices_asr_raw.jsonl"
RESULTS_FILE = SPIKE_DIR / "indicvoices_asr_results.json"
REPORT_FILE = SPIKE_DIR / "indicvoices_asr_report.md"
ERRORS_FILE = SPIKE_DIR / "indicvoices_asr_error_analysis.md"

SEED = 3208
SR = 16000
LANGS = ["kn", "hi"]
LANG_NAME = {"kn": "Kannada", "hi": "Hindi"}
SCENARIOS = ["Read", "Extempore", "Conversation"]

NORMALISATION_RULES = [
    "Applied identically to reference and hypothesis (Phase 3.2B-7 normalise_for_scoring, unchanged).",
    "1. Kannada (U+0CE6-0CEF) and Devanagari (U+0966-096F) digits folded to ASCII 0-9.",
    "2. Unicode NFC.",
    "3. ZWNJ (U+200C) and ZWJ (U+200D) removed.",
    "4. Every character that is neither alphanumeric nor a combining mark (Unicode category M*) "
    "becomes a space: punctuation such as . , ? ! and the danda U+0964 is not scored.",
    "5. Lowercased (affects Latin letters only).",
    "6. Whitespace collapsed; WER tokens = whitespace-separated words.",
    "CER = code-point Levenshtein distance with spaces removed, divided by reference code points. "
    "Vowel signs, viramas and nuktas are separate code points and ARE scored.",
    "NOT normalised (counted as errors): number words vs digits, Latin vs native script, "
    "transliteration or spelling variants, other scripts (e.g. Telugu or Urdu output).",
    "Corpus WER/CER = total edits / total reference units (micro average).",
]

# ---------------------------------------------------------------------------
# heuristic lexicons for the error-category analysis (evaluation only)
# ---------------------------------------------------------------------------

DIGIT_WORDS = {
    "kn": {"ಸೊನ್ನೆ": 0, "ಶೂನ್ಯ": 0, "ಒಂದು": 1, "ಎರಡು": 2, "ಮೂರು": 3, "ನಾಲ್ಕು": 4,
           "ಐದು": 5, "ಆರು": 6, "ಏಳು": 7, "ಎಂಟು": 8, "ಒಂಬತ್ತು": 9},
    "hi": {"शून्य": 0, "जीरो": 0, "ज़ीरो": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4,
           "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "छे": 6, "सात": 7, "आठ": 8, "नौ": 9},
}
OTHER_NUMBER_WORDS = {
    "kn": ["ಹತ್ತು", "ಹನ್ನೊಂದು", "ಹನ್ನೆರಡು", "ಹದಿಮೂರು", "ಹದಿನಾಲ್ಕು", "ಹದಿನೈದು", "ಹದಿನಾರು",
           "ಹದಿನೇಳು", "ಹದಿನೆಂಟು", "ಹತ್ತೊಂಬತ್ತು", "ಇಪ್ಪತ್ತು", "ಮೂವತ್ತು", "ನಲವತ್ತು", "ನಲ್ವತ್ತು",
           "ಐವತ್ತು", "ಅರವತ್ತು", "ಎಪ್ಪತ್ತು", "ಎಂಬತ್ತು", "ತೊಂಬತ್ತು"],
    "hi": ["दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
           "बीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर", "अस्सी", "नब्बे"],
}
SCALE_OR_UNIT_WORDS = {
    "kn": ["ನೂರು", "ಸಾವಿರ", "ಲಕ್ಷ", "ಕೋಟಿ", "ರೂಪಾಯಿ", "ರೂಪಾಯಿಗಳು", "ರುಪಾಯಿ"],
    "hi": ["सौ", "हज़ार", "हजार", "लाख", "करोड़", "करोड", "रुपये", "रुपए", "रूपए", "रूपये", "रुपया"],
}
NEGATION_TOKENS = {
    "hi": {"नहीं", "नही", "नहिं", "मत", "न"},
    "kn": {"ಇಲ್ಲ", "ಇಲ್ಲಾ", "ಅಲ್ಲ", "ಅಲ್ಲಾ", "ಬೇಡ", "ಬೇಡಾ", "ಬೇಡಿ"},
}
NEGATION_RULE_TEXT = {
    "hi": "token in {नहीं, नही, नहिं, मत, न}; 'ना' excluded (tag particle in 'है ना').",
    "kn": "token in {ಇಲ್ಲ, ಇಲ್ಲಾ, ಅಲ್ಲ, ಅಲ್ಲಾ, ಬೇಡ, ಬೇಡಾ, ಬೇಡಿ}, or ends in ಬೇಡ/ಬೇಡಿ, or ends in "
          "ಲ್ಲ/ಲ್ಲಾ after a bare consonant or the vowel sign ಿ (fused ಅಲ್ಲ/ಇಲ್ಲ, e.g. ಮಾಡಲ್ಲ, "
          "ಗೊತ್ತಿಲ್ಲ); tokens starting with ಎಲ್ಲ ('all') and the ೆಲ್ಲ ending (ಬೆಲ್ಲ 'jaggery') excluded.",
}
# Lexicon keys are normalised exactly like transcripts, so a nukta or
# chandrabindu written precomposed or decomposed matches either way.
DIGIT_WORDS = {lang: {normalise_for_scoring(w): v for w, v in words.items()} for lang, words in DIGIT_WORDS.items()}
OTHER_NUMBER_WORDS = {lang: [normalise_for_scoring(w) for w in words] for lang, words in OTHER_NUMBER_WORDS.items()}
SCALE_OR_UNIT_WORDS = {lang: [normalise_for_scoring(w) for w in words] for lang, words in SCALE_OR_UNIT_WORDS.items()}
NEGATION_TOKENS = {lang: {normalise_for_scoring(w) for w in words} for lang, words in NEGATION_TOKENS.items()}

KN_VOWEL_SIGNS = {chr(c) for c in range(0x0CBE, 0x0CCD)} | {"ೕ", "ೖ"}

SCRIPT_BLOCKS = [
    ("kannada", 0x0C80, 0x0CFF), ("devanagari", 0x0900, 0x097F), ("telugu", 0x0C00, 0x0C7F),
    ("tamil", 0x0B80, 0x0BFF), ("malayalam", 0x0D00, 0x0D7F), ("bengali", 0x0980, 0x09FF),
    ("gurmukhi", 0x0A00, 0x0A7F), ("gujarati", 0x0A80, 0x0AFF), ("arabic", 0x0600, 0x06FF),
    ("arabic", 0x0750, 0x077F), ("arabic", 0xFB50, 0xFDFF), ("arabic", 0xFE70, 0xFEFF),
]
EXPECTED_SCRIPT = {"kn": "kannada", "hi": "devanagari"}


def load_manifest():
    with open(MANIFEST_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def read_raw():
    sessions, rows = [], {}
    if RAW_FILE.exists():
        with open(RAW_FILE, encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                if "_session" in rec:
                    sessions.append(rec["_session"])
                else:
                    rows[rec["id"]] = rec
    return sessions, rows


# =========================================================================
# TRANSCRIBE
# =========================================================================

def transcribe(limit_per_language=None):
    import torch

    manifest = load_manifest()
    if manifest.get("status") != "AUDIO_EXTRACTED_NOT_BENCHMARKED":
        sys.exit("manifest status is not AUDIO_EXTRACTED_NOT_BENCHMARKED; refusing to run")
    utterances = manifest["utterances"]

    print("verifying 400 WAV checksums against the frozen manifest ...")
    for u in utterances:
        path = SPIKE_DIR / u["audio_file"]
        if sha256_file(path) != u["audio_sha256"]:
            sys.exit(f"checksum mismatch for {u['id']}; refusing to run")

    _, done = read_raw()

    from app.speech.stt import SpeechToText

    started = time.perf_counter()
    stt = SpeechToText()
    load_seconds = time.perf_counter() - started

    warm = utterances[0]
    torch.manual_seed(SEED)
    started = time.perf_counter()
    stt.transcribe(str(SPIKE_DIR / warm["audio_file"]), language=warm["language"])
    warmup_seconds = time.perf_counter() - started

    session = {
        "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "model_load_seconds": round(load_seconds, 3),
        "warmup_clip": warm["id"],
        "warmup_seconds_discarded": round(warmup_seconds, 3),
        "torch_threads": torch.get_num_threads(),
        "torch_seed_per_clip": SEED,
        "resumed_with_completed": len(done),
    }
    with open(RAW_FILE, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"_session": session}) + "\n")

    for lang in LANGS:
        todo = [u for u in utterances if u["language"] == lang and u["id"] not in done]
        if limit_per_language is not None:
            todo = todo[:limit_per_language]
        for n, u in enumerate(todo, 1):
            path = SPIKE_DIR / u["audio_file"]
            torch.manual_seed(SEED)
            started = time.perf_counter()
            try:
                out = stt.transcribe(str(path), language=lang)
                hypothesis, error = out["text"], None
            except Exception as exc:  # recorded, never hidden
                hypothesis, error = "", f"{type(exc).__name__}: {exc}"
            latency = time.perf_counter() - started
            rec = {
                "id": u["id"], "language_param": lang, "hypothesis": hypothesis,
                "error": error, "latency_seconds": round(latency, 4),
                "audio_seconds": round(u["samples"] / SR, 4),
            }
            with open(RAW_FILE, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            print(f"[{lang} {n}/{len(todo)}] {u['id']} {latency:.2f}s "
                  f"rtf={latency / rec['audio_seconds']:.2f}" + (f" ERROR {error}" if error else ""),
                  flush=True)


# =========================================================================
# ANALYSE
# =========================================================================

def align_counts(ref, hyp):
    """Word-level substitutions, deletions, insertions via DP backtrace."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    i, j, s, dl, ins = n, m, 0, 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            s += ref[i - 1] != hyp[j - 1]
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            dl += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    return s, dl, ins


def script_profile(text, lang):
    counts = Counter()
    for ch in text:
        cat = unicodedata.category(ch)
        if not (cat.startswith("L") or cat.startswith("M")):
            continue
        cp = ord(ch)
        name = "latin" if ("a" <= ch.lower() <= "z") else "other"
        for block, lo, hi in SCRIPT_BLOCKS:
            if lo <= cp <= hi:
                name = block
                break
        counts[name] += 1
    total = sum(counts.values())
    expected = EXPECTED_SCRIPT[lang]
    return {
        "letters": total,
        "expected_share": round(counts[expected] / total, 3) if total else None,
        "dominant": counts.most_common(1)[0][0] if total else None,
        "counts": dict(counts),
    }


def is_negation(token, lang):
    if token in NEGATION_TOKENS[lang]:
        return True
    if lang == "kn":
        if token.startswith("ಎಲ್ಲ"):
            return False
        if token.endswith(("ಬೇಡ", "ಬೇಡಿ")):
            return True
        for tail in ("ಲ್ಲ", "ಲ್ಲಾ"):
            if token.endswith(tail) and len(token) > len(tail):
                prev = token[-len(tail) - 1]
                if prev == "ಿ" or (prev not in KN_VOWEL_SIGNS and prev != "್"):
                    return True
    return False


def number_phrases(tokens, lang):
    """Maximal runs of number tokens that are >=2 long or touch a scale/currency word."""
    numeric = set(DIGIT_WORDS[lang]) | set(OTHER_NUMBER_WORDS[lang])
    scale = set(SCALE_OR_UNIT_WORDS[lang])
    phrases, run = [], []
    for tok in tokens + [None]:
        if tok is not None and (tok in numeric or tok in scale or tok.isdigit()):
            run.append(tok)
            continue
        if run and (len(run) >= 2 or any(t in scale for t in run)) and any(t not in scale for t in run):
            phrases.append(run)
        run = []
    return phrases


def digit_stream(tokens, lang):
    out = []
    for tok in tokens:
        if tok in DIGIT_WORDS[lang]:
            out.append(str(DIGIT_WORDS[lang][tok]))
        elif tok.isdigit():
            out.append(tok)
    return "".join(out)


def identifier_runs(tokens, lang):
    runs, run = [], []
    for tok in tokens + [None]:
        if tok is not None and tok in DIGIT_WORDS[lang]:
            run.append(str(DIGIT_WORDS[lang][tok]))
            continue
        if len(run) >= 4:
            runs.append("".join(run))
        run = []
    return runs


def contains_seq(hay, needle):
    k = len(needle)
    return any(hay[i:i + k] == needle for i in range(len(hay) - k + 1))


def max_repeat_run(tokens):
    best = cur = 0
    prev = object()
    for t in tokens:
        cur = cur + 1 if t == prev else 1
        prev = t
        best = max(best, cur)
    return best


def max_ngram_repeat(tokens):
    """Highest occurrence count of any 2- to 4-word phrase (phrase-level loops)."""
    best = 0
    for n in (2, 3, 4):
        grams = Counter(tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1))
        if grams:
            best = max(best, max(grams.values()))
    return best


def cpu_name():
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        return winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
    except Exception:
        return platform.processor()


def pct(values, p):
    s = sorted(values)
    if not s:
        return None
    k = (len(s) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def bootstrap_ci(items, num_key, den_key, reps=1000, seed=SEED):
    rng = random.Random(seed)
    n = len(items)
    stats = []
    for _ in range(reps):
        sample = [items[rng.randrange(n)] for _ in range(n)]
        den = sum(x[den_key] for x in sample)
        stats.append(sum(x[num_key] for x in sample) / den if den else 0.0)
    stats.sort()
    return [round(stats[int(0.025 * reps)], 4), round(stats[int(0.975 * reps) - 1], 4)]


def score_utterance(u, r):
    lang = u["language"]
    ref, hyp = u["reference_transcript"], r["hypothesis"] or ""
    rn, hn = normalise_for_scoring(ref), normalise_for_scoring(hyp)
    rw, hw = rn.split(), hn.split()
    rc, hc = rn.replace(" ", ""), hn.replace(" ", "")
    s, dl, ins = align_counts(rw, hw)
    cdist = levenshtein(list(rc), list(hc))
    raw_ref, raw_hyp = ref.split(), hyp.split()
    hyp_bytes = hyp.encode("utf-8")
    comp = len(hyp_bytes) / len(zlib.compress(hyp_bytes)) if hyp_bytes else 0.0
    prof = script_profile(hyp, lang)
    rep = max_repeat_run(hw)
    ngram_rep = max_ngram_repeat(hw)
    ratio = len(hc) / max(1, len(rc))

    ref_phr = number_phrases(rw, lang)
    ref_ids = identifier_runs(rw, lang)
    hyp_stream = digit_stream(hw, lang)
    ref_neg = [t for t in rw if is_negation(t, lang)]
    hyp_neg = [t for t in hw if is_negation(t, lang)]

    return {
        "id": u["id"], "language": lang, "scenario": u["scenario"], "task_name": u["task_name"],
        "speaker_id": u["speaker_id"], "quality_flags": u["quality_flags"],
        "audio_seconds": r["audio_seconds"], "latency_seconds": r["latency_seconds"],
        "rtf": round(r["latency_seconds"] / r["audio_seconds"], 4),
        "error": r["error"],
        "reference": ref, "verbatim": u["verbatim_transcript"], "hypothesis": hyp,
        "reference_normalised": rn, "hypothesis_normalised": hn,
        "ref_words": len(rw), "hyp_words": len(hw), "word_edits": s + dl + ins,
        "sub": s, "del": dl, "ins": ins,
        "wer": round((s + dl + ins) / len(rw), 4) if rw else None,
        "ref_chars": len(rc), "hyp_chars": len(hc), "char_edits": cdist,
        "cer": round(cdist / len(rc), 4) if rc else None,
        "raw_word_edits": levenshtein(raw_ref, raw_hyp),
        "empty": hn == "",
        "script": prof,
        "wrong_script": bool(prof["letters"]) and prof["expected_share"] < 0.5,
        "compression_ratio": round(comp, 3),
        "max_repeat_run": rep,
        "max_ngram_repeat": ngram_rep,
        "hyp_to_ref_char_ratio": round(ratio, 3),
        "unusual_output": (not r["error"]) and (comp > 2.4 or rep >= 4 or ngram_rep >= 3
                                                or (ratio > 2.0 and len(hc) > 20)),
        "slower_than_realtime": r["latency_seconds"] > r["audio_seconds"],
        "normalisation_touched": {
            "punctuation_or_symbols": any(not (c.isalnum() or c.isspace() or unicodedata.category(c).startswith("M")) for c in hyp),
            "native_digits_folded": any("೦" <= c <= "೯" or "०" <= c <= "९" for c in hyp),
            "zero_width_removed": any(c in "‌‍" for c in hyp),
            "latin_lowercased": any("A" <= c <= "Z" for c in hyp),
            "nfc_changed": unicodedata.normalize("NFC", hyp) != hyp,
        },
        "hyp_has_digits": any(c.isdigit() for c in hn),
        "hyp_latin_tokens": [t for t in hw if all("a" <= c <= "z" for c in t)],
        "number_phrases": [
            {"phrase": " ".join(p), "preserved_exact": contains_seq(hw, p)} for p in ref_phr],
        "identifier_runs": [
            {"digits": d, "preserved_in_hyp_digit_stream": d in hyp_stream} for d in ref_ids],
        "negation_ref": ref_neg, "negation_hyp": hyp_neg,
    }


def aggregate(items):
    if not items:
        return None
    ref_words = sum(x["ref_words"] for x in items)
    ref_chars = sum(x["ref_chars"] for x in items)
    lat = [x["latency_seconds"] for x in items]
    audio = sum(x["audio_seconds"] for x in items)
    wers = [x["wer"] for x in items]
    return {
        "clips": len(items),
        "speakers": len({x["speaker_id"] for x in items}),
        "audio_minutes": round(audio / 60, 2),
        "ref_words": ref_words, "ref_chars": ref_chars,
        "wer": round(sum(x["word_edits"] for x in items) / ref_words, 4),
        "wer_ci95": bootstrap_ci(items, "word_edits", "ref_words"),
        "sub_rate": round(sum(x["sub"] for x in items) / ref_words, 4),
        "del_rate": round(sum(x["del"] for x in items) / ref_words, 4),
        "ins_rate": round(sum(x["ins"] for x in items) / ref_words, 4),
        "cer": round(sum(x["char_edits"] for x in items) / ref_chars, 4),
        "cer_ci95": bootstrap_ci(items, "char_edits", "ref_chars"),
        "raw_wer_unnormalised": round(sum(x["raw_word_edits"] for x in items) / sum(len(x["reference"].split()) for x in items), 4),
        "utterance_wer_median": round(statistics.median(wers), 4),
        "utterances_wer_0": sum(w == 0 for w in wers),
        "utterances_wer_ge_1": sum(w >= 1 for w in wers),
        "empty_outputs": sum(x["empty"] for x in items),
        "failed_outputs": sum(bool(x["error"]) for x in items),
        "unusual_outputs": sum(x["unusual_output"] for x in items),
        "wrong_script_outputs": sum(x["wrong_script"] for x in items),
        "slower_than_realtime_clips": sum(x["slower_than_realtime"] for x in items),
        "latency_seconds": {
            "mean": round(statistics.mean(lat), 3), "median": round(statistics.median(lat), 3),
            "p95": round(pct(lat, 95), 3), "max": round(max(lat), 3),
        },
        "rtf_aggregate": round(sum(lat) / audio, 4),
        "rtf_median": round(statistics.median(x["rtf"] for x in items), 4),
    }


def category_summary(items, lang):
    phrases = [p for x in items for p in x["number_phrases"]]
    ids = [i for x in items for i in x["identifier_runs"]]
    neg_ref = [x for x in items if x["negation_ref"]]
    neg_ins = [x for x in items if x["negation_hyp"] and not x["negation_ref"]]
    latin = [x for x in items if x["hyp_latin_tokens"]]
    return {
        "numbers": {
            "rule": "maximal run of number words (0-90 lexicon, scale and rupee words) of length >=2 or "
                    "touching a scale/rupee word; preserved = same token run appears contiguously in hypothesis",
            "utterances_with_number_phrases": sum(bool(x["number_phrases"]) for x in items),
            "number_phrases": len(phrases),
            "preserved_exact": sum(p["preserved_exact"] for p in phrases),
            "hypotheses_containing_digits": sum(x["hyp_has_digits"] for x in items),
            "digits_where_reference_has_number_phrase": sum(x["hyp_has_digits"] and bool(x["number_phrases"]) for x in items),
        },
        "identifiers": {
            "rule": ">=4 consecutive single-digit words in the reference (phone/UPI-style digit strings); "
                    "preserved = digit string appears in the hypothesis digit stream (digits + digit words)",
            "identifier_runs": len(ids),
            "preserved": sum(i["preserved_in_hyp_digit_stream"] for i in ids),
        },
        "names": {
            "status": "NOT MEASURABLE",
            "why": "IndicVoices carries no name/entity annotation; names are shown qualitatively only "
                   "in the Digital Payment Commands examples of the error analysis",
        },
        "code_mixed": {
            "rule": "references contain 0 Latin-script tokens (English loanwords are in native script); "
                    "counted here: hypotheses that emit Latin-script tokens",
            "hypotheses_with_latin_tokens": len(latin),
            "latin_tokens_total": sum(len(x["hyp_latin_tokens"]) for x in items),
        },
        "negation": {
            "rule": NEGATION_RULE_TEXT[lang] + " Polarity only: a marker present, not the same marker in place.",
            "reference_negative_utterances": len(neg_ref),
            "negation_marker_preserved": sum(bool(x["negation_hyp"]) for x in neg_ref),
            "negation_marker_dropped": sum(not x["negation_hyp"] for x in neg_ref),
            "negation_marker_inserted": len(neg_ins),
        },
    }


def analyse():
    manifest = load_manifest()
    sessions, raw = read_raw()
    utterances = manifest["utterances"]
    missing = [u["id"] for u in utterances if u["id"] not in raw]
    scored = [score_utterance(u, raw[u["id"]]) for u in utterances if u["id"] in raw]

    import torch
    import whisper  # noqa: F401  (version only)
    from importlib.metadata import version

    results = {
        "phase": "3.2B-8",
        "track": "GENERAL_ASR_BASELINE",
        "status": "COMPLETE" if not missing else "PARTIAL",
        "missing_clips": missing,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "manifest": {"file": MANIFEST_FILE.name, "sha256": sha256_file(MANIFEST_FILE),
                     "dataset_revision": manifest["dataset"]["revision"]},
        "system_under_test": {
            "implementation": "app.speech.stt.SpeechToText (unmodified) -> whisper.load_model('small'); "
                              "model.transcribe(path, language=<code>, fp16=False)",
            "model_file_sha256": sha256_file(Path.home() / ".cache" / "whisper" / "small.pt"),
            "decoding": "openai-whisper transcribe() defaults: greedy at T=0 (beam_size=None), temperature "
                        "fallback 0.2..1.0 (single sample) when compression ratio > 2.4 or avg logprob < -1.0, "
                        "no_speech_threshold 0.6, condition_on_previous_text=True, no initial prompt",
            "language_codes": {"kn": "kn", "hi": "hi"},
            "openai_whisper": version("openai-whisper"), "torch": torch.__version__,
        },
        "hardware": {"cpu": cpu_name(), "python": platform.python_version(),
                     "platform": platform.platform()},
        "run_sessions": sessions,
        "latency_definition": "wall time of SpeechToText.transcribe() per clip (audio load via ffmpeg + "
                              "log-mel + decode); model load and one warm-up clip excluded",
        "normalisation_rules": NORMALISATION_RULES,
        "unusual_output_rule": "compression ratio > 2.4 (Whisper's own loop threshold), or the same word "
                               "repeated >= 4 times in a row, or any 2-4 word phrase occurring >= 3 times, "
                               "or hypothesis > 2x reference characters",
        "slow_clip_rule": "latency greater than the clip's audio duration (RTF > 1)",
        "wrong_script_rule": "fewer than 50% of hypothesis letters in the expected script "
                             "(Kannada U+0C80-0CFF, Devanagari U+0900-097F)",
        "by_language": {}, "by_language_scenario": {}, "by_language_quality": {},
        "categories": {}, "normalisation_effects_on_hypotheses": {},
        "per_utterance": scored,
    }
    for lang in LANGS:
        items = [x for x in scored if x["language"] == lang]
        results["by_language"][lang] = aggregate(items)
        results["by_language_scenario"][lang] = {sc: aggregate([x for x in items if x["scenario"] == sc]) for sc in SCENARIOS}
        results["by_language_quality"][lang] = {
            "flagged_noise_chatter_etc": aggregate([x for x in items if x["quality_flags"]]),
            "no_quality_flags": aggregate([x for x in items if not x["quality_flags"]]),
        }
        results["categories"][lang] = category_summary(items, lang)
        results["normalisation_effects_on_hypotheses"][lang] = {
            k: sum(x["normalisation_touched"][k] for x in items)
            for k in ("punctuation_or_symbols", "native_digits_folded", "zero_width_removed", "latin_lowercased", "nfc_changed")
        }
        results["normalisation_effects_on_hypotheses"][lang]["dominant_script_of_hypotheses"] = dict(
            Counter(x["script"]["dominant"] for x in items))

    with open(RESULTS_FILE, "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
    write_report(results)
    write_error_analysis(results)
    print(f"wrote {RESULTS_FILE.name}, {REPORT_FILE.name}, {ERRORS_FILE.name} "
          f"({len(scored)} clips scored, {len(missing)} missing)")
    return results


# =========================================================================
# REPORTS
# =========================================================================

def _p(x, digits=1):
    return "n/a" if x is None else f"{100 * x:.{digits}f}%"


def _cell(text, limit=260):
    text = (text or "").replace("|", "\\|").replace("\n", " ")
    return text if len(text) <= limit else text[:limit] + " …[truncated]"


def write_report(res):
    L = []
    a = L.append
    a("# Phase 3.2B-8 — IndicVoices General-Track ASR Baseline (Whisper small)\n")
    a("Spike artifact. Not production code, not part of the regression suite. Every number below was "
      "measured on this machine from `indicvoices_asr_raw.jsonl`; nothing is estimated.\n")
    a(f"**Status:** `{res['status']}`" + (f" — missing: {len(res['missing_clips'])}" if res["missing_clips"] else "") + "\n")
    a("## What was measured\n")
    a("| | |\n|---|---|")
    a(f"| Clips | 400 frozen clips from `{res['manifest']['file']}` (sha256 `{res['manifest']['sha256'][:12]}…`), "
      f"IndicVoices revision `{res['manifest']['dataset_revision'][:12]}…` |")
    a(f"| System under test | `{res['system_under_test']['implementation']}` |")
    a(f"| Model | Whisper small, file sha256 `{res['system_under_test']['model_file_sha256'][:12]}…`; "
      f"openai-whisper {res['system_under_test']['openai_whisper']}, torch {res['system_under_test']['torch']} |")
    a(f"| Decoding | {res['system_under_test']['decoding']} |")
    a("| Language codes | `kn` for all Kannada clips, `hi` for all Hindi clips, passed explicitly |")
    a(f"| Hardware | {res['hardware']['cpu']}, CPU only, {res['run_sessions'][-1]['torch_threads'] if res['run_sessions'] else '?'} torch threads |")
    a(f"| Latency | {res['latency_definition']} |")
    a("| Reference | manifest `reference_transcript` (IndicVoices `normalized`); `verbatim` retained for audit |\n")

    a("## Results by language\n")
    a("| | Kannada | Hindi |\n|---|---|---|")
    bl = res["by_language"]
    rows = [
        ("Clips / speakers", lambda s: f"{s['clips']} / {s['speakers']}"),
        ("Audio", lambda s: f"{s['audio_minutes']} min"),
        ("**WER** (95% CI)", lambda s: f"**{_p(s['wer'])}** ({_p(s['wer_ci95'][0])}–{_p(s['wer_ci95'][1])})"),
        ("  substitutions / deletions / insertions", lambda s: f"{_p(s['sub_rate'])} / {_p(s['del_rate'])} / {_p(s['ins_rate'])}"),
        ("**CER** (95% CI)", lambda s: f"**{_p(s['cer'])}** ({_p(s['cer_ci95'][0])}–{_p(s['cer_ci95'][1])})"),
        ("WER without normalisation (whitespace split only)", lambda s: _p(s["raw_wer_unnormalised"])),
        ("Median per-clip WER", lambda s: _p(s["utterance_wer_median"])),
        ("Clips with WER 0 / WER ≥ 100%", lambda s: f"{s['utterances_wer_0']} / {s['utterances_wer_ge_1']}"),
        ("Empty outputs", lambda s: str(s["empty_outputs"])),
        ("Failed (exception) outputs", lambda s: str(s["failed_outputs"])),
        ("Unusual outputs (loops / >2× length)", lambda s: str(s["unusual_outputs"])),
        ("Wrong-script outputs", lambda s: str(s["wrong_script_outputs"])),
        ("Clips slower than real time (RTF > 1)", lambda s: str(s["slower_than_realtime_clips"])),
        ("Latency mean / median / p95 / max", lambda s: "{mean:.2f} / {median:.2f} / {p95:.2f} / {max:.2f} s".format(**s["latency_seconds"])),
        ("Real-time factor (total / median per clip)", lambda s: f"{s['rtf_aggregate']:.2f} / {s['rtf_median']:.2f}"),
    ]
    for label, fn in rows:
        a(f"| {label} | " + " | ".join(fn(bl[l]) if bl.get(l) else "n/a" for l in LANGS) + " |")
    a("\nRTF < 1 means faster than real time.\n")

    a("## Results by scenario\n")
    a("| Language | Scenario | Clips | WER | CER | Empty | Unusual | Wrong script | Slower than real time | Latency median / p95 | RTF |")
    a("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for l in LANGS:
        for sc in SCENARIOS:
            s = res["by_language_scenario"][l].get(sc)
            if s:
                a(f"| {LANG_NAME[l]} | {sc} | {s['clips']} | {_p(s['wer'])} | {_p(s['cer'])} | {s['empty_outputs']} | "
                  f"{s['unusual_outputs']} | {s['wrong_script_outputs']} | {s['slower_than_realtime_clips']} | "
                  f"{s['latency_seconds']['median']:.2f} / {s['latency_seconds']['p95']:.2f} s | {s['rtf_aggregate']:.2f} |")
    a("")
    a("## Results by recording-quality flag\n")
    a("| Language | Group | Clips | WER | CER |\n|---|---|---:|---:|---:|")
    for l in LANGS:
        for g, s in res["by_language_quality"][l].items():
            if s:
                a(f"| {LANG_NAME[l]} | {g.replace('_', ' ')} | {s['clips']} | {_p(s['wer'])} | {_p(s['cer'])} |")
    a("")
    a("## Script of the output\n")
    a("| Language | Dominant script of hypothesis → clips |\n|---|---|")
    for l in LANGS:
        d = res["normalisation_effects_on_hypotheses"][l]["dominant_script_of_hypotheses"]
        a(f"| {LANG_NAME[l]} | " + ", ".join(f"{k}: {v}" for k, v in sorted(d.items(), key=lambda kv: -kv[1])) + " |")
    a("")
    a("## Entity-like and safety-relevant content (heuristic, see error analysis)\n")
    a("| | Kannada | Hindi |\n|---|---|---|")
    c = res["categories"]
    a("| Number phrases in reference → preserved exactly | " + " | ".join(
        f"{c[l]['numbers']['number_phrases']} → {c[l]['numbers']['preserved_exact']}" for l in LANGS) + " |")
    a("| Hypotheses writing digits where reference has number words | " + " | ".join(
        str(c[l]["numbers"]["digits_where_reference_has_number_phrase"]) for l in LANGS) + " |")
    a("| Digit-string identifiers (≥4 digit words) → preserved | " + " | ".join(
        f"{c[l]['identifiers']['identifier_runs']} → {c[l]['identifiers']['preserved']}" for l in LANGS) + " |")
    a("| Names | NOT MEASURABLE (no annotation) | NOT MEASURABLE (no annotation) |")
    a("| Hypotheses emitting Latin-script tokens (references have none) | " + " | ".join(
        str(c[l]["code_mixed"]["hypotheses_with_latin_tokens"]) for l in LANGS) + " |")
    a("| Negative references → marker kept / dropped; markers inserted | " + " | ".join(
        f"{c[l]['negation']['reference_negative_utterances']} → {c[l]['negation']['negation_marker_preserved']} / "
        f"{c[l]['negation']['negation_marker_dropped']}; {c[l]['negation']['negation_marker_inserted']}" for l in LANGS) + " |")
    a("")
    a("## Normalisation used for WER / CER\n")
    for rule in res["normalisation_rules"]:
        a(f"- {rule}")
    a("\nHow often each rule changed a **hypothesis** (references were already clean — the normaliser "
      "changes none of the 400 references):\n")
    a("| Rule | Kannada | Hindi |\n|---|---:|---:|")
    for k in ("punctuation_or_symbols", "native_digits_folded", "zero_width_removed", "latin_lowercased", "nfc_changed"):
        a(f"| {k.replace('_', ' ')} | " + " | ".join(str(res["normalisation_effects_on_hypotheses"][l][k]) for l in LANGS) + " |")
    a("")
    a(f"- Unusual output rule: {res['unusual_output_rule']}.")
    a(f"- Slow clip rule: {res['slow_clip_rule']}.")
    a(f"- Wrong-script rule: {res['wrong_script_rule']}.")
    a("\n## Files\n")
    a(f"- `{RESULTS_FILE.name}` — machine-readable results, including every clip's reference, verbatim, hypothesis and scores")
    a(f"- `{ERRORS_FILE.name}` — error analysis with representative examples")
    a(f"- `{RAW_FILE.name}` — raw per-clip transcriptions and latencies (resumable run log)")
    a(f"- `{Path(__file__).name}` — the runner")
    REPORT_FILE.write_text("\n".join(L) + "\n", encoding="utf-8")


def _example(x):
    return (f"**{x['id']}** · {x['scenario']} · {x['task_name']} · {x['audio_seconds']:.1f}s · "
            f"WER {_p(x['wer'], 0)} · CER {_p(x['cer'], 0)} · latency {x['latency_seconds']:.1f}s\n\n"
            f"| | |\n|---|---|\n| REF | {_cell(x['reference'])} |\n| VERBATIM | {_cell(x['verbatim'])} |\n"
            f"| HYP | {_cell(x['hypothesis'])} |\n")


def write_error_analysis(res):
    L = []
    a = L.append
    a("# Phase 3.2B-8 — IndicVoices ASR Baseline: Error Analysis\n")
    a("Representative examples drawn deterministically from `indicvoices_asr_results.json` "
      "(sorted by CER / id — no hand-picking). REF = scoring reference (IndicVoices `normalized`), "
      "VERBATIM = as spoken (audit only), HYP = Whisper small output, unmodified. Long texts are truncated "
      "for display only; scores use the full text.\n")
    for l in LANGS:
        items = [x for x in res["per_utterance"] if x["language"] == l]
        if not items:
            continue
        s = res["by_language"][l]
        c = res["categories"][l]
        a(f"## {LANG_NAME[l]}\n")
        a(f"WER {_p(s['wer'])}, CER {_p(s['cer'])}, {s['empty_outputs']} empty, {s['failed_outputs']} failed, "
          f"{s['unusual_outputs']} unusual, {s['wrong_script_outputs']} wrong-script out of {s['clips']}.\n")
        ranked = sorted([x for x in items if not x["empty"]], key=lambda x: (x["cer"], x["id"]))
        if ranked:
            a("### Best, median and worst (by CER, non-empty)\n")
            picks = ranked[:2] + ranked[len(ranked) // 2 - 1:len(ranked) // 2 + 1] + ranked[-2:]
            for x in picks:
                a(_example(x))
        groups = [
            ("Wrong-script outputs", [x for x in items if x["wrong_script"]], 3,
             lambda x: f"dominant script: {x['script']['dominant']}, expected share {x['script']['expected_share']}"),
            ("Unusual outputs (loops / runaway length)", sorted([x for x in items if x["unusual_output"]], key=lambda x: -x["latency_seconds"]), 3,
             lambda x: f"compression {x['compression_ratio']}, max word repeat {x['max_repeat_run']}, "
                       f"max phrase repeat {x['max_ngram_repeat']}, hyp/ref chars {x['hyp_to_ref_char_ratio']}"),
            ("Empty outputs", [x for x in items if x["empty"]], 5, lambda x: ""),
            ("Failed outputs", [x for x in items if x["error"]], 5, lambda x: x["error"] or ""),
        ]
        for title, xs, k, note in groups:
            a(f"### {title}: {len(xs)}\n")
            for x in xs[:k]:
                extra = note(x)
                a(_example(x) + (f"\n_{extra}_\n" if extra else ""))
        a("### Numbers\n")
        n = c["numbers"]
        a(f"Rule: {n['rule']}. {n['number_phrases']} phrases in {n['utterances_with_number_phrases']} clips; "
          f"{n['preserved_exact']} preserved exactly; {n['digits_where_reference_has_number_phrase']} hypotheses "
          f"wrote digits where the reference has number words (scored as errors — not normalised away).\n")
        for x in [x for x in items if x["number_phrases"]][:4]:
            a(_example(x) + "\n_phrases: " + "; ".join(
                f"`{p['phrase']}` → {'kept' if p['preserved_exact'] else 'NOT kept'}" for p in x["number_phrases"]) + "_\n")
        a("### Identifiers (digit strings)\n")
        i = c["identifiers"]
        a(f"Rule: {i['rule']}. {i['identifier_runs']} found, {i['preserved']} preserved.\n")
        for x in [x for x in items if x["identifier_runs"]]:
            a(_example(x) + "\n_" + "; ".join(
                f"`{r['digits']}` → {'preserved' if r['preserved_in_hyp_digit_stream'] else 'NOT preserved'}" for r in x["identifier_runs"]) + "_\n")
        a("### Names\n")
        a(f"{c['names']['status']}: {c['names']['why']}.\n")
        a("### Code-mixed / Latin-script output\n")
        cm = c["code_mixed"]
        a(f"{cm['rule']}: {cm['hypotheses_with_latin_tokens']} clips, {cm['latin_tokens_total']} Latin tokens.\n")
        for x in [x for x in items if x["hyp_latin_tokens"]][:3]:
            a(_example(x) + f"\n_Latin tokens: {', '.join(x['hyp_latin_tokens'][:12])}_\n")
        a("### Negation (heuristic polarity check)\n")
        ng = c["negation"]
        a(f"Rule: {ng['rule']}\n\n{ng['reference_negative_utterances']} reference clips contain a negation marker; "
          f"marker kept in {ng['negation_marker_preserved']}, dropped in {ng['negation_marker_dropped']}; "
          f"marker inserted into {ng['negation_marker_inserted']} non-negative clips.\n")
        dropped = [x for x in items if x["negation_ref"] and not x["negation_hyp"]]
        inserted = [x for x in items if x["negation_hyp"] and not x["negation_ref"]]
        for x in dropped[:3]:
            a(_example(x) + f"\n_dropped: reference markers {x['negation_ref']}_\n")
        for x in inserted[:2]:
            a(_example(x) + f"\n_inserted: hypothesis markers {x['negation_hyp']}_\n")
        a("### Digital Payment Commands in this general selection (banking-adjacent, qualitative only)\n")
        for x in [x for x in items if x["task_name"] == "Digital Payment Commands"]:
            a(_example(x))
    ERRORS_FILE.write_text("\n".join(L) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcribe", action="store_true")
    parser.add_argument("--analyse", action="store_true")
    parser.add_argument("--limit-per-language", type=int, default=None)
    args = parser.parse_args()
    if args.transcribe:
        transcribe(args.limit_per_language)
    if args.analyse:
        analyse()
    if not (args.transcribe or args.analyse):
        parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
