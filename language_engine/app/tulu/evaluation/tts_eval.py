"""Evaluates Tulu speech synthesis (Kannada-trained voice reading Tulu text).

For every verified sentence (and, for the listening sheet only, both disputed
D04 wordings) this script:

  1. synthesizes NEW audio from text with TuluSpeechSynthesizer;
  2. proves it is not a dataset recording: SHA-256 differs from all 16
     recordings, and the peak normalised cross-correlation of the waveform
     against each recording is reported (identical audio = 1.0);
  3. measures MACHINE intelligibility: the generated audio is transcribed by
     the same Kannada acoustic models used in the ASR evaluation and scored
     (CER on phonetic keys) against the Romanized reference. The native
     speaker's recording of the same sentence is scored the same way, so
     the two can be compared. A Kannada ASR rewards Kannada-like
     pronunciation: this is a proxy, NOT a measure of Tulu intelligibility,
     which only a native listener can give (see the listening sheet).

Outputs (evaluation/reports/):
  tulu_tts_eval.json / .md
  tulu_tts_audio/*.mp3                 generated audio for native review
  tulu_tts_listening_sheet.csv         blank rating sheet for a native speaker

Run from language_engine/:
    python -m app.tulu.evaluation.tts_eval
"""

from __future__ import annotations

import csv
import hashlib
import json
import subprocess
import sys
import warnings
from pathlib import Path

import numpy as np

from app.tulu.data.dataset import all_utterances, audio_path, audio_utterances, load_dataset
from app.tulu.evaluation.asr_eval import REPORTS, available_memory_mb, build_model, cer, memory_mb
from app.tulu.tts.synthesizer import DISCLOSURE, TuluSpeechSynthesizer

warnings.filterwarnings("ignore")

OUT_AUDIO = REPORTS / "tulu_tts_audio"


def decode_16k(path_or_bytes) -> np.ndarray:
    args = ["ffmpeg", "-v", "error", "-nostdin"]
    if isinstance(path_or_bytes, (bytes, bytearray)):
        args += ["-i", "pipe:0"]
        stdin = bytes(path_or_bytes)
    else:
        args += ["-i", str(path_or_bytes)]
        stdin = None
    args += ["-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"]
    out = subprocess.run(args, input=stdin, capture_output=True, check=True).stdout
    return np.frombuffer(out, np.int16).astype(np.float32) / 32768.0


def peak_xcorr(a: np.ndarray, b: np.ndarray) -> float:
    """Peak normalised cross-correlation over all lags (1.0 = same signal)."""
    a = a - a.mean()
    b = b - b.mean()
    n = len(a) + len(b) - 1
    size = 1 << (n - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    denom = np.sqrt((a ** 2).sum() * (b ** 2).sum()) + 1e-12
    return float(np.abs(corr).max() / denom)


def items():
    rows = []
    for u in all_utterances():
        rows.append({"id": u["id"], "dataset": u["dataset"], "role": u["speaker_role"], "text": u["tulu_romanized"],
                     "native_audio": str(audio_path(u)) if u.get("audio_file") else None,
                     "status": "verified" if u.get("audio_file") else "text-only (no recording)"})
    disputed = next(d for d in load_dataset("deposit")["discrepancies"] if d["id"] == "D04_ASSISTANT_WORDING")
    for i, version in enumerate(disputed["versions"], 1):
        rows.append({"id": f"D04-disputed-v{i}", "dataset": "deposit", "role": "assistant", "text": version["tulu_romanized"],
                     "native_audio": None, "status": f"disputed ({version['source']}) -- listening only"})
    # The D04 table row duplicates disputed v1; mark it so it is not counted as verified.
    for r in rows:
        if r["id"] == "D04":
            r["status"] = "disputed -- listening only"
    return rows


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    # Low-memory protocol: ONE light acoustic model for the intelligibility proxy.
    print(f"free RAM before: {available_memory_mb()} MB", flush=True)
    model = build_model("indicconformer-kn")
    asr = {"indicconformer-kn": lambda path: (model(path), "kn")}
    synth = TuluSpeechSynthesizer()
    OUT_AUDIO.mkdir(parents=True, exist_ok=True)

    dataset_audio = {}
    dataset_hashes = set()
    for u in audio_utterances():
        p = audio_path(u)
        dataset_audio[p.name] = decode_16k(p)
        dataset_hashes.add(hashlib.sha256(p.read_bytes()).hexdigest())

    results = []
    for item in items():
        res = synth.synthesize_sync(item["text"], assume_tulu=True)
        out = OUT_AUDIO / f"{item['id']}_generated.mp3"
        out.write_bytes(res.audio)
        wave = decode_16k(res.audio)
        xc = {name: round(peak_xcorr(wave, ref), 3) for name, ref in dataset_audio.items()}
        row = {
            **item,
            "spoken_kannada_script": res.spoken_text,
            "voice_id": res.voice_id,
            "generated_file": str(out.relative_to(REPORTS.parent.parent)),
            "bytes": len(res.audio),
            "content_type": res.content_type,
            "duration_s": round(len(wave) / 16000, 2),
            "sha256": hashlib.sha256(res.audio).hexdigest(),
            "sha256_matches_any_dataset_recording": hashlib.sha256(res.audio).hexdigest() in dataset_hashes,
            "max_xcorr_vs_dataset": max(xc.values()),
            "xcorr_vs_own_native_recording": xc.get(Path(item["native_audio"]).name) if item["native_audio"] else None,
            "machine_intelligibility": {},
        }
        for name, run in asr.items():
            hyp_tts, _ = run(str(out))
            entry = {"tts_hypothesis": hyp_tts, "tts_cer": round(cer(hyp_tts, item["text"]), 3)}
            if item["native_audio"]:
                hyp_nat, _ = run(item["native_audio"])
                entry.update({"native_hypothesis": hyp_nat, "native_cer": round(cer(hyp_nat, item["text"]), 3)})
            row["machine_intelligibility"][name] = entry
        results.append(row)
        print(item["id"], row["duration_s"], row["max_xcorr_vs_dataset"],
              {k: (v["tts_cer"], v.get("native_cer")) for k, v in row["machine_intelligibility"].items()}, flush=True)

    summary = {}
    for name in asr:
        paired = [r for r in results if r["native_audio"]]
        summary[name] = {
            "mean_tts_cer (all 28 dataset sentences)": round(np.mean([r["machine_intelligibility"][name]["tts_cer"] for r in paired]), 3),
            "mean_native_cer (same 28 sentences)": round(np.mean([r["machine_intelligibility"][name]["native_cer"] for r in paired]), 3),
            "mean_tts_cer (8 verified assistant responses used in product)": round(np.mean([
                r["machine_intelligibility"][name]["tts_cer"] for r in results
                if r["id"] in ("D01", "D02", "D03", "W01", "W02", "W03", "W04", "W05")]), 3),
        }
    report = {
        "disclosure": DISCLOSURE,
        "generated_items": len(results),
        "any_sha256_match_with_dataset": any(r["sha256_matches_any_dataset_recording"] for r in results),
        "max_xcorr_vs_dataset_overall": max(r["max_xcorr_vs_dataset"] for r in results),
        "machine_intelligibility_summary": summary,
        "memory_end": memory_mb(),
        "rows": results,
    }
    (REPORTS / "tulu_tts_eval.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# Tulu TTS evaluation", "", f"**Voice:** {DISCLOSURE}", "",
             f"- Generated items: {len(results)}",
             f"- Any generated file byte-identical (SHA-256) to a dataset recording: {report['any_sha256_match_with_dataset']}",
             f"- Highest waveform cross-correlation between any generated file and any dataset recording: "
             f"{report['max_xcorr_vs_dataset_overall']} (identical audio = 1.0)", "",
             "## Machine-intelligibility proxy (Kannada ASR round trip; lower CER = closer to the Romanized text)", "",
             "| ASR | Mean CER, generated (28 sentences) | Mean CER, native speakers (same 28) | Mean CER, generated (8 product responses) |",
             "|---|---|---|---|"]
    for name, s in summary.items():
        lines.append(f"| {name} | {s['mean_tts_cer (all 28 dataset sentences)']} | {s['mean_native_cer (same 28 sentences)']} | "
                     f"{s['mean_tts_cer (8 verified assistant responses used in product)']} |")
    lines += ["", "## Per item", "", "| ID | Status | Romanized | Spoken (Kannada script) | Dur. | Max xcorr vs dataset |"
              + "".join(f" {n} CER gen / native |" for n in asr), "|---|---|---|---|---|---|" + "---|" * len(asr)]
    for r in results:
        cells = "".join(f" {r['machine_intelligibility'][n]['tts_cer']} / {r['machine_intelligibility'][n].get('native_cer', '-')} |" for n in asr)
        lines.append(f"| {r['id']} | {r['status']} | {r['text']} | {r['spoken_kannada_script']} | {r['duration_s']} s | {r['max_xcorr_vs_dataset']} |{cells}")
    (REPORTS / "tulu_tts_eval.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    with open(REPORTS / "tulu_tts_listening_sheet.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "id", "status", "romanized_tulu", "kannada_script_spoken",
                    "intelligible_1to5", "pronunciation_1to5", "naturalness_1to5",
                    "mispronounced_words", "kannada_script_correct_yes_no", "corrected_kannada_script", "comments"])
        for r in results:
            w.writerow([Path(r["generated_file"]).name, r["id"], r["status"], r["text"], r["spoken_kannada_script"]]
                       + [""] * 7)
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
