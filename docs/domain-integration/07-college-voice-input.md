# Phase 7 — College voice input through the shared language engine

## 1. Review: what was already integrated, and what was missing

| Capability | Engine | College backend | College frontend |
|---|---|---|---|
| Typed question → answer (knowledge, workflows) | ✅ `/turn` | ✅ `POST /assistant/messages` | ✅ chat |
| Admission status (backend action, outcome code only) | ✅ `/sessions/{id}/workflow-result` | ✅ | ✅ details card |
| Spoken answer (TTS) | ✅ `/tts` | ✅ `POST /assistant/speech` | ✅ Listen |
| Release engine conversation after logout/expiry | ✅ `DELETE /sessions/{id}` | ✅ sweep | — |
| Production token validation (teammate, "Phase 7A") | ✅ | ✅ `env.ts` | — |
| No chat history sent (teammate, "Phase 7A") | — | ✅ ignored | ✅ removed |
| **Spoken question (speech-to-text)** | ✅ `/turn/audio` (College runtime shares the engine's Whisper) | ❌ no endpoint | ❌ "Voice input is not available yet" |

The engine already supported spoken College turns, so this phase adds only the College side. No engine
production code changed.

## 2. Flow

```
Student taps 🎤 → browser records (stops after 3 s of silence, a second tap, 10 s of nothing → dropped, 30 s cap)
  → POST /api/assistant/voice-messages  (multipart: audio, language, collegeId, area?; session cookie)
  → College backend: SessionGuard + STUDENT role → multer (5 MB, 1 file, 3 fields) → strict DTO (no identity fields)
      → recording check (non-empty, audio/webm|ogg|mp4|mpeg|wav; codec parameters dropped)
      → QR context re-check (INVALID_QR)
      → engine POST /turn/audio (College token, X-Assistant-Domain: college, institution_id, area, generated file name)
      → engine transcribes, runs the SAME turn a typed question takes
      → admission_status action? → own record lookup → outcome code only → engine words the reply
  → 200 {text, language, intent, outcome, steps, studentContext, transcript}
  → chat shows the transcript as the student's message, the answer, reads the answer aloud
```

## 3. Security and privacy

- Identity comes only from the session; any extra form field (email, studentId, rank, …) is refused with 400.
- Guards run before the upload is read, so anonymous and staff uploads are refused unread (401 / 403).
- The recording is passed through in memory and never stored or logged; the browser's file name is never forwarded.
- Engine refusals without a code (empty / nothing heard / undecodable) → `422 VOICE_NOT_UNDERSTOOD`; engine 413 →
  `413 FILE_TOO_LARGE`; every coded refusal (domain, token, context) and every other failure → `503
  ASSISTANT_UNAVAILABLE`, as for typed questions. The Banking token is refused by the engine on `/turn/audio` (403).
- Spoken replies are remembered like typed ones, so Listen works for them and `/assistant/speech` stays a non-proxy.
- Typed replies keep exactly their earlier shape (`transcript` is present only for spoken questions).

## 4. Files

Backend: `assistant.contract.ts` (transcript, `EngineAudioTurnRequest`), `engine/college-engine.client.ts`
(`turnAudio`, multipart), `assistant.service.ts` (`sendVoice`, shared `converse`, `callVoice`, recording check),
`assistant.dto.ts` (`AssistantVoiceDto`, `transcript`), `assistant.controller.ts` (`POST voice-messages`),
`common/api-error.ts` (`VOICE_NOT_UNDERSTOOD`), `test/support/fake-engine.ts` (`turnAudio`), README.

Frontend: `lib/useVoiceRecorder.ts` (new), `services/assistant/assistantService.ts` (`sendVoice`, shared reply
parsing), `components/assistant/ChatPanel.tsx` + `chat.css` (microphone), `services/errors.ts`, `services/http.ts`,
`i18n/catalog.ts`, `i18n/en|kn|hi.ts` (9 keys each).

Engine (test harness only): `debugging/college_integration_server.py` — a synthetic speech stand-in that "hears" the
text after `SYNTHETIC-SPEECH:` in the uploaded bytes.

## 5. Tests

| Suite | Result |
|---|---|
| College backend unit (new `assistant.voice.spec.ts` 16, `college-engine.client.voice.spec.ts` 4) | 182/182 |
| College backend cross-process with the real engine (5 new voice cases) | 19/19 |
| College frontend (new: recorder 7, service 4, chat 6) | 234/234 |
| Engine `test_college_integration` | 37/37 |
| lint / tsc (backend and frontend) | clean |

## 6. Limitations

- Not tried with a real microphone and Whisper in a browser; Whisper itself is covered by the engine's speech suites.
- The new Kannada and Hindi strings are unreviewed, like the rest of the catalog (05-kannada-review-cases.md).
- Answers to spoken questions are read aloud automatically; if the browser blocks playback, the Listen button remains.
- Tulu (`tcy`) recordings are transcribed with the engine's language handling for `tcy` (answers in English).
