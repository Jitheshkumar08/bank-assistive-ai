# Phase 3.2B-8 — IndicVoices General-Track ASR Baseline (Whisper small)

Spike artifact. Not production code, not part of the regression suite. Every number below was measured on this machine from `indicvoices_asr_raw.jsonl`; nothing is estimated.

**Status:** `COMPLETE`

## What was measured

| | |
|---|---|
| Clips | 400 frozen clips from `indicvoices_general_manifest.json` (sha256 `a2cd7a20f1f0…`), IndicVoices revision `c96f9088f138…` |
| System under test | `app.speech.stt.SpeechToText (unmodified) -> whisper.load_model('small'); model.transcribe(path, language=<code>, fp16=False)` |
| Model | Whisper small, file sha256 `9ecf779972d9…`; openai-whisper 20250625, torch 2.11.0+cpu |
| Decoding | openai-whisper transcribe() defaults: greedy at T=0 (beam_size=None), temperature fallback 0.2..1.0 (single sample) when compression ratio > 2.4 or avg logprob < -1.0, no_speech_threshold 0.6, condition_on_previous_text=True, no initial prompt |
| Language codes | `kn` for all Kannada clips, `hi` for all Hindi clips, passed explicitly |
| Hardware | AMD Ryzen 5 5600H with Radeon Graphics, CPU only, 6 torch threads |
| Latency | wall time of SpeechToText.transcribe() per clip (audio load via ffmpeg + log-mel + decode); model load and one warm-up clip excluded |
| Reference | manifest `reference_transcript` (IndicVoices `normalized`); `verbatim` retained for audit |

## Results by language

| | Kannada | Hindi |
|---|---|---|
| Clips / speakers | 200 / 189 | 200 / 194 |
| Audio | 27.12 min | 27.91 min |
| **WER** (95% CI) | **117.2%** (112.3%–123.2%) | **74.2%** (70.5%–78.0%) |
|   substitutions / deletions / insertions | 62.0% / 38.0% / 17.2% | 50.4% / 20.2% / 3.5% |
| **CER** (95% CI) | **104.7%** (101.8%–108.4%) | **49.5%** (44.9%–54.9%) |
| WER without normalisation (whitespace split only) | 116.0% | 75.7% |
| Median per-clip WER | 100.0% | 73.6% |
| Clips with WER 0 / WER ≥ 100% | 0 / 200 | 0 / 33 |
| Empty outputs | 9 | 1 |
| Failed (exception) outputs | 0 | 0 |
| Unusual outputs (loops / >2× length) | 14 | 13 |
| Wrong-script outputs | 150 | 14 |
| Clips slower than real time (RTF > 1) | 190 | 100 |
| Latency mean / median / p95 / max | 98.54 / 66.86 / 130.29 / 4624.88 s | 17.09 / 7.03 / 65.78 / 114.27 s |
| Real-time factor (total / median per clip) | 12.11 / 10.11 | 2.04 / 1.00 |

RTF < 1 means faster than real time.

## Results by scenario

| Language | Scenario | Clips | WER | CER | Empty | Unusual | Wrong script | Slower than real time | Latency median / p95 | RTF |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Kannada | Read | 40 | 113.3% | 101.3% | 2 | 1 | 27 | 34 | 94.99 / 197.73 s | 7.18 |
| Kannada | Extempore | 80 | 123.0% | 108.2% | 4 | 7 | 64 | 77 | 73.94 / 173.06 s | 17.10 |
| Kannada | Conversation | 80 | 113.4% | 102.6% | 3 | 6 | 59 | 79 | 65.60 / 79.30 s | 10.01 |
| Hindi | Read | 40 | 68.0% | 42.5% | 1 | 2 | 1 | 10 | 6.03 / 43.23 s | 1.16 |
| Hindi | Extempore | 80 | 74.6% | 50.6% | 0 | 6 | 9 | 38 | 8.20 / 69.49 s | 2.41 |
| Hindi | Conversation | 80 | 77.7% | 52.7% | 0 | 5 | 4 | 52 | 5.81 / 48.41 s | 2.30 |

## Results by recording-quality flag

| Language | Group | Clips | WER | CER |
|---|---|---:|---:|---:|
| Kannada | flagged noise chatter etc | 26 | 114.5% | 103.2% |
| Kannada | no quality flags | 174 | 117.6% | 104.9% |
| Hindi | flagged noise chatter etc | 74 | 71.8% | 47.2% |
| Hindi | no quality flags | 126 | 75.5% | 50.8% |

## Script of the output

| Language | Dominant script of hypothesis → clips |
|---|---|
| Kannada | latin: 127, kannada: 42, devanagari: 20, None: 9, other: 2 |
| Hindi | devanagari: 186, latin: 13, None: 1 |

## Entity-like and safety-relevant content (heuristic, see error analysis)

| | Kannada | Hindi |
|---|---|---|
| Number phrases in reference → preserved exactly | 28 → 0 | 31 → 0 |
| Hypotheses writing digits where reference has number words | 7 | 6 |
| Digit-string identifiers (≥4 digit words) → preserved | 9 → 0 | 12 → 0 |
| Names | NOT MEASURABLE (no annotation) | NOT MEASURABLE (no annotation) |
| Hypotheses emitting Latin-script tokens (references have none) | 155 | 24 |
| Negative references → marker kept / dropped; markers inserted | 35 → 0 / 35; 0 | 35 → 21 / 14; 4 |

## Normalisation used for WER / CER

- Applied identically to reference and hypothesis (Phase 3.2B-7 normalise_for_scoring, unchanged).
- 1. Kannada (U+0CE6-0CEF) and Devanagari (U+0966-096F) digits folded to ASCII 0-9.
- 2. Unicode NFC.
- 3. ZWNJ (U+200C) and ZWJ (U+200D) removed.
- 4. Every character that is neither alphanumeric nor a combining mark (Unicode category M*) becomes a space: punctuation such as . , ? ! and the danda U+0964 is not scored.
- 5. Lowercased (affects Latin letters only).
- 6. Whitespace collapsed; WER tokens = whitespace-separated words.
- CER = code-point Levenshtein distance with spaces removed, divided by reference code points. Vowel signs, viramas and nuktas are separate code points and ARE scored.
- NOT normalised (counted as errors): number words vs digits, Latin vs native script, transliteration or spelling variants, other scripts (e.g. Telugu or Urdu output).
- Corpus WER/CER = total edits / total reference units (micro average).

How often each rule changed a **hypothesis** (references were already clean — the normaliser changes none of the 400 references):

| Rule | Kannada | Hindi |
|---|---:|---:|
| punctuation or symbols | 117 | 100 |
| native digits folded | 0 | 0 |
| zero width removed | 0 | 0 |
| latin lowercased | 104 | 13 |
| nfc changed | 1 | 6 |

- Unusual output rule: compression ratio > 2.4 (Whisper's own loop threshold), or the same word repeated >= 4 times in a row, or any 2-4 word phrase occurring >= 3 times, or hypothesis > 2x reference characters.
- Slow clip rule: latency greater than the clip's audio duration (RTF > 1).
- Wrong-script rule: fewer than 50% of hypothesis letters in the expected script (Kannada U+0C80-0CFF, Devanagari U+0900-097F).

## Files

- `indicvoices_asr_results.json` — machine-readable results, including every clip's reference, verbatim, hypothesis and scores
- `indicvoices_asr_error_analysis.md` — error analysis with representative examples
- `indicvoices_asr_raw.jsonl` — raw per-clip transcriptions and latencies (resumable run log)
- `benchmark_indicvoices_asr.py` — the runner
