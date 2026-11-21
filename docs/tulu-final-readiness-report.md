# Tulu Language Support — Final Implementation-Readiness Report

**Workspace:** `bank-assistive-ai-tulu-work/` (temporary copy). **Prepared:** 2026-11-17.
**Basis:** the code, dataset JSON files and report files in this workspace. No code, data, configuration or recording was changed to
prepare this report, no tests were run for it, and no Git operation was performed.

Evidence files (under `language_engine/evaluation/reports/` unless stated):
- `tulu_asr_indicconformer-kn.{json,md}`
- `tulu_tts_eval.{json,md}`, `tulu_tts_audio/` (30 MP3), `tulu_tts_listening_sheet.csv`
- `tulu_e2e.{json,md}`, `tulu_control_e2e.{json,md}`
- `docs/tulu-dataset-audit.md`, `docs/tulu-control-dataset-audit.md`, `docs/tulu-implementation-report.md`, `docs/tulu-integration-handover.md`

---

> ### Update 2026-11-19 — supersedes the figures below where they differ
> **New data:** 8 withdrawal phrases and control groups C05 (what next) and C06 (continue). Totals: 48 customer phrases, 63 recordings.
>
> **Situational control replies:** the Tulu reply plus the current step where its meaning requires it (repeat / next / continue / clarify). Example: "Next panle" while deposit is paused at step 2 gives the C05 reply + step 2.
>
> **All previously pending regression suites have now been run after the deterministic-completion change:**
> - Localization 93/0, speech 69/0, TTS diagnostics 59/0, interpreter 38/0.
> - **College runtime 130/0**, College workflows 169/2 (same missing-document artifact).
>
> **Current results:**
> - Tulu offline 157/0.
> - Control e2e **108/0** (0 LLM calls).
> - **Full Tulu e2e 271/0** with Groq unavailable.
> - ASR 29/48 correct, **0/48 false acceptances**.
>
> **Still not run:** Whisper-small (1,018 MB free), e2e with a working Groq key, the TTS proxy for the new sentences, native listening, NestJS/frontend.
>
> Details: `docs/tulu-implementation-report.md` §13. Controls not implemented: PREVIOUS_STEP only.

---

## Readiness verdict

| Area | Status |
|---|---|
| Typed Tulu: deposit, withdrawal, 4 controls | **Working and tested** (most recent full run 192/0) |
| Spoken Tulu | **Partial.** Closed-set only; about 60% of verified phrases recognised, the rest fall back to typing; 0 false acceptances measured |
| Assistant voice | **Working.** Fresh Edge TTS from text. Kannada-trained voice reading Tulu, **not native Tulu TTS** |
| Groq dependency | **Reduced.** Tulu deposit and withdrawal complete with Groq unavailable |
| Language data | **Not native-speaker verified** in several places (§8) |
| Regression after the last change | **Incomplete.** Seven suites not re-run because of low memory (§7) |

**Ready for integration as a demonstrable, honestly labelled prototype, on two conditions:** the pending regression suites (§7.3) must be
run in the restructured repository, and the native-speaker items (§8) must be resolved before the language is presented as verified.

---

## 1. Architecture and complete request flow

Tulu (`tcy`) is a **language layer** inside the shared language engine. It has no Tulu workflow, intent detector or dialogue manager.

```
TEXT   POST /turn {language:"tcy", text}
AUDIO  POST /turn/audio (language=tcy)
        └─ service/engine.py EngineRuntime.transcribe(tcy)
             └─ app/tulu/asr/recognizer.py: IndicConformer-kn (acoustic) → transliterate to Roman
                → closed-set match. Accepted → verified Romanized phrase. Else 422
                "Tulu speech could not be recognised reliably. Please type your request in Tulu…"
                ▼
service/main.py _run_turn  (Banking runtime only; College returns earlier via accepts_context)
  └─ app/tulu/intent/matcher.understand(text):
       verified START phrase   → English pivot ("I want to withdraw money.")  → existing intent detector
       verified PROGRESS phrase → step-specific pivot ("I have entered the amount.")
       verified CONTROL phrase  → engine control word ("repeat" | "pause" | "thank you" | "help")
                                   + the group's Tulu acknowledgement prefixed to the reply
       ambiguous / low confidence → fixed English clarification (no workflow change, no LLM)
       anything else            → passed to the engine unchanged (unverified)
                ▼
EXISTING ENGINE  EngineRuntime.run_turn → detect_control (deterministic control tier)
  → DialogueManager.generate_response
       5B policy screen, exact answer
       5C NEW: confirmed completion → advance WITHOUT Groq   (app/dialogue/manager.py)
       6  Groq dialogue understanding (only when 5C does not apply)
       9  resolver + LLM completion (unchanged)
  → deposit.json / withdraw.json (existing workflows)
                ▼  canonical English reply
ResponseLocalizer → localize_detailed("tcy") → app/tulu/translation/renderer.py
  verified rendering → Kannada-script Tulu; everything else stays English
                ▼
POST /tts {language:"tcy"} → service/tts.synthesize → prepare_speech_text → speech_plan
  Kannada-script Tulu → kn-IN-SapnaNeural; English → en-IN-NeerjaNeural → NEW MP3 (Edge TTS)
```

Additive routes (same domain authentication as `/tts`): `GET /tulu/capabilities`, `POST /tulu/normalize`, `/tulu/understand`,
`/tulu/translate`, `/tulu/tts`, `/tulu/asr`. No existing route, request model or response model changed.

---

## 2. Implemented functionality

### Datasets (each a separate generated JSON file; originals untouched)

| Dataset | Source folder | Customer | Assistant | Speech | Workflow |
|---|---|---|---|---|---|
| `deposit_dataset.json` | `deposit conversation/` | 12 | 4 | assistant ≈15 s | `deposit.json` (4 steps) |
| `withdrawal_dataset.json` | `withdraw_conversation/` | 7 | 5 | ≈23 s total | `withdraw.json` (5 steps) |
| `control_dataset.json` | `control_statement/` | 15 | 4 | ≈36 s total | — (conversation control) |

### Deposit (intent `deposit` → engine `deposit money`)
- 3 start phrases (D01a–c) and 9 progress phrases.
- Tulu replies are verified for **steps 1–3**. **Step 4 is answered in English**, because its D04 wording is disputed (two versions are kept).

### Withdrawal (intent `withdraw` → engine `withdraw money`)
- 3 start phrases (W01a–c) and 4 progress phrases.
- Tulu replies for **all 5 steps**.
- "Fill in your account number." is rendered identically by D02 and W02, so there is no conflict.

### Conversation control (control dataset)

| Canonical | Group | Engine action (existing, deterministic) | Mapping |
|---|---|---|---|
| REPEAT_STEP | C01 (4) | `repeat` | clear |
| PAUSE_WORKFLOW | C02 (5) | `pause` | clear |
| DECLINE_FURTHER_HELP | C03 (3) | `thanks` (non-destructive) | **uncertain** |
| CLARIFY_CURRENT_STEP | C04 (3) | `help` | clear |

- **Not implemented** (no Tulu data): NEXT_STEP, PREVIOUS_STEP, RESUME_WORKFLOW. The engine has no "previous" command at all.
- After pausing, resuming requires English "resume"/"continue".

### Safety rules (asserted in the offline tests)
- Control phrases never carry a service intent.
- A control match that contains a service verb is rejected.
- A start phrase containing the other service's verb is rejected (e.g. "Yank duddu deppere undu?").
- C02d "…continue malporchi" (*don't continue*) pauses and never resumes.
- Progress pivots are workflow-neutral and **confirmed only at their own step**.

### Other intents
Loan, balance enquiry and account opening have no verified Tulu, so their replies stay English. Money transfer and passbook update do not exist as engine workflows.

---

## 3. Typed and spoken Tulu

| | Typed | Spoken |
|---|---|---|
| Input | Romanized Tulu (authoritative) or Kannada-script Tulu | Recording → IndicConformer-kn → closed-set match |
| Coverage | 34 verified customer phrases, plus verb cues for start phrases | The same 34 phrases only |
| Unknown or unclear input | Near-miss (0.65–0.80): "please say again or type"; other text passes to the engine as unverified | Refused (422) → frontend should offer typing |
| Generalisation | Exact and near-exact phrases plus the deposit/withdraw verbs | **None demonstrated:** leave-one-out 2/34 |

Limitations:
- This is **matching, not Tulu NLU or open-vocabulary ASR**.
- Language labels are evidence-based: Kannada-script text with no verified Tulu word is labelled `kn-or-unknown`, never Tulu.

---

## 4. ASR evaluation

From `tulu_asr_indicconformer-kn.json`: 47 recordings, 34 of them customer.

| Dataset | Correct phrase | False acceptance | Rejected |
|---|---|---|---|
| Deposit (12) | 10 | 0 | 2 |
| Withdrawal (7) | 3 | 0 | 4 (all three W01 start phrases) |
| Control (15) | 8 | 0 | 7 |
| **Total (34)** | **21** | **0** | **13** |

- Mean CER (phonetic keys) is 0.265 for customer recordings and 0.282 for all.
- Leave-one-out: 2/34 correct meaning, 0 false acceptances.
- Latency: mean 2.13 s, max 3.68 s per clip. Process peak about 400 MB.
- **Caveat:** this run predates the D04/W04 pivot change. That change merges two meanings, so it can only reduce ambiguity rejections; it was not re-measured.
- In the most recent full e2e, 22 of 31 audio turns were recognised from speech; the control e2e recognised 8 of 15 spoken controls.

**Whisper-small (kn, temperature 0): NOT RUN.** Free RAM was 373 MB and later 1,039 MB, against an estimated 1–1.5 GB need.
Command: `python -m app.tulu.evaluation.asr_eval whisper-small-kn`. Earlier exploratory evidence (Whisper-small kn with default retries) returned empty output for 3 of 4 deposit assistant clips.

No ASR or TTS model was trained. Measured speech is deposit assistant ≈15 s (deposit customer speech not separately
measured; 87.7 s of deposit file time), withdrawal ≈23 s and control ≈36 s. That is far below any training threshold.

---

## 5. TTS and evidence of fresh audio

**Implementation.**
- Romanized Tulu → deterministic Kannada-script transliteration (`app/tulu/normalization/text.py`, loanwords from `loanwords.json`).
- Then Edge TTS `kn-IN-SapnaNeural`. Any English in the same reply is read by `en-IN-NeerjaNeural`.
- Disclosure header `X-Tulu-Disclosure: Kannada-trained neural voice synthesizing Tulu text written in Kannada script; not a native Tulu TTS model.`
- No voice cloning (consent not documented).

**Evidence**

| Source | Result |
|---|---|
| `tulu_tts_eval.json` (deposit + withdrawal sentences + 2 disputed D04; predates the control set) | 30 files generated; **0 SHA-256 matches** with any recording; max waveform cross-correlation vs any recording **0.346** (identical = 1.0) |
| `tulu_e2e.json` (after the latest change) | Every `/tts` reply 200 `audio/mpeg`, not a dataset recording |
| `tulu_control_e2e.json` | Every control reply synthesized fresh; xcorr vs input recording 0.05–0.13 |
| Offline tests | The synthesizer opens no dataset file; output is the generator's new audio |
| Machine-intelligibility proxy (Kannada ASR round trip, CER) | Generated 0.348 vs native speakers 0.273 over 28 sentences; 0.355 for the 8 product responses. **A proxy only, not a Tulu intelligibility score.** |

**Native listening evaluation: NOT DONE.** The sheet is prepared.

---

## 6. Deterministic step completion and Groq dependency

**Change.** `app/dialogue/manager.py` (approved). Branch 5C advances one step **without Groq** only if:
1. `resolve_step_completion` returns True;
2. every clause is a report;
3. there is no amount or number;
4. there is no control word or joiner;
5. the message is not a verbatim repeat.

Otherwise the existing Groq path runs unchanged. The advancement body is shared, so there is still exactly one increment per turn.

**Effect**

| Evidence | Before | After |
|---|---|---|
| Full Tulu e2e | 178 passed / 14 failed (Groq daily quota exhausted mid-run) | **192 / 0 with Groq deliberately unavailable** (process-only invalid key, zero quota) |
| Audio-turn latency | 22–36 s on completion turns | max 3.83 s, mean 2.06 s |
| Banking dialogue-manager suites | 2,360 / 0 | 2,360 / 0 |

**Still needs Groq:**
- turns the resolver cannot confirm (anything that isn't a plain report of the current step);
- compound "done + question" turns;
- amounts given as words;
- knowledge questions;
- all Kannada and Hindi completion turns (the resolver returns None for non-English text).

---

## 7. Test results

### 7.1 Passed (most recent run of each)

| Suite | Result | When |
|---|---|---|
| `app.tulu.tests.test_tulu_offline` | **136 / 0** | after the deterministic change |
| `debugging.test_deterministic_completion` (new) | **33 / 0** | after |
| Banking dialogue manager: 32b1 (478), 32b1 control routing (223), 32b2 (407), 32b3 (148), 32b4 (264), 32b12 (117), 32b13 (69), 32b14 (360), 32b15 audit (73), LLM cancel confirmation (84), service turn (137) | **2,360 / 0** | after (identical to the baseline) |
| `app.tulu.tests.test_tulu_e2e` (Groq unavailable) | **192 / 0** | after |
| `app.tulu.tests.test_tulu_control_e2e` | **72 / 0**, 0 LLM calls | **before** the deterministic change |
| Localization `test_m6_localization` | 93 / 0 | before |
| Speech `test_m8_speech` | 69 / 0 (one intended test edit: `tcy` is now speakable) | before |
| TTS diagnostics `test_tts_diagnostics` | 59 / 0 | before |
| Interpreter `test_interpreter` | 38 / 0 | before |
| College runtime `test_college_runtime` | 130 / 0 | before |
| ASR eval, IndicConformer-kn | 21/34 correct, 0 false acceptances | before (pivot change) |
| TTS eval | 30 generated, 0 identical | before (control set) |

### 7.2 Failed

| Suite | Result | Cause |
|---|---|---|
| College workflows `test_college_workflows` | 169 passed / **2 failed** (before the deterministic change) | Both checks read `docs/domain-integration/05-kannada-review-cases.md`, which exists in the original repository but not in this partial copy. Workspace artifact; College code not modified. **Must be confirmed in the full repo.** |
| *Superseded:* full Tulu e2e with real Groq | 178 / 14 | Groq daily token quota exhausted (429); fixed by the deterministic change (now 192/0) |

### 7.3 Not run

| Item | Reason |
|---|---|
| After the deterministic change: control e2e, localization, speech, TTS diagnostics, interpreter, **College runtime, College workflows** | Free RAM 128–400 MB, taken up by other applications; the guards stopped each run cleanly |
| Whisper-small ASR evaluation | Insufficient RAM |
| Full Tulu e2e with a **working** Groq key after the change | Deliberately not run (quota) |
| `debugging.test_dialogue_understanding` | Calls live Groq (quota) |
| Other `debugging/` suites not listed above (e.g. phase25/31/32, m1/m3/m4/m5/m7, knowledge suites) | Not part of this work's validation; not run |
| NestJS backend and React frontend with `language: "tcy"` | Not available in this workspace |
| Native-speaker listening test | No native listener available |

---

## 8. Native-speaker verification still required

None of the following may be presented as verified until confirmed:

1. **Withdrawal dataset:** the document does not state native-speaker verification.
2. **Control dataset:** verification not stated; its English meanings are "working glosses".
3. **D04 assistant wording:** two conflicting versions; step 4 is in English until one is confirmed.
4. **D03 (deposit)** uses *deppere* (the withdrawal verb elsewhere) and is almost identical to W03. Is it correct for deposit?
5. **C03 mapping:** "stop the conversation" vs "decline further help". Implemented as the non-destructive `thanks`.
6. **C03 assistant reply:** the word "oik" is unclear.
7. **W01b** "kaas/amount": which word is in the recording?
8. **Spelling variants:** Bokka/Boka, Yank/Yenk/Yan/Yaan, eth/yeth/Eth.
9. **All Kannada-script forms** (machine transliteration), e.g. *dada* → ದಡ.
10. **Kannada-voice pronunciation** of Tulu (listening sheet).
11. **Workflow-neutral English pivots** for progress groups. They follow the document headings; D04 now pivots to "I have entered the amount." based on D04b/D04c.

---

## 9. Files to transfer into the restructured `language_engine/`

### New (copy as is)

```
app/tulu/__init__.py
app/tulu/data/__init__.py
app/tulu/data/build_dataset.py
app/tulu/data/dataset.py
app/tulu/data/deposit_dataset.json
app/tulu/data/withdrawal_dataset.json
app/tulu/data/control_dataset.json
app/tulu/data/loanwords.json
app/tulu/normalization/__init__.py
app/tulu/normalization/text.py
app/tulu/intent/__init__.py
app/tulu/intent/matcher.py
app/tulu/translation/__init__.py
app/tulu/translation/renderer.py
app/tulu/tts/__init__.py
app/tulu/tts/synthesizer.py
app/tulu/asr/__init__.py
app/tulu/asr/recognizer.py
app/tulu/evaluation/__init__.py
app/tulu/evaluation/asr_eval.py
app/tulu/evaluation/tts_eval.py
app/tulu/tests/__init__.py
app/tulu/tests/test_tulu_offline.py
app/tulu/tests/test_tulu_e2e.py
app/tulu/tests/test_tulu_control_e2e.py
service/tulu_routes.py
debugging/test_deterministic_completion.py
```

### Modified shared files (apply the hunks; see `docs/tulu-integration-handover.md` §2, §6, §7)

| File | Change |
|---|---|
| `app/dialogue/localization.py` | `tcy` → `_localize_tulu()` (verified renderings only) |
| `app/speech/speech_plan.py` | `"tcy"` added to `SPOKEN_LANGUAGES` |
| `service/tts.py` | `TULU`, `TULU_VOICE_LANGUAGE="kn"`; `select_voice` maps tcy→kn; `prepare_speech_text` for tcy |
| `service/engine.py` | `transcribe(language="tcy")` → Tulu recogniser (accept or `TranscriptionError`) |
| `service/main.py` | imports (`dataclasses`, `TULU`, `understand_tulu`, `tulu_control_acknowledgements`, `tulu_router`, `TurnResult`); `include_router(tulu_router, …)`; Tulu branch in `_run_turn`; `TULU_AMBIGUOUS_REPLY`, `TULU_LOW_CONFIDENCE_REPLY` |
| `app/dialogue/manager.py` | Deterministic completion: imports, constants, `_history_pairs`, `_advance_current_step`, `_confirmed_completion_without_llm`, branch 5C; branch 9 calls the helper |
| `debugging/test_m8_speech.py` | `tcy` moved from "refused" to "speakable via Kannada voice" |

### Documentation

`docs/tulu-dataset-audit.md`, `docs/tulu-control-dataset-audit.md`, `docs/tulu-implementation-report.md`,
`docs/tulu-integration-handover.md`, `docs/tulu-final-readiness-report.md`.

### Data folders (needed only to rebuild datasets and run evaluations or e2e tests; not at runtime)

`deposit conversation/`, `withdraw_conversation/`, `control_statement/`. Keep them as delivered. `build_dataset.py` expects them next to
`language_engine/`; if moved, update the `folder` values in `build_dataset.py`.

Optional evidence: `evaluation/reports/tulu_*` and `tulu_tts_audio/`. Regenerate rather than copy if preferred.

---

## 10. Dependencies, environment and startup

- **New Python dependencies: none.** Uses packages already in the venv: `edge-tts 7.3.1`, `openai-whisper`, `numpy`, `scipy`, `fastapi`,
  `onnx-asr 0.12.0`, `onnxruntime 1.30.0`.
- **Risk:** `onnx-asr` and `onnxruntime` are **not listed in `requirements.txt`**, although the existing IndicConformer provider and the Tulu ASR need them. A fresh install from `requirements.txt` would break Tulu speech input.
- **System:** `ffmpeg`/`ffprobe` on PATH (decoding uploads; dataset building).
- **Models:** the IndicConformer-kn ONNX model must be in the Hugging Face cache (`OpenVoiceOS/ai4bharat-indicconformer-kn-onnx`, about 138 MB int8), or downloadable on first use.
- **Network:** Edge TTS (cloud) for all speech, and Groq for the turns in §6 that still need it.
- **Environment variables** (names only):
  - Existing: `GROQ_API_KEY`, `AI_ENGINE_TOKEN`, `AI_ENGINE_COLLEGE_TOKEN`, `AI_ENGINE_ENV`, `MAX_AUDIO_BYTES`, `ASR_*`, `PYTHONIOENCODING`.
  - New and optional: `TULU_ASR_ACOUSTIC` (`indicconformer-kn` default | `whisper-small-kn`).
  - A real environment variable overrides `.env` (`service/config.py`).
- **Startup:** from `language_engine/`, run `uvicorn service.main:app`. NestJS and the frontend need only send `language: "tcy"` for a Tulu visit. On a 422 from `/turn/audio` with the Tulu refusal, show a text box.
- **Memory:** engine plus Tulu ASR peaked at about 0.7–1.0 GB per process in the e2e runs. On the 7.5 GB development machine, model jobs must run one at a time.
- **Windows console:** run test suites with `PYTHONIOENCODING=utf-8`, or several existing suites crash printing Kannada.

---

## 11. Known risks, limitations and unresolved issues

1. The voice is Kannada-trained, not native Tulu. Pronunciation is unverified by listeners.
2. ASR is closed-set with about 40% refusals. It cannot recognise new phrasings.
3. Language data is unverified in places (§8). Deposit D03 may carry the wrong verb; deposit step 4 is in English.
4. Regression after the last change is incomplete (§7.3), **including College**. College uses `domain_runner`, not `DialogueManager.generate_response`, so the change should not reach it, but that is not yet test-confirmed.
5. The College-workflow failures (2) depend on a document missing from this copy.
6. `onnx-asr`/`onnxruntime` are missing from `requirements.txt`.
7. **Groq is still required** for non-confirmable turns. One full e2e run with a working key used almost a whole day's quota (200k tokens) before the change. Do not run it on demo day.
8. **Duplicate requests:** the fast path refuses verbatim repeats, but the existing branch 9 (unchanged) still treats a repeated confirmed report as new. True idempotency needs a request id from NestJS.
9. **C01 promises slower speech;** the TTS does not slow down.
10. **Tulu pause works, but resuming** requires English ("resume"/"continue"). There is no Tulu NEXT, PREVIOUS or RESUME.
11. **Replies mix Tulu and English:** a Tulu acknowledgement or instruction plus English engine text where no verified Tulu exists. Honest, but mixed.
12. **Edge TTS depends on an external cloud service;** there is no offline speech fallback.
13. **The ambiguity and low-confidence replies are English;** no verified Tulu exists for them.
14. **Thresholds** (0.80 match, 0.05 margin, 0.65 low-confidence floor) were fixed a priori and evaluated only on the dataset's own recordings. There are no held-out speakers.

---

## 12. Integration and post-integration testing plan

Run every step **one process at a time**, with `PYTHONIOENCODING=utf-8`, from `language_engine/`, and check free RAM before model-loading steps.

### A. Prepare

1. In the restructured repository (teammate-managed Git), confirm `deposit.json` and `withdraw.json` instructions are unchanged. `build_dataset.py` refuses to build if a document and its workflow differ.
2. Add `onnx-asr==0.12.0` and `onnxruntime==1.30.0` to `requirements.txt` (team decision), or confirm they are installed.
3. Confirm `ffmpeg` is on PATH and the IndicConformer-kn model is cached.

### B. Transfer

4. Copy the new files (§9). Apply the shared-file hunks as units, especially the `manager.py` deterministic-completion block (5C must stay after the policy screen and exact answer, and before `dialogue_understanding.understand`).
5. Optional: copy the three data folders next to `language_engine/` and run `python -m app.tulu.data.build_dataset`. The output must be byte-identical to the transferred JSON files.

### C. Offline verification (no models, no Groq)

```
python -m app.tulu.tests.test_tulu_offline           # expect 136 / 0
python -m debugging.test_deterministic_completion    # expect 33 / 0
python -m debugging.test_m6_localization             # expect 93 / 0
python -m debugging.test_m8_speech                   # expect 69 / 0
python -m debugging.test_phase32b4                   # expect 264 / 0
```

### D. Banking regression

```
python -m debugging.test_phase32b1
python -m debugging.test_phase32b1_control_routing
python -m debugging.test_phase32b2
python -m debugging.test_phase32b3
python -m debugging.test_phase32b12
python -m debugging.test_phase32b13
python -m debugging.test_phase32b14
python -m debugging.test_phase32b15_audit
python -m debugging.test_llm_cancel_confirmation
python -m debugging.test_service_turn
python -m debugging.test_tts_diagnostics
python -m debugging.test_interpreter
```

Expected totals: the 2,360 dialogue-manager checks with 0 failures, plus TTS diagnostics 59/0 and interpreter 38/0.

### E. College regression (required; not yet run after the last change)

```
python -m debugging.test_college_runtime       # expect 130 / 0, incl. "Tulu is not claimed"
python -m debugging.test_college_workflows     # 169 / 2 here (missing doc); 0 failures expected in the full repo (inference, not yet observed)
```

Investigate any other failure before proceeding.

### F. Tulu end-to-end (models; Groq not needed)

```
python -m app.tulu.tests.test_tulu_control_e2e                                    # expect 72 / 0, 0 LLM calls
GROQ_API_KEY=invalid-key-for-offline-test python -m app.tulu.tests.test_tulu_e2e  # expect 192 / 0
```

The invalid key applies to that one process only, uses no quota, and does not touch `.env`.

### G. Through NestJS and the frontend (not yet tested anywhere)

1. Start a Banking visit with `language: "tcy"`.
2. Type "Yenk kaas deppere undu?" and walk withdrawal steps 1–5 with W02a, W03a, W03b and W04a. Expect Tulu replies and fresh audio.
3. Repeat for deposit with D01a, D02a, D03a and D04a. Step 4 is expected in English.
4. Record a verified phrase in the browser (WebM/Opus). Expect acceptance or the 422 refusal; on 422 the UI must offer typing.
5. Try the controls "Kuda panoli ya", "Churu wait malpule", "Yenk artha ayiji" and "Eth aav ." in both workflows.
6. Run a College visit with `language: "tcy"`. Expect English answers, not presented as Tulu.

### H. Optional, when resources allow

1. Whisper-small evaluation with ≥1.5 GB free RAM: `python -m app.tulu.evaluation.asr_eval whisper-small-kn`.
2. One full e2e with a **working** Groq key, after a quota reset and not on demo day.
3. A native-speaker listening session using `tulu_tts_listening_sheet.csv`, plus resolution of the §8 items. Then rebuild the datasets and re-run §C and §F.
