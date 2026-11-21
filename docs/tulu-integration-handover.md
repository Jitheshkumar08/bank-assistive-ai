# Tulu integration handover

Source: `bank-assistive-ai-tulu-work/` (temporary copy). Target: the teammate's restructured repository.
Paths below are relative to `language_engine/` unless stated otherwise. No Git operation was performed.

## 1. New files: copy as they are

| File | Purpose |
|---|---|
| `app/tulu/__init__.py` | Package marker, `TULU = "tcy"` |
| `app/tulu/data/__init__.py` | Package marker |
| `app/tulu/data/build_dataset.py` | Rebuilds both dataset JSON files from the annotators' docx files and recordings (read-only) |
| `app/tulu/data/deposit_dataset.json` | Deposit dataset: 16 utterances, audio facts and hashes, discrepancies (generated, do not hand-edit) |
| `app/tulu/data/withdrawal_dataset.json` | Withdrawal dataset: 12 utterances, same format, kept separate (generated, do not hand-edit) |
| `app/tulu/data/dataset.py` | Read-only accessors across both datasets; group roles (start/progress) and workflow-neutral pivots |
| `app/tulu/data/loanwords.json` | Kannada-script spellings of English loanwords (pending review) |
| `app/tulu/normalization/__init__.py`, `text.py` | Script detection, language labels, matching keys, Roman↔Kannada transliteration |
| `app/tulu/intent/__init__.py`, `matcher.py` | Verified-utterance matching (deposit + withdraw), verb-consistency and ambiguity rejection → intent and English pivot |
| `app/tulu/translation/__init__.py`, `renderer.py` | English workflow reply → verified Tulu (mapping) |
| `app/tulu/tts/__init__.py`, `synthesizer.py` | Tulu text → newly generated audio (Kannada-trained Edge voice) |
| `app/tulu/asr/__init__.py`, `recognizer.py` | Kannada acoustic model + closed-set matching; refuses when unsure |
| `app/tulu/evaluation/__init__.py`, `asr_eval.py`, `tts_eval.py` | Evaluation scripts |
| `app/tulu/tests/__init__.py`, `test_tulu_offline.py`, `test_tulu_e2e.py` | Offline tests and end-to-end test |
| `service/tulu_routes.py` | Additive `/tulu/*` HTTP routes |
| `app/tulu/data/control_dataset.json` | Conversation-control dataset (C01–C04), built by `build_dataset.py` from `control_statement/` |
| `app/tulu/tests/test_tulu_control_e2e.py` | Control end-to-end test (LLM-free) |
| `../docs/tulu-control-dataset-audit.md` | Control dataset audit |
| `../docs/tulu-dataset-audit.md`, `../docs/tulu-implementation-report.md`, `../docs/tulu-integration-handover.md` | Documentation |

Optional evidence (regenerate rather than copy if preferred): `evaluation/reports/tulu_asr_indicconformer-kn.{json,md}`,
`tulu_tts_eval.{json,md}`, `tulu_tts_listening_sheet.csv`, `tulu_tts_audio/*.mp3`, `tulu_e2e.{json,md}`.

## 2. Modified shared files: apply these hunks (small and additive)

| File | Change |
|---|---|
| `app/dialogue/localization.py` | `localize_detailed()`: `if language == TULU: return _localize_tulu(text)` before the unsupported-language return. New `TULU` constant and `_localize_tulu()` function (verified renderings only; everything else stays English). |
| `app/speech/speech_plan.py` | `SPOKEN_LANGUAGES` gains `"tcy"` (Kannada-script Tulu → Kannada voice; English → English voice). |
| `service/tts.py` | New constants `TULU`, `TULU_VOICE_LANGUAGE = "kn"`. `select_voice()` maps `tcy` to the Kannada voice. In `synthesize()`, for `tcy` the sanitised text goes through `prepare_speech_text()` (Romanized Tulu → Kannada script; English kept). |
| `service/engine.py` | `EngineRuntime.transcribe()`: for `language == "tcy"` it uses the Tulu recogniser and returns the verified transcript, or raises `TranscriptionError(REFUSAL)`. |
| `service/main.py` | Imports (`TULU`, `understand_tulu`, `tulu_router`, `TurnResult`). `app.include_router(tulu_router, dependencies=[Depends(require_known_domain)])`. In `_run_turn()`, Banking with `entry.language == "tcy"` replaces the text with `understand_tulu(text).pivot_en`, or returns the fixed English clarification `TULU_AMBIGUOUS_REPLY` (outcome `clarify`) when the matcher rejects the input as ambiguous. |
| `debugging/test_m8_speech.py` | `tcy` removed from the "session language is refused" loop; new assertion that a Tulu session reads Kannada-script Tulu with the kn voice and English with the en voice (intended contract change). |

No existing route, request or response model changed. College is untouched: its runtime path
(`accepts_context`) returns before the Tulu pivot, and it uses `catalog_localizer`, not `localization`.

## 3. Runtime requirements

- No new Python dependencies. Uses `edge-tts`, `openai-whisper`, `onnx-asr` and `numpy`/`scipy`, which are already installed.
- Edge TTS needs network access, as it already does for en, kn and hi.
- Workflow step completion (all languages) goes through the existing Groq LLM call. With the current key's daily quota
  (200k tokens) exhausted, no workflow advances. Don't run the full e2e test on the day of a demo.
- The Tulu ASR default acoustic model is the cached IndicConformer-kn ONNX model. Override it with `TULU_ASR_ACOUSTIC`.
- The frontend and NestJS need only pass `language: "tcy"` for a Tulu visit (same field as `kn`/`hi`).
  On `/turn/audio` a 422 with the Tulu refusal message means: show a text box and ask the customer to type in Tulu.

## 4. Verify after integration (from `language_engine/`)

```
python -m app.tulu.tests.test_tulu_offline      # offline, no models
python -m app.tulu.tests.test_tulu_e2e          # real engine + Edge TTS
python -m debugging.test_m6_localization
python -m debugging.test_m8_speech
python -m debugging.test_tts_diagnostics
python -m debugging.test_interpreter
python -m debugging.test_college_runtime
python -m debugging.test_college_workflows   # needs docs/domain-integration/ from the full repo
python -m app.tulu.evaluation.asr_eval indicconformer-kn   # one ASR model per run
```

Run these one at a time. On the 7.5 GB development machine, parallel model jobs were killed for low memory.

## 5. Must not be copied or changed

- `deposit conversation/`, `withdraw_conversation/` and `control_statement/` (original recordings and docx files): keep as delivered. `build_dataset.py` reads them only and expects them next to `language_engine/`. If the restructured repo moves them, update `DATASETS[...]["folder"]` in `build_dataset.py` (runtime code uses only the generated JSON, except evaluations and tests, which read the recordings).
- Do not resolve the D04 wording on a developer's judgement. When the native speaker confirms one:
  1. The annotator corrects the docx table row if needed.
  2. In `build_dataset.py`, set the `D04_ASSISTANT_WORDING` status to `resolved`.
  3. Re-run `python -m app.tulu.data.build_dataset` and the tests. Step 4 is then rendered in Tulu automatically.

## 6. Control-statement addendum

- `service/main.py` `_run_turn()`, Tulu branch only:
  - control matches send the engine's own control word (`repeat`/`pause`/`thank you`/`help`) and prefix the group's Tulu acknowledgement (`dataclasses.replace`);
  - low-confidence matches return `TULU_LOW_CONFIDENCE_REPLY` (outcome `clarify`);
  - new imports: `dataclasses`, `control_acknowledgements`.
- `app/tulu/data/dataset.py` (control role and groups C01–C04), `intent/matcher.py` (control, `LOW_CONFIDENCE_FLOOR = 0.65`),
  `translation/renderer.py` (`control_acknowledgements()`), `data/loanwords.json` (added words), `service/tulu_routes.py` (capabilities).
- No change to `app/dialogue/manager.py`.
- Verify: `python -m app.tulu.tests.test_tulu_offline` (127/0) and `python -m app.tulu.tests.test_tulu_control_e2e` (72/0, uses no Groq quota).

## 7. Deterministic step completion (approved shared change)

| File | Change |
|---|---|
| `app/dialogue/manager.py` | Imports `REPORT, classify_clause, split_clauses`. New module constants `WORKFLOW_COMPLETED_REPLY`, `_NUMBER_WORDS`, `_FAST_PATH_BLOCKING_WORDS`, helper `_history_pairs()`. New `DialogueManager._advance_current_step()` (branch 9 body, unchanged) and `_confirmed_completion_without_llm()` (5 gates). New branch 5C in `generate_response()` before the LLM call. Branch 9 now calls `_advance_current_step()`. |
| `app/tulu/data/dataset.py` | D04/W04 pivot → `"I have entered the amount."` |
| `debugging/test_deterministic_completion.py` | New suite (33 checks) |
| `app/tulu/tests/test_tulu_offline.py` | +9 step-specific pivot checks |

Apply the `manager.py` hunks as a unit. In a restructured repo, keep 5C placed after the policy screen and exact answer and before `dialogue_understanding.understand`.

Verify (one at a time):

```
python -m debugging.test_deterministic_completion
python -m debugging.test_phase32b4
python -m debugging.test_service_turn
python -m app.tulu.tests.test_tulu_offline
```

Optional quota-free end-to-end check:

```
GROQ_API_KEY=invalid-key-for-offline-test python -m app.tulu.tests.test_tulu_e2e
GROQ_API_KEY=invalid-key-for-offline-test python -m app.tulu.tests.test_tulu_control_matrix   # 466/0 over 462 situations
```

New file: `app/tulu/tests/test_tulu_control_matrix.py` (every control × every step × active/paused, plus no-workflow, completed, cancelled and cancel-pending states).

**Still to re-run after this change** (memory was too low): control e2e, localization, speech, TTS diagnostics, interpreter, College runtime and workflows.

## 8. Update 2026-11-19 (added data, situational control replies)

**Data:**
- Re-run `python -m app.tulu.data.build_dataset`, or copy the regenerated files: `withdrawal_dataset.json` (20 rows), `control_dataset.json` (27 rows, C01–C06), `loanwords.json` (+`request`).
- `deposit_dataset.json` is unchanged.

**Code:**
- `app/tulu/data/build_dataset.py`: C05/C06 groups and new discrepancies.
- `app/tulu/data/dataset.py`: C05/C06 groups and `CONTROL_REPLY_PLAN`.
- `app/tulu/normalization/text.py`: doubled-nasal fix.
- `service/main.py`: `_current_instruction()` and `_compose_tulu_control_reply()` replace the earlier "prefix the acknowledgement" block. New imports: `tulu_render`, `TULU_CONTROL_REPLY_PLAN`, `WorkflowState`.
- `service/tulu_routes.py`: capabilities.

**Tests:**
- `test_tulu_offline.py` (157 checks) and `test_tulu_control_e2e.py` (108 checks, including the paused-at-step-2 "Next panle" scenario).
- `test_tulu_e2e.py`: withdrawal sequences with the new phrases (271 checks).

**Verify** (one at a time):

```
python -m app.tulu.tests.test_tulu_offline
GROQ_API_KEY=invalid-key-for-offline-test python -m app.tulu.tests.test_tulu_control_e2e
GROQ_API_KEY=invalid-key-for-offline-test python -m app.tulu.tests.test_tulu_e2e
```

## 9. C03 = stop (2026-11-19)

- `build_dataset.py` and `dataset.py`: C03 is `STOP_REQUEST` with pivot `"stop"`. `CONTROL_REPLY_PLAN["C03"]["stop"] = True`.
- `service/main.py` `_compose_tulu_control_reply()`: a stop branch. While a request is open it returns the engine's confirmation question; once cancelled, or when nothing was active, it returns the C03 Tulu reply.
- Rebuild `control_dataset.json` (only the C03 rows' `canonical_control` changed).
- Verify: `GROQ_API_KEY=invalid-key-for-offline-test python -m app.tulu.tests.test_tulu_control_matrix` (466/0).

## 10. Tulu stop / exit (2026-11-19; supersedes §9)

- `service/registry.py`: new defaulted field `SessionEntry.tulu_exit_offered: bool = False` (per visit).
- `service/main.py`: `TULU_EXIT_OFFER` and `_tulu_stop()`. In the Tulu branch of `_run_turn`, the offer is read and cleared every turn, and C03 is routed to `_tulu_stop()`. The C03 branch was removed from `_compose_tulu_control_reply()`.
- Behaviour: 1st stop cancels at once and offers exit; 2nd stop on the next turn exits; anything else clears the offer.
- English and Kannada are unchanged. No dialogue-manager change.
- Verify: `test_tulu_control_matrix` (468/0) and `test_tulu_control_e2e` (108/0), both with `GROQ_API_KEY=invalid-key-for-offline-test`.

## 11. Text-only phrase "yank gothuji" (2026-11-19)

- New file: `app/tulu/data/control_supplement.json` (text-only phrases outside the document). Copy it with the other data files.
- `build_dataset.py` appends it, plus a `TEXT_ONLY_SUPPLEMENT` discrepancy.
- `dataset.py`: `audio_utterances()`. `asr_eval.py`, `tts_eval.py`, `test_tulu_e2e.py` and `test_tulu_control_e2e.py` use it for anything that needs a recording.
- Verify: `test_tulu_offline` (162/0), `test_tulu_control_matrix` (490/0), `test_tulu_control_e2e` (110/0).
