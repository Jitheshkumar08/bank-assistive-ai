# Phase 6 — College backend and shared language engine integration

Student Portal chat → College backend → shared language engine → College backend → Student Portal, with
the College backend as the only source of truth for identity and admission data. Builds on Phases 1–5
without replacing them. Banking (`backend/`, `frontend/`) is untouched.

## 1. Audit (before any change)

### Existing functionality

| Area | Found | Status before Phase 6 |
|---|---|---|
| Frontend chat | `ChatPanel` + `assistantService.ts` POST `/assistant/messages` `{message, history, collegeId, language, inputMode}`, expects `{text, intent?, steps?}`; route `/assistant` behind `RequireAuth roles=['STUDENT']` and the QR gate | **Endpoint did not exist** in the backend; the chat could never answer |
| Frontend auth/session | HttpOnly cookie session (`credentials: 'include'`), `onUnauthenticated` → sign-in guard | Reused unchanged |
| Frontend QR | `CollegeContext {collegeId, area, validatedAt}` in sessionStorage (12 h), validated by `/qr-context/validate` | `area` was not sent with questions |
| Frontend language | en / kn / hi selector, `errorText` per code | Reused |
| Frontend speech | None: "Voice input and spoken answers are not available yet" | Missing |
| Backend auth | `SessionGuard` (cookie → `StudentSession`, active + verified account), `RolesGuard` / `@Auth(...)` | Reused unchanged |
| Backend admission | `AdmissionService.getDetails` (record by **session email**, QR re-checked, claimed-by-other excluded, newest year, ambiguity audited) behind `GET /students/me/admission-details` | Reused unchanged |
| Backend Phase 5 adapter | `AssistantAdmissionStatusService.lookup` → outcome code | **Not wired to any endpoint**, not in any module |
| Backend → engine client | none (Banking has `HttpAiEngineClient`) | Missing |
| Engine | token→domain, context policy, `(domain, session)` registry, institution binding, College runtime, intent profile, verified-only RAG, workflow runner, `POST /sessions/{id}/workflow-result` | Reused |
| Engine workflow actions | single-use, constant-time id compare, abandoned on next sentence, outcome whitelist, `extra=forbid` | **No expiry, no action-type check** |

### Database model (Prisma, unchanged; no migration)

`AdmissionRecord`: `nucatRank`, `allocatedBranch → Branch`, `admissionStatus` (official text), `feeCategory`
(GENERAL/SCHOLARSHIP/NRI, deliberately not exposed to students), `officialEmail`, `studentAccountId`, `admissionYear`.
**Not in the model:** reservation/admission category (the README says a plain "Category" column is deliberately
ignored), batch, admission hall, next step, seat availability.

### Duplicate functionality

None introduced. The assistant uses the Result page's own `AdmissionService.getDetails` through the Phase 5
adapter (no second lookup), `ContextService` (no second QR check) and `@Auth('STUDENT')` (no second auth). The
engine does not authenticate students.

### Security risks found

1. Frontend posts `history` — a client-controlled conversation history must never reach the engine.
2. Pending engine actions never expired; a result could be posted for a different action type.
3. Engine `/turn` silently ignored unknown body fields (e.g. a forged `student_context`): unused, but not refused.
4. No College engine credential/config existed; nothing stopped a production deploy without a token.

### Tests available before Phase 6

College backend unit 86/86 (incl. Phase 5 adapter 11), College frontend 203/203, engine College suites
(runtime 130, workflows 171, RAG 100, isolation 101), Banking backend unit 75 / e2e 96, Banking frontend 584.
College backend e2e needs a PostgreSQL `_test` database (`.env.test`), not configured here.

## 2. What Phase 6 adds

### Contracts (`college-domain/backend/src/assistant/assistant.contract.ts`)

**Browser → College backend** `POST /api/assistant/messages` (cookie, role STUDENT, 30/min):

```json
{ "message": "What is my rank?", "language": "en", "collegeId": "nmamit", "area": "admissions-desk",
  "inputMode": "text", "history": [] }
```

Strict validation: any other field (`studentId`, `rank`, `admissionStatus`, `studentContext`, `nucatReference`,
`email`, …) → `400 VALIDATION_FAILED`. `history` is accepted for compatibility and **ignored**.

**College backend → engine** `POST /turn` (headers `X-Internal-Token: AI_ENGINE_COLLEGE_TOKEN`,
`X-Assistant-Domain: college`):

```json
{ "session_id": "cg-<48 hex>", "language": "en", "text": "What is my rank?", "domain": "college",
  "context": { "institution_id": "nmamit", "area": "admissions-desk" } }
```

`session_id` = `cg-` + SHA-256(`server-side session id : college`)[:48] — per student, per login, per college;
unguessable from the browser; never the cookie token.

**Engine → backend** (validated with zod; `domain` must be the literal `"college"`, otherwise rejected):
`{reply, domain, intent, outcome, steps, action: {id, type, workflow} | null}`.

**Backend → engine** `POST /sessions/{id}/workflow-result`: `{action_id, action_type, outcome}` — an outcome code
only (`details_available`, `not_signed_in`, `not_a_student`, `no_record`, `ambiguous_record`, `context_invalid`,
`unavailable`).

**College backend → browser** (`AssistantReply`):

```json
{ "text": "Your admission details from the official records are shown below.", "language": "en",
  "intent": "admission_status", "outcome": "workflow_result", "steps": null,
  "studentContext": { "verified": true, "admissionYear": 2026, "rank": 145, "category": null,
    "allocatedBranch": "…", "assignedBatch": null, "assignedHall": null, "admissionStatus": "…", "nextStep": null } }
```

**Adaptation of the suggested contract (deliberate).** The brief's example sent `student_context` to the engine.
Phase 5 established that private data never reaches the engine; Phase 6 keeps that: the engine receives the
outcome code (the trusted signal, only from the College token) and words the sentence in the visit's language; the
student's values go from the backend straight to the browser. `category`, `assignedBatch`, `assignedHall`,
`nextStep` are typed `null` because no trusted source exists. Name and fee are not part of the assistant contract.

### Authentication / authorisation flow

1. Browser sends the cookie; `SessionGuard` resolves an active, email-verified account; `RolesGuard` requires
   `STUDENT` (staff → 403, none/expired/revoked → 401).
2. `ContextService.requireActiveContext(collegeId, area)` — inactive/unknown college or QR placement → `400 INVALID_QR`,
   engine not called.
3. Engine authenticates the backend by token (College token → college domain only; Banking token declaring college
   → 403; College token declaring banking → 403).
4. On an `admission_status` action: `AssistantAdmissionStatusService.lookup(session account, collegeId, area)` =
   `AdmissionService.getDetails` (record by the session account's verified email, scoped to the college, never a
   record claimed by another account). 8 s bound → `unavailable`.

### Student-context data flow

```
browser ─(question, language, collegeId, area)──▶ College backend ─(question, language, institution, area)──▶ engine
                                                                  ◀── action {id, type, workflow}  (no data)
                         AdmissionService.getDetails(session) ─▶ outcome code (+ details kept in backend)
                                                  ─(action_id, action_type, outcome)──▶ engine
                                                                  ◀── reply in the visit's language
browser ◀── reply + studentContext (from the backend only)
```

### Workflow integration

| Brief item | How it is served |
|---|---|
| Admission status | Phase 5 `admission_status` workflow + backend lookup (above) |
| Rank / batch enquiry | Same path. Engine: "what is my rank", "which batch am i in" + keywords `my rank`, `my batch` → `admission_status`. Batch is `null` (not in the data model) |
| Assigned admission hall | Same path. "which admission hall should i go to", `my hall`, `admission hall`, `assigned hall` → `admission_status` (previously routed to campus navigation / office location). Hall is `null` |
| Required documents / procedure | Existing verified-only RAG (`admission_documents`, `admission_process`, admission guidance workflow). The production College collection is still empty → "no verified information" reply |
| Next-step guidance | General: admission guidance workflow step 4 (RAG). Student-specific: `nextStep` is `null` (no source) |
| Seat availability | **Not implemented** — no trusted backend source exists; questions fall to course information (RAG) |
| Campus navigation | Unchanged Phase 5 behaviour; production campus map collection is empty → "no verified directions" |

No live admission data was added to any RAG document. No rank-allocation or seat-management logic was added.

### Engine hardening

- `backend_action` actions carry an internal `issued_at`; results after `AI_ENGINE_ACTION_TTL_SECONDS` (default
  120, bounded 5–900) → `409 action_expired`, and the action is abandoned (no replay).
- Optional `action_type` in a workflow result must equal the pending type → `409 action_mismatch` (the College
  backend always sends it; the Phase 5 contract without it still works).
- `/turn` with unknown body fields from a **non-Banking** domain → `422 invalid_context`. Banking keeps ignoring
  extras (its contract is unchanged; tested).

### Frontend changes (`college-domain/frontend`)

- `assistantService`: sends `area`; parses `outcome` and `studentContext` (dropped unless `verified === true`
  and well-formed); 45 s timeout → clear message; `speak(text)` → `POST /assistant/speech`.
- `ChatPanel`: admission details card (existing `result.*` labels + new labels; unavailable fields read
  "Not available yet"); **Listen** button per reply (backend TTS, in the reply's language); voice note now says
  only voice *input* is unavailable. Design and other features unchanged.
- `ASSISTANT_UNAVAILABLE` error code with en/kn/hi text. New kn/hi strings are unreviewed
  (`05-kannada-review-cases.md` §6).

### Security controls (summary)

Identity/role only from the session; no student field accepted from the browser (400) or by the engine (422);
QR = context only and re-checked; engine session per student/login/college; institution binding (409 on switch);
outcome-code-only results, single use, typed, expiring; College and Banking tokens separate (production: College
token ≥ 32 chars, never sent without it); no Banking fallback (engine 503 / backend rejects non-`college`
replies); speech only for replies this session received (no open TTS proxy); logs carry failure categories and
status codes only — never message text, replies, tokens or records; errors to the browser are one safe 503 message.

## 3. Tests

| Suite | Result |
|---|---|
| College backend unit (`npm test`) | **151 / 151** (86 baseline + 65 new: `assistant.service` 20, `assistant.http` 21, `assistant.lifecycle` 11, `college-engine.client` 13) |
| College backend cross-process integration (`npm run test:integration`, real engine HTTP service on fixtures) | **14 / 14** |
| College frontend (`npx vitest run`) | **216 / 216** (203 baseline + 13 new) |
| Engine `test_college_integration` (new) | **37 / 37** |
| Engine `test_college_runtime` / `test_college_workflows` / `test_college_rag` / `test_domain_isolation` | 130 / 171 / 100 / 101 — all pass, same counts as Phase 5 |
| Banking backend | unit 75 / 75, e2e 96 / 96 |
| Banking frontend | 584 / 584 |
| Engine regression (all 57 suites) | Complete, see section 5 |

One existing assertion was extended, not weakened: `ChatPanel.test.tsx` now expects `area: 'admissions-desk'` in the
request it already checked field-by-field.

## 4. Known limitations

- Batch, admission hall, next step and admission category have no trusted source → always `null`.
- Seat availability not implemented (no source). Production College knowledge and campus collections are empty.
- Voice input (speech-to-text) is not wired into the College frontend; spoken answers are.
- Engine replies say "shown below"; they do not name the specific field asked about (rank vs hall).
- Served-reply memory for speech and rate limits are in memory per backend instance.
- Engine conversations of ended login sessions are released by a 5-minute sweep (section 5), not instantly at logout; the sweep's bookkeeping is in memory per backend instance (after a restart, the engine's 60-minute idle reaper applies).
- College backend e2e against PostgreSQL not run (no `.env.test`); the HTTP-level and cross-process tests use an
  in-memory stand-in for the database.
- The two backends and two frontends were not started together as processes (section 5).

## 5. Final verification (after the Phase 6 report)

### Engine regression — all 57 suites, sequential, one process at a time (no GROQ key exported, as in the baseline)

| Result | Suites (check counts) |
|---|---|
| Pass, same counts as the baseline | audio_decoding 36, cancel_confirmation_exit 129, evaluation_harness 102, llm_cancel_confirmation 84, m1_amounts 140, m10_policy 49, m10_routing 82, m3_language_cues 146, m4_intent 108, m5_normalization 70, m6_localization 93, m7_knowledge 82, m8_speech 69, m9_asr 62, phase25 130, phase31 89, phase32 153, phase32b1 478, phase32b1_control_routing 223, phase32b12 117, phase32b13 69, phase32b14 360, phase32b15_audit 73, phase32b2 407, phase32b3 148, phase32b4 264, proactive_assistance 210, remediation 145, romanized_batch1 131, romanized_g3g4 163, service_config 35, service_housekeeping 68, service_language 88, service_registry 33, service_tts 32, service_turn 137, tts_diagnostics 59, vad_recorder 85, workflow_snapshot 28 |
| Pass, no assertions: output **byte-identical** to the baseline commit `7081b66` (run in a temporary worktree) | conversation, intent, knowledge, retriever, translation, workflow |
| Pass, Phase 2–6 College suites | domain_isolation 101, college_rag 100, college_runtime 130, college_workflows 171, college_integration 37 |
| Not executed: environment (same as baseline) | dialogue, dialogue_understanding, full_pipeline, pipeline, question → `GROQ_API_KEY` not exported; stt, tts → interactive (`EOFError`) |

**Live-LLM run** (key loaded from `language_engine/.env` into that process only): `test_dialogue`,
`test_dialogue_understanding` and `test_question` exit 0 with real Groq answers. They are print-only scripts with no
assertions, and LLM output is not deterministic, so they were not compared byte-for-byte. `test_full_pipeline` and
`test_pipeline` get past the key and stop at their keyboard / microphone prompts (`input()`, `AudioRecorder`):
interactive, environment-blocked.

No engine test failed; no engine code was changed during verification.

### Admission ownership

- Identity: `SessionService.resolve` re-reads the account (id, email, role, status, verified) from the database on
  every request; nothing from the request body is used (strict DTO: 400).
- Lookup key: the account's email. It is unique (`StudentAccount.email @unique`, stored lower-case), proven by email
  verification (sessions require `emailVerifiedAt`), and no endpoint changes it.
- Immutable id: `StudentAccount.id`. `AdmissionRecord.studentAccountId` is `@unique` and set only by the rate-limited
  NUCAT reference verification; `getDetails` excludes every record claimed by another account id, so a re-registered
  email cannot inherit a claimed record. Ambiguous matches are refused and audited.
- Conclusion: the existing rule (verified email + claimed-by-other exclusion) is sound; business rules unchanged.
- New tests (`assistant.lifecycle.spec.ts`): the lookup uses the session's database email only; A never sees B's record
  whatever A types or sends (forged body fields → 400); a record claimed by another id is hidden even with the same
  email; a record claimed by the same account is shown; a record claimed by A stays hidden from B even if B's email is
  on it; a forged cookie → 401.

### Session lifecycle

- Logout (`POST /api/auth/logout`) revokes the session; the assistant and speech then answer 401 (tested through the
  real logout endpoint, in unit and cross-process tests). Expired, revoked, password-reset-revoked and deleted sessions
  fail `SessionGuard` the same way.
- Engine session ids are derived from the server-side session id, so a new login always starts a new conversation.
- **Gap found and fixed:** the engine conversation of a logged-out session stayed in engine memory until the engine's
  60-minute idle reaper. `AssistantService.sweepEndedSessions` (every 5 minutes, read-only on the database) now ends
  the engine conversations (`DELETE /sessions/{id}` with the College token) of sessions that are revoked, expired or
  deleted, and forgets their speech memory; failures are retried on the next sweep. No auth or Banking code changed.
  Verified against the real engine process: after logout and a sweep, the engine snapshot reports `known: false`.

### Combined startup

| Process | Port | Credential / origin |
|---|---|---|
| Language engine (one process) | 8000 | `AI_ENGINE_TOKEN` (Banking), `AI_ENGINE_COLLEGE_TOKEN` (College) |
| Banking backend | 3000 | `AI_ENGINE_TOKEN`, `CORS_ORIGINS=http://localhost:5173` |
| Banking frontend | 5173 | (unchanged) |
| College backend | 3001 | `AI_ENGINE_COLLEGE_TOKEN`, `FRONTEND_ORIGIN=http://localhost:5174` |
| College frontend | 5174 | `VITE_API_BASE_URL=http://localhost:3001/api` |

- **Port conflict fixed:** the College frontend defaulted to 5173 and the College backend example to 3000 (both
  Banking's). `vite.config.ts` now uses `5174` with `strictPort` (a silent port change would break CORS), and the
  College `.env.example` files and READMEs use 3001 / 5174.
- **Token configuration (important):** today neither `language_engine/.env` nor `backend/.env` sets a token, so the
  engine runs in development "no tokens" mode. Two valid setups:
  1. *Development, no tokens*: Banking sends no domain (served as Banking), College declares `college`. Works as is.
  2. *Tokens*: set **both** `AI_ENGINE_TOKEN` (engine + `backend/.env`) and `AI_ENGINE_COLLEGE_TOKEN` (engine +
     `college-domain/backend/.env`). Setting only the College token turns authentication on for every caller, and
     Banking (no token) would get 401.
- **Verified live:** the real engine (`service.main`, real models, `AI_ENGINE_ENV=production`, two temporary tokens)
  started on 8000 with both domains `ready`.
  - Banking-style call (token only) → Banking deposit workflow. No token → 401. Banking token declaring college → 403.
    College token declaring banking → 403. College token without an institution → 422 (never Banking).
  - The real `HttpCollegeEngineClient`: admission action; `action_mismatch` 409; undefined outcome 422; defined outcome
    → reply; replay 409; hall question → admission action; documents → "no verified information" (empty production
    collection); Kannada reply; institution switch 409; Banking token 403; `endSession` true, then false.
  - The engine log held no question text, no Kannada text and no token.
- Not started as processes: the Banking and College backends and frontends together (the College backend needs a
  database that does not exist yet; see limitations).

### End-to-end journey (`npm run test:integration`, 14/14)

Real engine HTTP process (synthetic fixtures) + real College backend pipeline (`/api/auth/login` with argon2,
`/api/qr-context/validate`, `/api/assistant/messages`, `/api/auth/logout`), in-memory database: sign in → scan QR →
admission-status question → session verified → own record → engine action → outcome → engine reply → response with
`studentContext`. Also covered: wrong password, staff account (403), another student (own data only), invalid QR (at
scan and at question time), logout and expired session (401) with engine-session release, engine down (503). The
frontend leg (display) is covered by `ChatPanel.test.tsx` and `assistantService.test.ts`.
