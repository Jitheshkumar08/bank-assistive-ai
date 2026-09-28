"""Smoke test: per-language AI4Bharat IndicConformer ONNX exports via onnx-asr.

Disposable experiment, runs in venv-onnx (onnx-asr + onnxruntime + numpy).
Nothing is installed into the project venv by this script and no production file
is touched. Models are MIT-licensed, ungated ONNX conversions of the official
ai4bharat/indicconformer_stt_<lang>_hybrid_ctc_rnnt_large checkpoints.

    venv-onnx/Scripts/python.exe smoke_onnx_asr.py [int8|fp32]
"""
import json
import sys
import time
import unicodedata
from pathlib import Path

import onnx_asr

HERE = Path(__file__).resolve().parent
SPIKE = HERE.parent
MANIFEST = SPIKE / "indicvoices_banking_manifest.json"
CORPUS = SPIKE / "corpus" / "indicvoices_banking"
N_PER_LANG = 5
SCRIPT_RANGES = {"kn": (0x0C80, 0x0CFF), "hi": (0x0900, 0x097F)}
REPOS = {
    "kn": "OpenVoiceOS/ai4bharat-indicconformer-kn-onnx",
    "hi": "OpenVoiceOS/ai4bharat-indicconformer-hi-onnx",
}

sys.path.insert(0, str(SPIKE))
from benchmark_asr import levenshtein, normalise_for_scoring  # noqa: E402


def script_share(text, lang):
    lo, hi = SCRIPT_RANGES[lang]
    letters = [c for c in (text or "") if unicodedata.category(c).startswith(("L", "M"))]
    return round(sum(lo <= ord(c) <= hi for c in letters) / len(letters), 3) if letters else 0.0


def main():
    quant = sys.argv[1] if len(sys.argv) > 1 else "int8"
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    out = {"candidate": "indicconformer_per_language_onnx", "repos": REPOS, "quantization": quant,
           "library": "onnx-asr", "clips": []}

    for lang in ("kn", "hi"):
        t0 = time.perf_counter()
        model = onnx_asr.load_model(REPOS[lang], quantization=quant)
        load_s = time.perf_counter() - t0
        out[f"load_seconds_{lang}"] = round(load_s, 2)
        print(f"[{lang}] loaded {REPOS[lang]} ({quant}) in {load_s:.2f}s")

        clips = [u for u in manifest["utterances"] if u["language"] == lang][:N_PER_LANG]
        model.recognize(str(CORPUS / lang / f"{clips[0]['id']}.wav"))  # warm-up, discarded

        for u in clips:
            path = CORPUS / lang / f"{u['id']}.wav"
            t0 = time.perf_counter()
            hyp = model.recognize(str(path))
            lat = time.perf_counter() - t0
            ref = u["reference_transcript"]
            rn, hn = normalise_for_scoring(ref), normalise_for_scoring(hyp or "")
            rw, hw = rn.split(), hn.split()
            rc, hc = rn.replace(" ", ""), hn.replace(" ", "")
            row = {
                "id": u["id"], "language": lang, "audio_seconds": u["duration_seconds"],
                "latency_seconds": round(lat, 3), "rtf": round(lat / u["duration_seconds"], 3),
                "wer": round(levenshtein(rw, hw) / len(rw), 4) if rw else None,
                "cer": round(levenshtein(list(rc), list(hc)) / len(rc), 4) if rc else None,
                "expected_script_share": script_share(hyp, lang),
                "empty": not hn, "hypothesis": hyp, "reference": ref,
            }
            out["clips"].append(row)
            print(f"  {u['id']} {row['latency_seconds']}s rtf={row['rtf']} wer={row['wer']} "
                  f"cer={row['cer']} script={row['expected_script_share']}")
            print(f"     HYP: {(hyp or '')[:100]}")
            print(f"     REF: {ref[:100]}")

    for lang in ("kn", "hi"):
        rows = [r for r in out["clips"] if r["language"] == lang and r["wer"] is not None]
        if rows:
            out[f"summary_{lang}"] = {
                "clips": len(rows),
                "wer_mean": round(sum(r["wer"] for r in rows) / len(rows), 4),
                "cer_mean": round(sum(r["cer"] for r in rows) / len(rows), 4),
                "rtf_mean": round(sum(r["rtf"] for r in rows) / len(rows), 3),
                "expected_script_share_mean": round(
                    sum(r["expected_script_share"] for r in rows) / len(rows), 3),
                "empty": sum(r["empty"] for r in rows),
            }
            print(lang, json.dumps(out[f"summary_{lang}"], ensure_ascii=False))
    p = HERE / f"smoke_indicconformer_per_language_{quant}.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", p)


if __name__ == "__main__":
    main()
