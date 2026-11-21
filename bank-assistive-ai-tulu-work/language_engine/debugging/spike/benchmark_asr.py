"""
PHASE 3.2B-7 -- ASR BENCHMARK RUNNER

Benchmarks the EXISTING Whisper baseline against the corpus. Nothing in
app/ is modified: this imports app.speech.stt.SpeechToText and calls it
exactly as the pipeline does.

Run from language_engine/:

    $env:PYTHONIOENCODING = "utf-8"
    .\\venv\\Scripts\\python.exe -m debugging.spike.benchmark_asr

With no recordings present it prints a readiness report and exits
WAITING_FOR_REAL_AUDIO without loading a single model. It NEVER
estimates, extrapolates or simulates a transcription.

METRIC HONESTY

  WER is reported per language but is a poor primary metric for
  Kannada: the language is agglutinative, so one wrong suffix destroys
  a whole token and a small pronunciation difference can read as a 100%
  word error. CER is reported alongside for exactly that reason, and
  neither is collapsed into a single cross-language average.

  Entity, negation and intent results are reported SEPARATELY from WER,
  because a transcript can be word-perfect and still lose an account
  number, and can be word-poor while preserving every digit.
"""

import json
import statistics
import sys
import time
import unicodedata
from pathlib import Path


SPIKE_DIR = Path(__file__).resolve().parent
CORPUS_FILE = SPIKE_DIR / "corpus_metadata.json"
AUDIO_ROOT = SPIKE_DIR / "corpus" / "audio"
RESULTS_FILE = SPIKE_DIR / "asr_results.json"

LINE = "=" * 72


# =========================================================
# NUMERAL AND TEXT NORMALISATION
# =========================================================

# Kannada and Devanagari digits fold to ASCII so an identifier written
# in either script still compares equal. This is an EVALUATOR concern
# only -- it is not entity_guard.py and nothing in app/ uses it.
DIGIT_FOLD = {}

for base, ascii_start in ((0x0CE6, "0"), (0x0966, "0")):
    for offset in range(10):
        DIGIT_FOLD[chr(base + offset)] = str(offset)


def fold_digits(text):
    return "".join(DIGIT_FOLD.get(ch, ch) for ch in text or "")


#: Zero-width joiners carry rendering information, not word identity.
ZERO_WIDTH = "‌‍"


def normalise_for_scoring(text):
    """
    Lowercases, folds digits, strips punctuation, collapses whitespace.

    Punctuation is removed rather than scored: Whisper's punctuation is
    a stylistic choice, and counting it as an error would inflate WER
    for reasons that have nothing to do with banking.

    COMBINING MARKS ARE KEPT. str.isalnum() is False for Unicode
    category Mn -- every Kannada and Devanagari vowel sign, virama and
    nukta. Filtering on isalnum() alone therefore deletes the matras and
    shreds each word into consonant fragments: "ಐದು" becomes "ಐದ",
    "मुझे पैसे चाहिए" scores as seven tokens instead of three, and two
    genuinely different Kannada words collapse to the same skeleton and
    score CER 0. The evaluator self-check caught exactly that.
    """

    text = fold_digits(text or "")
    text = unicodedata.normalize("NFC", text)

    kept = []

    for ch in text:
        if ch in ZERO_WIDTH:
            continue

        if ch.isalnum() or unicodedata.category(ch).startswith("M"):
            kept.append(ch)
        else:
            kept.append(" ")

    return " ".join("".join(kept).lower().split())


def levenshtein(reference, hypothesis):
    """Edit distance over any sequence. Pure Python, no new dependency."""

    if reference == hypothesis:
        return 0

    if not reference:
        return len(hypothesis)

    if not hypothesis:
        return len(reference)

    previous = list(range(len(hypothesis) + 1))

    for i, ref_item in enumerate(reference, start=1):
        current = [i]

        for j, hyp_item in enumerate(hypothesis, start=1):
            cost = 0 if ref_item == hyp_item else 1
            current.append(
                min(
                    previous[j] + 1,          # deletion
                    current[j - 1] + 1,       # insertion
                    previous[j - 1] + cost,   # substitution
                )
            )

        previous = current

    return previous[-1]


def error_rate(reference, hypothesis, unit):
    """Returns (rate, distance, reference_length) or None when there is no reference."""

    ref = normalise_for_scoring(reference)
    hyp = normalise_for_scoring(hypothesis)

    ref_seq = ref.split() if unit == "word" else ref.replace(" ", "")
    hyp_seq = hyp.split() if unit == "word" else hyp.replace(" ", "")

    if not ref_seq:
        return None

    distance = levenshtein(list(ref_seq), list(hyp_seq))

    return distance / len(ref_seq), distance, len(ref_seq)


# =========================================================
# AMOUNT PARSING  (semantic, not string)
#
# Deliberately SMALL and explicit. It covers the number words this
# corpus actually uses and reports UNPARSED for anything else rather
# than guessing -- an evaluator that silently guesses a number is worse
# than one that admits it cannot read the utterance.
#
# This is benchmark tooling. It is NOT entity_guard.py, nothing in app/
# imports it, and it must not be promoted into production without its
# own design pass.
# =========================================================

_UNIT_WORDS_RAW = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "twenty": 20, "fifty": 50,
    "ondu": 1, "eradu": 2, "muru": 3, "aidu": 5, "ippattu": 20,
    "ಒಂದು": 1, "ಎರಡು": 2, "ಮೂರು": 3, "ನಾಲ್ಕು": 4, "ಐದು": 5,
    "ಆರು": 6, "ಏಳು": 7, "ಎಂಟು": 8, "ಒಂಬತ್ತು": 9, "ಹತ್ತು": 10,
    "ಇಪ್ಪತ್ತು": 20,
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5,
    "छह": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "बीस": 20,

    # Ordinals, needed for step references ("repeat step three").
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "ಮೊದಲನೇ": 1, "ಎರಡನೇ": 2, "ಮೂರನೇ": 3, "ಮೂರನೆ": 3,
    "ನಾಲ್ಕನೇ": 4, "ಐದನೇ": 5,
    "पहला": 1, "दूसरा": 2, "तीसरा": 3, "तीसरे": 3,
    "चौथा": 4, "पाँचवाँ": 5,
}

_SCALE_WORDS_RAW = {
    "hundred": 100, "thousand": 1000,
    "lakh": 100000, "lac": 100000, "lakhs": 100000,
    "crore": 10000000, "crores": 10000000,
    "ನೂರು": 100, "ಸಾವಿರ": 1000, "ಲಕ್ಷ": 100000, "ಕೋಟಿ": 10000000,
    "सौ": 100, "हज़ार": 1000, "हजार": 1000,
    "लाख": 100000, "करोड़": 10000000, "करोड": 10000000,
}


# Keys are normalised the SAME way transcripts are, so a nukta written
# as a combining mark and one written precomposed both match.
UNIT_WORDS = {
    normalise_for_scoring(word): value
    for word, value in _UNIT_WORDS_RAW.items()
}

SCALE_WORDS = {
    normalise_for_scoring(word): value
    for word, value in _SCALE_WORDS_RAW.items()
}


def parse_amount(text):
    """
    Extracts a single monetary value. Returns an int, or None when the
    utterance carries no readable amount.

    Handles: bare digit runs with Indian or Western grouping, and
    <unit> <scale> phrases in English, Kannada and Hindi.
    """

    if not text:
        return None

    folded = fold_digits(text)

    # 1. Grouped or bare digits: 2,00,000 / 200,000 / 20000
    digits_buffer = []
    best_digit_value = None

    for ch in folded + " ":
        if ch.isdigit():
            digits_buffer.append(ch)
        elif ch == "," and digits_buffer:
            continue
        else:
            if digits_buffer:
                value = int("".join(digits_buffer))

                # An identifier-length run is not an amount.
                if len(digits_buffer) <= 7:
                    if best_digit_value is None or value > best_digit_value:
                        best_digit_value = value

                digits_buffer = []

    # 2. Number words
    tokens = normalise_for_scoring(folded).split()

    total = 0
    pending = 0
    saw_unit_word = False
    saw_scale = False

    for token in tokens:
        if token in UNIT_WORDS:
            pending = pending + UNIT_WORDS[token] if pending else UNIT_WORDS[token]
            saw_unit_word = True

        elif token.isdigit() and len(token) <= 7:
            # "2 lakh" -- a digit can be the multiplicand of a scale
            # word. Identifier-length runs are excluded so an account
            # number is never read as an amount.
            pending = int(token)

        elif token in SCALE_WORDS:
            total += (pending or 1) * SCALE_WORDS[token]
            pending = 0
            saw_scale = True

    if saw_scale:
        return total + pending

    if saw_unit_word and pending:
        return pending

    return best_digit_value


# =========================================================
# CORPUS
# =========================================================

def load_corpus():
    with open(CORPUS_FILE, encoding="utf-8") as handle:
        return json.load(handle)


def audio_path_for(utterance):
    return AUDIO_ROOT / utterance["recording_file"]


def available(utterances):
    return [u for u in utterances if audio_path_for(u).exists()]


def readiness_report(corpus):
    utterances = corpus["utterances"]
    present = available(utterances)

    print()
    print(LINE)
    print("PHASE 3.2B-7 -- ASR BENCHMARK READINESS")
    print(LINE)
    print()

    for language in corpus["languages"]:
        rows = [u for u in utterances if u["language"] == language]
        have = [u for u in rows if audio_path_for(u).exists()]

        print("  " + language + " : " + str(len(have)) + " / " + str(len(rows)) + " recordings present")

        by_category = {}

        for row in rows:
            slot = by_category.setdefault(row["category"], [0, 0])
            slot[1] += 1

            if audio_path_for(row).exists():
                slot[0] += 1

        for category in sorted(by_category):
            have_n, total_n = by_category[category]
            print("        " + category.ljust(16) + str(have_n) + "/" + str(total_n))

    print()
    print("  total present : " + str(len(present)) + " / " + str(len(utterances)))
    print("  audio root    : " + str(AUDIO_ROOT))

    return present


# =========================================================
# EVALUATION OF ONE UTTERANCE
# =========================================================

def evaluate_entities(utterance, hypothesis):
    """
    Entity checks, reported per entity kind rather than as one score.

    Identifiers are STRING invariants -- the exact run must survive.
    Amounts are SEMANTIC invariants -- the parsed value must survive,
    however it was worded.
    """

    expected = utterance.get("expected_entities") or {}
    outcome = {}

    folded_hypothesis = fold_digits(hypothesis or "")

    for key in ("account_number", "phone_number"):
        if key in expected:
            wanted = str(expected[key])
            found = wanted in folded_hypothesis.replace(" ", "")

            outcome[key] = {
                "expected": wanted,
                "preserved": found,
                "kind": "string_invariant",
            }

            if not found and not any(ch.isdigit() for ch in folded_hypothesis):
                outcome[key]["note"] = "spoken_digit_words"

    if "amount" in expected:
        parsed = parse_amount(hypothesis)

        outcome["amount"] = {
            "expected": expected["amount"],
            "parsed": parsed,
            "preserved": parsed == expected["amount"],
            "kind": "semantic_invariant",
        }

    if "step_number" in expected:
        parsed = parse_amount(hypothesis)

        outcome["step_number"] = {
            "expected": expected["step_number"],
            "parsed": parsed,
            "preserved": parsed == expected["step_number"],
            "kind": "semantic_invariant",
        }

    if "name" in expected:
        # Deliberately NOT scored at the ASR stage.
        #
        # expected_entities.name holds the LATIN transliteration
        # ("Kamala"), but a Kannada recording is transcribed in Kannada
        # script -- so a Latin substring match would fail every time and
        # would be measuring the script, not the ASR. At this stage the
        # name is already covered by CER (did the syllables survive) and
        # by must_not_contain (was it turned into its literal meaning).
        #
        # Positive name preservation is a TRANSLATION-stage assertion,
        # and benchmark_translation.py makes it there. Reported here as
        # not-applicable so the gap is visible rather than silent.
        outcome["name"] = {
            "expected": expected["name"],
            "preserved": None,
            "kind": "deferred_to_translation_benchmark",
            "note": "latin_transliteration_not_comparable_to_native_script_transcript",
        }

    return outcome


def evaluate_must_contain(utterance, hypothesis):
    """Code-mixed banking terms and literal-meaning traps."""

    hypothesis_lower = (hypothesis or "").lower()
    folded = fold_digits(hypothesis_lower)

    required = utterance.get("expected_transcript_must_contain") or []
    forbidden = utterance.get("must_not_contain") or []

    return {
        "required": {term: (term.lower() in folded) for term in required},
        "forbidden_present": [t for t in forbidden if t.lower() in hypothesis_lower],
    }


def run_benchmark(corpus, present):
    from app.speech.stt import SpeechToText

    print()
    print(LINE)
    print("LOADING BASELINE (app/speech/stt.py -- unmodified)")
    print(LINE)

    load_started = time.time()
    stt = SpeechToText()
    load_seconds = time.time() - load_started

    print("  model load: " + format(load_seconds, ".1f") + "s "
          + "(EXCLUDED from per-utterance latency, per Step 9)")

    results = []

    for utterance in present:
        path = audio_path_for(utterance)

        duration = utterance.get("duration_seconds")

        if not duration:
            duration = probe_duration(path)

        started = time.time()

        try:
            transcription = stt.transcribe(str(path), language=utterance["language"])
            hypothesis = transcription["text"]
            failure = None
        except Exception as error:
            hypothesis = ""
            failure = type(error).__name__ + ": " + str(error)

        elapsed = time.time() - started

        wer = error_rate(utterance["reference_transcript"], hypothesis, "word")
        cer = error_rate(utterance["reference_transcript"], hypothesis, "char")

        results.append({
            "id": utterance["id"],
            "language": utterance["language"],
            "category": utterance["category"],
            "severity": utterance["severity"],
            "reference": utterance["reference_transcript"],
            "hypothesis": hypothesis,
            "failure": failure,
            "wer": wer[0] if wer else None,
            "cer": cer[0] if cer else None,
            "audio_seconds": duration,
            "transcribe_seconds": round(elapsed, 3),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "entities": evaluate_entities(utterance, hypothesis),
            "terms": evaluate_must_contain(utterance, hypothesis),
            "expected_intent": utterance["expected_intent"],
            "expected_routing": utterance["expected_routing"],
            "expected_negation": utterance["expected_negation"],
        })

        status = "FAIL" if failure else "ok"
        print("  [" + status + "] " + utterance["id"]
              + "  wer=" + (format(wer[0], ".3f") if wer else "n/a")
              + "  cer=" + (format(cer[0], ".3f") if cer else "n/a")
              + "  " + format(elapsed, ".2f") + "s")

    return results


def probe_duration(path):
    try:
        from scipy.io import wavfile

        rate, data = wavfile.read(str(path))

        return round(len(data) / float(rate), 3)
    except Exception:
        return None


# =========================================================
# DOWNSTREAM: INTENT, SEPARATED BY CAUSE
# =========================================================

def evaluate_intent(results):
    """
    Runs the EXISTING IntentDetector as an evaluation only.

    The point is the attribution, not the score. Every miss is assigned
    to ASR or to the intent model by re-running the detector on the
    REFERENCE transcript:

      hypothesis wrong + reference right -> ASR-induced downstream failure
      hypothesis wrong + reference wrong -> intent model limitation

    Combining those two would hide which component to fix.
    """

    from app.intent.detector import IntentDetector

    print()
    print(LINE)
    print("DOWNSTREAM INTENT EVALUATION (app/intent -- unmodified)")
    print(LINE)

    detector = IntentDetector()

    for row in results:
        hypothesis_intent = detector.detect_intent(row["hypothesis"] or "")
        reference_intent = detector.detect_intent(row["reference"])

        row["intent_from_hypothesis"] = hypothesis_intent
        row["intent_from_reference"] = reference_intent

        expected = row["expected_intent"]

        if expected is None:
            # IntentDetector is a total function: it returns a banking
            # label even for "do not cancel". Recorded, not scored as an
            # intent error -- the real assertion is expected_routing.
            row["intent_verdict"] = "not_an_intent_utterance"
            continue

        if hypothesis_intent["intent"] == expected:
            row["intent_verdict"] = "correct"
        elif reference_intent["intent"] == expected:
            row["intent_verdict"] = "asr_induced_failure"
        else:
            row["intent_verdict"] = "intent_model_limitation"

    return results


def evaluate_routing(results):
    """
    Runs the existing deterministic tier as an evaluation only.

    Imports the module-level pure functions from app.dialogue.manager.
    DialogueManager itself is never constructed -- that would require a
    Groq key and a knowledge-base load, neither of which this benchmark
    needs.
    """

    from app.dialogue.manager import (
        classify_turn,
        contains_negation,
        looks_like_a_question,
        looks_like_a_control_utterance,
    )

    for row in results:
        hypothesis = row["hypothesis"] or ""

        row["deterministic"] = {
            "classify_turn": str(classify_turn(hypothesis)),
            "contains_negation": contains_negation(hypothesis),
            "looks_like_a_question": looks_like_a_question(hypothesis),
            "looks_like_a_control_utterance": looks_like_a_control_utterance(hypothesis),
        }

        # The safety assertion: would this utterance have been handed to
        # IntentDetector, which cannot abstain?
        would_reach_intent = (
            classify_turn(hypothesis) is None
            and not looks_like_a_question(hypothesis)
            and not looks_like_a_control_utterance(hypothesis)
        )

        row["would_reach_intent_detector"] = would_reach_intent

        must_not_start = row["expected_routing"] in (
            "no_workflow_start", "control:pause", "control:resume",
            "control:repeat", "session_exit", "question",
        )

        row["unsafe_workflow_start"] = bool(must_not_start and would_reach_intent)

    return results


# =========================================================
# REPORTING -- per language and per category, never averaged away
# =========================================================

def summarise(results):
    print()
    print(LINE)
    print("RESULTS BY LANGUAGE")
    print(LINE)

    languages = sorted({r["language"] for r in results})

    for language in languages:
        rows = [r for r in results if r["language"] == language]
        wers = [r["wer"] for r in rows if r["wer"] is not None]
        cers = [r["cer"] for r in rows if r["cer"] is not None]

        print()
        print("  " + language + "  (" + str(len(rows)) + " utterances)")
        print("    WER median : " + fmt(statistics.median(wers) if wers else None))
        print("    CER median : " + fmt(statistics.median(cers) if cers else None)
              + "   <- primary metric for agglutinative languages")
        print("    failures   : " + str(sum(1 for r in rows if r["failure"])))

    print()
    print(LINE)
    print("RESULTS BY LANGUAGE AND CATEGORY")
    print(LINE)

    for language in languages:
        print()
        print("  " + language)

        rows = [r for r in results if r["language"] == language]
        categories = sorted({r["category"] for r in rows})

        for category in categories:
            subset = [r for r in rows if r["category"] == category]
            cers = [r["cer"] for r in subset if r["cer"] is not None]
            wers = [r["wer"] for r in subset if r["wer"] is not None]

            print("    " + category.ljust(16)
                  + "n=" + str(len(subset)).ljust(4)
                  + "WER " + fmt(statistics.median(wers) if wers else None).ljust(9)
                  + "CER " + fmt(statistics.median(cers) if cers else None))

    entity_report(results)
    negation_report(results)
    intent_report(results)
    code_mixed_report(results)
    latency_report(results)


def fmt(value):
    return "n/a" if value is None else format(value, ".3f")


def entity_report(results):
    print()
    print(LINE)
    print("BANKING ENTITY PRESERVATION (severity 1)")
    print(LINE)

    kinds = {}
    deferred = []

    for row in results:
        for key, detail in (row.get("entities") or {}).items():
            if detail["preserved"] is None:
                deferred.append(row["id"] + " " + key + " -> " + detail["kind"])
                continue

            bucket = kinds.setdefault(key, {"ok": 0, "total": 0, "misses": []})
            bucket["total"] += 1

            if detail["preserved"]:
                bucket["ok"] += 1
            else:
                bucket["misses"].append(
                    row["id"] + " expected=" + str(detail["expected"])
                    + " got=" + str(detail.get("parsed", "not found"))
                    + (" [" + detail["note"] + "]" if detail.get("note") else "")
                )

    if not kinds and not deferred:
        print("  no entity-bearing utterances in this run")
        return

    for key in sorted(kinds):
        bucket = kinds[key]
        print()
        print("  " + key + " : " + str(bucket["ok"]) + "/" + str(bucket["total"]) + " preserved")

        for miss in bucket["misses"]:
            print("      MISS  " + miss)

    if deferred:
        print()
        print("  NOT APPLICABLE at the ASR stage (" + str(len(deferred)) + "):")

        for entry in deferred:
            print("      " + entry)


def negation_report(results):
    print()
    print(LINE)
    print("NEGATION PRESERVATION (safety-critical, reported separately)")
    print(LINE)

    rows = [r for r in results if r["expected_negation"]]

    if not rows:
        print("  no negation utterances in this run")
        return

    kept = [r for r in rows if r["deterministic"]["contains_negation"]]
    lost = [r for r in rows if not r["deterministic"]["contains_negation"]]

    print("  negation detected on transcript : " + str(len(kept)) + "/" + str(len(rows)))
    print()
    print("  NOTE: contains_negation() reads English ASCII tokens only")
    print("  (manager.py:281). A Kannada or Hindi transcript scoring")
    print("  False here is EXPECTED today and is the gap Phase 3.2B-8")
    print("  must close -- it is not an ASR failure.")

    for row in lost:
        print("      NOT DETECTED  " + row["id"] + "  " + repr(row["hypothesis"][:60]))


def intent_report(results):
    print()
    print(LINE)
    print("INTENT: ASR-INDUCED vs INTENT-MODEL FAILURE")
    print(LINE)

    verdicts = {}

    for row in results:
        verdicts.setdefault(row["intent_verdict"], []).append(row)

    for verdict in sorted(verdicts):
        rows = verdicts[verdict]
        print()
        print("  " + verdict + " : " + str(len(rows)))

        if verdict in ("asr_induced_failure", "intent_model_limitation"):
            for row in rows:
                print("      " + row["id"]
                      + " expected=" + str(row["expected_intent"])
                      + " got=" + row["intent_from_hypothesis"]["intent"]
                      + " (" + str(row["intent_from_hypothesis"]["confidence"]) + ")")

    unsafe = [r for r in results if r["unsafe_workflow_start"]]

    print()
    print("  UNSAFE WORKFLOW STARTS : " + str(len(unsafe)))
    print("  (utterance must not start a workflow, yet nothing would")
    print("   stop it reaching IntentDetector, which cannot abstain)")

    for row in unsafe:
        print("      " + row["id"] + " [" + row["expected_routing"] + "] -> "
              + row["intent_from_hypothesis"]["intent"]
              + " (" + str(row["intent_from_hypothesis"]["confidence"]) + ")")


def code_mixed_report(results):
    print()
    print(LINE)
    print("CODE-MIXED SPEECH")
    print(LINE)

    rows = [r for r in results if r["category"] == "code_mixed"]

    if not rows:
        print("  no code-mixed utterances in this run")
        return

    for row in rows:
        required = row["terms"]["required"]
        kept = sum(1 for ok in required.values() if ok)

        print("  " + row["id"] + "  terms kept " + str(kept) + "/" + str(len(required))
              + "  CER " + fmt(row["cer"]))

        for term, ok in required.items():
            if not ok:
                print("      LOST  " + repr(term))


def latency_report(results):
    print()
    print(LINE)
    print("ASR LATENCY (model load excluded)")
    print(LINE)

    for language in sorted({r["language"] for r in results}):
        rows = [r for r in results if r["language"] == language]
        times = [r["transcribe_seconds"] for r in rows if r["transcribe_seconds"]]
        rtfs = [r["rtf"] for r in rows if r["rtf"]]

        if not times:
            continue

        print()
        print("  " + language)
        print("    transcribe seconds  min/median/max : "
              + fmt(min(times)) + " / " + fmt(statistics.median(times)) + " / " + fmt(max(times)))

        if rtfs:
            print("    real-time factor    min/median/max : "
                  + fmt(min(rtfs)) + " / " + fmt(statistics.median(rtfs)) + " / " + fmt(max(rtfs)))
        else:
            print("    real-time factor    : n/a (no audio durations)")

    print()
    print("  Measured on this machine only. No claim is made about")
    print("  whether these values are acceptable for production.")


# =========================================================

def selfcheck():
    """
    Exercises the scoring path on KNOWN TEXT PAIRS, with no audio.

    This proves the metrics work before any recording exists, so the
    first real corpus run measures the ASR rather than debugging the
    evaluator. It fabricates no speech and produces no ASR result: every
    input here is a hand-written string, not a transcription.
    """

    print()
    print(LINE)
    print("EVALUATOR SELF-CHECK (text only -- no audio, no ASR)")
    print(LINE)
    print()

    passed = 0
    failed = 0

    def check(label, actual, expected):
        nonlocal passed, failed

        if actual == expected:
            passed += 1
            print("  PASS  " + label)
        else:
            failed += 1
            print("  FAIL  " + label + "  expected=" + repr(expected) + " got=" + repr(actual))

    # --- error rates -------------------------------------------------
    check("identical text -> WER 0", error_rate("ನನಗೆ ಹಣ ಬೇಕು", "ನನಗೆ ಹಣ ಬೇಕು", "word")[0], 0.0)
    check("one word wrong of three -> WER 1/3",
          round(error_rate("मुझे पैसे चाहिए", "मुझे पैसे नहीं", "word")[0], 3), 0.333)
    check("punctuation is not scored",
          error_rate("exit", "Exit.", "word")[0], 0.0)
    check("CER available for agglutinative text",
          error_rate("ಮುಂದುವರಿಸಿ", "ಮುಂದುವರಿಸು", "char")[0] > 0, True)
    check("empty hypothesis -> WER 1.0",
          error_rate("मुझे लोन चाहिए", "", "word")[0], 1.0)

    # --- numeral folding ---------------------------------------------
    check("Devanagari digits fold to ASCII", fold_digits("१२३४५६७८९०"), "1234567890")
    check("Kannada digits fold to ASCII", fold_digits("೧೨೩೪೫೬೭೮೯೦"), "1234567890")

    # --- amount parsing, semantic not string -------------------------
    check("bare digits", parse_amount("20000 rupees"), 20000)
    check("Western grouping", parse_amount("20,000 rupees"), 20000)
    check("Indian grouping", parse_amount("2,00,000 rupees"), 200000)
    check("English lakh", parse_amount("2 lakh rupees"), 200000)
    check("English crore", parse_amount("2 crore rupees"), 20000000)
    check("English words", parse_amount("five thousand rupees"), 5000)
    check("Kannada ಐದು ಸಾವಿರ", parse_amount("ಐದು ಸಾವಿರ ರೂಪಾಯಿ"), 5000)
    check("Kannada ಎರಡು ಲಕ್ಷ", parse_amount("ಎರಡು ಲಕ್ಷ ರೂಪಾಯಿ"), 200000)
    check("Kannada ಎರಡು ಕೋಟಿ", parse_amount("ಎರಡು ಕೋಟಿ ರೂಪಾಯಿ"), 20000000)
    check("Hindi पाँच हज़ार", parse_amount("पाँच हज़ार रुपये"), 5000)
    check("Hindi दो लाख", parse_amount("दो लाख रुपये"), 200000)
    check("Hindi दो करोड़", parse_amount("दो करोड़ रुपये"), 20000000)
    check("Hindi बीस हज़ार", parse_amount("बीस हज़ार रुपये"), 20000)
    check("no amount present -> None", parse_amount("ನನಗೆ ಸಾಲ ಬೇಕು"), None)
    check("10-digit identifier is not read as an amount",
          parse_amount("account number 1234567890"), None)

    # --- entity checks -----------------------------------------------
    account = {
        "id": "x", "expected_entities": {"account_number": "1234567890"},
    }
    check("account number preserved",
          evaluate_entities(account, "my account number is 1234567890")["account_number"]["preserved"],
          True)
    check("account number in Devanagari digits still preserved",
          evaluate_entities(account, "मेरा खाता नंबर १२३४५६७८९० है")["account_number"]["preserved"],
          True)
    check("altered account number caught",
          evaluate_entities(account, "my account number is 1234567899")["account_number"]["preserved"],
          False)
    check("spoken digit words flagged, not silently failed",
          evaluate_entities(account, "ಒಂದು ಎರಡು ಮೂರು").get("account_number", {}).get("note"),
          "spoken_digit_words")

    # --- name traps ---------------------------------------------------
    name_row = {"expected_transcript_must_contain": [], "must_not_contain": ["lotus"]}
    check("name translated to its literal meaning is caught",
          evaluate_must_contain(name_row, "my name is lotus")["forbidden_present"],
          ["lotus"])
    check("transliterated name passes",
          evaluate_must_contain(name_row, "my name is Kamala")["forbidden_present"],
          [])

    # --- code-mixed term survival -------------------------------------
    mixed = {"expected_transcript_must_contain": ["account number"], "must_not_contain": []}
    check("code-mixed term kept",
          evaluate_must_contain(mixed, "ನನಗೆ account number fill ಮಾಡಬೇಕು")["required"]["account number"],
          True)
    check("code-mixed term lost is caught",
          evaluate_must_contain(mixed, "ನನಗೆ ಖಾತೆ ಸಂಖ್ಯೆ ಭರ್ತಿ ಮಾಡಬೇಕು")["required"]["account number"],
          False)

    print()
    print("  passed: " + str(passed) + "   failed: " + str(failed))
    print()
    print("  This validates the EVALUATOR only. No ASR result exists and")
    print("  no accuracy figure is implied by these numbers.")
    print()

    return 0 if failed == 0 else 1


def main():
    if "--selfcheck" in sys.argv:
        return selfcheck()

    corpus = load_corpus()
    present = readiness_report(corpus)

    if not present:
        print()
        print(LINE)
        print("STATUS: WAITING_FOR_REAL_AUDIO")
        print(LINE)
        print()
        print("  0 recordings present, so NOTHING was benchmarked.")
        print()
        print("  NOT MEASURED : WER, CER, entity accuracy, amount accuracy,")
        print("                 negation preservation, intent preservation,")
        print("                 code-mixed behaviour, ASR latency.")
        print()
        print("  No value above is estimated, simulated or inferred. Add")
        print("  recordings per recording_guide.md and re-run; no code")
        print("  change is required.")
        print()
        return 0

    results = run_benchmark(corpus, present)
    results = evaluate_intent(results)
    results = evaluate_routing(results)

    summarise(results)

    with open(RESULTS_FILE, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "phase": "3.2B-7",
                "recordings_benchmarked": len(results),
                "corpus_size": len(corpus["utterances"]),
                "results": results,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )

    print()
    print("  raw results written to " + str(RESULTS_FILE))
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
