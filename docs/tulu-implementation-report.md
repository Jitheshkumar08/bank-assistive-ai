# Tulu Language Support — Implementation Report

Project: Multimodal Assistive AI System for Context-Aware Guidance. Workspace: `bank-assistive-ai-tulu-work/` (temporary copy).
Date: 2026-11-17. Original repository untouched; no Git operations performed.

All numbers below come from runs executed in this workspace. Reports live in
`language_engine/evaluation/reports/tulu_*`. Where something was **not run**, it says so.

---

## 1. Summary

| Capability | Status | Method |
|---|---|---|
| Supported intents | **deposit** (`deposit money`), **withdraw** (`withdraw money`) | Existing engine intents and workflows, reused |
| Tulu text input | Working | Normalization + closed-set matching to 19 verified utterances → English pivot |
| Tulu speech input | Partial (closed set) | IndicConformer-kn acoustic model + closed-set matching; refuses when unsure, and the customer types instead |
| Tulu translation | Deposit steps 1–3, withdrawal steps 1–5 | **Mapping-based** from verified native-speaker sentences (not neural MT) |
| Tulu speech output | Working | **Kannada-trained Edge neural voice synthesizing Tulu text** (Kannada script). Not native Tulu TTS. |
| Other intents (loan, balance, account opening) | English fallback | No verified Tulu exists |

Every assistant response is **synthesized fresh from text**. No original recording is ever played, concatenated or returned.

---

## 2. Architecture

```
Tulu audio ──/turn/audio──► EngineRuntime.transcribe(tcy)
                              └─ app/tulu/asr: IndicConformer-kn → Roman → closed-set match
                                 accepted → verified Romanized utterance | refused → 422 "please type in Tulu"
Tulu text  ──/turn─────────► service/main._run_turn (Banking, language tcy)
                              └─ app/tulu/intent.understand → English pivot (or ambiguity rejection)
                                 ▼
                     EXISTING engine: normalize → intent detector → dialogue manager → deposit.json / withdraw.json
                                 ▼ canonical English reply
                     ResponseLocalizer → localize_detailed(tcy) → app/tulu/translation (verified renderings only)
                                 ▼ Kannada-script Tulu (+ English for anything unverified)
/tts (language tcy) ─► service/tts.synthesize → speech_plan: Kannada script → kn-IN-SapnaNeural, Latin → en-IN-NeerjaNeural
                                 ▼
                     NEW MP3 audio (Edge TTS)
```

There are no Tulu-specific workflows, intent detector or dialogue manager. Tulu is a language layer at the
input boundary (pivot) and the output boundary (rendering and speech).

### Module layout (`language_engine/app/tulu/`)

| Module | Role |
|---|---|
| `data/` | `deposit_dataset.json`, `withdrawal_dataset.json` (separate files, generated from the docx by `build_dataset.py`), `loanwords.json`, `dataset.py` accessors |
| `normalization/text.py` | Script detection; labels `tcy-Latn` / `tcy-Knda` / `kn-or-unknown` / `en` (Tulu claimed only with verified-word evidence); matching keys; Roman↔Kannada transliteration |
| `intent/matcher.py` | Closed-set matching, verb cues, ambiguity rejection, English pivot |
| `translation/renderer.py` | English instruction → verified Tulu; conflict and dispute handling |
| `tts/synthesizer.py` | Text → new audio; Romanized → Kannada script front end |
| `asr/recognizer.py` | Acoustic model + matcher; accept or refuse |
| `evaluation/` | `asr_eval.py`, `tts_eval.py` |
| `tests/` | `test_tulu_offline.py`, `test_tulu_e2e.py` |

---

## 3. Datasets

Originals are untouched. The offline tests verify every recording's SHA-256 against the value recorded at build time.

| | Deposit | Withdrawal |
|---|---|---|
| Folder | `deposit conversation/` | `withdraw_conversation/` |
| Sentences | 16 (12 customer, 4 assistant) | 12 (7 customer, 5 assistant) |
| Recordings | 16 (13 WAV PCM16 dual-mono stereo, 3 AAC named `*.wav.m4a`) | 12 (WAV PCM **24-bit mono**, named `*.wav.wav`, mixed case) |
| Sample rate | 48 kHz | 48 kHz |
| File duration | 87.7 s | 112.5 s |
| Speech (measured) | assistant ≈15.0 s | ≈23.4 s total, assistant ≈9.0 s (≈4 s leading silence per file) |
| Speaker (median F0) | 102–117 Hz | 199–229 Hz: **very likely a different speaker** |
| Quality | Hard noise gate (24–61% zero samples); energy >8 kHz at −55 to −76 dB (heavily processed) | Heavier gating (55–73% zero); natural bandwidth (>8 kHz at −22 to −39 dB) |
| Workflow | `deposit.json` (4 steps), checked equal to the document | `withdraw.json` (5 steps), checked equal to the document |
| Text-only examples | none | none |
| Native-speaker verification | Treated as authoritative (team instruction) | Document "Final" with a user correction noted; **verification not explicitly stated, to be confirmed** |
| Voice-use consent | Not documented: no cloning | Not documented: no cloning |

Several phrasings for one service: deposit has D01a/b/c and withdrawal has W01a/b/c ("I want to withdraw money", "…from my account", "…from the bank"). All map to the same intent.

### Discrepancies (documented in the JSON, not corrected)

| ID | Dataset | Issue | Effect |
|---|---|---|---|
| D04_ASSISTANT_WORDING | deposit | Two conflicting D04 wordings (table vs notes) | Step 4 answered in English until confirmed |
| D03_DEPPERE_IN_DEPOSIT | deposit | D03 "Bokka eth amount **deppere** undu aven barele" (glossed *deposit*) ≈ W03 (glossed *withdraw*); *deppere* is the withdrawal verb in W01a–c | Kept as annotated; **high-priority native check** |
| SPELLING_BOKKA_BOKA, SPELLING_YANK_YAN_YAAN | deposit | Spelling variants | Kept |
| D04C_STEP_MAPPING | deposit | A note maps a near-identical sentence to D03 | Table placement used |
| AAC_FILES_NAMED_WAV | deposit | D01a–c are AAC | Decoded with ffmpeg |
| NATIVE_SPEAKER_VERIFICATION_NOT_STATED | withdrawal | Not explicit in the document | To confirm |
| FILENAMES_DIFFER_FROM_DOCUMENT | withdrawal | `W01a_Customer.wav.wav` vs `W01a_CUSTOMER.wav`, etc. | Case-insensitive match |
| W01B_ALTERNATIVE_WORDS | withdrawal | "kaas/amount" written as alternatives | Kept verbatim |
| CUSTOMER_IDS_VS_STEPS | withdrawal | W03b → step W04, W04a → step W05 (notes confirm) | Grouped by table |
| SPELLING_YENK_YANK_ETH_YETH | both | Variants | Kept |

### TTS training feasibility

**Not feasible.** About 24 s of assistant speech from two speakers is far below any fine-tuning threshold (≥30–60 min),
and no consent for voice cloning is documented. See `docs/tulu-dataset-audit.md`.

---

## 4. Methods

### 4.1 Normalization
- The authoritative Romanized text is never changed. Matching uses separate phonetic keys (doubled letters folded, aspiration/`h` folded, etc.).
- Romanized → Kannada script follows the annotator's spelling literally: doubled vowels are long; `th`/`dh` dental; single `t`/`d` dental word-initially and retroflex inside a word; nasal before a stop becomes anusvara.
- Suffix tokens (`n`, `d`, `dh`, `g`, including `slip-g`) are joined to the preceding word. English loanwords come from `loanwords.json`.
- **All Kannada-script output is pending native review.**

### 4.2 Intent detection: closed-set matching (not a trained model)
- **Bank:** 19 verified customer utterances from both datasets.
- **Accept:** best similarity ≥ **0.80**, with no utterance of a *different meaning* within **0.05**. Both values were fixed before evaluation.
- **Start phrases** (D01, W01) carry the intent `deposit` or `withdraw`.
- **Progress phrases** carry no intent and use **workflow-neutral pivots** ("I have taken the slip.", "I have filled in the account number.", "I have completed the slip.", "I have filled in the amount.", "I have signed the slip."). A deposit-set phrase therefore cannot steer a withdrawal visit.
- **Verb consistency:** if a start phrase matches but the input contains the other service's verb (*padare/padodu/deposit* vs *deppere/withdraw*), the input is **rejected as ambiguous**. This rule was added after a probe ("Yank duddu deppere undu?") was falsely accepted as deposit at 0.857.
- **Verified verb cue** (Tulu text only): one service's verb → that service; both → reject.
- **Anything else** → `unverified_passthrough` (not accepted as Tulu; the engine may still act on English loanwords and replies in English).
- **Ambiguous** → a fixed English clarification. Workflow and history are untouched.

### 4.3 Translation: mapping-based
- English instruction → verified assistant sentence of the same workflow step.
- "Fill in your account number." is rendered identically by D02 and W02, so there is no conflict. Instructions rendered differently across datasets would be refused automatically.
- Sentences without a verified rendering stay **English**, unchanged.

### 4.4 Speech synthesis
- Edge TTS `kn-IN-SapnaNeural` reads Kannada-script Tulu, and `en-IN-NeerjaNeural` reads any English fallback in the same reply.
- `/tulu/tts` responses carry `X-Tulu-Disclosure: Kannada-trained neural voice synthesizing Tulu text written in Kannada script; not a native Tulu TTS model.`

### 4.5 Speech recognition
- No ASR model supports Tulu: Whisper has no `tcy`, the IndicConformer family has no Tulu model, MMS has no `tcy` adapter, and the only reported Tulu model (SraVaani, 57.3% WER) is gated.
- Production uses the cached **IndicConformer-kn** (int8 ONNX, 138 MB) as an acoustic front end plus the closed-set matcher. It accepts only verified matches and otherwise asks the customer to type.

---

## 5. Results

### 5.1 Offline tests (`python -m app.tulu.tests.test_tulu_offline`)

**89 passed, 0 failed.** This is the original 56 plus 33 new withdrawal tests: dataset separation and preservation, every withdrawal phrase, the three W01 phrasings → `withdraw`, deposit/withdrawal distinction, ambiguity and unsupported rejection, translation coverage, and TTS from translated text.

Changed tests: the 12 deposit-understanding assertions now expect intent only for start phrases (D01) and `None` for progress phrases, by design (§4.2).

### 5.2 ASR (`evaluation/reports/tulu_asr_indicconformer-kn.{json,md}`)

**IndicConformer-kn**, 28 recordings (19 customer):

| | Correct phrase | Correct meaning (other phrase) | **False acceptance** | Rejected (→ type) |
|---|---|---|---|---|
| Deposit (12) | 10 | 0 | **0** | 2 |
| Withdrawal (7) | 3 | 0 | **0** | 4 (all three W01 start phrases among them) |
| **Total (19)** | **13** | 0 | **0** | 6 |

- Mean CER on phonetic keys: 0.24 for customer recordings, 0.273 for all recordings. No empty outputs, no errors.
- **Leave-one-out** (own sentence removed): 2/19 correct meaning, **0 false acceptances**, 17 rejected. This only recognises verified phrases; it **does not generalise to new phrasings**.
- Latency: mean 3.8 s per clip, max 8.4 s (the first clip includes warm-up); 106.9 s wall time for 28 clips.
- Memory: process peak working set **407 MB**.

**Whisper-small (kn, temperature 0, no fallback): NOT RUN (deferred).** Free RAM was 373 MB at the time (7.5 GB machine with 1.5 GB under compression). Whisper-small needs roughly 1–1.5 GB, and the task rules require stopping before memory becomes critical. Run later with
`python -m app.tulu.evaluation.asr_eval whisper-small-kn` once at least 1.5 GB is free.
Earlier exploratory evidence (audit, Whisper-small kn with default retries): empty output for 3 of 4 deposit assistant clips.

### 5.3 Regression suites (run one at a time)

| Suite | Result | Notes |
|---|---|---|
| Localization (`test_m6_localization`) | **93 / 0** | |
| Speech (`test_m8_speech`) | **69 / 0** | One intended test update: `tcy` is no longer refused; a Tulu session now reads Kannada-script Tulu with the kn voice and English with the en voice. Before the update: 68 passed, 1 failed on exactly this assertion. |
| TTS diagnostics (`test_tts_diagnostics`) | **59 / 0** | |
| Interpreter (`test_interpreter`) | **38 / 0** | Interpreter still refuses Tulu (untouched by design) |
| College runtime (`test_college_runtime`) | **130 / 0** | Includes "a Tulu (tcy) session … answered in English, not presented as Tulu" |
| College workflows (`test_college_workflows`) | **169 / 2** | Both failures read `docs/domain-integration/05-kannada-review-cases.md`, which exists in the original repository but not in this partial copy (only `language_engine/` was copied). Workspace artifact, not a code regression; College code was not touched. |

### 5.4 TTS (`evaluation/reports/tulu_tts_eval.{json,md}`, audio in `tulu_tts_audio/`)

- 30 items synthesized fresh: all 28 dataset sentences, plus both disputed D04 versions for listening only.
- **0** generated files byte-identical (SHA-256) to any of the 28 recordings.
- Highest waveform cross-correlation, any generated file vs any recording: **0.346** (identical audio = 1.0).
- Machine-intelligibility proxy (IndicConformer-kn round trip, CER vs Romanized text; lower is closer):

| | Generated (Kannada voice) | Native speakers |
|---|---|---|
| All 28 sentences | 0.348 | 0.273 |
| 8 product responses (D01–D03, W01–W05) | 0.355 | — |

  The generated speech is somewhat further from the Romanized text than the native recordings under a Kannada ASR. A Kannada ASR rewards Kannada-like pronunciation, so this is **not** a Tulu intelligibility score.
- Process peak memory 376 MB.
- **Native-speaker listening evaluation: NOT YET DONE.** The sheet `evaluation/reports/tulu_tts_listening_sheet.csv` is ready (intelligibility, pronunciation and naturalness 1–5, mispronounced words, Kannada-script corrections).

### 5.5 End-to-end (`evaluation/reports/tulu_e2e.{json,md}`)

One run through the real FastAPI app and engine (`python -m app.tulu.tests.test_tulu_e2e`): **178 passed, 14 failed.**
Engine start 13.0 s. Process peak memory 961 MB (engine models + IndicConformer-kn).

| Part | Result |
|---|---|
| Deposit, audio (4 sequences × 4 turns) | **All 16 turns correct.** 12 by speech, 4 by typed fallback after ASR refusal (D03a ×2, D04b); replies D01–D03 verified Tulu, step 4 English (disputed) |
| Deposit, typed Tulu (4 sequences, all 12 utterances) | **All correct** |
| Withdrawal, audio (3 sequences × 5 turns) | Sequences 2 and 3 (W01b…, W01c…): **all 10 turns correct**, W01→W05 verified Tulu. Sequence 1: turn 1 correct, **turns 2–5 failed** ("Sorry, I didn't catch that.") |
| Withdrawal, typed Tulu (3 sequences) | Start turns correct; **8 progress turns failed** the same way |
| Generated audio | Every /tts reply 200 `audio/mpeg`; **0** SHA-256 matches with any recording; xcorr vs the input recording 0.052–0.22 (all < 0.5) |
| Ambiguity probes | Both rejected with the clarification reply; no workflow started |
| Deposit-set progress phrase in a withdrawal visit | **Failed** (same cause, below) |
| Loan in a Tulu session | Existing workflow started; reply English; spoken by the English voice |
| Deposit step 4 fallback check | **Failed** (same cause) |
| English and Kannada regressions, `/tulu/*` routes | All passed |

**Cause of all 14 failures: the Groq LLM's daily token quota was used up during the run.** The engine logged:
`[LLM] Understanding request failed (RateLimitError): Error code: 429 … Rate limit reached for model openai/gpt-oss-20b … tokens per day (TPD): Limit 200000, Used 198334`.
In the existing engine, a step-completion turn ("I have taken the slip", in any language) is decided by the LLM. The deterministic
completion resolver only corrects the LLM's answer, and the deterministic "next" command deliberately refuses to skip an
uncompleted step. With the LLM unavailable, every completion turn is answered "Sorry, I didn't catch that." This was confirmed
afterwards by direct engine probes: the same English pivots, and the English "I have done it.", all failed in 0.07 s with the 429.

The same pivots completed every withdrawal step while the quota lasted (sequences 2 and 3). The failures are therefore an
LLM-availability dependency of the shared engine, not a Tulu mapping error. They are reported as failures, not excluded.
**Re-run after the Groq quota resets** (or with a higher-tier key). The test was not re-run here, because it would only hit the same limit.

Turn latency: 1–7 s for start turns; **22–36 s for most completion turns**. This is consistent with the LLM client's
retry and back-off under rate limiting.

---

## 6. API

Existing interfaces are unchanged. A Tulu visit sends `language: "tcy"` exactly as `kn` or `hi` would.

| Route | Tulu behaviour |
|---|---|
| `POST /turn` `{session_id, language:"tcy", text}` | Tulu text → pivot → existing engine → verified Tulu reply (Kannada script), English where unverified |
| `POST /turn/audio` (form `language=tcy`) | Tulu ASR; 422 `"Tulu speech could not be recognised reliably. Please type your request in Tulu…"` when refused |
| `POST /tts` `{text, language:"tcy"}` | New MP3: Kannada voice for Tulu, English voice for English |

Additive routes (same domain authentication as `/tts`):

```
GET  /tulu/capabilities
POST /tulu/normalize   {"text": "Yenk kaas deppere undu?"}
POST /tulu/understand  {"text": "Yenk bank dh kaas deppere undu?"}
     → {"accepted": true, "method": "verified_match", "intent_id": "withdraw",
        "intent": "withdraw money", "pivot_en": "I want to withdraw money.", "matched_id": "W01c", ...}
POST /tulu/translate   {"text": "Sign the withdrawal slip.", "script": "kannada"}
     → {"text": "ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್‌ಗ್ ಸೈನ್ ಮಲ್ಪುಲೆ.", "status": "translated", "method": "verified mapping"}
POST /tulu/tts         {"text": "Withdrawal slip-g sign malpule.", "language": "tcy", "voice": "default", "format": "mp3"}
     → audio/mpeg; headers X-Tulu-Voice: tcy-text/kn-IN-SapnaNeural, X-Tulu-Disclosure, X-Tulu-Generated: true
POST /tulu/asr         multipart audio → {accepted, transcript, raw_hypothesis, match, acoustic_model, note}
```

TTS errors use `{"detail": <customer-safe>, "error": <category>}`: `empty_text`/`text_too_long` → 400, `synthesis_failed`/`empty_audio` → 422.

---

## 7. Files

**Created**

- `language_engine/app/tulu/`:
  - `__init__.py`
  - `data/{__init__,build_dataset,dataset}.py`, `data/{deposit_dataset,withdrawal_dataset,loanwords}.json`
  - `normalization/{__init__,text}.py`
  - `intent/{__init__,matcher}.py`
  - `translation/{__init__,renderer}.py`
  - `tts/{__init__,synthesizer}.py`
  - `asr/{__init__,recognizer}.py`
  - `evaluation/{__init__,asr_eval,tts_eval}.py`
  - `tests/{__init__,test_tulu_offline,test_tulu_e2e}.py`
- `language_engine/service/tulu_routes.py`
- `docs/tulu-dataset-audit.md`, `docs/tulu-implementation-report.md`, `docs/tulu-integration-handover.md`
- Reports: `evaluation/reports/tulu_asr_indicconformer-kn.{json,md}`, `tulu_tts_eval.{json,md}`, `tulu_tts_listening_sheet.csv`, `tulu_tts_audio/*.mp3`, `tulu_e2e.{json,md}`

**Modified (small, additive)**

| File | Change |
|---|---|
| `app/dialogue/localization.py` | `tcy` → `_localize_tulu()` (verified renderings only) |
| `app/speech/speech_plan.py` | `"tcy"` added to `SPOKEN_LANGUAGES` |
| `service/tts.py` | `tcy` → Kannada voice; Romanized Tulu → Kannada script before planning |
| `service/engine.py` | `transcribe(language="tcy")` → Tulu recogniser (accept or refuse) |
| `service/main.py` | Tulu pivot in `_run_turn` (Banking only), ambiguity clarification, `/tulu` router |
| `debugging/test_m8_speech.py` | `tcy` moved from "refused" to "speakable via Kannada voice" (intended contract change) |

---

## 8. Known limitations

1. **Speech output is not native Tulu TTS.** A Kannada-trained voice reads Tulu text. Tulu-specific vowels and the vowel length unmarked in romanization may be mispronounced, and no native listener has rated it yet.
2. **Kannada-script Tulu is machine-transliterated** from the Romanized text and pending native review (e.g. *dada* → ದಡ, where the word may be ದಾದ).
3. **ASR is closed-set.** It recognises only the 19 verified phrases (13/19 accepted correctly on the recordings themselves, with no held-out speakers or sentences) and does not generalise (leave-one-out: 2/19). Typed Tulu is the reliable input path.
4. **Intent is closed-set plus verb cues.** New phrasings without a verified verb are passed to the engine as unverified text.
5. **Deposit step 4** is in English (D04 wording disputed). **Deposit D03** may be the withdrawal sentence (to confirm).
6. Loan, balance and account-opening workflows have no verified Tulu and are answered in English. Money transfer and passbook update do not exist as engine workflows.
7. Whisper-small evaluation was deferred for memory reasons. The native-speaker listening test is pending.
8. Edge TTS is a cloud service and needs network access, the same as for en, kn and hi.
9. **Workflow progress depends on the Groq LLM (existing engine behaviour).** Step completion is decided by the LLM for every
   language. When the Groq daily quota (200k tokens on the current key) is exhausted, no workflow can advance, in Tulu or English.
   One full e2e run (about 190 turns) is enough to exhaust it.

## 9. Remaining work

1. A native speaker confirms D04, D03, the withdrawal verification, W01b "kaas/amount" and the Kannada-script forms, and fills in the listening sheet.
2. Run `asr_eval whisper-small-kn` when at least 1.5 GB of RAM is free.
3. Record more customer phrasings per step (held-out speakers and sentences) to measure real generalisation.
4. Collect verified Tulu for loan, balance and account opening, then rebuild the datasets. No code change is needed for new verified sentences of existing workflows.
5. **Re-run `python -m app.tulu.tests.test_tulu_e2e` after the Groq quota resets.** Run it once, and not on the morning of the demo,
   because it uses most of a day's quota.
6. Decision for the team (needs approval, since it touches the shared Banking dialogue manager): let the deterministic resolver
   *complete* a step on its own when it returns True, before calling the LLM. That would make "I have filled in the account
   number" (any language) work without the LLM and remove most of the 22–36 s latency. Not implemented here.

## 10. Demonstration

From `language_engine/`, with the service running (`uvicorn service.main:app`):

```
# typed Tulu withdrawal
curl -s localhost:8000/turn -H "Content-Type: application/json" \
  -d '{"session_id":"demo1","language":"tcy","text":"Yenk kaas deppere undu?"}'
# → reply "ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ."  (withdraw money, step 1)
curl -s localhost:8000/tts -H "Content-Type: application/json" \
  -d '{"text":"ಸರಿ..ಅಲ್ಪ ವಿತ್‌ಡ್ರಾಯಲ್ ಸ್ಲಿಪ್ ದೆತೊನ್ಲೆ.","language":"tcy"}' -o reply.mp3   # newly generated audio
# spoken Tulu
curl -s localhost:8000/turn/audio -F session_id=demo2 -F language=tcy -F "audio=@../deposit conversation/D01a_CUSTOMER.wav.m4a"
```

Integration: see `docs/tulu-integration-handover.md`.

---

## 11. Conversation-control statements (added 2026-11-17)

Dataset audit: `docs/tulu-control-dataset-audit.md`. Data: `app/tulu/data/control_dataset.json` (separate file; deposit and
withdrawal JSON verified byte-identical after the rebuild).

- 15 customer and 4 assistant statements, each with a recording (24-bit mono 48 kHz, ≈36 s of speech).
- **Native-speaker verification is not stated**; the English meanings are the document's *working glosses*. No Kannada script was supplied.

**Implemented controls.** Only those the dataset covers. Each maps to the engine's EXISTING deterministic control command, which runs before the LLM:

| Canonical | Group | Engine action | Mapping |
|---|---|---|---|
| REPEAT_STEP | C01 (4 phrases) | `repeat` | clear |
| PAUSE_WORKFLOW | C02 (5) | `pause` | clear |
| DECLINE_FURTHER_HELP | C03 (3) | `thanks` (non-destructive) | **uncertain**: heading names "stop the conversation" or "decline help" |
| CLARIFY_CURRENT_STEP | C04 (3) | `help` | clear |
| NEXT_STEP / PREVIOUS_STEP / RESUME_WORKFLOW | — | — | **not implemented: no Tulu data** (the engine has no "previous" command at all) |

**How it works.**
- Control phrases join the closed-set matcher (34 customer phrases in total). They carry a canonical control and **never** a service intent.
- A control match that contains a deposit or withdrawal verb is rejected as ambiguous.
- New: Tulu input that is close to a verified phrase but below threshold (0.65 ≤ score < 0.80) gets "Please say it again, or type it." It is not guessed and not sent to the LLM.
- The group's dataset Tulu reply is spoken as an acknowledgement before the engine's own reply. It is left out when the engine says "There's nothing … right now".
- **No dialogue-manager change was needed.**

**Results**

| Test | Result |
|---|---|
| Offline suite (`test_tulu_offline`) | **127 passed, 0 failed** (89 + 38 control) |
| Control e2e (`python -m app.tulu.tests.test_tulu_control_e2e`, real service) | **72 passed, 0 failed; 0 LLM calls**; every reply newly synthesized (MP3, no SHA-256 match, xcorr vs input 0.05–0.13); turns 2–5 s; process peak 1014 MB |
| Spoken controls through `/turn/audio` | 8/15 recognised; 7 refused → typed fallback used |
| ASR eval, IndicConformer-kn, all 47 recordings | Correct phrase 21/34 (deposit 10/12, withdrawal 3/7, control 8/15); **false acceptance 0/34**; rejected 13/34; leave-one-out 2/34; mean 2.1 s per clip; peak 400 MB |

C02d "Yaan panpina muta continue malporchi" (*don't continue*) is verified to **pause, never resume**, by both the typed and spoken paths.

**Regression suites re-run after the control change** (sequentially, free RAM checked before each):

| Suite | Result |
|---|---|
| Localization | 93 / 0 |
| Speech | 69 / 0 |
| TTS diagnostics | 59 / 0 |
| Interpreter | 38 / 0 |
| College runtime | 130 / 0 |
| College workflows | 169 / 2 |

The College-workflow failures are the same missing-document workspace artifact as §5.3, so the totals (558 / 2) are identical to before the control change.

**Still not run:**
- **Whisper-small:** free RAM was 1,039 MB at the check, below the 1.5 GB needed.
- **The quota-dependent full e2e test (§5.5):** each run uses most of the daily Groq quota. Run it once after the quota resets, not on demo day.

**Native-speaker review needed:** all control phrases (verification not stated); the C03 mapping; "oik" in the C03 reply; the Kannada-script forms. Also: C01 promises *slower* speech, but the TTS does not slow down. Pausing in Tulu works, but resuming requires English "resume"/"continue" (no Tulu RESUME data).

---

## 12. Deterministic step completion before the LLM (approved change, 2026-11-17)

**Problem (from §5.5).**
- Every in-workflow turn called Groq (`dialogue_understanding.understand`, branch 6 of `DialogueManager.generate_response`) *before* the existing deterministic resolver (`resolve_step_completion`, branch 9) was consulted.
- When the daily Groq quota ran out, no workflow could advance in any language, and completion turns took 22–36 s.

**Change** (`app/dialogue/manager.py`, the only shared Banking file touched):
- **New branch 5C**, placed after the policy screen and exact-answer lookup and **before** the LLM call. It advances one step without the LLM only when `_confirmed_completion_without_llm()` passes **all** of these gates:
  1. `resolve_step_completion()` returns **True** for the current instruction. None (undecided) and False (vetoed) never qualify. Kannada and Hindi resolve to None, so they are unchanged.
  2. Every clause is a REPORT. Completion plus a question still goes to the LLM, so the question gets answered.
  3. No amount or number (digits, Indic number words, English number words). Entity extraction stays with the LLM.
  4. No control word or clause joiner (cancel, stop, pause, repeat, next, help, and, but, not…). This closes a gap found in review: the resolver does not split on commas, so "I filled it, cancel" is one REPORT clause.
  5. Not a verbatim repeat of the customer's previous message.
- `_advance_current_step()`: the advancement body of branch 9, moved unchanged into a helper that branch 9 and 5C both call. There is still **exactly one increment per turn**: 5C returns before the LLM path runs.
- Branch 9 (resolver + LLM fallback), the understanding-failure guard, controls, conflict handling and Groq itself are unchanged.

**Tulu change.** The D04 and W04 pivots became "I have entered the amount.". The old pivots ("completed the slip", "filled in the amount") were confirmed by the resolver at the *wrong* steps (1 and 2). Every Tulu progress pivot is now confirmed **only at its own step**, and this is asserted in the offline suite.

**Results** (run sequentially)

| Suite | Before | After |
|---|---|---|
| New `debugging/test_deterministic_completion.py` | — | **33 / 0** |
| Banking dialogue-manager suites (32b1, 32b1 control routing, 32b2, 32b3, 32b4, 32b12, 32b13, 32b14, 32b15 audit, LLM cancel confirmation, service turn) | 2,360 / 0 | **2,360 / 0** (identical) |
| Tulu offline | 127 / 0 | **136 / 0** (+9 step-specific pivot checks) |
| **Full Tulu e2e with Groq unavailable** (process-only `GROQ_API_KEY=invalid…`, zero quota used; `.env` untouched) | 178 / 14 (with real Groq, quota exhausted) | **192 / 0** |

What the new suite covers:
- Confirmed completion advances with **0 LLM calls**, in both workflows.
- **With Groq unavailable**, deposit steps 1→4 and withdrawal steps 1→5 still complete; a question or an untied report does not advance.
- Unconfirmed input ("will", "not", questions) does not advance, and "…, cancel" is sent to the LLM.
- An amount goes to the LLM and the entity is persisted.
- One response advances at most one step, and a verbatim repeat is not fast-pathed.
- Controls are unchanged; "signed" never confirms a deposit step; Kannada still consults the LLM.

In the end-to-end run, audio turn latency was **max 3.8 s, mean 2.1 s** (previously 22–36 s on completion turns). 22 of 31 audio turns were recognised from speech; the rest used the typed fallback. Every reply was freshly synthesized, with no SHA-256 match against any recording.

The end-to-end test captures engine output internally, so it cannot count LLM calls directly. The evidence that none were needed is the result: with an invalid key, any turn reaching the LLM would have answered "Sorry, I didn't catch that" and failed.

**LLM calls avoided.**
- Every completion turn that passes the gates: in both Tulu workflows that is every progress turn (deposit 3, withdrawal 4 per visit).
- English plain reports of the current step ("I have taken the slip.", "I have signed the slip.").

**NOT run after this change.** Free RAM fell to 128–330 MB, held by other applications; the guards stopped every run cleanly:
- the control e2e,
- localization, speech, TTS diagnostics and interpreter,
- College runtime and College workflows.

Their last results (after the control change, before this one) were 72/0, 93/0, 69/0, 59/0, 38/0, 130/0 and 169/2. **Re-run them before integration.**

**College compatibility.** College runs through `app/workflow/domain_runner.py`, not `DialogueManager.generate_response`. The change is not reachable from College, but this is not yet confirmed by re-running the College suites.

**Remaining limitations.**
- A repeated identical confirmed report is still treated as a new report by the existing branch 9 (pre-existing behaviour). Only the fast path refuses a verbatim repeat. True idempotency for a duplicated HTTP request would need a request id from NestJS, which is out of scope.
- Number words are deliberately routed to the LLM, so "I entered five thousand" still needs Groq.
- Compound "done + question" turns still need Groq.

---

## 13. Update 2026-11-19: added data, situational control replies, completed validation

### Data added (originals untouched; all earlier rows unchanged, checked row by row; deposit JSON byte-identical)

| Dataset | Added | Now |
|---|---|---|
| Withdrawal | W02b–d ("I took the slip"), W03a1 ("I wrote the account number"), W03b1–2 ("I wrote the amount"), W04b–c ("I signed it") | 20 rows (15 customer, 5 assistant) |
| Control | **C05 "Asking what comes next"** (4 phrases, reply "Avu next dada malpodu annd panpe." = *I will say what to do next*); **C06 "Asking the assistant to continue"** (2 phrases, reply "Avu erna request n continue malpuve." = *I'll continue your request*) | 27 rows (21 customer, 6 assistant) |

**About the new recordings:**
- All 16 are 16-bit stereo with median F0 106–132 Hz, consistent with the **deposit speaker**. Withdrawal and control now each have two speakers.
- W03b1 "amount n bareye" is the same sentence as deposit D04b. It has the same meaning and pivot, so there is no ambiguity.
- The control document was open in Word when read (lock file present); its name still says C01–C04.
- Discrepancies are recorded in the JSON files (`ADDED_RECORDINGS_SECOND_SPEAKER`, `W03B1_SAME_TEXT_AS_D04B`, `C06_VS_C02D`, `ADDED_GROUPS_SECOND_SPEAKER`, `DOCUMENT_OPEN_IN_WORD`).

### Controls now supported

REPEAT_STEP, PAUSE_WORKFLOW, DECLINE_FURTHER_HELP (mapping uncertain), CLARIFY_CURRENT_STEP, **NEXT_STEP** (`next`) and **RESUME_WORKFLOW** (`resume`).
PREVIOUS_STEP has no data.

### Situational control replies

The shared assistant reply is now combined with what the situation needs, following each reply's English meaning. This is `CONTROL_REPLY_PLAN` in `app/tulu/data/dataset.py`, applied by `_compose_tulu_control_reply()` in `service/main.py`.

| Control | Reply |
|---|---|
| Repeat, next, continue | Tulu reply + current step |
| Clarify | Tulu reply + engine explanation (English) + current step |
| Pause, decline help | Tulu reply only |

**Example (tested):** deposit paused at step 2, then "Next panle" → *ಅವು ನೆಕ್ಸ್ಟ್ ದಡ ಮಲ್ಪೊಡು ಅಂಡ್ ಪಂಪೆ. ಐಟ್ ಎರ್ನ ಅಕೌಂಟ್ ನಂಬರ್ ಬರೆಲೆ.* (C05 + step 2). The workflow resumes at step 2, because the engine's `next` never skips an unfinished step.

When nothing is active, the engine's own message is returned without a contradictory Tulu reply.

**Transliteration fix:** a doubled nasal before a stop ("annd") is now one anusvara (ಅಂಡ್), not the malformed "ಅನ್ಂಡ್".

### Validation (2026-11-19, sequential, memory checked before each run; end-to-end runs with a process-only invalid Groq key, zero quota)

| Suite | Result |
|---|---|
| Tulu offline | **157 / 0** |
| Deterministic completion | **33 / 0** |
| Tulu control e2e (21 phrases spoken + typed, situational scenarios) | **108 / 0**, **0 LLM calls**, 13/21 spoken phrases recognised |
| Full Tulu e2e (deposit + withdrawal incl. all new phrases, spoken + typed) | **271 / 0**; 26 of 46 audio turns by speech; turn latency max 3.02 s, mean 1.85 s; process peak 730 MB |
| Localization | **93 / 0** |
| Speech | **69 / 0** |
| TTS diagnostics | **59 / 0** |
| Interpreter | **38 / 0** |
| College runtime | **130 / 0** |
| College workflows | **169 / 2** (same two checks needing `docs/domain-integration/05-kannada-review-cases.md`, absent from this copy) |
| Service turn | **137 / 0** |
| 32b4 | **264 / 0** |
| 32b1 | **478 / 0** |
| 32b1 control routing | **223 / 0** |
| 32b14 | **360 / 0** |

**ASR (IndicConformer-kn), 63 recordings / 48 customer.** Correct phrase **29/48**, false acceptance **0/48**, rejected 19/48. Leave-one-out: 3/48 correct, 0 false acceptances. Mean 1.89 s per clip; peak 400 MB.

| Dataset | Correct phrase | Rejected |
|---|---|---|
| Deposit | 10/12 | 2 |
| Withdrawal | 6/15 | 9 |
| Control | 13/21 | 8 |

Of the new phrases, these were recognised: W02b, W02c, W03b2, C05a–d, C06b. These were refused: W02d, W03a1, W03b1, W04b, W04c, C06a.

**Still not run:**
- **Whisper-small:** free RAM 1,018 MB at the check, below the 1.5 GB minimum.
- **E2E with a working Groq key:** deliberately not run, to save quota.
- **TTS evaluation for the new sentences:** fresh synthesis of every reply, including C05/C06, is covered by the control e2e and full e2e, but the per-sentence intelligibility proxy (`tts_eval`) was not re-run.
- **Native listening test:** not done.

### 13a. Situational control replies: exhaustive matrix (2026-11-19)

`python -m app.tulu.tests.test_tulu_control_matrix` runs through the real service, with a process-only invalid Groq key and zero quota. Report: `evaluation/reports/tulu_control_matrix.{json,md}`.

**Coverage:**
- Every control phrase (21, C01–C06) × every step of deposit (1–4) and withdrawal (1–5) × active and paused = 378 situations.
- Plus each phrase with no workflow, a completed workflow, a cancelled workflow, and a pending cancel confirmation = 84 more.
- Plus repeated controls (pause twice, next twice, continue while active).

**Result: 466 checks passed, 0 failed, over 462 situations, 0 LLM calls.**

| Situation | Behaviour verified |
|---|---|
| Any step, active or paused: C01 / C05 / C06 | Tulu reply + **that** step's instruction. C05 and C06 leave it active at the same step (next never skips an unfinished step); C01 leaves the state unchanged |
| Any step: C02 | Tulu reply only; workflow paused, same step |
| Any step: C03 | Tulu reply only; state and step unchanged |
| Any step: C04 | Tulu reply + the engine's explanation for that step (English) + that step's instruction |
| Deposit step 4 | The step is appended in **English** ("Submit the slip along with the cash."), because the D04 wording is disputed |
| No workflow / completed / cancelled | The engine's own message (e.g. "Your request is already completed…"); no contradictory Tulu reply, nothing reopened (C03 gives its Tulu reply when nothing is active) |
| Cancel confirmation pending | A control phrase does not cancel; the workflow stays at its step (C06 "continue" means *keep it*, as the engine's question allows) |

**Gaps:**
- There is no Tulu phrase for **cancel**. The engine's confirmation ("Say cancel to confirm, or continue to keep it.") and the cancel itself are English.
- The completed, cancelled and no-workflow messages are the engine's English sentences (no verified Tulu).

### 13b. C03 mapped to "stop" (team decision, 2026-11-19)

C03 ("Stopping the conversation or declining further help") was mapped to the non-destructive `thanks` while its meaning was uncertain. On the team's instruction it is now **`STOP_REQUEST`**, mapped to the engine's existing `stop`, which the engine treats as cancel.

**Safety comes from the engine's existing confirmation, so a single C03 phrase never cancels on its own:**

| Turn | Reply |
|---|---|
| 1st C03 with a request open (any step, active or paused) | The engine's question: "Do you want to cancel the withdrawal? Say cancel to confirm, or continue to keep it." (English; no verified Tulu). Nothing is cancelled |
| 2nd C03 | The request is cancelled → C03 Tulu reply *"Okay ... nana oik andala help bodanda yenk panle ... thank you."* ("Okay, let me know if you need any other help. Thank you.") |
| C06 "Continue malpule" at the question | The request is kept → C06 reply + current step |
| C03 with nothing active, or after completed or cancelled | C03 Tulu reply (polite close) |

**Results** (after the change; process-only invalid Groq key):

| Suite | Result |
|---|---|
| Situation matrix | **466 / 0** over 462 situations, 0 LLM calls |
| Control e2e | **108 / 0**, 13/21 spoken |
| Tulu offline | **157 / 0** |
| Service turn | **137 / 0** |

**Still open:** a native speaker should confirm that C03 phrases such as "Eth aav ." ("That's enough") and "Nana explain malpodu pandh ejji" ("I don't need any further explanation") are meant to *cancel the request*, not only to stop explanations.

### 13c. Tulu stop: one stop cancels, two stops exit (team rule, 2026-11-19; supersedes 13b)

| Turn (Tulu session) | Result |
|---|---|
| **1st stop** (C03) with a request open, any step, active or paused | Request **cancelled at once** (no "are you sure?") → C03 Tulu reply + "Say stop again to end the conversation." (English; no verified Tulu) |
| 1st stop with nothing open (none / completed / cancelled) | Only the offer: C03 Tulu reply + "Say stop again to end the conversation." |
| **2nd stop**, the very next turn | **Conversation ends** (the engine's own session exit; farewell "Thank you for using the banking assistant."; `ended: true`; every later turn gets the farewell) |
| Anything else after the offer | The offer is dropped and the turn is handled normally (e.g. a new deposit request starts) |

**Implementation** (`service/main.py` `_tulu_stop()`; `service/registry.py` adds a per-visit field `SessionEntry.tulu_exit_offered`):
- The cancel reuses the engine's own cancel: "stop" is sent, and if the engine asks its usual confirmation, "stop" again as that confirmation, so state, history and replies stay the engine's.
- Exit reuses the engine's `session_exit`.
- **English and Kannada sessions are unchanged** (confirm-first cancel). The shared dialogue manager is not modified. No LLM call.

**Results** (Groq made unavailable, zero quota):

| Suite | Result |
|---|---|
| Situation matrix | **468 / 0** over 462 situations + stop/exit flow checks, 0 LLM calls |
| Control e2e | **108 / 0**: every C03 phrase, spoken and typed, cancels then exits |
| Tulu offline | **157 / 0** |
| Service turn | **137 / 0** |

**Risk to confirm:** cancelling now takes one phrase, so a misheard or misunderstood C03 phrase cancels the request immediately. ASR false acceptances measured so far: 0/48. Native-speaker confirmation of the C03 meaning is still pending.

### 13d. Text-only control phrase "yank gothuji" — "I don't know" (2026-11-19)

**Source and storage.**
- Supplied by the team in chat; **not in the control document and with no recording**.
- Stored in `app/tulu/data/control_supplement.json` (id **C04t1**). `build_dataset.py` appends it to `control_dataset.json` with `text_only: true`, `audio_file: null` and `verification: "not stated"`, keeping the spelling exactly as supplied.
- The Word document is untouched.

**Meaning and behaviour.**
- Assigned to **C04 (asking for clarification)**: a customer who does not know what to do at a step needs it explained. This was the development assistant's choice, pending team and native confirmation.
- In every situation the reply is therefore C04's: *"Thondre ejji yaan ereg kuda panpe.."* ("No problem, I'll explain it again to you.") + the engine's explanation for the current step (English) + the current step in Tulu.
- With nothing active, the engine's own message is returned.

**Matching.**
- Exact phrase score 1.0. The closest other phrase scores 0.54 (C04a), well below the 0.80 threshold, so there is no confusion with deposit "Yank duddu …" (0.52).

**Speech.**
- With no recording, **spoken "yank gothuji" is not supported**: the closed-set ASR can still match it if the acoustic model happens to transcribe it closely, but this has never been measured.
- All recording-based code now uses `audio_utterances()`, so text-only rows are never treated as recordings or as ASR evaluation data.

**Results** (Groq made unavailable):

| Suite | Result |
|---|---|
| Tulu offline | **162 / 0** |
| Situation matrix | **490 / 0** over 484 situations (C04t1 in all 22 of its situations), 0 LLM calls |
| Control e2e | **110 / 0** (typed C04t1 included; reply freshly synthesized) |
