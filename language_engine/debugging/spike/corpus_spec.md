# Phase 3.2B-7 — Speech Corpus Specification

Benchmark artifact. Not production code, not part of the regression suite.

## Why this corpus exists

Phase 3.2B-6 established that the installed Whisper accepts 15 Indian
language codes and that the decode path works for all of them. It also
established that **no accuracy figure could be produced**, because the
repository contains no speech recordings in any language — the only
audio file, `phase3_format_check.wav`, is a 3.0-second synthetic tone
(float32, 16 kHz, peak 0.80, RMS 0.64) that Whisper transcribes as the
empty string.

Accepting a language code and transcribing that language well are
different properties. This corpus is what turns the second one into a
number.

## Scope

| | |
|---|---|
| Languages | Kannada (`kn`), Hindi (`hi`) |
| Utterances | 30 per language, 60 total |
| Out of scope | Tulu (`tcy`) — not in Whisper's language table, separate later track |
| Out of scope | Tamil, Telugu, Malayalam, Marathi — add only once `kn`/`hi` are measured |

Two languages first, deliberately. A corpus that covers six languages
shallowly measures nothing well; two covered properly decides whether
the architecture works at all.

## Category balance

Identical in both languages, so every result is comparable across them.

| Category | Count | Severity | What it measures |
|---|---:|---|---|
| `banking_intent` | 5 | 2 | Does the request reach the right one of the five `intents.py` labels |
| `amount` | 5 | **1** | Lakh/crore scale, Indian grouping, spoken numerals |
| `identifier` | 3 | **1** | Account number, phone number, step number — must survive exactly |
| `name` | 3 | **1** | Transliteration, not translation |
| `negation` | 4 | **1** | Polarity survival. The safety-critical category |
| `completion` | 2 | 2 | Workflow step advancement signals |
| `control` | 3 | **1** | pause / resume / session exit |
| `question` | 2 | 2 | Side questions that must not start a workflow |
| `code_mixed` | 3 | 2 | English banking terms inside a regional frame |

**36 of 60 utterances are severity 1** — a wrong result moves money or
misidentifies an account.

## Design decisions worth knowing

**Minimal pairs are deliberate.** Several utterances differ from another
by one morpheme, because that is exactly where a transcription or
translation error becomes dangerous:

| Affirmative | Negative | Separated by |
|---|---|---|
| `kn_002` ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು | `kn_017` ನನಗೆ ಹಣ ತೆಗೆಯುವುದು ಬೇಡ | ಬೇಡ |
| `kn_024` ಮುಂದುವರಿಸಿ (resume) | `kn_020` ಮುಂದುವರಿಸಬೇಡಿ (do not proceed) | ಬೇಡಿ suffix |
| `hi_002` मुझे पैसे निकालने हैं | `hi_017` मुझे पैसे नहीं निकालने हैं | नहीं |
| `hi_003` मुझे लोन चाहिए | `hi_019` नहीं, मुझे लोन नहीं चाहिए | नहीं |
| `hi_024` आगे बढ़िए (resume) | `hi_020` आगे मत बढ़िए (do not proceed) | मत |

If the system cannot separate these pairs, nothing else in the
multilingual plan matters.

**Name traps are real names.** कमला / ಕಮಲಾ (Kamala) literally means
*lotus*; आशा (Asha) means *hope*; ಚಂದ್ರ (Chandra) means *moon*; प्रकाश
(Prakash) means *light*. All four are ordinary given names. Each carries
a `must_not_contain` entry naming the literal meaning that must never
appear.

**Every identifier is synthetic.** `1234567890` and `9876543210` are
obvious placeholders. No real customer data enters this corpus, ever.

**Amounts span the scale divergence.** `20000` is written the same way
under both Indian and Western grouping; `200000` is `2,00,000` under one
and `200,000` under the other; `20000000` is two crore. The corpus
covers all three so a scale error cannot hide.

## Schema

`corpus_metadata.json` carries every field the brief requires plus six
additions, each documented in the file's own `_schema_notes` block. The
one worth calling out here:

**`expected_routing`** exists because `expected_intent` cannot express
the assertion that matters most. `IntentDetector` is a total function
(`detector.py:24-29`) — argmax over five labels, no abstention — so it
returns a banking intent for *every* input, including "do not cancel".
For a negation, a control command or a question, the correct outcome is
not an intent at all; it is **no workflow start**. Recording
`expected_intent: null` alone would lose that, and a benchmark that
cannot state "this must not start a workflow" cannot measure the thing
this phase exists to measure.

Values: `workflow_start`, `no_workflow_start`, `control:pause`,
`control:resume`, `control:repeat`, `session_exit`, `question`,
`completion`.

## Adding real speech requires no code change

1. Record the utterance (see `recording_guide.md`).
2. Save it as `corpus/audio/<lang>/<id>.wav` — e.g. `corpus/audio/kn/kn_001.wav`.
3. Set that utterance's `audio_status` to `"recorded"` and fill in
   `speaker_id` and `duration_seconds`.
4. Run `benchmark_asr.py`.

The runner reads the metadata and the filesystem. Nothing in `app/` is
touched, and no benchmark code changes as the corpus grows.

## Status

**`WAITING_FOR_REAL_AUDIO`** — 0 of 60 recordings present.

No WER, CER, entity-accuracy or latency figure exists for any Indian
language, and none is estimated anywhere in these artifacts.
