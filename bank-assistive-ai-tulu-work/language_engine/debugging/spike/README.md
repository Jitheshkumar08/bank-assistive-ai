# Phase 3.2B-6 / 3.2B-7 SPIKE — throwaway benchmark harness

NOT part of the production test suite. Nothing here is imported by
`app/` or `service/`, and nothing here may be referenced by a
`debugging/test_*.py` suite. Delete the folder when the questions it
answers are closed.

Naming is deliberate: these files are `spike_*.py` and `benchmark_*.py`,
never `test_*.py`, so the existing suite-runner conventions never pick
them up.

Run everything from `language_engine/`:

```powershell
$env:PYTHONIOENCODING = "utf-8"
```

## Phase 3.2B-6 — feasibility

| File | What it does |
|---|---|
| `spike_whisper_languages.py` | Which Indian language codes the installed Whisper accepts, whether the decode path really takes them, and whether `SpeechToText` passes them through. Makes no accuracy claim. |
| `spike_candidate_availability.py` | Read-only PyPI and Hugging Face metadata probe: can a candidate be installed here at all, what licence does it carry. Installs nothing. |
| `entity_preservation_matrix.json` | The proposed banking-entity test design that Phase 3.2B-7's corpus is built from. |

```powershell
.\venv\Scripts\python.exe -m debugging.spike.spike_whisper_languages
.\venv\Scripts\python.exe -m debugging.spike.spike_candidate_availability
```

The second makes read-only HTTPS GETs to public metadata APIs and sends
nothing but package and model names.

## Phase 3.2B-7 — corpus and benchmarks

| File | What it does |
|---|---|
| `corpus_spec.md` | Corpus design: 30 Kannada + 30 Hindi utterances, 9 categories, 36 of them severity 1. |
| `corpus_metadata.json` | The 60 utterances with reference transcripts and expected entities, intents, negation and routing. |
| `recording_guide.md` | How to record the corpus. Written for team members, not engineers. |
| `benchmark_asr.py` | Benchmarks the existing Whisper baseline. Reports `WAITING_FOR_REAL_AUDIO` until recordings exist. |
| `benchmark_translation.py` | Typed-text translation benchmark. Needs no audio, so it runs today. |
| `benchmark_report.md` | Results and what remains unmeasured. |
| `corpus/audio/{kn,hi}/` | Where recordings go. Empty until the team records them. |

```powershell
.\venv\Scripts\python.exe -m debugging.spike.benchmark_asr --selfcheck
.\venv\Scripts\python.exe -m debugging.spike.benchmark_asr
.\venv\Scripts\python.exe -m debugging.spike.benchmark_translation
```

`--selfcheck` exercises the scoring path on hand-written text pairs with
no audio and no ASR, so the metrics are known good before the first real
recording arrives. It caught four genuine evaluator bugs when it was
first run, including `str.isalnum()` silently deleting every Kannada and
Devanagari combining mark.

## Rules these artifacts follow

- Nothing in `app/`, `service/`, `requirements.txt`, the workflow JSON or
  the regression suite is modified by anything here.
- No package is installed into the project venv.
- No accuracy, latency or quality number is ever estimated, simulated or
  inferred. A measurement that was not taken is reported as
  `NOT MEASURED`, `NOT AVAILABLE` or `NOT APPLICABLE`.
- Every account number, phone number and name in the corpus and the
  benchmarks is synthetic. No real customer data, no secrets.
- The Groq API key is read from the environment, never printed and never
  written to a results file.

## Housekeeping

This folder is untracked but **not** gitignored, so `git add .` will pick
it up. Recordings under `corpus/audio/` are covered by the existing
`*.wav` ignore rules at both repository levels and will not be committed
by accident.
