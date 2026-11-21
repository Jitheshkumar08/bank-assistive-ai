# Custom banking speech recording plan (pilot)

Status: **plan only** — no recording has been done. Written at the end of Phase
3.2B-11, to be executed after the ASR integration is stable.

## Why record at all

Two findings from the frozen evaluation make this necessary, and neither is
fixable by sampling more public data.

**1. Every strong free candidate trained on our evaluation data.** The IndicVoices
paper states its ASR model was trained "using only the IndicVoices train set",
and our 200-clip banking set is drawn from that split. SraVaani names IndicVoices
among its fine-tuning corpora too. So the corpus we would compare models on is
training data for the models being compared. There is also no public test split
at the pinned revision (Kannada and Hindi ship only `train` and `valid`).

**2. Three of our seven safety fields cannot be measured at all.** In the frozen
200-clip set:

| Field | Instances in 200 clips |
|---|---|
| negation | 3 |
| control_type | 1 |
| completion_signal | 1 |

The workflow depends on all three — `app/dialogue/manager.py` routes pause,
resume, cancel, repeat and next, and `completion_semantics.py` resolves step
completion. Digital Payment Commands are first-person requests that rarely
negate, rarely issue a control command and rarely report completion, so no
amount of extra sampling from that source fixes this.

A small custom corpus solves both at once: it is contamination-free, and we
control the category mix.

## Scope of the pilot

Deliberately small. This is a controlled pilot, not a data-collection project.

| Parameter | Value |
|---|---|
| Languages | **Kannada and Hindi** (the two the ASR layer verifies today) |
| Utterances per language | **30–40** |
| Speakers per language | **4–6**, gender-balanced, at least two age bands |
| Utterances per speaker | 6–10 |
| Total | **60–80 recordings** across both languages |
| Effort | one or two sittings |
| Tulu | **excluded** — separate research track, uses the existing Tulu dataset |

Every other Indian language stays on public datasets for broad evaluation. Our
own recordings exist only for banking-specific, safety-critical material.

## Category quotas (per language, target 35)

| Category | Count | Why it is here |
|---|---|---|
| Transfer | 3 | core intent |
| Payment / UPI | 3 | core intent |
| Balance | 3 | core intent |
| Deposit | 2 | core intent |
| Withdrawal | 2 | core intent |
| Amounts | 4 | round, decimal, lakh/crore, digit-by-digit — Whisper's worst failure |
| Account / UPI identifiers | 4 | leading zeros, "double/triple", 10+ digit strings |
| Negation | 4 | **unmeasurable in public data** |
| Pause / resume / repeat / cancel | 4 (1 each) | **unmeasurable**; must match the manager's vocabulary |
| Completion | 3 | **unmeasurable**; "I have entered the amount" vs "not yet" |
| Code-mixed | 2 | real users say "balance", "transfer", "UPI" in English |
| Natural conversational | 1 | guards against over-fitting to command phrasing |

Roughly half the set targets the three fields the public data cannot exercise.

## Recording protocol

- **Format:** 16 kHz, mono, 16-bit PCM WAV — matches the existing pipeline and
  the extracted IndicVoices clips, so no resampling is introduced.
- **Environment:** ordinary room, ordinary phone or laptop mic. Do not record in
  a studio; the assistant will not be used in one.
- **Prompts:** written per category in the target language, reviewed by a native
  speaker before recording. Speakers say them naturally rather than reading
  robotically; small deviations are fine and should be transcribed as spoken.
- **One utterance per file**, named `bank_<lang>_<speaker>_<nnn>.wav`.
- **Consent:** a one-line written consent per speaker, kept out of the repo.
  Record no real account numbers, real UPI IDs or real personal data — invent
  every identifier.

## Annotation and freezing

Reuse the existing frozen artefacts unchanged so the current scoring code runs
as-is:

- Annotate with **`banking_annotation_schema.md`** (version 1) — the same seven
  fields: intent, amount, identifier, negation, control_type,
  completion_signal, notes. Here the reference transcript is what the speaker
  actually said, so annotation is direct rather than inferred.
- Freeze exactly as in Phase 3.2B-9: a manifest with per-clip metadata, a
  SHA-256 over the manifest, and a determinism check.
- Score with the same evaluator (`benchmark_indicvoices_banking_asr.py` scoring
  imports) so results sit alongside the existing baseline.

Suggested file names, all under `debugging/spike/`:

```
corpus/custom_banking/{kn,hi}/*.wav
custom_banking_manifest.json
custom_banking_annotations.json
```

## What this pilot can and cannot tell us

**Can:** whether IndicConformer, Whisper-small and any later candidate preserve
amounts, identifiers, negation, control commands and completion on speech none
of them has seen. That is the number that should drive the architecture.

**Cannot:** a general WER for Kannada or Hindi. 35 utterances from 5 speakers is
far too small for that, and it is not what the set is for. Broad accuracy stays
with the public benchmarks.

With ~15–20 instances per critical category across both languages, the pilot
separates large differences — the kind we already see, such as 5% versus 60%
amount preservation — and nothing finer. If a later comparison turns out to hinge
on a small difference, the corpus needs to grow first.

## Next step after recording

Run all candidates on the frozen custom corpus, report per-category preservation
alongside the existing IndicVoices numbers, and state plainly which figures are
contamination-free (the custom ones) and which are not (everything from
IndicVoices).
