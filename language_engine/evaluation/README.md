# Multilingual evaluation harness (M0)

An offline, deterministic measurement of the engine's language path in English,
Kannada, Hindi, Kannada-English, Hindi-English and romanised input. It changes
no engine behaviour: it calls the engine's own functions the way production
calls them, and records what they decide against a labelled fixture set.

## Running it

From `language_engine/`:

```sh
# Regenerate the baseline (writes reports/baseline_m0.md and .json)
venv/Scripts/python.exe -m evaluation.harness --name baseline_m0

# A later milestone: write a new report and list every fixture whose outcome changed
venv/Scripts/python.exe -m evaluation.harness --name m1 --compare evaluation/reports/baseline_m0.json

# Harness self-test (no model, no network, a few seconds)
venv/Scripts/python.exe -m debugging.test_evaluation_harness
```

| Option | Default | Meaning |
|---|---|---|
| `--fixtures` | `evaluation/fixtures/multilingual_v1.json` | fixture file |
| `--out` | `evaluation/reports` | report directory |
| `--name` | `latest` | report file stem |
| `--no-retrieval` | off | skip the knowledge-retrieval measurement |
| `--compare` | – | earlier JSON report to diff outcomes against |

A full run takes about a minute on CPU, most of it loading the embedding model.
Exit code 0 means the run completed; it is a measurement, not a gate, so failing
fixtures do not change the exit code. Exit code 2 means the fixture file is
invalid and nothing was evaluated.

### Offline by construction

- `HF_HUB_OFFLINE` and `TRANSFORMERS_OFFLINE` are forced before any import.
- A socket guard refuses every non-loopback connection for the whole run.
- The LLM is never constructed: `DialogueManager` is built without running its
  `__init__` (which creates the Groq client), the same pattern the offline
  suites use.

The only requirement is that `paraphrase-multilingual-MiniLM-L12-v2` is already
in the local Hugging Face cache, which it is wherever the engine has run once.
No new dependency was added.

### Deterministic

The report contains no timestamps, scores are rounded to three decimals, and
fixtures are processed in file order. Two runs on the same fixtures produce the
same report apart from the run name. The report header records the fixture
file's SHA-256, so a report can always be matched to the exact fixtures it measured.

## What each category measures

| Category | Engine path measured | Expected field |
|---|---|---|
| `service_request` | Resting-state router: `normalize_banking_terms` → `classify_turn` → question/control prefilter → `IntentDetector` | `intent` (one of the five labels) |
| `knowledge_question` | The same router, plus `KnowledgeRetriever.search(top_k=2)` | `route: "knowledge"`, `sources` (acceptable documents, or null) |
| `control` | `classify_turn` (deterministic tier) | `command` |
| `amount` | `extract_amount` (the deterministic gap-filler) | `amount` (integer, or null for "no amount") |
| `negation` | `contains_negation`, plus `DialogueManager._detect_workflow_conflict` with `context.active_workflow` in progress | `negated` |
| `conflict_answer` | Pending-conflict path: control tier → `CONFLICT_CONTROL_CHOICES`, else `_conflict_choice_from_text` | `choice` (`cancel` / `pause` / `continue`, or null for "ask again") |
| `ambiguous_request` (M4) | The resting-state router: a request naming no single service ("I need money") must not start one | `starts_workflow: false` |
| `refusal` (M3) | The resting-state router including the routing layer's refusal gate, plus `_detect_workflow_conflict` when `context.active_workflow` is set | `starts_workflow: false` |

The refusal gate is applied only when the engine under test has it
(`DialogueManager.handle_refused_request`, added in M3), so the harness
mirrors whichever engine it runs against: measuring pre-M3 code reports the
pre-M3 behaviour.

Other fixture files: `amounts_m1.json` (M1 amount boundary cases),
`m3_language_cues.json` (M3 question, refusal, politeness and control
targets) and `m4_heldout.json` (M4 HELD-OUT set: written before M4's
changes and never used to choose intent examples, so it measures whether
they generalise) and `m5_fresh.json` (M5 FRESH set: written before M5 and
independently of every earlier file; spelling and Unicode variants, inflected
loanwords, Indic punctuation, and the M4 held-out failure categories in new
wording) and `m7_fresh.json` (M7 FRESH retrieval set: eight knowledge-base
topics asked in all seven language groups -- `topic` links each question to
its English equivalent -- plus four questions the knowledge base cannot
answer). `multilingual_v1.json` is frozen; the self-test checks its digest.

Since M7 every knowledge question is retrieved. Reports give top-1, top-2,
wrong top-1 and abstentions for answerable questions, how often retrieval
returned nothing for unanswerable ones, and agreement with the English
question on the same topic.
Reports include a per-intent table for service requests.

`localization_review.py` (M6) writes `reports/m6_localization_review.md`, the
sheet a native-speaker reviewer works through: every Kannada and Hindi
rendering in `app/dialogue/localization_catalog.py`, with its review status.

Every category routes on the same text production routes on: since M5 the
canonical routing text (`text_normalization.routing_text`), before M5
`normalize_banking_terms` alone. The harness picks whichever the engine under
test provides.

For routing fixtures the report also shows the detector's verdict on its own
(the "detector-only" view). The router leaves prefiltered turns to the LLM, but
the same detector decides workflow conflicts mid-task, so its verdict matters
for every sentence.

## Outcomes and severity

| Severity | Outcomes | Meaning |
|---|---|---|
| critical | `wrong_service`, `question_to_workflow`, `intercepted_by_control`, `wrong_amount`, `false_amount`, `wrong_command`, `wrong_choice`, `false_conflict` | The engine did the wrong thing |
| miss | `abstained`, `wrong_non_banking`, `missed_amount`, `missed_command`, `reasked`, `missed_negation`, `false_negation` | The engine did nothing useful; the customer loses a turn, not their request |
| unscored | `llm_gated` | The decision belongs to the LLM, which is not called |

## Fixtures

`fixtures/multilingual_v1.json`. Each fixture has an `id`
(`<category>-<group>-<n>`), a language group, a category, the text, an
`expected` object, an English `gloss`, and a `source`:

| Source | Meaning |
|---|---|
| `audit-3.2B-15` | verbatim from `debugging/test_phase32b15_audit.py` |
| `test-3.2B-12` / `test-3.2B-13` | verbatim from those suites or the phrase tables they test |
| `m0-audit-probe` | from the October 2026 language-core audit probe |
| `m0-new` | written for M0 |

Language groups: `en`, `kn`, `hi` (native words only); `kn-en`, `hi-en` (English
words in Latin script or transliterated, e.g. ಲೋನ್, लोन); `rom-kn`, `rom-hi`
(typed in Latin script). Digits alone do not make a sentence code-mixed.

Expected labels come from what each sentence means, never from what the engine
currently does. Changing a fixture changes the SHA-256 in the report, which
marks the result as a different measurement. Adding fixtures is fine; editing
an existing one should be rare and mentioned in the milestone report.

## Limits

- **Small, hand-authored fixture set.** Results show which behaviours fail, not
  how often customers hit them. Do not quote them as accuracy.
- **No native-speaker review yet** of the Kannada, Hindi and romanised labels.
- **The LLM is not measured.** Prefiltered routing turns are unscored, and the
  LLM's own amount extraction is not covered.
- **Text only.** Speech recognition, including code-mixed ASR, is not exercised
  here; see *Speech recognition (M9)* below.
- **Conflict detection is measured in isolation.** In production it runs only
  after the LLM has classified a mid-workflow turn.
- **Reply language is not scored in M0** (localisation, knowledge-answer
  language, TTS voice). Those belong to the milestones that change them.

## Speech recognition (M9)

`asr_harness.py` measures recognition separately from the text harness:

```bash
# Real speech: the production recogniser over the IndicVoices clips on disk.
# Transcripts are cached in reports/m9_asr_hypotheses.jsonl; a re-run only scores.
venv/Scripts/python.exe -m evaluation.asr_harness --audio --name m9_asr_baseline

# ASR output forms (text): fixtures/asr/m9_asr_forms.json through the production routing
venv/Scripts/python.exe -m evaluation.asr_harness --text --name m9_forms_baseline

# Harness tests (no recogniser, a few seconds)
venv/Scripts/python.exe -m debugging.test_m9_asr
```

**Real speech** reports WER, CER, exact match, recall of English words written
in native script (`LOANWORD_MARKERS`), recall of banking terms, amount
preservation (against the annotated amount, and against the amount parsed from
the reference, which isolates the ASR effect), how often ASR changed the routing
decision, and, for banking clips, routing against the annotated intent. The
split was fixed before any result: banking clips 001-050 per language are DEV,
banking 051-100 and all general clips are HELD-OUT.

What the audio on disk can and cannot show:

- 200 banking clips (100 kn, 100 hi) from IndicVoices' **train** split, which
  IndicConformer was very likely trained on: optimistic.
- 400 general clips (200 kn, 200 hi) from the validation split: not banking.
- **No English audio and no Latin-script code-switching audio.** English and
  Latin code-switching are not measured from speech. "Code-mixed" (`kn-en`,
  `hi-en`) means English words spoken inside Kannada or Hindi, written in native
  script in the reference.
- Read prompts, mostly clean: no counter noise or spontaneous speech.
- Intent annotations are first-pass and not human-verified.

**ASR output forms** are text written to mirror documented recogniser output
(native-script and Latin English, fillers, clipping, number formats, spelling
variants). They are **not recognised audio**. A form that loses what its
reference said carries its own `category` and `expected`. The file is held-out
and its hash is pinned in `debugging/test_m9_asr.py`.

## Routing safety (M10)

```bash
# Production routing decision vs the expected decision (start / clarify / decline / question / refusal)
venv/Scripts/python.exe -m evaluation.m10_routing_eval --name m10_dev_after
venv/Scripts/python.exe -m evaluation.m10_routing_eval --name m10_after_m4 --fixtures evaluation/fixtures/m4_heldout.json

# Real-speech banking clips, reference vs cached ASR transcript, with detector internals
venv/Scripts/python.exe -m evaluation.routing_diagnosis --name m10_diagnosis_after

# Tests
venv/Scripts/python.exe -m debugging.test_m10_routing
```

`fixtures/m10_dev.json` is the M10 **development** set: 133 new sentences, labelled under
`fixtures/M10_LABEL_POLICY.md`, author-labelled and not native-speaker reviewed. Rows marked
`"policy": "pending"` depend on an open team decision (`reports/m10_annotation_review_summary.md`)
and are reported separately. The evaluator scores which reply a no-start gets, so it is stricter
than the M0 harness, which only checks that nothing started. LLM-gated rows are not scored. The
column "gated, would start if handed back" shows what the detector would do if the LLM returned
the turn.
