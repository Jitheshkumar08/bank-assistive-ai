# Control Commands Audit — Python Engine, NestJS and React Integration

Date: 2026-10-21 · Mode: read-only audit (this report is the only file created) · Working tree: includes the uncommitted A1, Phase 1–3 and teammates' changes.

Evidence rules:
- **Verified** = read in code **and** exercised by a test that was run during this audit.
- **Code-only** = read in code but not covered by a test that was run.
- **Unverified** = needs a real browser, microphone, LLM or TTS.

Line numbers refer to the working tree at audit time.

---

## 1. Executive summary

**What works:**

- **Every workflow control is implemented in the Python engine.** This covers pause, resume, cancel, repeat, next, exit, acknowledgements, step references and the workflow-switch choice. They live in a **deterministic, rule-based tier** (`app/dialogue/manager.py: classify_command`, `classify_turn`, `handle_control_command`) that runs **before** any LLM call. Kannada and Hindi are covered by authored tables, and romanized Kannada/Hindi by an M3 table.
- **The same code path serves typed and spoken input over HTTP.** `POST /turn` and `POST /turn/audio` go to `EngineRuntime.run_turn` and then to `VoiceAssistantPipeline._respond`. There is no separate control endpoint; a control is just an utterance.
- **NestJS is a pure adapter.** It forwards text and audio and returns `{reply, transcript, workflow, ended}`. There is no control logic in `backend/src/assistant/*` (grep: 0 hits).
- **React has no workflow-control UI.** Workflow controls reach the engine only as typed or spoken utterances. `WorkflowProgress` displays the engine's snapshot (`Paused at step N of M`, `Cancelled`, …). It is updated **only from a successful response**, never optimistically.
- **Voice-session controls are frontend-only and UI-driven.** These are start, "Stop listening", the tap-to-reset during sending/speaking, disable, endpointing and automatic re-listening. The frontend never parses transcripts, so **no spoken word changes microphone state**.

**What needs attention** (details in §6):

| # | Issue | Severity |
|---|---|---|
| S1 | A whole-utterance "stop" / "cancel" / "never mind" / "ಸಾಕು" / "ಬೇಡ" / "ನಿಲ್ಲಿಸು" / "बस" / "नहीं चाहिए" / "saaku" / "beda" **cancels the active workflow immediately, with no confirmation**. A cancelled workflow **cannot be resumed**. Hands-free capture makes an incidental utterance more likely to arrive as a turn. | High |
| S2 | Hindi **"बंद करो"** ("stop it / turn it off") is a **session exit**, which ends the visit in the UI, not a workflow cancel. | High |
| S3 | Kannada **"ಬೇಡ"** and Hindi **"नहीं चाहिए"** (both "don't want / no") are **cancel**. A "no" answer in an active workflow cancels it. | Medium-high |
| S4 | **No deterministic yes/no.** Bare "yes", and every Kannada/Hindi confirmation, depends on the Groq LLM; with the LLM down, nothing advances (safe, but unhelpful). | Medium |
| S5 | **"help" is LLM-only.** With the LLM down, help degrades to "Sorry, I didn't catch that. {instruction}". | Medium |
| S6 | `SessionState.EXITED` is set but **never enforced** by the engine. Only the frontend's `ended` flag blocks further turns. | Low-medium |
| S7 | A control applied by Python **after** NestJS's 60 s timeout leaves the frontend showing a stale workflow state and an error. There is no snapshot endpoint to reconcile. | Medium |
| S8 | Romanized **"next"** and romanized **exit** phrases do not exist. | Low |

**Verdict:**
- The control system is **functionally wired end to end and ready for integrated browser testing**.
- S1–S3 should be **decided and fixed in the engine** before hands-free use with real customers.
- There is **no fundamental architectural blocker**: the domains are cleanly separated.
- The separate TTS 403 (Phase 1B) still prevents continuous hands-free conversation.

---

## 2. Control inventory and language coverage

### 2.1 Recognition pipeline (`app/dialogue/manager.py`)

Every turn first goes through `normalize_turn` (`app/dialogue/text_normalization.py`, ASR repair). The routing text then goes to `DialogueManager.detect_control` (`:1206`) and on to `classify_turn` (`:814`), which runs:

1. `classify_command` (`:695`) on `normalize_command_text` (`:670`): lowercase, NFC, trailing `.!?,;:` stripped.
   - **Exit:** exact whole-utterance match in `SESSION_EXIT_PHRASES`. No word limit.
   - **Controls / acknowledgements:** exact whole-utterance match, **≤ 4 words** (`MAX_CONTROL_PHRASE_WORDS`).
   - **Polite second pass** (`classify_polite_control`, `:396`): ≤ 8 words, no negation, prefixes/suffixes stripped, then an exact match again. **Only `pause`, `resume`, `repeat`** (`POLITELY_WRAPPABLE_COMMANDS`, `:214`). So "please stop" or "cancel it please" are **not** deterministic cancels; they reach the LLM.
   - **Kannada stem rule** (`multilingual_phrases.classify_by_stem`): a single word starting `ಮುಂದುವ`→resume, `ವಿರಾಮಿಸ`→pause, `ನಿಲ್ಲಿಸ`→cancel, `ನಿರ್ಗಮಿಸ`→exit. It is guarded by `contains_negation`, so "ನಿಲ್ಲಿಸಬೇಡಿ" ("don't stop") does not cancel (tested, `test_m3_language_cues`).
   - **Trailing ASR fragments:** one-character tokens are dropped and matching is retried.
2. `classify_step_reference` (`:601`): "step 2", "second step of deposit", … (read-only).
3. **No match:** normal routing. In an `ACTIVE`/`SUSPENDED` workflow → `generate_response` (LLM understanding plus deterministic completion). In a resting state → `answer_general_question`, then `IntentDetector`.
4. **LLM recovery:** when the LLM says `type=control`, `resolve_control_command` (`:1083`) maps **substring** keywords (`CONTROL_INTENT_KEYWORDS`, `:995`) to **pause/resume only**.

### 2.2 Commands

"kn" = Kannada script, "hi" = Devanagari, "rom" = romanized (M3 table).

| Control | Exact phrases (source) | Languages | Mechanism |
|---|---|---|---|
| **exit** (`session_exit`) | en: exit, quit, goodbye, bye, end session, close assistant, exit assistant (`manager.py:67`) · kn: ಹೊರಗೆ, ನಿರ್ಗಮಿಸು, ನಿರ್ಗಮಿಸಿ, ವಿದಾಯ, ಬೈ (+ stem ನಿರ್ಗಮಿಸ) · hi: बाहर, बाहर निकलो, निकास, अलविदा, **बंद करो** (`multilingual_phrases.py`) | en, kn, hi · **no rom** | rule |
| **pause** | en: pause, hold on, hold up, **wait**, hang on, give me a moment/minute (+ polite wrappers) · kn: ವಿರಾಮ, ವಿರಾಮಿಸು/ಸಿ, ವಿರಾಮ ಮಾಡು/ಡಿ, ತಡೆಯಿರಿ, ತಡೆಯಿಸು, ಸ್ವಲ್ಪ ನಿಲ್ಲಿ, ಸ್ವಲ್ಪ ತಡೆಯಿರಿ, ಒಂದು ನಿಮಿಷ · hi: रुको, ठहरो, विराम, एक मिनट, थोड़ा रुको, रुक जाओ, रुकिए, रुक जाइए, ज़रा/थोड़ा/एक मिनट रुकिए · code-mixed: pause ಮಾಡಿ, pause करो/कीजिए · rom: ruko, ruk jao, rukiye, thoda/zara ruko, ek minute, pause karo, swalpa nilli, ondu nimisha, pause maadi/madi | en, kn, hi, rom, mixed | rule; LLM recovery (substring) |
| **resume** | en: resume, **continue**, carry on, let's continue · kn: ಮುಂದುವರಿಸಿ/ಸು, ಮುಂದುವರೆಸಿ/ಸು, ಪುನಃ ಪ್ರಾರಂಭಿಸಿ, ಮುಂದೆ ಸಾಗಿ (+ stem ಮುಂದುವ) · hi: जारी रखो/रखिए, आगे बढ़ो, फिर से शुरू करो · mixed/rom: continue ಮಾಡಿ/करो/कीजिए, jaari rakho, aage badho, continue karo, munduvarisi/su, continue maadi | en, kn, hi, rom, mixed | rule; LLM recovery |
| **cancel** | en: cancel, **stop**, never mind, nevermind, forget it · kn: ನಿಲ್ಲಿಸು/ಸಿ (+ stem), **ಸಾಕು**, **ಬೇಡ**, ರದ್ದು ಮಾಡು, ರದ್ದುಮಾಡಿ · hi: रद्द करो/करें, कैंसिल करो, **बस**, **नहीं चाहिए** · mixed/rom: cancel ಮಾಡಿ, ಕ್ಯಾನ್ಸಲ್ ಮಾಡಿ, cancel करो/कीजिए, कैंसल करो, cancel karo/kar do, radd karo, nahi chahiye, cancel maadi, nillisi/su, **beda**, **saaku/saku** | en, kn, hi, rom, mixed | rule only (no polite wrapper, no LLM recovery) |
| **repeat** | en: repeat, again, say that again, come again, pardon, say again (+ polite: "can you repeat that") · kn: ಮತ್ತೆ ಹೇಳಿ/ಹೇಳು, ಮತ್ತೊಮ್ಮೆ/ಪುನಃ/ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ · hi: फिर से बताइए/बताओ, दोबारा बताइए, दोहराइए, फिर से कहिए · mixed/rom: repeat ಮಾಡಿ/करो/कीजिए, ರಿಪೀಟ್ ಮಾಡಿ, रिपीट करो, phir se batao, dobara batao, repeat karo, matte heli, innomme heli, repeat maadi | en, kn, hi, rom, mixed | rule |
| **next** | en: next, what next, what's next · kn: ಮುಂದಿನದು, ಮುಂದೇನು, ಮುಂದಿನ ಹಂತ · hi: अगला, आगे क्या, अगला कदम, आगे क्या करना है | en, kn, hi · **no rom** | rule |
| **acknowledgement / thanks** | en: okay, ok, alright, got it, understood / thank you, thanks… · kn: ಸರಿ, ಆಯಿತು, ಗೊತ್ತಾಯಿತು, ಅರ್ಥವಾಯಿತು / ಧನ್ಯವಾದ(ಗಳು) · hi: ठीक है, ठीक, समझ गया/गयी, अच्छा / धन्यवाद, शुक्रिया · rom: theek hai, sari, dhanyavaad, shukriya… | en, kn, hi, rom | rule |
| **step reference** | "step 2", "2nd step", "step two of deposit", "what is step 3" (`classify_step_reference`) | **English only** | rule |
| **workflow-switch choice** (while a conflict question is pending) | cancel / pause / continue words (`workflow_conflict.CHOICE_WORDS`), Indic stems ರದ್ದು, ನಿಲ್ಲಿಸ, ಸಾಕು, ವಿರಾಮ, ತಡೆಯ, ಮುಂದುವ, रद्द, कैंसिल … (`INDIC_CHOICE_STEMS`); control commands mapped through `CONFLICT_CONTROL_CHOICES` (`workflow_conflict.py:148`) | en, kn, hi | rule (negation-guarded) |
| **help** | none in any phrase table | — | **LLM only** (`message_type == "help"` → `handle_question`) |
| **yes / confirmation** | deliberately excluded from all tables (`manager.py:123`) | — | `resolve_step_completion` (English structure) → else LLM `step_completed` |
| **no / rejection** | not a phrase; `contains_negation` (en + `multilingual_negation` kn/hi/rom) routes refusals | en, kn, hi, rom | rule guard → `handle_refused_request` (changes nothing) — **except** kn ಬೇಡ / hi नहीं चाहिए / rom beda, nahi chahiye, which are **cancel** |

Not found anywhere: "help" as a deterministic phrase, "skip", "go back / previous step", "start over", "louder/slower".

---

## 3. Semantics by state (`handle_control_command`, `manager.py:1221-1523`)

Precedence inside `handle_control_command`:
1. step reference;
2. **pending workflow-switch question** (`_pending_conflict`): cancel/pause/resume are answered as the choice, and **every other control re-asks the question**;
3. acknowledgement;
4. workflow present (`ACTIVE`/`SUSPENDED` with an intent) vs. absent.

| Control | ACTIVE | SUSPENDED (paused) | COMPLETED / CANCELLED | NONE (no workflow) |
|---|---|---|---|---|
| pause | → SUSPENDED: "Okay, I've paused this request…" | unchanged: "That request is already paused. Say resume…" | unchanged: "Your request is already completed / That request was cancelled. There's no active request to control…" | "There's nothing active to pause right now." |
| resume | unchanged: "That request is already active. {step}" | → ACTIVE, same step: "Continuing. {step}" | unchanged, status message (cannot resume a cancelled request) | generic "There's no active request…" |
| cancel | → CANCELLED: "Okay, I've cancelled that request…" | → CANCELLED | unchanged, status message | "There's nothing active to cancel right now." |
| repeat | current instruction (no state change) | current instruction (stays SUSPENDED) | last assistant message (`_last_assistant_message`) | last assistant message, else "There's nothing to repeat right now." |
| next | **restates** the current step (no advance) | → ACTIVE: "Continuing. {step}" | status message | generic |
| thanks / ok | restates the step, no advance | "…still paused. Say resume…" (does not resume) | status + offer | offer |
| step reference | reads that step, never mutates (`_handle_step_reference`) | same | same | same |
| exit | `SessionState.EXITED`, reply "Thank you for using the banking assistant.", `ended=true`; **workflow state left as is**; not written to history (`service/engine.py:240-252`) | same | same | same |

**"yes" in a workflow:** `resolve_step_completion` returns `None` for a bare "yes" (tested, `test_phase32b4`). The LLM's `step_completed` then decides. If the LLM fails, `understanding_failed` gives "Sorry, I didn't catch that. {step}" with **no advance** (`manager.py:2442`).

**"no" in a workflow:** the resolver vetoes completion for refusal clauses (returns `False`). The rest is LLM-routed. In a resting state, `_respond` routes negation to `handle_refused_request`, which changes nothing.

**On LLM failure:** the deterministic tier is unaffected. Pause, resume, cancel, repeat, next, exit, acknowledgements and step references all work. Help, yes, free-form questions and polite cancels degrade to "didn't catch that" with no state change.

**On ASR failure:**
- `/turn/audio` returns 422 ("could not be understood" / "could not hear anything") **before** dialogue, so no control runs.
- The frontend shows the error, and Phase 3 hands-free ends (reply `null`).

---

## 4. End-to-end traces

### 4.1 Workflow control (spoken or typed)

1. **Browser input:**
   - Spoken (Phase 2 endpointing or a manual stop): `useMicrophone`, then `VoiceContext.handleRecorded`, then `ConversationContext.sendVoice` → `deliver`, then `HttpAssistantClient.sendMessage`, which sends multipart `POST /api/assistant/voice`.
   - Typed: `Composer`, then `ConversationContext.send` → `deliver`, then `POST /api/assistant/message` with `{sessionId, text}`.
2. **NestJS:** `AssistantController.sendVoice` / `sendMessage`, then `AssistantService` (visit ownership via `resolveSession`; language from `session.language`), then `HttpAiEngineClient.sendAudio` / `sendText`. That posts to Python `POST /turn/audio` (multipart `session_id, language, audio`) or `POST /turn` (`{session_id, language, text}`), with a 60 s abort.
3. **Python:**
   1. `service/main.py: audio_turn` / `text_turn`, then `registry.get_or_create`, then `in_turn` (a per-visit lock).
   2. `[EngineRuntime.transcribe]`, then `EngineRuntime.run_turn` (`service/engine.py:176`).
   3. `normalize_turn` → `dialogue.detect_control`. Exit is handled here; otherwise `VoiceAssistantPipeline._respond` → `handle_control_command` or `generate_response`.
   4. History is written (canonical English), then `ResponseLocalizer.render`.
   5. The response is `TurnResponse{reply, transcript?, workflow{name, state, step, total_steps}, ended}` (`service/snapshot.py`).
4. **Back through NestJS:** `call()` maps it to `{reply, transcript, workflow{…, totalSteps}, ended}`. Errors: a 4xx with a string detail is passed through, a 5xx becomes 502, a timeout becomes 504.
5. **React:**
   - `deliver` runs `setWorkflow(nextWorkflow)` and `setEnded(...)` only on success, and appends the reply.
   - `WorkflowProgress` renders the state.
   - On a voice turn, `VoiceContext.speakReply` posts `/api/assistant/speak` → `/tts` (currently 403 → 422). The written reply stays on screen.

**Verdict:** wired end to end. Evidence:
- `test_service_turn` (135 checks): the HTTP-handler path equals the CLI path, called as FastAPI calls it, with fake understanding;
- `test_service_language` (88): through the real handlers;
- the frontend `ConversationContext` / `httpAssistantClient` tests: response mapping.

A **live browser → NestJS → Python** run of a control phrase was **not** performed (it needs running services and the database).

### 4.2 Exit (visit domain)

The engine's `ended: true` flows to `ConversationContext.setEnded(true)`. Then:
- `send`/`sendVoice` refuse further input (`ConversationContext.tsx:256,272`);
- `AssistantPage` shows "This visit has ended" with a **Finish** button, which calls `endSession()` (DB) → `SessionsService` → `HttpAiEngineClient.endSession` → `DELETE /sessions/{id}` (`AssistantPage.tsx:63-67`);
- `VoiceContext` ends hands-free on `ended` (Phase 3, tested).

### 4.3 Voice-session controls (frontend only, never reach NestJS/Python)

| Action | Trigger | Effect |
|---|---|---|
| Start listening | mic button when idle (`Composer.handleMicPress`, `VoiceOverlay.handleMicPress` → `startListening`) | opens the mic, starts the hands-free session |
| "Stop listening" | mic button while listening (`stopListening`) | sends this recording (manual), ends hands-free |
| Tap during sending/speaking | `reset()` | abandons the turn, stops speech, ends hands-free |
| Disable voice | account menu → `disable()` | as reset, and persists the preference |
| Endpointing | Phase 2 detector | speech + 800 ms silence → submit; 15 s silence → drop; 30 s → submit |
| Re-listening | Phase 3 | only after playback `'ended'` + 300 ms, with every guard re-checked |

---

## 5. Integration ownership matrix

| Control | Python implementation | Python HTTP | NestJS forwarding | Frontend trigger | Frontend state handling | Tests run | Verdict | Gap → minimal action |
|---|---|---|---|---|---|---|---|---|
| pause | `classify_command` + `handle_control_command` → `suspend_workflow` | `/turn`, `/turn/audio` | pass-through | utterance only | `WorkflowProgress` "Paused at step N" from snapshot | 32b1_control_routing, 32b12, m3, 32b1 | **integrated** (browser unverified) | "wait" pauses on an incidental utterance; recoverable via resume → none required |
| resume | → `resume_workflow`, same step | same | same | utterance | snapshot | same | **integrated** | — |
| cancel | → `cancel_workflow` (irreversible) | same | same | utterance | snapshot "Cancelled" | 32b12 (ಸಾಕು, ನಿಲ್ಲಿಸು, बस), m3 (negation guards) | **unsafe** under hands-free | S1/S3: engine-side confirmation for cancel, plus a native-speaker review of ಬೇಡ / नहीं चाहिए / बस |
| repeat | current step or last reply, re-rendered in the current language | same | same | utterance | reply only | 32b1, 32b2, m6 (localized replay) | **integrated** | — |
| next | restates; resumes if paused | same | same | utterance | snapshot | 32b1, 32b14 | **integrated** | S8: add romanized phrases (engine data) |
| exit | `run_turn` → EXITED, `ended=true` | same | `ended` mapped | utterance | `setEnded` → input blocked → Finish | service_turn, frontend AssistantPage/Conversation tests | **partial** | S2: "बंद करो" → exit. S6: enforce EXITED in `run_turn` |
| ack / thanks | `_handle_acknowledgement` | same | same | utterance | reply | 32 (153 checks) | **integrated** | — |
| step reference | `_handle_step_reference` (read-only) | same | same | utterance | reply | 32b2 (407) | **integrated** (English only) | kn/hi step references not implemented — note only |
| switch choice | `_resolve_workflow_conflict` | same | same | utterance | snapshot | 32b14 (359) | **integrated** | — |
| help | LLM `type=help` → `handle_question` | same | same | utterance | reply | fakes only | **partial** (LLM-dependent) | S5: owner decision whether to add a deterministic "help" phrase in the engine |
| yes | resolver → LLM | same | same | utterance | snapshot step | 32b4 (yes → None, "I took the slip" → True) | **partial** (LLM-dependent) | S4: add tests with fake understanding for kn/hi "yes" |
| no | `contains_negation` → refusal; kn/hi exceptions = cancel | same | same | utterance | reply | m3 (146), 32b1 | **partial** | S3 |
| voice start/stop/reset/disable | n/a | n/a | n/a | mic button, account menu | `VoiceContext` | VoiceContext (+handsFree 23), Composer, useMicrophone | **integrated** (automated) | real-device validation pending |
| visit end | n/a (engine cache released) | `DELETE /sessions/{id}` | `SessionsService` → `endSession` | Finish / sign-out | navigate to `/scan` | backend `session-end.unit-spec` | **integrated** | — |

---

## 6. Safety conflicts, synchronization risks and untested cases

### 6.1 Domain separation: how the system tells workflow commands from capture actions

**Structurally, and correctly.**
- The frontend never interprets transcripts; voice capture responds only to UI events and the engine's `ended` flag (`VoiceContext.tsx`).
- The engine never learns about the microphone.
- So a spoken "stop" can **never** close the mic, and an on-screen stop can **never** change a workflow.

**Cross-domain effects that do exist (all code-verified):**

| Utterance | Workflow | Mic / voice session | Visit |
|---|---|---|---|
| "stop", "cancel", "ಸಾಕು", "बस" | **cancelled** | hands-free continues: the reply plays, the mic reopens | unchanged |
| "wait", "pause", "रुको" | suspended | hands-free continues; after 15 s of silence the session ends by itself | unchanged |
| "continue" | resumed | continues | unchanged |
| "exit", "bye", "बंद करो" | untouched (left ACTIVE) | hands-free **ends** (`ended`) | conversation closed in the UI; DB visit ends on Finish |

No command changes more than its intended domain, except **exit**. It deliberately ends the voice session too, and leaves an active workflow in place rather than cancelling it; that is harmless because the visit ends.

### 6.2 Conflicts

- **S1, incidental destructive cancel.**
  - Exact whole-utterance matching protects longer sentences ("stop sending me SMS" is not a cancel).
  - A **lone** "stop", "ಸಾಕು" or "बस" spoken to a companion and captured by hands-free endpointing (≥ 300 ms of speech) **is** a complete turn, and cancels.
  - The cancellation is final: `resume` on CANCELLED returns a status message.
  - There is no confirmation step anywhere (`handle_control_command`, the `cancel` branch).
- **S2, "बंद करो" = exit.** In Hindi this commonly means "stop it / switch it off". As an exit it closes the conversation in the UI, and the customer must Finish and rescan. A native-speaker decision is needed: is it exit, cancel, or neither?
- **S3, kn "ಬೇಡ" / hi "नहीं चाहिए" = cancel.** Both are everyday ways of saying "no / don't want". As a reply to a step instruction or a help offer, they cancel the workflow. Contrast English "no", which only routes through the negation guard and changes nothing.
- **S4 / S5, LLM dependence.** "yes", help, and polite or sentence-length cancels ("please cancel it") need Groq. On failure the engine is safe (no state change) but unhelpful.
- **S6, EXITED not enforced.** `run_turn` never checks `SessionState.EXITED`. A client other than this frontend, or a request already in flight, could keep talking to an exited conversation.
- **S7, timeout desync.**
  - NestJS aborts at 60 s, but Python keeps running and applies the control (`audio_turn` has no disconnect check).
  - The browser shows an error and the **previous** `WorkflowProgress` state, which is now wrong (e.g. still "Step 2 of 4" after a cancel).
  - There is no read-only snapshot endpoint to reconcile.
  - The frontend never claims a state the engine didn't return, so it never shows a *false success*, only a *stale* state.
- **S8, romanized gaps.** "agla", "aage kya", "mundina", "bye-bye" variants, "bahar niklo": none are in the tables; they reach the LLM or intent detection.

### 6.3 Workflow safety and idempotency checklist

| Property | Status | Evidence |
|---|---|---|
| Silence never advances | **Verified** | Phase 2 drops `no_speech` before upload (useMicrophone tests); the engine returns 422 for an empty transcript (`main.py:192`); `run_turn` with empty text is not recorded (`engine.py:212`); `test_service_turn` |
| Repeat does not advance | **Verified** | `repeat` branch reads only; 32b1, 32b2 |
| Help/questions keep the step | **Verified with fakes** | `handle_question` branch; 32b3, 25, 31 |
| Pause prevents progression | **Code + tests** | SUSPENDED; acknowledgements don't resume (32: "SUSPENDED + Thank you → stays SUSPENDED"); a completion report while SUSPENDED **implicitly resumes and advances** (`manager.py:~2722`), by design |
| Resume restores the correct workflow and step | **Verified** | `resume_workflow`, current step unchanged; `restore_paused_workflow` for switch-pause (32b14) |
| Cancel/exit semantics consistent | **Code-verified** | cancel = workflow only, irreversible; exit = visit only, workflow untouched |
| Duplicate control twice | **Code-verified idempotent** | pause→"already paused"; resume→"already active"; cancel→status message; next→restate. The per-visit lock serializes turns (`registry.in_turn`). Voice turns are never auto-retried; text retry (`canRetry`) resends once, which is harmless for controls |
| Frontend never claims an unconfirmed state | **Verified** | `setWorkflow` only after a successful response (`ConversationContext.deliver`); frontend tests pass |
| Failed HTTP never shows success | **Verified** | the catch path marks the message failed and sets `error`; the workflow is untouched |
| Re-listening cannot race a control turn | **Verified (automated)** | reopen only after playback `'ended'`; guards on `isSending`/turn/`ended`; 23 hands-free tests incl. mutation checks (Phase 3) |
| Spoken words never alter mic state | **Verified by construction** | no transcript parsing in `frontend/src` (grep); tests drive only UI actions |
| Real browser / microphone / LLM behaviour | **Unverified** | not run |

### 6.4 Untested paths

- **Indic yes/no:** Kannada/Hindi "yes" and "no" in an ACTIVE workflow with the real LLM.
- **Polite or sentence-length cancels** ("please cancel it", "ದಯವಿಟ್ಟು ರದ್ದು ಮಾಡಿ ಇದನ್ನು") in the LLM path.
- **The S7 timeout desync** end to end.
- **Hands-free** with real background speech containing control words.
- **Romanized "next" and exit.**

---

## 7. Tests executed

Python suites ran from `language_engine/` with `PYTHONDONTWRITEBYTECODE=1 PYTHONIOENCODING=utf-8 PYTHONPATH=.`, through a scratchpad wrapper that calls `evaluation.harness.install_network_guard()` (it refuses every non-loopback connection) and then `runpy.run_module`. Every output was scanned for `NetworkBlocked` and tracebacks: **0 and 0** in every suite.

```
venv/Scripts/python.exe <scratchpad>/guarded.py debugging.<suite>
```

| Suite | Covers | Result |
|---|---|---|
| test_phase32b1_control_routing | control routing in resting states | 223 passed, 0 failed |
| test_phase32b12 | kn/hi control phrases (ನಿಲ್ಲಿಸು, ಸಾಕು, रुको, बस…) | 117 checks, 0 failed |
| test_m3_language_cues | romanized/code-mixed phrases, negation guards (ನಿಲ್ಲಿಸಬೇಡಿ) | 146 passed, 0 failed |
| test_phase32 | acknowledgements never advance or resume | 153 passed, 0 failed |
| test_phase32b1 | control priority, polite controls | 445 passed, 0 failed |
| test_phase32b2 | step references are read-only | 407 passed, 0 failed |
| test_phase32b3 | side questions keep the step | 148 passed, 0 failed |
| test_phase32b4 | completion resolution ("yes" → None, "I took the slip" → True) | 264 passed, 0 failed |
| test_phase32b13 | LLM failure leaves state unchanged | 69 checks, 0 failed |
| test_phase32b14 | workflow-switch conflict choices | 359 checks, 0 failed |
| test_phase31 | dialogue invariants | 89 passed, 0 failed |
| test_phase25 | dialogue invariants | 130 passed, 0 failed |
| test_m5_normalization | ASR repair before routing | 70 passed, 0 failed |
| test_m6_localization | replies and replay in kn/hi | 93 passed, 0 failed |
| test_service_turn | HTTP path = CLI path | 135 checks, 0 failed |
| test_service_language | real handlers, language per turn | 88 passed, 0 failed |

Frontend (`frontend/`):

```
npx vitest run src/components/chat src/context src/pages/AssistantPage.test.tsx src/services/assistant src/hooks
```
**11 files, 215 tests passed.** These cover WorkflowProgress, Composer, ConversationContext, VoiceContext (+ hands-free), AssistantPage, the assistant client, useMicrophone and useSpeechPlayback.

**Not run, deliberately:**
- `debugging/test_dialogue.py`: real Groq.
- Backend e2e (`npm test`): database.
- `test_remediation`: TTS/audio device paths, not control-focused.
- Any live browser, microphone, Groq or TTS run.

Python unit results are **not** evidence of browser integration.

---

## 8. Prioritized minimal integration plan

Ownership stays where it is: **the engine decides dialogue/workflow semantics; NestJS and React stay adapters.** Nothing below duplicates engine logic outside Python.

| Priority | Change | Owner / files | Why minimal |
|---|---|---|---|
| **P1** | **Confirm destructive cancel.** In `handle_control_command`'s `cancel` branch, answer "Cancel your {workflow}? Say cancel again to confirm, or continue." and record a pending cancel. A second cancel confirms; anything else clears it. Reuse the existing `workflow_conflict` pending-question mechanism rather than a new one. | engine: `app/dialogue/manager.py` (+ tests) | one branch; no frontend change |
| **P2** | **Native-speaker review of the phrase tables:** decide on "बंद करो" (exit?), "ಬೇಡ", "नहीं चाहिए", "beda", "nahi chahiye" (cancel?), "बस" (cancel?). Move them, or remove them, per decision. | engine: `app/dialogue/multilingual_phrases.py` (+ 32b12/m3 tests) | data only |
| **P3** | **Enforce EXITED.** In `EngineRuntime.run_turn`, a conversation in `SessionState.EXITED` answers with the farewell and `ended=true` without routing. | engine: `service/engine.py` | ~5 lines |
| **P4** | **Reconcile after a failed/timed-out turn.** Add a read-only `GET /sessions/{id}/snapshot` (reusing `workflow_snapshot`), a NestJS pass-through, and a frontend refresh of `WorkflowProgress` on 504/502. | engine `service/main.py`; NestJS assistant client/controller; `ConversationContext` | adapter; the engine stays the source of truth |
| **P5** | Add romanized "next"/exit phrases; tests with fake understanding for kn/hi "yes"/"no" and polite cancels. | engine data + `debugging/` tests | data + tests |
| **P6** | Owner decision: a deterministic "help" phrase (en/kn/hi) routed to `handle_question` with the current step, so help survives an LLM outage. | engine | small; policy decision |
| **P7** | **Manual browser test plan** (needs running services): each control in en/kn/hi typed and spoken, under hands-free; incidental "stop"/"wait" from a second speaker; exit → Finish; timeout desync. | QA | validation only |

P1–P3 are the recommended fixes before hands-free use with real customers. P4 is recommended before relying on `WorkflowProgress` under slow ASR. P5–P7 can follow.

---

## 9. Files and working-tree verification

- **Created:** `language_engine/evaluation/reports/control_command_integration_audit.md` (this file) only.
- **Not modified:** any source file, test, fixture, configuration, environment file or existing report.
- **Preserved:** the uncommitted A1, Phase 1–3, deep-audit report and teammates' changes.
- **Snapshots:** `git status --short`, `git status --short -uall` and `git diff --stat` were captured before the audit and compared after writing this report. The only expected difference is this new untracked file inside the already-untracked `language_engine/evaluation/` directory.
- **Not done:** no database access, migrations, service start/restart, external API calls (all Python suites ran behind the network guard), commits, pushes, resets, restores or stashes.

## Recommendation

**Ready for integrated browser testing, with targeted engine fixes recommended before real-customer hands-free use.**
- Controls are implemented once, in the engine, and are reachable and correctly reflected end to end.
- The voice/workflow/visit domains are structurally separated.
- The blockers are **policy and data decisions inside the engine** (P1–P3), not architectural ones.
- Continuous hands-free conversation remains blocked by the separate TTS 403 (Phase 1B).
