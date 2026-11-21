# Deep Language Engine Audit — Integration Contract and Collision Analysis

Date: 2026-10-21 · Scope: `language_engine/`, `backend/`, `frontend/` · Mode: read-only (this report is the only file created)

Every claim below cites the code it rests on. "Verified" means read in code **and** covered by a test that was run, unless stated otherwise. Line numbers refer to the working tree at audit time, including the uncommitted A1 fix.

---

## 1. Executive summary

The language-engine team's claims were treated as hypotheses. Result:

| Claimed behaviour | Implemented? | Where it runs | Available to the web app? |
|---|---|---|---|
| Continuous microphone listening | **Yes** | CLI only: `VoiceAssistantPipeline.run()` loop, `app/pipeline/voice_pipeline.py` | **No.** Records from a `sounddevice` microphone on the machine running Python |
| VAD + end-of-speech after silence | **Yes** (Silero, 800 ms) | CLI only: `AudioRecorder.record()/_capture()`, `app/speech/recorder.py` | **No.** The HTTP service never constructs `AudioRecorder` |
| Automatic re-listening after a reply | **Yes** | CLI only: the `while True` loop records again after `speak()` returns | **No.** One utterance per HTTP request; the browser closes the mic after each tap |
| Workflow progression from natural replies ("I took the deposit slip", "yes") | **Yes** | `DialogueManager.generate_response()` + `resolve_step_completion()` | **Yes.** Same code via `EngineRuntime.run_turn()` → `VoiceAssistantPipeline._respond` |
| Repetition, clarification, recovery | **Yes** | `DialogueManager` control tier, `handle_question`, failure branches | **Yes** |
| Spoken reply in the selected language | **Yes** (catalog localization + per-sentence voice) | `ResponseLocalizer`, `speech_plan.plan_speech`, `service/tts.synthesize` | **Exposed** via `/tts`, but `/tts` currently returns 422 in the field (cause not established, §6) |
| Follow-up prompts after prolonged silence | **No** | Nowhere. The CLI silently re-listens after 15 s | **No** |

**The core architectural fact:** the continuous loop belongs to a single-user terminal program. It reads audio from a local device (`sd.InputStream`, `recorder.py:399-406`) and plays speech through local speakers (`pygame`, `app/speech/tts.py` `_play`). A browser customer's microphone is not reachable from Python. The loop therefore **cannot** be reused as-is by the web app. What *can* be reused is:

- every stage the loop calls per utterance (ASR, routing, dialogue, localization, speech planning), which the HTTP service already reuses;
- the loop's *policy* (VAD timing parameters, the "silence is not an utterance" rule, the speak-then-listen ordering).

The browser must own capture, endpointing and the listen/speak cycle. The engine stays the only owner of dialogue and workflow state.

---

## 2. Language-engine module inventory

Line counts from `wc -l` at audit time. "Used by HTTP" means reachable from `service/main.py`.

| Module | Lines | Responsibility | CLI | HTTP |
|---|---:|---|:-:|:-:|
| `app/main.py` | 70 | CLI entry; builds `VoiceAssistantPipeline` and calls `run()` | ✔ | – |
| `app/pipeline/voice_pipeline.py` | 497 | CLI loop (`run`, `listen`, `speak`) and the shared per-turn router `_respond` | ✔ | `_respond` only |
| `app/speech/recorder.py` | 731 | `VadConfig`, Silero VAD loader, `AudioRecorder` (VAD-bounded capture to `temp_recording.wav`) | ✔ | – |
| `app/speech/stt.py` | 39 | `SpeechToText` façade over the ASR router | ✔ | ✔ |
| `app/speech/asr/{base,factory,whisper_provider,indic_conformer_provider}.py` | 77/147/68/270 | Provider routing (kn/hi→IndicConformer, en→Whisper), fallback, decoding (A1: ffmpeg for non-WAV) | ✔ | ✔ |
| `app/speech/tts.py` | 249 | `sanitize_for_speech`, `TextToSpeech.VOICES`; CLI playback through pygame | ✔ | sanitizer + voice map only |
| `app/speech/speech_plan.py` | 142 | Per-sentence voice choice by script; refuses unreadable scripts | ✔ | ✔ |
| `app/conversation/{manager,state}.py` | 503/58 | `ConversationManager` (one workflow slot, history, entities); `SessionState`, `WorkflowState` | ✔ | ✔ (one per visit) |
| `app/dialogue/manager.py` | 3561 | `DialogueManager`: control tier, acknowledgements, step references, conflicts, completion, questions | ✔ | ✔ |
| `app/dialogue/completion_semantics.py` | 802 | Deterministic, current-step-aware `resolve_step_completion` | ✔ | ✔ |
| `app/dialogue/llm/dialogue_understanding.py` | 1131 | Groq structured understanding + question answering (`openai/gpt-oss-20b`) | ✔ | ✔ |
| `app/dialogue/llm/answer_language.py` | 64 | Prompt rules making generated answers come back in the session language | ✔ | ✔ |
| `app/dialogue/localization{,_catalog}.py` | 300/274 | `ResponseLocalizer`: canonical English → kn/hi from an authored catalog; replay | ✔ | ✔ |
| `app/dialogue/{multilingual_phrases,multilingual_negation,multilingual_questions,text_normalization,term_normalizer,indic_numbers,workflow_conflict,side_question_context}.py` | — | Kannada/Hindi phrase tables, negation, question cues, ASR repair, spoken amounts, conflict and side-question memory | ✔ | ✔ |
| `app/intent/{detector,intent_examples,routing_safety,service_keywords,intents}.py` | 288/336/235/225/6 | Embedding intent classifier over 5 intents, with abstention | ✔ | ✔ |
| `app/knowledge/*` | — | Retrieval for knowledge answers (used by dialogue understanding) | ✔ | ✔ |
| `app/workflow/loader.py` + `workflows/*.json` | 268 | Workflow definitions (`deposit`, `withdraw`, `apply_for_loan`; ordered `instruction` steps) | ✔ | ✔ |
| `app/dialogue/action_detector.py`, `app/dialogue/llm_action_detector.py`, `app/translation/translator.py` | 68/80/75 | **Not imported anywhere in `app/` or `service/`** (grep) | – | – |
| `service/main.py` | 259 | FastAPI: `/health`, `/turn`, `/turn/audio`, `/tts`, `DELETE /sessions/{id}` | – | ✔ |
| `service/engine.py` | 310 | `EngineRuntime` (shared models), `transcribe`, `run_turn` | – | ✔ |
| `service/registry.py` + `housekeeping.py` | 271/123 | Per-visit `SessionEntry` (conversation, language, localizer, lock), idle purge | – | ✔ |
| `service/{tts,language,snapshot,models,config}.py` | 261/42/47/53/154 | Synthesis, language normalization, workflow snapshot, wire models, `.env` loading | – | ✔ |

---

## 3. Continuous listening: exact call flow (CLI only)

### 3.1 Call flow

```
app/main.py:main()
 └─ VoiceAssistantPipeline.__init__()            voice_pipeline.py:51
      AudioRecorder()  (preloads Silero)          recorder.py:336, load_vad_model():290
      SpeechToText(), TextToSpeech(), IntentDetector(),
      ConversationManager(), DialogueManager(intent_detector=…), ResponseLocalizer()
 └─ run()                                          voice_pipeline.py:195
      select_language() / select_input_mode()     terminal input()
      while True:
        state ← LISTENING
        listen(mode, lang)                         :115
          AudioRecorder.record()                   recorder.py:412
            vad.reset_states(); open sd.InputStream(16 kHz, mono, 512-sample blocks)
            _capture()  WAITING → RECORDING → done :478
            _finalize() → path | None              :655
          None → return ""     (STT is NOT run on silence)
          stt.transcribe(path, language) → text; recorder.cleanup()
        "" → "No speech detected. Listening again…", state ← READY, continue
        normalize_turn → detect_control → exit? break
        add_history(User) → _respond(control, text) → add_history(Assistant)
        localizer.render(reply) → state ← SPEAKING
        speak() → TextToSpeech.speak() → per segment: edge-tts → pygame play,
                  BLOCKS while get_busy()          app/speech/tts.py:_play
        state ← READY            → loop records again
```

### 3.2 VAD contract (`VadConfig`, `recorder.py:52-126`, overridable via `VAD_*` env, validated by `validate()`)

| Parameter | Default | Meaning (from code) |
|---|---|---|
| `sample_rate` / `frame_samples` | 16000 / 512 (32 ms) | Fixed by Silero; anything else is rejected |
| `start_threshold` | 0.5 | Probability needed to *start* |
| `continue_threshold` | 0.35 | Hysteresis while recording |
| `start_frames` | 2 (64 ms) | Consecutive speech frames before recording starts |
| `pre_roll_ms` | 320 | Audio kept from before the trigger |
| `end_silence_ms` | **800** | Silence that ends the utterance |
| `min_speech_ms` | 300 | Shorter captures → `None` (`TOO_SHORT`) |
| `max_recording_ms` | 30000 | Safety ceiling from onset (`MAX_DURATION`) |
| `max_wait_ms` | **15000** | No speech → `None` (`NO_SPEECH_TIMEOUT`) |

Outcomes (`AudioRecorder.SPEECH_ENDED / MAX_DURATION / NO_SPEECH_TIMEOUT / TOO_SHORT / INTERRUPTED`) are counted in frames, not wall-clock time. A stream dying mid-speech keeps what was captured (`INTERRUPTED`).

### 3.3 Runtime assumptions and state

- **A local audio device is mandatory:**
  - `import sounddevice as sd` sits at module level (`recorder.py:38`), so even importing the recorder needs PortAudio.
  - `_open_microphone()` opens the default input device of the *Python host*.
  - Playback needs a pygame mixer on that same host (`_ensure_mixer`).
- **Single user:**
  - Recordings go to a fixed filename, `temp_recording.wav` (`AudioRecorder.__init__`).
  - One `ConversationManager` per process.
  - CLI TTS writes `tts_<uuid>.mp3` into the current directory. A leftover `language_engine/tts_42c0…mp3` exists in the tree.
- **Echo safety is structural.** `speak()` blocks until playback finishes and only then does the loop call `record()`. Capture and playback never overlap. There is no echo cancellation; none is needed under that ordering.
- **Silence carries no meaning:**
  - `record()` returning `None` never changes workflow state (module docstring; `run()` only sets `READY` and continues).
  - There is **no follow-up prompt**. After 15 s of silence the loop just opens the microphone again.
- **Errors:**
  - `RecorderError` and STT exceptions are caught in `listen()`, which returns `""` (one lost turn).
  - A TTS failure is printed and swallowed (`speak()`, `_play`), and the loop continues to listen.
- **Tests:** `debugging/test_vad_recorder.py` (85 checks, fake VAD and scripted streams; no device). There is no test of a real microphone.

### 3.4 Why the HTTP service does not use this loop

- `service/engine.py` (module docstring and `_TurnHost`) deliberately reuses only `VoiceAssistantPipeline._respond`, "without constructing a pipeline that would try to open a microphone and a speaker on the server".
- `EngineRuntime.transcribe` notes that the recorder's fixed filename is "a collision waiting to happen for concurrent web requests".
- Each `/turn/audio` request carries one finished recording. Turn boundaries are decided by whoever produced the upload, which today is the customer's second tap.

**Narrowest reusable boundary for the web:**

- the `VadConfig` numbers, as a contract;
- the "silence → no turn" rule;
- `AudioRecorder`'s injectable `stream_factory`/`vad` parameters (`recorder.py:336-352`). These would let the existing `_capture`/`_finalize` state machine run over an *uploaded* waveform server-side, for example as a "contains speech?" gate. That is possible but **not** real-time endpointing: the audio arrives only after the browser has already stopped recording.

---

## 4. Workflow and dialogue behaviour; state-transition rules

### 4.1 State ownership

- `ConversationManager` (`app/conversation/manager.py`) owns **everything**:
  - `workflow_state` (`NONE/ACTIVE/SUSPENDED/COMPLETED/CANCELLED`), `current_intent`, `current_workflow`, `current_step`, `entities`, `history`;
  - `recent_side_question`, `workflow_conflict`, and one `paused_workflow` snapshot.
  - It has exactly **one** workflow slot (`PausedWorkflow` docstring, `state.py`).
- `SessionState` (`IDLE/READY/LISTENING/PROCESSING/SPEAKING/EXITED`) is the assistant's activity. Over HTTP only `PROCESSING`, `READY` and `EXITED` are ever set (`EngineRuntime.run_turn`). `LISTENING`/`SPEAKING` are CLI-only and meaningless to the web.
- No other component holds dialogue or workflow state. `ResponseLocalizer` holds only the language and the last canonical reply (for replay). `SessionEntry` holds the conversation, language, localizer and lock.

### 4.2 Turn routing (`VoiceAssistantPipeline._respond`, used by both CLI and HTTP)

1. `normalize_turn(raw).routing` (ASR repair, loanwords) → `DialogueManager.detect_control` → `classify_turn` (`manager.py:814`). These are exact-phrase tables, ≤ 4 words, in English, Kannada and Hindi (`multilingual_phrases`).
2. Control found → `handle_control_command` (`manager.py:1221`).
3. Workflow not resting (`ACTIVE`/`SUSPENDED`) → `generate_response`.
4. Resting state → `answer_general_question`, then `IntentDetector.detect_intent`. If not banking → `handle_non_banking_request`. A negation or refusal → `handle_refused_request`. Otherwise → `start_workflow`.

### 4.3 How specific replies are interpreted

| Utterance class | Rule (code) | Effect on state |
|---|---|---|
| "pause", "hold on", **"wait"**, "give me a moment" | `WORKFLOW_CONTROL_PHRASES["pause"]` (`manager.py:73`) | `ACTIVE → SUSPENDED` |
| "resume", "continue", "carry on" | `["resume"]` | `SUSPENDED → ACTIVE`, step restated |
| "cancel", **"stop"**, "never mind", "forget it" | `["cancel"]` (`manager.py:81`) | `→ CANCELLED` |
| "repeat", "again", "pardon" | `["repeat"]` | none; current step restated / last reply replayed in the current language |
| "next", "what next" | `["next"]` | none; **restates** the current step (does not skip) |
| "okay", "got it", "thank you" | `ACKNOWLEDGEMENT_PHRASES` (`manager.py:133`) → `_handle_acknowledgement` (`:1578`) | none; restates the step when `ACTIVE`; never resumes a `SUSPENDED` workflow |
| "what is step 2?" | `classify_step_reference` → `_handle_step_reference` (`:1664`) | none (documented as never mutating) |
| **"yes", "done"** | Deliberately **excluded** from the phrase tables (`manager.py:123`) | Decided by completion resolution (below) |
| "I took the slip" / "I entered the amount" | `resolve_step_completion` (`completion_semantics.py:740`) → `True` when a REPORT clause refers to the **current** instruction | `current_step += 1` exactly once (`manager.py:2732`); past the last step → `complete_workflow()` |
| "How do I fill this?" / "I don't understand" | LLM `type` in `{help, question}` → `handle_question` with the current step as context | none |
| uncertain / unknown | `"Okay. {instruction} Take your time and let me know when you are ready."` | none |
| A different service mid-workflow | `_detect_workflow_conflict` (`:1896`) → conflict question; `stash_paused_workflow` / `restore_paused_workflow` | asks before switching |
| "exit", "bye" | `SESSION_EXIT_PHRASES` | `SessionState.EXITED`, `ended=true` |

**Completion resolution** (`manager.py:2702-2740`):

- `resolve_step_completion` returns one of:
  - `True`: a clause reports *this* step done;
  - `False`: every clause is a question, help request, refusal or intention;
  - `None`: undecided. This covers bare "yes", "done", any completion naming another step, and **every non-English utterance** (module comments).
- Only on `None` is the LLM's `step_completed`/`action == "complete"` used.
- Test evidence (`debugging/test_phase32b4.py`, run here):
  - `("I took the slip", SLIP_STEP, True)` and `("Yes, I entered the amount.", AMOUNT_STEP, True)`;
  - `("yes", AMOUNT_STEP, None)` and `("Yes, next.", AMOUNT_STEP, None)`.

So a bare **"yes"**, and every Kannada or Hindi confirmation, **depends on the Groq call**.

**LLM failure never advances:**

- `generate_response` checks `understanding_failed` first (`manager.py:~2439`) and returns "Sorry, I didn't catch that. {instruction}" with no state change.
- `run_turn` turns any exception into an apology and returns `READY` (`service/engine.py:259-276`).

### 4.4 Duplicate-advancement protection

- **What exists:**
  - one increment per turn, on one path (`manager.py` comments at the completion branch);
  - per-visit serialization through `SessionRegistry.in_turn` → `with entry.lock` (`registry.py:167,190`), so two requests for one visit cannot interleave.
- **What does not exist:**
  - no idempotency key or turn id on `/turn` or `/turn/audio`;
  - no client-disconnect check.
- **Consequence:** a turn whose HTTP caller timed out still completes and advances (`audio_turn` never checks for disconnect; NestJS aborts at 60 s, `http-ai-engine.client.ts:42,182`). If the customer then repeats "I took the slip", the step advances twice. This is derived from the code, not reproduced live.
- **Frontend retry:** the conversation's retry button resends only **text** (`pendingRef` is set only for text, `ConversationContext.tsx` deliver/catch). So a failed voice turn is never resent automatically.

### 4.5 Silence follow-ups

None exist. A grep for re-prompt, nudge and "still there" style wording in `app/` and `service/` finds nothing. Silence never reaches the dialogue layer, in the CLI (recorder returns `None`) or the web (nothing is uploaded).

---

## 5. ASR, translation and TTS contracts

### 5.1 ASR

- **Entry:** `EngineRuntime.transcribe(audio: bytes, *, language, suffix) -> str` (`service/engine.py:107`).
  - It writes a `mkstemp` temp file, calls `SpeechToText.transcribe(path, language)`, and always deletes the file.
  - Any exception becomes `TranscriptionError("The recording could not be understood.")`.
- **Routing:** `RoutingSpeechRecognizer` (`asr/factory.py`).
  - Defaults: `kn`/`hi` → IndicConformer, `en` → Whisper (`ASR_*` env).
  - Fallback is used only when the fallback provider supports the language, and is flagged `fallback_used` with `fallback_errors`.
- **Decoding (A1, uncommitted):** `indic_conformer_provider.read_waveform` sends non-WAV input through `decode_with_ffmpeg` (16 kHz mono), and decodes before the model loads. Whisper decodes for itself through ffmpeg.
- **Silence guard is missing on the web path:**
  - The CLI never runs STT on silence ("Whisper is deliberately not run on silence… it is what makes Whisper invent filler text", `voice_pipeline.py:listen`).
  - The web path runs ASR on whatever is uploaded. An empty transcript → 422 "I could not hear anything in that recording." (`main.py:192-196`).
  - A near-silent upload that Whisper "hears" as "Thank you." is routed as a real turn. No equivalent guard exists on `/turn/audio`.

### 5.2 Translation and localization

- **No machine-translation service is in the turn path.** `app/translation/translator.py` is not imported.
- `ResponseLocalizer.render(reply, remember)` maps canonical English sentences to authored kn/hi renderings (`localization_catalog`).
  - Unmatched fixed text stays English with an explicit marker (`UNTRANSLATED_MARKER`).
  - LLM-generated answers pass through unchanged; `answer_language_rules` asks the LLM to answer in the session language.
- History always stores canonical English (`run_turn`). `repeat` re-renders in the *current* language.
- The language is decided by NestJS from the visit (`session.language`). `normalise_language` (`service/language.py`) reduces it once for ASR, localizer and TTS. `SessionEntry.apply_language` changes all three under the turn lock.

### 5.3 TTS

- `/tts` takes `TtsRequest{text: 1..2000, language: 2..16 chars, default "en"}` and returns `Response(audio, media_type)` with `Cache-Control: no-store`.
- `synthesize` steps:
  1. `validate_text`;
  2. `select_voice(session)` (voices: `en-IN-NeerjaNeural`, `kn-IN-SapnaNeural`, `hi-IN-SwaraNeural`);
  3. `sanitize_for_speech`;
  4. `plan_segments` → `plan_speech` (sentence split, voice by majority script, other scripts refused);
  5. one edge-tts call per voice run, written to a temp `.mp3`, read back and deleted;
  6. `join_mp3`;
  7. `detect_content_type`.
- **Error mapping** (`main.py:212-231`):
  - `UnsupportedLanguageError` → **400**;
  - any other `TtsError` → **422**;
  - anything else → **500** (generic handler).
- The response text is spoken unchanged (segments are slices of the sanitized reply; `test_m8_speech` asserts this).
- Tests: `debugging/test_m8_speech.py` (69, edge-tts stubbed) and `test_service_language.py` (88).

---

## 6. Existing TTS failure (HTTP 422)

**Exception path:**

1. Browser `VoiceContext.speakReply` (`VoiceContext.tsx:137`) → `HttpAssistantClient.speak` → `POST /api/assistant/speak`.
2. `SpeakDto` validation: `sessionId` must be a UUID; `text` must be a non-empty string of ≤ 2000 characters.
3. `AssistantService.speak` → `HttpAiEngineClient.synthesize` → `POST {AI_ENGINE_URL}/tts` with `{text, language: session.language}`.
4. `service/main.py:speak`. A 422 is produced by `except TtsError` here.

**The only sources of that `TtsError`:**

| # | Raised in | Message | Condition |
|---|---|---|---|
| a | `validate_text` | "There is nothing to read out." | Text blank after `strip()` (passes `SpeakDto` if it is whitespace) |
| b | `validate_text` | "That response is too long to read out." | > 2000 characters; `SpeakDto` blocks this first |
| c | `synthesize` | "There is nothing to read out." | Empty after `sanitize_for_speech` (e.g. Markdown-only) |
| d | `synthesize` loop | "The spoken reply could not be produced." | **Any** exception from edge-tts `Communicate(...).save()` or file I/O, or an empty part |

Pydantic validation of `TtsRequest` would also return 422, but NestJS already enforces the same bounds, and `session.language` is always a 2-letter code. Language and script refusals are 400, not 422.

**What is currently observable:**

- Python logs nothing: the inner exception is chained (`from error`) and never logged.
- NestJS logs only `Speech service returned 422` (`http-ai-engine.client.ts:121`). It **does** forward the string `detail` to the browser as the HTTP error message (`:123-126`).
- The frontend catches every error and shows a generic message (`VoiceContext.tsx:147-149`).

**What must be observed later (no external call made in this audit):**

1. The response body of a failing `POST /api/assistant/speak` in browser DevTools. "could not be produced" means (d); "nothing to read out" means (a/c).
2. If (d): the inner exception class from edge-tts, which needs a one-line log of `type(error).__name__` in `service/tts.py` (a future change, not made here).
3. The text being spoken at the time of failure, for example whether the greeting or a Markdown-only reply triggers (c).

The root cause is **not established**.

---

## 7. Frontend voice flow (as implemented)

| Step | Code | Behaviour |
|---|---|---|
| 1 Activation | `VoiceContext.enable()` (`:234`) | Stores the preference and unlocks audio inside the tap. **Does not** open the mic: "There is no continuous listening anywhere in this provider." (`:96`) |
| 2 Mic acquisition | `useMicrophone.start()`; `getUserMedia({audio: true, video: false})` (`useMicrophone.ts:210`) | Fresh stream on every tap; browser-default constraints (no explicit `echoCancellation`) |
| 3 Recording / silence | `MediaRecorder.start()`; ends only on `stop()` (`:285`) via the second tap (`Composer.handleMicPress`, `VoiceOverlay.handleMicPress`) | **No VAD, no silence end, no max duration, no no-speech timeout** |
| 4 Upload | `onstop` (`:248`) → `handleRecorded` (`VoiceContext.tsx:167`) → `sendVoice` → multipart `sessionId` + `audio` (`utterance.webm`) to `/api/assistant/voice`, 60 s | — |
| 5 Response | `deliver` reads `{reply, transcript, workflow, ended}`; replaces the "Voice message" placeholder with the transcript | — |
| 6 Speech | `speakReply` → `/api/assistant/speak` → `useSpeechPlayback.play(blob)` | Skipped if the turn is stale or the mic is recording (`:154-159`) |
| 7 Re-listen | — | **None.** `handleRecorded` always ends with `setActivity('idle')` |
| 8 Pause / stop / cancel | Tap during processing or speaking → `reset()` (`:224`): bumps the turn counter, `micCancel`, `playback.stop` | Abandons the turn; no "voice mode paused" state |
| Errors | Upload: message marked failed + banner; voice is not resendable. Speech: `speechError`, silent | Both end at `idle` |
| Cleanup | `disable()` → `reset()`; hook unmount stops tracks | — |

Playback: `play()` resolves identically on `ended`, `error`, `play()` rejection and `stop()` (`useSpeechPlayback.ts`), so callers cannot tell success from failure.

The tests encode tap-to-talk, e.g. `VoiceContext.test.tsx:187` "moves to listening only when the customer starts it", and `Composer.test.tsx:78`.

---

## 8. NestJS ⇄ Python integration contracts

All NestJS routes use the global `api` prefix (`backend/src/main.ts:20`), the global JWT guard, and `resolveSession(userId, sessionId)`. The latter returns 403 unless the id is the caller's active visit.

| Browser → NestJS | Request | NestJS → Python | Python request | Python response | NestJS response |
|---|---|---|---|---|---|
| `POST /api/assistant/message` | `SendMessageDto{sessionId: UUID, text: 1..4000}` | `sendText` → `POST /turn` | JSON `{session_id, language, text}` (`TextTurnRequest`: text 1..4000, language 2..16) | `TurnResponse{reply, transcript: null, workflow{name, state, step, total_steps}, ended}` | `AssistantReplyView{reply, transcript, workflow{name, state, step, totalSteps}, ended}` |
| `POST /api/assistant/voice` | multipart `sessionId` + `audio` (Multer memory, ≤ 10 MB, 1 file); `audio/*` required | `sendAudio` → `POST /turn/audio` | multipart `session_id`, `language`, `audio` (filename `utterance.<ext>` from MIME) | same, with `transcript` = raw ASR text | same |
| `POST /api/assistant/speak` | `SpeakDto{sessionId, text ≤ 2000}` | `synthesize` → `POST /tts` | JSON `{text, language}` | audio bytes, sniffed `Content-Type` | `StreamableFile`, same `Content-Type`, `no-store` |
| (visit end) `SessionsService.end…` → `releaseConversation` | — | `endSession` → `DELETE /sessions/{id}` | — | `{removed: bool}` | best effort; failures only logged (`sessions.service.ts:154-165`) |

- **Language/context:** the language always comes from `session.language` (DB, set from `preferredLanguage` at visit creation). The browser never sends it.
  - Branch/QR context stays in NestJS (`sessions.service.ts` `branchId`). **It never reaches the engine**, which has no branch awareness. That is a clean separation.
- **Timeouts:** NestJS `AI_ENGINE_TIMEOUT_MS = 60000` (`backend/.env`) per call through an `AbortController`. The frontend uses 60 s too (`httpAssistantClient.ts:17`). Python has none; it keeps working after the abort.
- **Error mapping:**
  - Python 4xx with a string `detail` → same status and detail to the browser;
  - other 4xx → generic message, same status;
  - 5xx → 502;
  - unreachable or aborted → 504.
- **Engine `/health`** is never called by NestJS (its `HealthModule` does not use the engine client).
- **State preservation:**
  - The engine keeps each visit's conversation **in process memory**, keyed by `session_id` (`SessionRegistry.get_or_create`). Each turn resumes it, so HTTP **does preserve dialogue and workflow state** between requests.
  - It does **not** survive an engine restart, idle purge (default 1 h, `ENGINE_SESSION_IDLE_SECONDS`), or LRU eviction past 500 visits. All three silently create a fresh conversation for the same `session_id`, and the DB visit stays open.
  - The engine holds **no voice-session state** (listening/speaking). That must live in the frontend.
- **`ended`:** set when the customer says exit. The frontend shows "This visit has ended" and a Finish button, which calls `endSession` and so releases the engine conversation (`AssistantPage.tsx:63-67`).

---

## 9. Cross-module responsibility and collision matrix

Legend: **CLI** = Python CLI only · **HTTP** = Python service · **FE** = browser orchestration · **—** = missing.

| Responsibility | Authoritative owner today | CLI | HTTP | FE | Duplication / conflict |
|---|---|:-:|:-:|:-:|---|
| Microphone capture | Browser (`useMicrophone`) for web; `AudioRecorder` for CLI | ✔ | — | ✔ (tap) | Two implementations for two different devices. Not a conflict; must not be merged |
| VAD / end-of-speech | `AudioRecorder` (Silero) | ✔ | — | — | **Gap on web.** Silero runs only in Python |
| No-speech timeout | `VadConfig.max_wait_ms` | ✔ | — | — | Gap on web |
| Turn boundary | CLI: VAD. Web: the customer's second tap | ✔ | (receives finished uploads) | ✔ | — |
| "Silence is not a turn" | `listen()` returns `""` | ✔ | ✗ (ASR runs on any upload; empty → 422) | — | **Conflict risk** once capture is automatic (§5.1) |
| Audio decoding / ASR | `EngineRuntime.transcribe` → router | ✔ | ✔ | — | None |
| Normalization / control / intent | `normalize_turn`, `classify_turn`, `IntentDetector` | ✔ | ✔ (same code) | — | None |
| Dialogue & workflow state | `ConversationManager` + `DialogueManager` | ✔ | ✔ (per-visit registry) | display only (`WorkflowProgress`) | None. Keep the frontend read-only |
| Workflow "pause" | `WorkflowState.SUSPENDED` via spoken pause phrases | ✔ | ✔ | — | **Name collision** with a voice-mode "pause" (see C2) |
| Translation / localization | `ResponseLocalizer` (catalog) + LLM answer rules | ✔ | ✔ | — | `translator.py` unused |
| TTS generation | `service/tts.synthesize` (HTTP); `TextToSpeech._play` (CLI) | ✔ | ✔ | — | Shared sanitizer, voices and speech plan. No conflict |
| Playback | pygame (CLI); `useSpeechPlayback` (web) | ✔ | — | ✔ | — |
| Speak-then-listen ordering | Structural in the CLI loop | ✔ | — | ✗ (no loop) | Must be reproduced by the frontend |
| Voice-session lifecycle | `SessionState` (CLI) / `VoiceActivity` (FE) | ✔ | partial, not exposed | ✔ | Engine `SessionState` over HTTP is not meaningful; **the frontend must own it** |
| Timed silence follow-ups | — | — | — | — | **Missing entirely** |
| Error recovery | Dialogue: `understanding_failed`, apology. CLI: lost turn. Web: banner, `idle` | ✔ | ✔ | partial | Voice not retryable; timed-out turns still applied server-side |
| Visit lifecycle | NestJS DB session (authoritative) → engine cache | — | cache | ✔ | Engine reset silently loses workflow progress |

### Specific collisions to design around

- **C1: spoken control words vs. ambient speech.**
  - "stop" **cancels** the workflow and "wait" / "hold on" **suspends** it (`manager.py:73-86`).
  - With automatic capture, an incidental "wait" said to a companion becomes a workflow pause. A customer saying "stop" to end listening cancels their banking task.
  - Voice-mode controls must therefore be **UI controls**, never new spoken commands added to these tables.
- **C2: two different "pause" concepts.**
  - Workflow pause is dialogue state, owned by the engine and reached by speech.
  - Voice-mode pause (mic off) is UI state, owned by the frontend.
  - Neither may trigger the other.
- **C3: phantom turns.**
  - Automatic capture without a speech gate would upload silence or noise.
  - Whisper's hallucinated "Thank you." is an acknowledgement (harmless). Other hallucinations reach intent detection; the CLI avoids this by never running ASR on silence (§5.1).
- **C4: echo.**
  - Safe in the CLI by ordering, and in the browser today because the mic is never open during playback.
  - An auto-relisten loop must re-open the mic only **after** `play()` really ended, which needs a distinguishable outcome (§7).
- **C5: duplicate advancement after timeouts (§4.4).**
- **C6: engine state loss.** Restart, purge or eviction silently resets a visit's workflow while NestJS and the frontend still show the old snapshot until the next reply.

---

## 10. Verified gaps, unverified assumptions, known defects

**Verified gaps (code + tests):**

- G1: no browser end-of-speech detection, no-speech timeout or max duration (`useMicrophone.ts`; `VoiceContext.tsx:96`).
- G2: no automatic re-listening (`handleRecorded` ends at `idle`).
- G3: playback outcome not distinguishable (`useSpeechPlayback.play`).
- G4: no silence follow-up prompts anywhere (grep, §4.5).
- G5: no speech gate on `/turn/audio` equivalent to the CLI's (`main.py:audio_turn`).
- G6: voice turns are not retryable (`pendingRef` text-only).

**Unverified (needs runtime evidence; not tested in this audit):**

- U1: real browser recordings decode and route to IndicConformer end to end (A1 is only fixture-tested).
- U2: LLM interpretation of bare "yes" and of Kannada/Hindi confirmations (depends on Groq; offline tests use fakes).
- U3: the TTS 422 cause (§6).
- U4: browser-default echo cancellation is effective on target devices.
- U5: latency of IndicConformer and Whisper on the deployment CPU.

**Known defects (from code; carried from the earlier diagnosis):**

- D1: `/tts` 422 is unlogged.
- D2: `async def audio_turn` runs blocking ASR and LLM work on the event loop (`main.py:149`).
- D3: equal 60 s timeouts, with no server-side cancellation (C5).
- D4: the Groq client uses SDK defaults (60 s, 2 retries), which can exceed the turn budget.
- D5: engine state loss is silent (C6).
- D6: unused modules (`action_detector.py`, `llm_action_detector.py`, `translator.py`). There is no defect, but they could mislead integrators.

---

## 11. Recommended integration plan (small phases, reuse-first)

Principles:

- The engine remains the **only** owner of dialogue and workflow state.
- The browser owns capture, endpointing, playback and the voice-session lifecycle.
- No CLI code is moved or rewritten.
- The HTTP contract changes only additively.

| Phase | Change | Reuses | Files (expected) |
|---|---|---|---|
| **I1 – Observability (no behaviour change)** | Log `type(error).__name__` for `TtsError` causes; include `detail` in NestJS warn logs | §6 path | `service/tts.py`, `http-ai-engine.client.ts` |
| **I2 – Browser endpointing** | Web Audio `AnalyserNode` energy gate in `useMicrophone` using the **`VadConfig` numbers as the contract** (800 ms end silence, 300 ms minimum speech, 15 s no-speech, 30 s maximum, 320 ms pre-roll). Too-short or no-speech captures are discarded locally and never uploaded (the CLI's "silence is not a turn" rule). No new dependency | `VadConfig` policy; existing upload path unchanged | `useMicrophone.ts` + tests |
| **I3 – Voice-session loop** | `play()` reports `ended/failed/stopped`; a frontend `voiceMode` state (`active/paused`) re-arms the mic **after** playback ends or after a recoverable error (bounded retries). Stops on `ended`, disable, pause or route change. Pause/stop are UI controls only (C1/C2). Request `echoCancellation`/`noiseSuppression` explicitly | Existing turn counter, `reset`, `speakReply` guards | `useSpeechPlayback.ts`, `VoiceContext.tsx`, the tests that encode tap-to-talk, button handlers |
| **I4 – Server-side speech gate (optional, defence in depth)** | Before ASR in `/turn/audio`, run the existing `AudioRecorder` capture state machine over the decoded upload through its `stream_factory`/`vad` injection points, or call `load_vad_model()` directly. No speech → a distinct "no speech" response the frontend treats as re-listen, not as an error | `recorder.py` (`load_vad_model`, `VadConfig`, `_capture`/`_finalize` through injection); A1 decoder | `service/engine.py` or `service/main.py` (new helper), `debugging/` test |
| **I5 – Silence follow-up turn** | A new, explicit "no input" turn (e.g. `POST /turn/idle` or a flag on `/turn`) handled by `DialogueManager` as **read-only**: an `ACTIVE` workflow gets the current instruction plus an offer of help; a resting state gets nothing or a generic offer. Must not touch `workflow_state`/`current_step`, matching the `_handle_step_reference` guarantee. The frontend sends it after N seconds without speech while a workflow is `ACTIVE`, rate-limited | `_resolve_current_instruction`, `restate_current_step`, localizer | `service/main.py`, `service/models.py`, `app/dialogue/manager.py` (one method), `ai-engine.client.ts`, `VoiceContext.tsx` |
| **I6 – Robustness** | Thread-pool the `audio_turn` body; timeout headroom (NestJS < frontend); explicit Groq `timeout`/`max_retries`; optional idempotency key per turn to prevent C5 double advances | — | `service/main.py`, `dialogue_understanding.py`, `http-ai-engine.client.ts`, `httpAssistantClient.ts` |

Ordering rationale:

- I2 must come before I3, otherwise automatic capture produces phantom turns (C3).
- I1 is independent, and should go first so the 422 cause is known before anyone changes TTS.
- I5 depends on I3, because it needs a voice-session state to know that the customer is silent rather than gone.

Why not reuse the CLI loop directly:

- it reads a server-local device (`sd.InputStream`);
- it plays on server-local speakers (pygame);
- it writes fixed filenames;
- it assumes one process per customer.

None of that holds for a web service. The reusable surface is the per-utterance pipeline (already reused through `_respond`) plus the recorder's policy and its injectable state machine.

---

## 12. Existing tests, exact commands and results

Python suites were run from `language_engine/` with `PYTHONDONTWRITEBYTECODE=1 PYTHONIOENCODING=utf-8 PYTHONPATH=.`, through a scratchpad wrapper (`guarded.py`) that calls the repo's own `evaluation.harness.install_network_guard()`, which refuses every non-loopback connection, and then `runpy.run_module`:

```
venv/Scripts/python.exe <scratchpad>/guarded.py debugging.<suite>
```

**Run during this audit:**

| Suite | What it covers here | Result |
|---|---|---|
| `debugging.test_phase32b4` | `resolve_step_completion` ("I took the slip" → True, "yes" → None), completion routing | **264 passed, 0 failed** |
| `debugging.test_phase32` | Acknowledgements never advance or resume ("yes"/"done" excluded) | **153 passed, 0 failed** |
| `debugging.test_phase32b1` | Control routing in resting states | **445 passed, 0 failed** |
| `debugging.test_phase25` | Earlier dialogue invariants (fakes; offline) | **130 passed, 0 failed** |

**Run earlier in this session, against the same working tree (`git status` unchanged since):**

| Command | Result |
|---|---|
| `guarded.py debugging.test_vad_recorder` | 85 passed |
| `guarded.py debugging.test_phase32b1_control_routing` | 223 passed |
| `guarded.py debugging.test_service_turn` | "All Phase 3.2B-16A parity checks passed" |
| `guarded.py debugging.test_service_housekeeping` | 68 passed, 0 failed |
| `guarded.py debugging.test_service_language` | 88 passed, 0 failed |
| `guarded.py debugging.test_audio_decoding` | 36 passed, 0 failed, 0 skipped |
| `python -m debugging.test_m8_speech` | 69 passed, 0 failed |
| `frontend: npx vitest run` (useMicrophone, useSpeechPlayback, VoiceContext, ConversationContext, Composer, components/voice, services/assistant) | 7 files, 133 passed |
| `backend: npx jest --config test/jest-unit.js` (documented as DB-free) | 3 suites, 25 passed |

**Not run, deliberately:**

- `debugging/test_dialogue.py` constructs a real `DialogueManager` and calls Groq.
- `debugging/test_stt.py` is an interactive microphone script.
- Backend e2e (`npm test`) boots the app against the database.
- No live microphone, browser, edge-tts or Groq test was run.

Other commands were read-only inspection (`git status --short`, `git diff --stat`, `grep`, `sed -n`, `wc -l`, file reads).

---

## 13. Files changed and working-tree verification

- **Created:** `language_engine/evaluation/reports/deep_language_engine_integration_audit.md` (this file). No other file in the repository was created, modified or deleted. No existing report was touched.
- **Before/after:** `git status --short` was captured before the audit (64 entries, including the uncommitted A1 changes `M language_engine/app/speech/asr/indic_conformer_provider.py` and `?? language_engine/debugging/test_audio_decoding.py`). The after-snapshot is **identical**, because the whole `language_engine/evaluation/` directory was already untracked (`?? language_engine/evaluation/`), so the new file is folded into that entry.
  - `git status --short -uall` lists it individually as `?? language_engine/evaluation/reports/deep_language_engine_integration_audit.md`.
  - The tracked diff is unchanged before and after: `31 files changed, 2512 insertions(+), 413 deletions(-)`.
- **Not done:** no database access, no migrations, no backend or engine start, no external LLM or TTS calls, no commit, push, reset or restore. Scratch files live only in the session scratchpad, outside the repository.
