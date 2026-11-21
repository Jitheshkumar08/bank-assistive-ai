# ASR providers (Phase 3.2B-11)

How speech becomes text in the language engine, which model serves which
language, and how to change that without touching code.

## What is integrated

| | |
|---|---|
| Primary (Kannada, Hindi) | **AI4Bharat IndicConformer**, ONNX int8, run on CPU |
| Kannada model | `OpenVoiceOS/ai4bharat-indicconformer-kn-onnx` (MIT, ungated) |
| Hindi model | `OpenVoiceOS/ai4bharat-indicconformer-hi-onnx` (MIT, ungated) |
| Source checkpoints | `ai4bharat/indicconformer_stt_{kn,hi}_hybrid_ctc_rnnt_large` (MIT) |
| Runtime | [`onnx-asr`](https://github.com/istupakov/onnx-asr) + `onnxruntime` — no NeMo, no GPU, no torch |
| English, and fallback everywhere | **Whisper small**, unchanged from before this phase |
| Tulu | **not supported** — separate research track, no verified model exists |

The IndicConformer models are CTC conformers of ~120M parameters, 138 MB each as
int8, downloaded once from Hugging Face and cached, then run fully offline. No
paid API is involved anywhere in this path.

## Why this model

Measured on this project's hardware (Ryzen 5 5600H, CPU only, 6 threads), five
banking clips per language:

| | Whisper small (baseline) | IndicConformer ONNX int8 |
|---|---|---|
| Kannada WER | 118.1% | 16.7% |
| Kannada output in Kannada script | 24% of clips | 100% |
| Kannada RTF | 8.70 | 0.26 |
| Hindi WER | 70.2% | 13.2% |
| Hindi RTF | 1.17 | 0.26 |

**Read the WER numbers with care.** Those clips come from the IndicVoices *train*
split, which IndicConformer was trained on, so its accuracy there is flattered by
possible memorisation. What the smoke test does establish beyond doubt is that
the provider loads, runs on CPU, produces correct-script output, and is roughly
30× faster than the baseline. A trustworthy accuracy comparison needs the
contamination-free corpus described in
`debugging/spike/asr_recording_plan.md`.

## Setup

```powershell
cd language_engine
.\venv\Scripts\python.exe -m pip install onnx-asr onnxruntime
```

`requirements.txt` was deliberately **not** modified in this phase. Add these two
lines when the team is ready to make the dependency permanent:

```
onnx-asr
onnxruntime
```

Models download on first use (~138 MB per language) into the Hugging Face cache
(`~/.cache/huggingface`). No token is needed: both repos are ungated. After the
first run the system works offline.

If `onnx-asr` is not installed, the provider reports itself unavailable and every
language falls back to Whisper, so the app still starts and runs.

## Configuration

All settings are environment variables (see `.env.example`); nothing is
hardcoded in the dialogue manager.

| Variable | Default | Meaning |
|---|---|---|
| `ASR_PROVIDER` | `auto` | `auto`, `whisper`, or `indicconformer` |
| `ASR_LANGUAGE_PROVIDERS` | `en=whisper,kn=indicconformer,hi=indicconformer` | per-language routing |
| `ASR_FALLBACK` | `whisper` | provider used when the first choice fails; `none` to disable |
| `ASR_INDIC_QUANTIZATION` | `int8` | `int8` (138 MB) or `fp32` (482 MB) |
| `ASR_INDIC_MODELS` | — | `lang=hf-repo` pairs to add or override models |
| `ASR_INDIC_ENABLE_UNVERIFIED` | unset | `1` enables the untested languages of the family |
| `ASR_WHISPER_MODEL` | `small` | Whisper size for baseline/fallback |

To revert entirely to the previous behaviour, with no code change:

```
ASR_PROVIDER=whisper
```

## How to run

Nothing about running the assistant changed:

```powershell
cd language_engine
$env:PYTHONIOENCODING = "utf-8"
.\venv\Scripts\python.exe -m app.main          # service
```

On startup the engine prints its routing, for example:

```
Speech-to-text ready (routing: en->whisper, kn->indicconformer, hi->indicconformer)
```

## Architecture

```
app/speech/
    stt.py                       facade, unchanged public contract
    asr/
        base.py                  SpeechRecognizer + SpeechRecognitionResult
        whisper_provider.py      Whisper small (baseline and fallback)
        indic_conformer_provider.py   IndicConformer ONNX via onnx-asr
        factory.py               config-driven routing and fallback
```

`SpeechToText.transcribe(path, language)` still returns a mapping containing
`text` and `language`, exactly as before. It now also carries `provider`,
`model`, `latency_seconds`, `confidence`, `fallback_used` and `metadata`. These
are additive, so `app/pipeline/voice_pipeline.py` and every other caller work
unchanged.

ASR does **speech → text in the same language only**. Translation to English
stays in `app/translation`, exactly where it was. A recogniser never returns
English for regional audio.

## Fallback behaviour

1. The language's configured provider runs first.
2. If it raises, the next capable provider runs — by default Whisper.
3. A fallback result is marked `fallback_used=True`, with `fallback_from` and the
   original error in `metadata`. Whisper output is never presented as though it
   came from the Kannada model.
4. A language no provider supports raises `RuntimeError` rather than guessing.
   Tulu (`tcy`) behaves this way by design.
5. `ASR_FALLBACK=none` turns failures into errors instead of silent substitution.

## Language support

**Verified on this project's data:** Kannada (`kn`), Hindi (`hi`), plus English
(`en`) through the unchanged Whisper path.

**Available but unverified** — the same MIT ONNX family publishes `as`, `bn`,
`brx`, `doi`, `gu`, `kok`, `ks`, `mai`, `ml`, `mni`, `mr`. They are off by default;
enable with `ASR_INDIC_ENABLE_UNVERIFIED=1` and measure before trusting them.

**Not supported: Tulu.** No audited model covers it (IndicConformer is the 22
scheduled languages, Whisper and MMS do not list it). It remains a separate
research track.

## Audio input formats

`onnx-asr` reads WAV files with the stdlib `wave` module, which handles integer
PCM only and fails with `unknown format: 3` on IEEE-float WAV — which is exactly
what `app/speech/recorder.py` writes for live microphone input. The provider
therefore decodes the file itself (via scipy, already a pinned dependency) and
hands `onnx-asr` a float32 array, which it accepts natively.

Handled: float32 and integer PCM (8/16/24/32-bit), mono or multi-channel
(averaged to mono), and any sample rate (resampled to 16 kHz when it is not
8 kHz or 16 kHz).

## Known limitations

- Accuracy on IndicVoices-derived clips is **not** a clean measurement: the model
  was trained on that corpus. Treat published and smoke-test WERs as indicative.
- Only Kannada and Hindi are verified. Do not advertise other languages yet.
- Each language loads its own ~138 MB model; the first call per language pays a
  one-off load of roughly 5–30 s (download on the very first run).
- The ONNX conversions are community rebuilds of the official AI4Bharat
  checkpoints, not published by AI4Bharat themselves.
- `int8` quantisation trades a little accuracy for size and speed; `fp32` is
  available via `ASR_INDIC_QUANTIZATION=fp32`.
- CTC output has no punctuation or casing, unlike Whisper. Downstream matching
  already normalises text, and the regression suites pass, but keep it in mind.
- IndicConformer offers no English model; English stays on Whisper by design.
