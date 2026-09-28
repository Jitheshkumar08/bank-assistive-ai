# IndicVoices banking ASR baseline (Whisper small) — Phase 3.2B-9

Generated 2026-09-24T20:05:27. Baseline only: no other ASR model was run, installed or compared in this step.

| | |
|---|---|
| Clips | 200 frozen banking clips from `indicvoices_banking_manifest.json` (sha256 `02a773066224…`), IndicVoices revision `c96f9088f138…`, split `train` |
| Audio | extracted per the frozen manifest, 200/200 verified against the FLAC STREAMINFO MD5 |
| Model | Whisper small, file sha256 `9ecf779972d9…`; openai-whisper 20250625, torch 2.11.0+cpu |
| Implementation | app.speech.stt.SpeechToText (unmodified) -> whisper.load_model('small'); model.transcribe(path, language=<code>, fp16=False) |
| Decoding | openai-whisper transcribe() defaults: greedy at T=0 (beam_size=None), temperature fallback 0.2..1.0 (single sample) when compression ratio > 2.4 or avg logprob < -1.0, no_speech_threshold 0.6, condition_on_previous_text=True, no initial prompt |
| Hardware | AMD Ryzen 5 5600H with Radeon Graphics, cpu, 6 torch threads, python 3.13.2 |
| Latency | wall time of SpeechToText.transcribe() per clip (audio load via ffmpeg + log-mel + decode); model load and one warm-up clip excluded |
| Annotations | `indicvoices_banking_annotations.json`, first pass, human_verified=false |

## Core ASR metrics

| Metric | Kannada | Hindi | Overall |
|---|---|---|---|
| Clips / speakers | 100 / 100 | 100 / 100 | 200 / 200 |
| Audio (min) | 15.8 | 16.0 | 31.8 |
| WER | 118.1% | 70.2% | 90.7% |
| CER | 108.3% | 41.5% | 77.1% |
| Substitutions | 936 (65.0%) | 957 (49.5%) | 1893 (56.1%) |
| Deletions | 504 (35.0%) | 345 (17.8%) | 849 (25.2%) |
| Insertions | 260 (18.1%) | 56 (2.9%) | 316 (9.4%) |
| Median clip WER | 100.0% | 66.7% | 100.0% |
| Clips with WER = 0 | 0 | 0 | 0 |
| Clips with WER >= 100% | 100 | 7 | 107 |
| Empty hypotheses | 1 | 0 | 1 |
| Wrong script | 76 (76.0%) | 5 (5.0%) | 81 (40.5%) |
| Failed calls | 0 | 0 | 0 |
| Latency mean / median / p95 / max (s) | 83.7 / 68.3 / 126.7 / 522.6 | 29.0 / 9.2 / 85.2 / 990.9 | 56.3 / 50.7 / 109.6 / 990.9 |
| RTF total / median | 8.80 / 8.70 | 3.02 / 1.17 | 5.90 / 4.42 |

WER and CER are micro averages (total edits / total reference units), scored after the Phase 3.2B-7 normalisation reused unchanged. Number words versus digits, and native script versus Latin, are NOT normalised away and count as errors.

### Sensitivity: excluding the 4 flagged annotation rows

Excluded: `ivb_kn_001`, `ivb_kn_016`, `ivb_kn_072`, `ivb_hi_097` — first-pass annotations the annotator could not settle from the reference alone.

| Metric | Kannada | Hindi | Overall |
|---|---|---|---|
| Clips | 97 | 99 | 196 |
| WER | 119.6% | 70.2% | 90.4% |
| CER | 109.6% | 41.6% | 76.6% |

## Banking-safety metrics

**Scored against FIRST-PASS project annotations that have not been independently human-verified. Treat every figure here as indicative.**

### A. Intent cue survival

This is NOT intent classification. For each row whose annotated intent is one of the five specific banking intents, a small cue list per intent and language is checked against the normalised text. A row is measurable only when the reference itself contains a cue for its annotated intent; the metric then reports whether any cue for that same intent survives in the hypothesis. It answers 'did the words that carry this action survive', not 'would a classifier still get the intent right'. Rows annotated other/unknown have no fixed cue set and are excluded.

| Verdict | Kannada | Hindi | All |
|---|---|---|---|
| cue_lost | 33 | 27 | 60 |
| cue_survived | 0 | 16 | 16 |

By annotated intent: balance {"cue_lost": 15, "cue_survived": 4}, deposit {"cue_lost": 7}, payment {"cue_lost": 5, "cue_survived": 3}, transfer {"cue_lost": 32, "cue_survived": 8}, withdrawal {"cue_lost": 1, "cue_survived": 1}

### B. Amount preservation

An amount is read from a maximal run of number tokens (digit words 0-9, teens and tens, fused hundreds, scale words 100/1000/100000/10000000, English numerals spoken in native script, and ASCII digit tokens). A run composes in the usual Indian way: units add, a scale multiplies what precedes it and 1000+ scales close a group. A run containing a token the lexicon does not know is left UNPARSED and never guessed. The check asks whether the annotated amount appears among the values recoverable from the hypothesis.

| Verdict | Kannada | Hindi | All |
|---|---|---|---|
| exact | 0 | 4 | 4 |
| incorrect | 3 | 16 | 19 |
| missing | 35 | 23 | 58 |

Rows whose hypothesis carries a value the reference does not: 17.

### C. Identifier preservation

Digits are recovered from the hypothesis by mapping digit words, English numerals in native script and ASCII digit tokens to characters, expanding 'double'/'triple' before a numeral, and concatenating. An identifier counts as preserved only when its annotated digit string appears as a contiguous substring of that stream, so leading zeros and digit order are enforced. An identifier whose digit string cannot be recovered from its own REFERENCE by this rule is reported as not measurable rather than scored as an error.

40 identifier entries across 35 rows, 450 annotated digits.

| Verdict | Kannada | Hindi | All |
|---|---|---|---|
| exact | 0 | 2 | 2 |
| incorrect | 2 | 11 | 13 |
| missing | 17 | 2 | 19 |
| not_measurable_annotation_digits_null | 2 | 0 | 2 |
| not_measurable_reference_rule_miss | 0 | 4 | 4 |

### D. Negation (n=3)

**n=3: descriptive only, not statistically meaningful.** Three rows in 200 carry an annotated negation, so this is a description of three cases, not a rate.

- **ivb_kn_019** (Kannada, WER 100%, wrong script): reference negation tokens ['ತೋರಸ್ತಿಲ್ಲ'], hypothesis negation tokens [] → survived: no
- **ivb_hi_086** (Hindi, WER 33%): reference negation tokens ['नहीं'], hypothesis negation tokens ['नहीं'] → survived: yes
- **ivb_hi_097** (Hindi, WER 75%): reference negation tokens [], hypothesis negation tokens [] → survived: no

### E. Control and completion (n=1 each)

**n=1: descriptive only, not an accuracy metric.** The frozen set contains exactly one annotated control command and one completion signal, so no accuracy can be computed.

- control `cancel` — **ivb_kn_024** (Kannada), WER 100%
- completion `not_completed` — **ivb_hi_097** (Hindi), WER 75%

## Annotation limitations

- The annotations are a **first-pass project annotation**, produced by reading the reference transcripts. They have **not** been independently human-verified, so every banking-safety figure above is indicative rather than ground truth.
- Four rows stay flagged and unresolved: `ivb_kn_001`, `ivb_kn_016`, `ivb_kn_072`, `ivb_hi_097`. They are included in the main tables with their current annotation and removed in the sensitivity table above.
- Negation (n=3), control (n=1) and completion (n=1) are too rare in this set to support any rate. They are reported case by case.
- Amount and identifier rules are validated against the reference before being applied: a row whose annotated value cannot be recovered from its own reference is reported as not measurable instead of being counted as an ASR error.

## Training-data / contamination considerations

- **Whisper small** (OpenAI) was trained on about 680,000 hours of weakly supervised audio collected from the web. OpenAI has not published the dataset contents, so it cannot be verified from the project's information whether any of these recordings, or IndicVoices itself, appear in that training data. This report does not claim these clips were unseen.
- These 200 clips come from the IndicVoices **train** split (recorded in the frozen manifest's `split_rationale`: the valid split has too few Digital Payment Commands speakers once the quality rules and the general-set speaker exclusion are applied).
- That matters for what comes next: models trained on IndicVoices train, which includes AI4Bharat's own Indian-language models, may have seen these exact recordings. A later candidate scoring better here could be doing so because it trained on this material. Each candidate's training data must be checked and stated before any comparison is drawn.
- IndicVoices release date versus Whisper small's training cut-off is not established here, so no timing argument is made either way.

## Files

- `indicvoices_banking_asr_raw.jsonl` — one JSON line per clip (id, language, speaker, reference, hypothesis, latency, duration, RTF, status/error)
- `indicvoices_banking_asr_results.json` — full metrics, per-utterance scores and banking-safety detail
- `indicvoices_banking_asr_report.md` — this report
- `indicvoices_banking_audio_index.json` — extraction record for the 200 WAVs
- The previous general-track files (`indicvoices_asr_raw.jsonl`, `indicvoices_asr_results.json`, `indicvoices_asr_report.md`) are untouched.
