"""Phase 3.2B-11 step 1: candidate ASR smoke test (5 Kannada + 5 Hindi clips).

Disposable experiment. Reads the frozen banking manifest READ-ONLY for reference
transcripts and uses the WAVs already extracted under
debugging/spike/corpus/indicvoices_banking/. Writes only into this directory.

This is NOT a benchmark: 10 clips cannot rank models. It answers one question per
candidate -- can we load it, run it on CPU, and get sane text in the right script
at a workable speed, today?

Run from language_engine/ (project venv is used read-only; nothing is installed):

    python -m debugging.spike.asr_candidates.smoke_test sravaani
    python -m debugging.spike.asr_candidates.smoke_test indicconformer
    python -m debugging.spike.asr_candidates.smoke_test whisper_kn
    python -m debugging.spike.asr_candidates.smoke_test whisper_small_baseline
"""
import json
import os
import platform
import sys
import time
import traceback
import unicodedata
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

SPIKE = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent
MANIFEST = SPIKE / "indicvoices_banking_manifest.json"
CORPUS = SPIKE / "corpus" / "indicvoices_banking"
N_PER_LANG = 5

sys.path.insert(0, str(SPIKE.parents[1]))
from debugging.spike.benchmark_asr import levenshtein, normalise_for_scoring  # noqa: E402

SCRIPT_RANGES = {"kn": (0x0C80, 0x0CFF), "hi": (0x0900, 0x097F)}


def expected_script_share(text, lang):
    lo, hi = SCRIPT_RANGES[lang]
    letters = [c for c in text if unicodedata.category(c).startswith(("L", "M"))]
    if not letters:
        return 0.0
    return round(sum(lo <= ord(c) <= hi for c in letters) / len(letters), 3)


def score(ref, hyp, lang):
    rn, hn = normalise_for_scoring(ref), normalise_for_scoring(hyp or "")
    rw, hw = rn.split(), hn.split()
    rc, hc = rn.replace(" ", ""), hn.replace(" ", "")
    return {
        "wer": round(levenshtein(rw, hw) / len(rw), 4) if rw else None,
        "cer": round(levenshtein(list(rc), list(hc)) / len(rc), 4) if rc else None,
        "expected_script_share": expected_script_share(hyp or "", lang),
        "empty": not hn,
    }


def pick_clips():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    out = []
    for lang in ("kn", "hi"):
        rows = [u for u in manifest["utterances"] if u["language"] == lang][:N_PER_LANG]
        for u in rows:
            out.append({
                "id": u["id"], "language": lang,
                "path": CORPUS / lang / f"{u['id']}.wav",
                "reference": u["reference_transcript"],
                "audio_seconds": u["duration_seconds"],
            })
    missing = [c["id"] for c in out if not c["path"].exists()]
    if missing:
        sys.exit(f"missing WAVs: {missing}")
    return out


def rss_mb():
    try:
        import ctypes
        import ctypes.wintypes as wt

        class PMC(ctypes.Structure):
            _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t)]
        c = PMC()
        c.cb = ctypes.sizeof(c)
        ctypes.windll.psapi.GetProcessMemoryInfo(
            ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb)
        return round(c.WorkingSetSize / 1e6)
    except Exception:
        return None


def load_audio(path):
    import torchaudio
    wav, sr = torchaudio.load(str(path))
    if wav.shape[0] > 1:
        wav = wav.mean(0, keepdim=True)
    return wav, sr


# --------------------------------------------------------------------- candidates

def run_sravaani(clips):
    from transformers import AutoModel
    t0 = time.perf_counter()
    model = AutoModel.from_pretrained("ARTPARK-IISc/SraVaani-1.0", trust_remote_code=True)
    load_s = time.perf_counter() - t0
    meta = {"transcribe_signature": None}
    try:
        import inspect
        meta["transcribe_signature"] = str(inspect.signature(model.transcribe))
    except Exception:
        pass

    def one(clip):
        out = model.transcribe(str(clip["path"]))
        if isinstance(out, (list, tuple)):
            out = out[0]
        return out if isinstance(out, str) else getattr(out, "text", str(out))
    return model, load_s, one, meta


def run_indicconformer(clips):
    from transformers import AutoModel
    t0 = time.perf_counter()
    model = AutoModel.from_pretrained("ai4bharat/indic-conformer-600m-multilingual",
                                      trust_remote_code=True)
    load_s = time.perf_counter() - t0

    def one(clip):
        wav, sr = load_audio(clip["path"])
        return model(wav, clip["language"], "ctc")
    return model, load_s, one, {"decoding": "ctc"}


def run_whisper_kn(clips):
    from transformers import pipeline
    t0 = time.perf_counter()
    pipe = pipeline("automatic-speech-recognition", model="vasista22/whisper-kannada-medium",
                    device="cpu")
    load_s = time.perf_counter() - t0

    def one(clip):
        return pipe(str(clip["path"]))["text"]
    return pipe, load_s, one, {"note": "Kannada-only model; Hindi clips are out of scope for it"}


def run_whisper_small_baseline(clips):
    from app.speech.stt import SpeechToText
    t0 = time.perf_counter()
    stt = SpeechToText()
    load_s = time.perf_counter() - t0

    def one(clip):
        return stt.transcribe(str(clip["path"]), language=clip["language"])["text"]
    return stt, load_s, one, {"note": "existing production baseline, for reference"}


CANDIDATES = {
    "sravaani": ("ARTPARK-IISc/SraVaani-1.0", run_sravaani),
    "indicconformer": ("ai4bharat/indic-conformer-600m-multilingual", run_indicconformer),
    "whisper_kn": ("vasista22/whisper-kannada-medium", run_whisper_kn),
    "whisper_small_baseline": ("openai/whisper-small via app.speech.stt", run_whisper_small_baseline),
}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in CANDIDATES:
        sys.exit(f"usage: smoke_test.py [{'|'.join(CANDIDATES)}]")
    name = sys.argv[1]
    repo, runner = CANDIDATES[name]
    clips = pick_clips()
    result = {
        "candidate": name, "repository": repo,
        "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "host": {"cpu": platform.processor(), "python": platform.python_version(),
                 "platform": platform.platform()},
        "rss_before_mb": rss_mb(),
        "clips": [], "status": "unknown",
    }
    try:
        _model, load_s, one, meta = runner(clips)
        result["model_load_seconds"] = round(load_s, 2)
        result["meta"] = meta
        result["rss_after_load_mb"] = rss_mb()
        # warm-up on the first clip, discarded
        t0 = time.perf_counter()
        try:
            one(clips[0])
        except Exception as e:
            result["warmup_error"] = repr(e)[:300]
        result["warmup_seconds_discarded"] = round(time.perf_counter() - t0, 2)

        for c in clips:
            row = {"id": c["id"], "language": c["language"], "audio_seconds": c["audio_seconds"]}
            t0 = time.perf_counter()
            try:
                hyp = one(c)
                row["latency_seconds"] = round(time.perf_counter() - t0, 3)
                row["rtf"] = round(row["latency_seconds"] / c["audio_seconds"], 2)
                row["hypothesis"] = hyp
                row.update(score(c["reference"], hyp, c["language"]))
                row["reference"] = c["reference"]
            except Exception as e:
                row["latency_seconds"] = round(time.perf_counter() - t0, 3)
                row["error"] = f"{type(e).__name__}: {e}"[:400]
            result["clips"].append(row)
            print(f"  [{row['language']}] {row['id']} "
                  f"{row.get('latency_seconds')}s rtf={row.get('rtf')} "
                  f"wer={row.get('wer')} script={row.get('expected_script_share')}"
                  + (f" ERROR {row['error']}" if "error" in row else ""), flush=True)

        ok = [r for r in result["clips"] if "error" not in r and r.get("wer") is not None]
        for lang in ("kn", "hi"):
            rows = [r for r in ok if r["language"] == lang]
            if rows:
                result[f"summary_{lang}"] = {
                    "clips": len(rows),
                    "wer_mean": round(sum(r["wer"] for r in rows) / len(rows), 4),
                    "cer_mean": round(sum(r["cer"] for r in rows) / len(rows), 4),
                    "rtf_mean": round(sum(r["rtf"] for r in rows) / len(rows), 2),
                    "expected_script_share_mean": round(
                        sum(r["expected_script_share"] for r in rows) / len(rows), 3),
                    "empty": sum(r["empty"] for r in rows),
                }
        result["rss_peak_mb"] = rss_mb()
        result["status"] = "ok" if ok else "failed_all_clips"
    except Exception as e:
        result["status"] = "load_or_setup_failed"
        result["error"] = f"{type(e).__name__}: {e}"[:600]
        result["traceback_tail"] = traceback.format_exc()[-900:]
        print("FAILED:", result["error"], flush=True)

    out = HERE / f"smoke_{name}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", out)
    for lang in ("kn", "hi"):
        if f"summary_{lang}" in result:
            print(lang, json.dumps(result[f"summary_{lang}"], ensure_ascii=False))


if __name__ == "__main__":
    main()
