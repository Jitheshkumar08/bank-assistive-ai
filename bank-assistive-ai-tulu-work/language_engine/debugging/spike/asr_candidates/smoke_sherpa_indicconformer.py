"""Smoke test: AI4Bharat IndicConformer exported to ONNX, run via sherpa-onnx on CPU.

Disposable experiment, runs in venv-onnx (sherpa-onnx + numpy only). Nothing is
installed into the project venv by this script and no production file is touched.

Model: meetsync/indic-conformer-onnx-sherpa (MIT), an ONNX export of
ai4bharat/indicconformer_stt_hi_hybrid_ctc_rnnt_large whose tokens.txt is
multilingual. Whether it actually transcribes Kannada is exactly what this tests.

    venv-onnx/Scripts/python.exe smoke_sherpa_indicconformer.py [int8|fp32]
"""
import json
import sys
import time
import unicodedata
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx
from huggingface_hub import hf_hub_download

HERE = Path(__file__).resolve().parent
SPIKE = HERE.parent
MANIFEST = SPIKE / "indicvoices_banking_manifest.json"
CORPUS = SPIKE / "corpus" / "indicvoices_banking"
REPO = "meetsync/indic-conformer-onnx-sherpa"
N_PER_LANG = 5
SCRIPT_RANGES = {"kn": (0x0C80, 0x0CFF), "hi": (0x0900, 0x097F)}

sys.path.insert(0, str(SPIKE))
try:
    from benchmark_asr import levenshtein, normalise_for_scoring
    SCORER = "frozen benchmark_asr.normalise_for_scoring (comparable with the baseline)"
except Exception:  # pragma: no cover - fallback keeps the smoke test runnable
    SCORER = "inline fallback normaliser (NOT identical to the frozen evaluator)"

    def normalise_for_scoring(t):
        t = unicodedata.normalize("NFC", t or "")
        return " ".join("".join(c if (c.isalnum() or c.isspace() or
                                      unicodedata.category(c).startswith("M")) else " "
                                for c in t).lower().split())

    def levenshtein(a, b):
        prev = list(range(len(b) + 1))
        for i, x in enumerate(a, 1):
            cur = [i]
            for j, y in enumerate(b, 1):
                cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
            prev = cur
        return prev[-1]


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return (pcm.astype(np.float32) / 32768.0), 16000


def script_share(text, lang):
    lo, hi = SCRIPT_RANGES[lang]
    letters = [c for c in (text or "") if unicodedata.category(c).startswith(("L", "M"))]
    if not letters:
        return 0.0
    return round(sum(lo <= ord(c) <= hi for c in letters) / len(letters), 3)


def main():
    variant = sys.argv[1] if len(sys.argv) > 1 else "int8"
    fname = "model.int8.onnx" if variant == "int8" else "model.onnx"
    model = hf_hub_download(REPO, fname)
    tokens = hf_hub_download(REPO, "tokens.txt")
    print(f"model: {fname} ({Path(model).stat().st_size/1e6:.0f} MB)")

    t0 = time.perf_counter()
    rec = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
        model=model, tokens=tokens, num_threads=6, decoding_method="greedy_search")
    load_s = time.perf_counter() - t0
    print(f"loaded in {load_s:.2f}s")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    clips = []
    for lang in ("kn", "hi"):
        for u in [x for x in manifest["utterances"] if x["language"] == lang][:N_PER_LANG]:
            clips.append((lang, u))

    out = {"candidate": "indicconformer_onnx_sherpa", "repository": REPO, "variant": variant,
           "model_file_mb": round(Path(model).stat().st_size / 1e6),
           "model_load_seconds": round(load_s, 2), "scorer": SCORER,
           "sherpa_onnx": sherpa_onnx.__version__, "clips": []}

    # warm-up, discarded
    lang0, u0 = clips[0]
    s = rec.create_stream()
    audio, sr = read_wav(CORPUS / lang0 / f"{u0['id']}.wav")
    s.accept_waveform(sr, audio)
    rec.decode_stream(s)

    for lang, u in clips:
        audio, sr = read_wav(CORPUS / lang / f"{u['id']}.wav")
        t0 = time.perf_counter()
        s = rec.create_stream()
        s.accept_waveform(sr, audio)
        rec.decode_stream(s)
        hyp = s.result.text
        lat = time.perf_counter() - t0
        ref = u["reference_transcript"]
        rn, hn = normalise_for_scoring(ref), normalise_for_scoring(hyp)
        rw, hw = rn.split(), hn.split()
        rc, hc = rn.replace(" ", ""), hn.replace(" ", "")
        row = {
            "id": u["id"], "language": lang, "audio_seconds": u["duration_seconds"],
            "latency_seconds": round(lat, 3), "rtf": round(lat / u["duration_seconds"], 2),
            "wer": round(levenshtein(rw, hw) / len(rw), 4) if rw else None,
            "cer": round(levenshtein(list(rc), list(hc)) / len(rc), 4) if rc else None,
            "expected_script_share": script_share(hyp, lang),
            "empty": not hn, "hypothesis": hyp, "reference": ref,
        }
        out["clips"].append(row)
        print(f"  [{lang}] {u['id']} {row['latency_seconds']}s rtf={row['rtf']} "
              f"wer={row['wer']} script={row['expected_script_share']}")
        print(f"        HYP: {hyp[:110]}")

    for lang in ("kn", "hi"):
        rows = [r for r in out["clips"] if r["language"] == lang and r["wer"] is not None]
        if rows:
            out[f"summary_{lang}"] = {
                "clips": len(rows),
                "wer_mean": round(sum(r["wer"] for r in rows) / len(rows), 4),
                "cer_mean": round(sum(r["cer"] for r in rows) / len(rows), 4),
                "rtf_mean": round(sum(r["rtf"] for r in rows) / len(rows), 2),
                "expected_script_share_mean": round(
                    sum(r["expected_script_share"] for r in rows) / len(rows), 3),
                "empty": sum(r["empty"] for r in rows),
            }
            print(lang, json.dumps(out[f"summary_{lang}"], ensure_ascii=False))
    (HERE / f"smoke_indicconformer_onnx_{variant}.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", HERE / f"smoke_indicconformer_onnx_{variant}.json")


if __name__ == "__main__":
    main()
