# Phase 5 — College workflows

Four College capabilities on the shared engine: **admission guidance**, **admission
status**, **campus navigation**, and **College service guidance**. Banking's
runtime, workflows, dialogue manager, catalog and backend are unchanged.

## What was inspected first

| College backend piece | What it means for the assistant |
|---|---|
| `AdmissionService.getDetails` (`GET /students/me/admission-details`, the Result page) | Identity only from the session cookie (`SessionGuard`); record found by the **account's email**; the QR context only selects the college and is re-checked; a record claimed by another account is never shown; error answers say nothing about other students. |
| `AdmissionService.verify` (`POST …/admission-verification`) | NUCAT reference verification: rate-limited, its own endpoint. **Not** used by the assistant. |
| `ContextService` | QR payload `campusguide:college/<id>?area=<slug>`: context only, never identity. |
| `InstitutionQrCode` | A placement has `areaSlug` + `label` only. **No rooms, buildings or routes exist anywhere in the College backend**, hence the verified campus-map collection below. |
| Frontend `assistantService.ts` | Reply contract `{text, intent?, steps?}` — `steps` already reserved for step-by-step answers. |

## Workflow execution contract (the existing one, reused)

- **Definitions** are the engine's JSON workflow files (`workflow`, ordered `steps`
  with `step`, `instruction`, optional `field`), loaded by `WorkflowLoader(folder)`
  from `app/domains/college/workflows/`. Banking's folder is untouched and never read
  for College (and vice versa).
- **State** is the engine's `ConversationManager` slot: `set_intent`, `load_workflow`,
  `current_step`, `entities`, `suspend/resume/cancel/complete_workflow`, `WorkflowState`.
- **Controls** come from the shared `classify_turn` (next / repeat / pause / resume /
  cancel / step reference) and "I've done it" from the shared `resolve_step_completion`.
- **Execution**: College steps add a `kind`; `app/workflow/domain_runner.py` runs
  them. It writes no text of its own (every sentence is the definition's or the
  College catalog's), and it does not detect intents, retrieve, translate, recognise
  speech or resolve QR codes — those are passed in or happen around it.

| kind | does | content from |
|---|---|---|
| `knowledge` | answers the step's `question` | verified knowledge, the step's `categories` only, same four gates as Phase 4 |
| `destination` | asks where to go when missing | names/aliases in the institution's **verified** campus map |
| `directions` | reads the route one step at a time | the verified route for exactly (QR location → destination) |
| `backend_action` | asks the backend to act; accepts back only a defined outcome code | the College backend |

Intent → workflow: `admission_process → admission_guidance`, `admission_status →
admission_status`, `campus_navigation → campus_navigation`. All service intents
(fees, payment, hostel, transport, scholarships, courses, departments, calendar,
exams, student services, contacts) stay knowledge-answered.

## A. Admission guidance

Five steps: the admission process (answers the student's own question first) →
documents → eligibility → what to do now → where to get help. Each step retrieves
only its own categories for the session's institution, verified documents only; a
step with no document says "I don't have verified information about … yet. Please
contact the college office for help." without calling the model, and the guidance
continues. A side question is answered from its own category and followed by "Say
next to continue the admission guidance." Pause, resume, cancel and "continue" work
with the shared control words.

## B. Admission status — private data never reaches the engine

```
student ──▶ College backend ──/turn──▶ engine: intent admission_status
                                      ◀── action {id, type:"admission_status", workflow}
            College backend: AssistantAdmissionStatusService.lookup(session account, collegeId, area)
                             = AdmissionService.getDetails (the Result page's own rules)
                             → outcome code (+ details kept in the backend)
            ──/sessions/{id}/workflow-result {action_id, outcome}──▶ engine
                                      ◀── reply in the visit's language
student ◀── reply + the details, shown by CampusGuide (Phase 6/7)
```

- The action carries `{id, type, workflow}` only — no text the student typed, no
  identifier. The engine never asks for a reference number; a typed one gets "For
  your security, I don't use reference numbers typed in the chat.", is not forwarded,
  not echoed, and College conversation history is stored redacted.
- `POST /sessions/{id}/workflow-result` accepts exactly `{action_id, outcome}`
  (`extra="forbid"`, so any record field is a 422), only from the caller's own domain,
  only for the visit's pending action id (compared in constant time, single use, and
  abandoned when the student asks something else), and only an outcome the
  definition lists: `details_available`, `not_signed_in`, `not_a_student`,
  `no_record`, `ambiguous_record`, `context_invalid`, `unavailable`.
- College backend: `src/assistant/admission-status.service.ts` maps the session
  account + QR context to one of those codes by calling the existing
  `AdmissionService.getDetails`. No session → `not_signed_in` (no lookup); a staff
  account → `not_a_student`; inactive college/QR → `context_invalid`; unexpected
  errors → `unavailable`. It has no parameter through which a reference could be
  passed. **Not wired to an endpoint yet** (that is the Phase 6 assistant module), so
  the running College backend is unchanged.

## C. Campus navigation

- **Data**: `app/navigation/campus_map.py` — one map per institution (places with
  names/aliases per language, and routes as step lists written for an exact origin →
  destination pair). Same verification rules as the knowledge collection: a verified
  map needs `source_reference`, `verified_by`, `verified_on`, `sha256`; editing it
  afterwards is refused; synthetic fixtures can never be verified. Place ids are QR
  area slugs. **Production collection (`app/domains/college/campus/`) is empty.**
- **Where the student is** comes only from the QR context (`location_id`, else
  `area`). A spoken starting point is never used. No QR location → "Please scan the
  CampusGuide QR code nearest to you…"; the destination is kept and the next turn
  after a scan continues.
- **Destination** from the sentence (longest name wins; inflected Kannada matches by
  prefix). Missing → "Where would you like to go?"; two places → "Do you mean A or
  B?"; not in the map → "I couldn't find that place in the verified campus map.
  Please tell me another place, or say cancel." Only a request that *names* another
  topic by keyword ends the question (an embedding-only near match such as "the moon
  base" → examinations does not).
- **Directions**: only a route written for that exact pair — never reversed, chained
  or generated. No route → "I don't have verified directions from A to B yet." +
  office referral. With a route: "Here are the directions from A to B. Step 1 of 3:
  …" one step per turn ("next" / "I did it"), and the whole list in the response's
  `steps` field (the frontend's existing contract).
- "Take me to the library": "library" also names student services and the embeddings
  preferred it. A sentence with navigation keywords that names a place **of the
  verified map** is routed to navigation; without a verified map the rule never fires.

## D. College service guidance

Fees, hostel, transport, scholarships, courses and other academic services are
answered exactly as in Phase 4: verified knowledge only, narrowed to the intent's
own categories, uncertainty reply when nothing qualifies (no model call). Production
uses no synthetic fixtures (knowledge and maps are both verified-only).

## Wire changes (additive)

`TurnResponse.steps: string[] | null` (in the visit's language) and
`TurnResponse.action: {id, type, workflow} | null` — both `null` for Banking. New
`POST /sessions/{id}/workflow-result`. `GET /sessions/{id}/snapshot` now totals a
College visit's steps from College's own definitions (the Phase 4 limitation);
`POST /sessions/{id}/assistance` answers `offered=false, reason="not_available"` for
College instead of Banking wording.

## Language

English and Kannada end to end; Hindi replies rendered, Hindi intents rely on the
encoder. Campus place names and steps come from the map in whatever languages the
institution wrote; a step without a Kannada text is shown in English **marked**, never
as Kannada. Tulu (`tcy`) is not supported and gets English. Replies name only control
words the shared classifier recognises (tested; the first draft said ರದ್ದು, which it
does not). All Kannada strings needing native review: `05-kannada-review-cases.md`.

## Tests

`python -m debugging.test_college_workflows` (engine) and `npm test --
src/assistant` (College backend, the real AdmissionService/ContextService/FeeService
over an in-memory database).

### Results (2026-11-07)

| Suite | Result |
|---|---|
| `test_college_workflows` (new) | 171 / 171 |
| College backend `src/assistant` (new) | 11 / 11 (full College unit run 86 / 86 = 75 baseline + 11) |
| `test_college_runtime` | 130 / 130 (2 checks updated for Phase 5 behaviour, below) |
| `test_college_rag`, `test_domain_isolation` | 100 / 100, 101 / 101 |
| Engine baseline suites (52) | same exit codes and pass counts as the baseline; summary-less suites print identical output; the same 7 live-LLM / interactive scripts stop for the same reasons |
| Banking backend | unit 75 / 75, e2e 96 / 96 |
| Banking frontend / College frontend | 584 / 584, 203 / 203 |

Two Phase 4 checks asserted the Phase 4 placeholder ("admission status / navigation
is a pending workflow"). They now assert the Phase 5 behaviour (an action without data;
navigation with no verified map → "no verified directions"); the check that neither
retrieves documents nor asks the model is unchanged.

Mutation checks (each deliberate defect must fail the suite): routes reversed (1),
origin taken from speech (1), typed text put in the action (2), action id not
checked (8), history not redacted (1), unverified maps served (2), the campus
"unverified" flag ignored (1), guidance steps searching every category (5),
undefined outcomes accepted (5), an embedding-only match ending the navigation
question (7). Unmutated: 0 failures.

## Known limitations

- The production campus collection is empty: navigation answers "no verified
  directions" everywhere until an institution supplies and verifies its map. Routes
  must be written per origin → destination pair (no path-finding, by design).
- The College backend adapter is not yet called by any endpoint (Phase 6). The engine
  side of the admission-status round trip is tested over HTTP; the backend side is
  tested as a service with an in-memory database, not end to end against Postgres
  (College e2e needs a `.env.test`, not configured here).
- The details shown to the student after `details_available` are the backend's to
  render (Phase 6/7); the engine only words the sentence around them.
- Kannada: all new sentences unreviewed; place names are not inflected (see the
  review list). Hindi intents rely on the encoder. Tulu not supported.
- Guidance step 4 ("what to do now") has no dedicated category and re-reads the
  admission-process documents with a different question.
- An invalid destination in the FIRST sentence ("take me to the moon base") is
  rejected as out of scope by the intent margin rather than "place not found"; once
  the assistant has asked "Where would you like to go?", it is "place not found".
- Live Groq behaviour and a live service start were not exercised (as in Phase 4).
