"""Evaluates ONE existing ASR model on the native-speaker Tulu recordings.

LOW-MEMORY PROTOCOL: one model per process, one process at a time.

    python -m app.tulu.evaluation.asr_eval indicconformer-kn
    python -m app.tulu.evaluation.asr_eval whisper-small-kn     # temperature 0, no fallback retries

No Kannada model is assumed to recognise Tulu. Each model's raw output is
transliterated to Roman letters and scored against the verified Romanized
transcript (character error rate on phonetic matching keys); then the
closed-set matcher is applied exactly as in production. The matcher only
supports the verified phrase set (19 customer utterances, deposit +
withdrawal).

Per customer recording:
  correct phrase    accepted and matched the recording's own utterance
  correct meaning   accepted and produced the right pivot (same step meaning)
  false acceptance  accepted with a WRONG meaning or wrong intent
  rejection         not accepted (refused or ambiguous) -> customer types

Leave-one-out (LOO): the recording's own sentence is removed from the bank;
a "correct meaning" then means another verified sentence with the same
meaning was matched -- a rough proxy for unseen phrasings.

Recordings are read in place, read-only. Results are written to
evaluation/reports/tulu_asr_<model>.json and .md.
"""

from __future__ import annotations

import ctypes
import json
import os
import sys
import time
import warnings
from pathlib import Path

from app.tulu.data.dataset import GROUPS, audio_path, audio_utterances, customer_utterances
from app.tulu.intent.matcher import AMBIGUITY_MARGIN, MATCH_THRESHOLD, understand
from app.tulu.normalization.text import matching_key, to_roman

warnings.filterwarnings("ignore")

ENGINE_ROOT = Path(__file__).resolve().parents[3]
REPORTS = ENGINE_ROOT / "evaluation" / "reports"
AUDIO_DIR = ENGINE_ROOT.parent / "deposit conversation"   # kept for older importers

MODELS = ("indicconformer-kn", "whisper-small-kn")


# ---------------------------------------------------------------- memory
class _PMC(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


def memory_mb() -> dict:
    """Current and peak working set of this process (Windows), in MB."""
    if os.name != "nt":
        import resource
        return {"peak_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}
    counters = _PMC()
    counters.cb = ctypes.sizeof(_PMC)
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    get_info = ctypes.windll.psapi.GetProcessMemoryInfo
    get_info.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PMC), ctypes.c_ulong]
    get_info(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
    return {"current_mb": round(counters.WorkingSetSize / 2**20, 1),
            "peak_mb": round(counters.PeakWorkingSetSize / 2**20, 1)}


def available_memory_mb() -> float:
    class MEMSTAT(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
    stat = MEMSTAT()
    stat.dwLength = ctypes.sizeof(MEMSTAT)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
    return round(stat.ullAvailPhys / 2**20, 1)


#: Stop cleanly (not crash) if free RAM falls below this.
MIN_FREE_MB = 300


# ---------------------------------------------------------------- scoring
def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(hyp: str, ref: str) -> float:
    h = matching_key(to_roman(hyp)).replace(" ", "")
    r = matching_key(ref).replace(" ", "")
    return levenshtein(h, r) / max(1, len(r))


def build_model(name: str):
    """A function path -> raw text, for ONE model."""
    if name == "indicconformer-kn":
        from app.speech.asr.indic_conformer_provider import IndicConformerRecognizer

        model = IndicConformerRecognizer()
        return lambda path: model.transcribe(path, language="kn").text
    if name == "whisper-small-kn":
        import whisper

        model = whisper.load_model("small")
        # temperature=0.0 alone disables Whisper's temperature-fallback retries.
        return lambda path: model.transcribe(path, language="kn", fp16=False, temperature=0.0,
                                             condition_on_previous_text=False)["text"].strip()
    raise ValueError(f"model must be one of {MODELS}")


def _outcome(result, utt) -> str:
    if not result.accepted:
        return "rejected"
    if result.matched_id == utt["id"]:
        return "correct_phrase"
    if result.pivot_en == GROUPS[utt["group"]]["pivot_en"]:
        return "correct_meaning"
    return "false_acceptance"


def evaluate(name: str) -> dict:
    mem_start = memory_mb()
    started = time.perf_counter()
    run = build_model(name)
    customers = customer_utterances()
    rows, stopped = [], None
    for utt in audio_utterances():   # text-only rows have no recording
        if available_memory_mb() < MIN_FREE_MB:
            stopped = f"stopped cleanly: free RAM {available_memory_mb()} MB < {MIN_FREE_MB} MB"
            print(stopped, flush=True)
            break
        t0 = time.perf_counter()
        try:
            text, error = run(str(audio_path(utt))), None
        except Exception as exc:                      # recorded, never hidden
            text, error = "", type(exc).__name__
        latency = time.perf_counter() - t0
        row = {"id": utt["id"], "dataset": utt["dataset"], "role": utt["speaker_role"], "group": utt["group"],
               "reference": utt["tulu_romanized"], "hypothesis": text, "hypothesis_roman": to_roman(text),
               "empty": not text.strip(), "cer": round(cer(text, utt["tulu_romanized"]), 3),
               "latency_s": round(latency, 2), "error": error}
        if utt["speaker_role"] == "customer":
            full = understand(text) if text.strip() else None
            loo = understand(text, bank=[c for c in customers if c["id"] != utt["id"]]) if text.strip() else None
            row.update({
                "outcome": _outcome(full, utt) if full else "rejected",
                "matched": full.matched_id if full else None, "method": full.method if full else "empty",
                "score": full.score if full else 0.0,
                "top_candidate": full.candidates[0] if full and full.candidates else None,
                "loo_outcome": _outcome(loo, utt) if loo else "rejected",
                "loo_matched": loo.matched_id if loo else None,
            })
        rows.append(row)
        print(f"[{name}] {utt['id']}: {row.get('outcome', '-')} cer={row['cer']} {latency:.1f}s hyp={text!r}",
              flush=True)

    cust = [r for r in rows if r["role"] == "customer"]

    def count(key, value, subset=None):
        subset = cust if subset is None else subset
        return sum(r[key] == value for r in subset)

    by_dataset = {}
    for ds in ("deposit", "withdrawal", "control"):
        sub = [r for r in cust if r["dataset"] == ds]
        by_dataset[ds] = {k: f"{count('outcome', k, sub)}/{len(sub)}"
                          for k in ("correct_phrase", "correct_meaning", "false_acceptance", "rejected")}
    summary = {
        "model": name,
        "recordings_evaluated": len(rows),
        "customer_recordings": len(cust),
        "empty_outputs": sum(r["empty"] for r in rows),
        "errors": sum(r["error"] is not None for r in rows),
        "mean_cer_all": round(sum(r["cer"] for r in rows) / max(1, len(rows)), 3),
        "mean_cer_customer": round(sum(r["cer"] for r in cust) / max(1, len(cust)), 3),
        "correct_phrase": f"{count('outcome', 'correct_phrase')}/{len(cust)}",
        "correct_meaning_other_phrase": f"{count('outcome', 'correct_meaning')}/{len(cust)}",
        "false_acceptance": f"{count('outcome', 'false_acceptance')}/{len(cust)}",
        "rejected": f"{count('outcome', 'rejected')}/{len(cust)}",
        "loo_correct_meaning": f"{count('loo_outcome', 'correct_meaning')}/{len(cust)}",
        "loo_false_acceptance": f"{count('loo_outcome', 'false_acceptance')}/{len(cust)}",
        "loo_rejected": f"{count('loo_outcome', 'rejected')}/{len(cust)}",
        "by_dataset": by_dataset,
        "mean_latency_s": round(sum(r["latency_s"] for r in rows) / max(1, len(rows)), 2),
        "max_latency_s": max((r["latency_s"] for r in rows), default=0),
        "total_wall_s": round(time.perf_counter() - started, 1),
        "memory_at_start": mem_start,
        "memory_at_end": memory_mb(),
        "stopped": stopped,
    }
    return {"protocol": __doc__.split("Recordings are")[0].strip(), "match_threshold": MATCH_THRESHOLD,
            "ambiguity_margin": AMBIGUITY_MARGIN, "summary": summary, "rows": rows}


def write_report(result: dict) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    name = result["summary"]["model"]
    (REPORTS / f"tulu_asr_{name}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    s = result["summary"]
    lines = [f"# Tulu ASR evaluation: {name}", "",
             f"Matcher threshold {result['match_threshold']}, ambiguity margin {result['ambiguity_margin']} "
             "(fixed before evaluation). Closed set: verified phrases only.", ""]
    lines += [f"- {k}: {v}" for k, v in s.items() if k != "by_dataset"]
    lines += ["", "| Dataset | correct phrase | correct meaning (other phrase) | false acceptance | rejected |",
              "|---|---|---|---|---|"]
    for ds, d in s["by_dataset"].items():
        lines.append(f"| {ds} | {d['correct_phrase']} | {d['correct_meaning']} | {d['false_acceptance']} | {d['rejected']} |")
    lines += ["", "| ID | Reference | Hypothesis (raw) | CER | Outcome | Matched (score) | LOO | Latency |",
              "|---|---|---|---|---|---|---|---|"]
    for r in result["rows"]:
        hyp = (r["hypothesis"] or "∅").replace("|", "/")
        lines.append(f"| {r['id']} | {r['reference']} | {hyp} | {r['cer']} | {r.get('outcome', 'assistant (CER only)')} | "
                     f"{r.get('matched') or '-'} ({r.get('score', '-')}) | {r.get('loo_outcome', '-')} | {r['latency_s']} s |")
    (REPORTS / f"tulu_asr_{name}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2 or sys.argv[1] not in MODELS:
        sys.exit(f"usage: python -m app.tulu.evaluation.asr_eval {{{'|'.join(MODELS)}}}")
    print(f"free RAM before: {available_memory_mb()} MB", flush=True)
    result = evaluate(sys.argv[1])
    write_report(result)
    print(json.dumps(result["summary"], indent=2), flush=True)
