# Phase 3.2B-7 — Benchmark Report

Benchmark artifact. Not production code, not part of the regression suite.

Every number below was measured on this machine. Nothing is estimated,
simulated or extrapolated. Absent measurements are labelled
`NOT MEASURED`, `NOT AVAILABLE` or `NOT APPLICABLE`.

---

## 1. Corpus status

**`WAITING_FOR_REAL_AUDIO`**

| | |
|---|---|
| Specified | 60 utterances — 30 Kannada, 30 Hindi |
| Recorded | **0** |
| Categories | 9, identically balanced across both languages |
| Severity 1 | 36 of 60 |
| Audio in repo | None. `phase3_format_check.wav` is a 3.0 s synthetic tone (float32, 16 kHz, peak 0.80, RMS 0.64), not speech |

The corpus is fully specified and ready to record. Adding speech needs
no code change: drop a WAV at `corpus/audio/<lang>/<id>.wav`, set
`audio_status` to `recorded`, re-run.

## 2. Recordings available

**0 of 60.** ASR was therefore not benchmarked at all.

## 3. Languages tested

| Stage | Languages | Status |
|---|---|---|
| ASR | kn, hi | **NOT MEASURED** — no audio |
| Translation | kn→en, hi→en, en→kn→en, en→hi→en | **MEASURED** |

---

## 4–11. ASR results

**NOT MEASURED, in full.** No recordings exist, so:

| Metric | Status |
|---|---|
| WER by language | NOT MEASURED |
| CER by language | NOT MEASURED |
| Amount / entity accuracy | NOT MEASURED |
| Negation preservation (ASR) | NOT MEASURED |
| Intent preservation | NOT MEASURED |
| Code-mixed transcription | NOT MEASURED |
| ASR latency / RTF | NOT MEASURED |
| Alternative ASR (IndicConformer) | NOT BENCHMARKED — environment/dependency limitation |

### What *was* established about the ASR path

The evaluator itself is built and verified. `benchmark_asr.py --selfcheck`
exercises the scoring path on hand-written text pairs — no audio, no
ASR, no fabricated transcription:

**30 of 30 evaluator checks pass.**

That self-check earned its place immediately: its first run exposed four
genuine bugs in this benchmark's own scoring code.

| Bug | Effect | Fix |
|---|---|---|
| `str.isalnum()` is `False` for Unicode category `Mn` | Every Kannada and Devanagari vowel sign, virama and nukta was deleted before scoring. `मुझे पैसे चाहिए` scored as 7 tokens instead of 3; two different Kannada words collapsed to the same skeleton and scored CER 0 | Keep combining marks; drop only punctuation |
| Digit tokens were not multiplicands | `2 lakh` parsed as 100000 instead of 200000 — a 2× error on the highest-severity field | Treat short digit runs as scale multiplicands |
| Number-word tables keyed on unnormalised strings | Every Kannada and Hindi amount returned `None` | Normalise dictionary keys the same way transcripts are |
| `expected_entities.name` had no evaluator branch | Name preservation silently unscored at the ASR stage | Report explicitly as `NOT APPLICABLE` at ASR stage, deferred to translation |

Had the first real corpus run happened before this self-check, every one
of those would have been misread as an ASR result.

---

## 12. Translation results — **MEASURED**

Groq `openai/gpt-oss-20b` (the same model the production dialogue path
uses), typed text end to end. 56 API calls, **0 API failures**.

### By direction

| Direction | Cases fully preserved |
|---|---|
| kn → en | **12 / 12** |
| hi → en | **12 / 12** |
| en → hi → en (round trip) | **8 / 8** |
| en → kn → en (round trip) | **7 / 8** |

### By category

| Severity | Category | Preserved |
|---|---|---|
| 1 | account_number | **6 / 6** |
| 1 | amount | **10 / 10** |
| 1 | control | **6 / 6** |
| 1 | negation | **8 / 8** |
| 1 | name | 3 / 4 |
| 2 | code_mixed | 2 / 2 |
| 2 | workflow | 4 / 4 |

### What held up

- **Amounts: 10/10.** `2 lakh` → 200000, `2 करोड़` → 20000000,
  `ಎರಡು ಲಕ್ಷ` → 200000, and `2,00,000` survived a round trip with Indian
  grouping intact.
- **Account and phone numbers: 6/6.** `1234567890` and `9876543210`
  survived every direction byte-identical, including both round trips.
- **Negation: 8/8.** `ರದ್ದು ಮಾಡಬೇಡಿ` → "Do not cancel";
  `रद्द मत कीजिए` → "Do not cancel"; `ನನಗೆ ಹಣ ತೆಗೆಯುವುದು ಬೇಡ` →
  "I don't want to withdraw money". Verified with the **production**
  `contains_negation()` (`manager.py:284`), so this is the real gate, not
  a proxy.
- **Control: 6/6.** pause and exit survived as recognisable commands in
  all directions.
- **The literal-meaning trap was never hit.** कमला / ಕಮಲಾ came back as
  "Kamala" in every one of four directions — never "lotus".

### The one safety-critical failure

```
en_name_trap  [en -> kn -> en round trip]
  source : 'My name is Kamala Shetty'
  output : 'My name is Kamal Shetty'
```

The name was not translated into its meaning — it was **transliterated
unstably**. "Kamala" and "Kamal" are different people's names, and on a
banking form that is a severity-1 error.

**My own check was too lenient on the parallel case, and this report
corrects it.** The `en → hi → en` round trip returned
`'My name is Kamla Shetty.'`, which the benchmark scored as a pass only
because `"kamla"` was in its accepted-spellings list. Judged as exact
preservation, **both round trips altered the name: 0 / 2**. The honest
summary is:

| | Result |
|---|---|
| Name preservation, regional → English | **2 / 2 exact** |
| Name preservation, English → regional → English | **0 / 2 exact** |

Round-tripping a name through a script boundary is not safe with this
model and this prompt.

## 13. Translation latency — **MEASURED**

56 calls, this machine, this network, one session.

| | Seconds |
|---|---|
| min | 0.44 |
| median | **0.68** |
| max | 2.98 |

End-to-end per case, by direction:

| Direction | n | min | median | max |
|---|---:|---:|---:|---:|
| kn → en | 12 | 0.47 | **0.53** | 2.27 |
| hi → en | 12 | 0.47 | **0.56** | 0.99 |
| en → kn → en (2 chained calls) | 8 | 0.95 | **1.15** | 5.40 |
| en → hi → en (2 chained calls) | 8 | 4.97 | **5.17** | 5.52 |

**The `en → hi → en` row is not interpreted here.** It ran roughly 4.5×
slower than the structurally identical `en → kn → en` direction. With
n=8 in a single session, provider-side variance and queueing are at
least as likely an explanation as anything about the language or script,
and this benchmark cannot separate the two. Repeat runs across different
times of day are needed before any claim is made. No conclusion about
Hindi is drawn from it.

What the data does support: a regional turn needs **two** translation
calls on top of the existing `understand()` call, and for a question a
further `answer_question()` call. On the measured median that is roughly
**+1.4 s** of translation per turn. Whether that total is acceptable is
a product decision this benchmark does not make.

## 14. Safety-critical failures

**1 measured**, listed in §12: name corruption on the English → Kannada
→ English round trip, plus the lenient-check correction that makes it
0/2 for round-tripped names.

Zero failures in amounts, account numbers, phone numbers, negation and
control commands across 30 severity-1 measured cases.

## 15. Alternative-model results

| Candidate | Status |
|---|---|
| AI4Bharat IndicConformer | **NOT BENCHMARKED** — environment/dependency limitation. Needs `nemo_toolkit` in a disposable venv; not installed, and the project venv must not be touched |
| IndicTrans2 | **NOT BENCHMARKED** — `IndicTransToolkit` publishes no Windows wheel at any Python version (cp313 exists for macOS/manylinux/musllinux only), so this machine requires a C++ source build in a disposable venv |
| NLLB-200 | **NOT BENCHMARKED** — excluded on licence. CC-BY-NC-4.0 is non-commercial |
| Per-language fine-tuned Whisper | **NOT BENCHMARKED** — deliberately. One model per language means N model loads and N× resident memory in `EngineRuntime.__init__`, which loads eagerly |

No model-selection decision is made on downloads, popularity, model-card
claims, or "designed for Indian languages".

## 16. Limitations

1. **No ASR evidence of any kind exists** — for Kannada, Hindi, or
   English. This is the dominant limitation and it gates the phase.
2. **Translation was measured on one model, one session, one network.**
   Latency especially should not be treated as stable from n=56.
3. **Round-trip is a weak proxy** for English → regional quality. Two
   errors can cancel, and a round trip cannot see an error that is
   introduced and then undone. A native speaker reading the intermediate
   regional text is the real check, and that has not been done.
4. **The benchmark's amount parser is small and explicit.** It covers the
   number words this corpus uses and returns `None` otherwise. It is not
   `entity_guard.py` and must not be promoted to production without its
   own design pass.
5. **Spoken digit words are an evaluator gap.** If a speaker reads an
   account number as words rather than digits, the evaluator flags
   `spoken_digit_words` rather than scoring it — deliberately, so the
   limitation is visible rather than counted as an ASR failure.
6. **One speaker per language is not yet decided.** With a single
   speaker, results describe that voice as much as that language.

## 17. Recommendation for Phase 3.2B-8

**Record the corpus. Nothing else moves until it exists.**

The translation half of the architecture now has evidence and it is
largely encouraging: amounts, identifiers, negation and control commands
survived every measured case, and the literal-meaning name trap never
fired. The ASR half has no evidence at all, and ASR is upstream of
everything — a transcription error cannot be repaired by a translator.

Priority order for 3.2B-8:

1. **Record 30 Kannada + 30 Hindi utterances** per `recording_guide.md`,
   ideally 2–3 speakers per language. Run `benchmark_asr.py`.
2. **Do not build the ASR provider abstraction yet.** Phase 3.2B-6
   recommended option C (abstraction now, Whisper the only active
   provider) and that still holds — but it should land *after* the
   baseline is measured, so there is a number to compare any future
   provider against.
3. **Design a name-handling rule**, given the measured round-trip
   corruption. Options worth evaluating: never round-trip a name, mask
   names before translation and restore after, or keep names in their
   original script throughout. This is the one measured severity-1
   failure and it has a concrete fix.
4. **Repeat the translation latency measurement** across several sessions
   before using any of these numbers in a budget.
5. **Re-run the IndicTrans2 compatibility spike in a disposable venv**,
   preferably on the Linux deployment target where the wheel exists, to
   close the one open dependency question.
