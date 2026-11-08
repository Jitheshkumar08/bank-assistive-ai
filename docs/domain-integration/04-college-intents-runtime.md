# Phase 4 — College intent detection and College runtime

The shared engine now serves College turns end to end: control words → College
intent → category-narrowed, verified-only retrieval → evidence-only answer,
validated → rendered in the session language. Banking's runtime, intent
detector, dialogue manager, prompts and localization catalog are unchanged.
College workflows (admission status, navigation) are Phase 5; until then those
intents answer "not available in the assistant yet".

## College intent catalogue (`app/domains/college/intents.py`)

| Group | Intent | Answered from (knowledge categories) |
|---|---|---|
| admissions | admission_process | admission_process, application_deadlines |
| | admission_documents | admission_documents |
| | admission_eligibility | admission_eligibility |
| | admission_status | **workflow** `admission_status` (Phase 5) |
| fees | fee_information | fees |
| | payment_process | fees |
| | scholarship_information | scholarships |
| academics | course_information | programmes |
| | department_information | departments |
| | academic_calendar | academic_calendar |
| | examination_information | examinations |
| student_services | hostel_information | hostel |
| | transport_information | transport |
| | student_services | student_services, facilities |
| | contact_information | contacts |
| campus | campus_navigation | **workflow** `campus_navigation` (Phase 5) |
| | office_location | office_locations, contacts |
| | general_college_query | overview, faq (chosen only when nothing specific is close) |

Each intent is data: group, categories or workflow handler, English + Kannada
examples, keywords. No reply text (asserted by the tests). Examples, keywords
and the Kannada/Hindi reply renderings were authored by the development
assistant and are **unreviewed** by a native speaker.

## Detection (`app/intent/profile.py`)

`ProfileIntentDetector` subclasses Banking's `IntentDetector` and reuses its
`score_all()` (best-example contrastive scoring) over the profile's own
examples and anchors; Banking's tables and M10 rules are not used. Decision:

1. **Other-domain gate** — Banking's own lexical tables decide: a sentence naming
   a Banking service (`service_keywords.service_evidence`) is out of scope; one
   naming a declined banking operation (bills, cards, UPI, insurance —
   `routing_safety`) is out of scope unless it names a College topic other than
   "pay".
2. **Lexical narrowing** — keywords (word-prefix and phrase) restrict the choice.
3. **Margin vs anchors** (acknowledgements, control, unsafe = the engine's shared
   anchors; OUT_OF_SCOPE = every Banking example + general questions):
   `MARGIN = -0.05` when the intent is named by keyword, `0.10` when only the
   embeddings support it.
4. **Ambiguity** — nothing named, top two within `0.02`, different knowledge →
   `AMBIGUOUS` → "Do you mean X or Y?". A general intent is never an option.

### Measurement

| Set | Used for | Result |
|---|---|---|
| College dev (45) | tuning | 45/45 |
| College held-out (43) | check only | **40/43 (93%)**, Kannada 16/18, all 10 non-intents rejected |
| Banking m4_heldout, multilingual_v1, m10_dev (408) | tuning the gate / no-keyword margin | 0 accepted as College |
| Banking m3_language_cues, m5_fresh, m7_fresh (212) | check only | **1/212** accepted ("what is today's gold rate" → fees; fails safe, see below) |

Held-out misses: a Kannada instalment question rejected as out of scope (safe
failure); two "contact the admissions team" questions routed to
admission_process (answered from admission documents, or "no verified
information").

## Runtime (`service/domain_runtime.py`)

`DomainKnowledgeRuntime` subclasses `EngineRuntime` (inherits `transcribe`,
`_render`, `has_exited`) without calling its constructor, which would build
Banking's components. Per turn, mirroring `EngineRuntime.run_turn`: exit check →
empty turn → `normalize_turn` → `classify_turn` (shared control words) →
history → route → one output boundary.

**Registration and initialisation**

1. `service/main.py` import → `register_builtin_domain_runtimes()` registers the
   College factory with the Phase 2 registry (`service.engine`); nothing is built.
2. Lifespan: Banking `get_runtime()` first (unchanged), then each registered
   domain is warmed; a domain that fails to build is logged and answers 503 —
   Banking keeps serving. A failed build is not cached; the next request retries.
3. `build_college_runtime()` assembles from the College `DomainConfig`:
   `ProfileIntentDetector(COLLEGE_INTENT_PROFILE)` (shared encoder),
   `DomainKnowledgeBase.for_domain` (verified-only), `GroundedAnswerer(PERSONA)`
   (Groq client created on first answer), College reply catalog, College
   workflow folder; speech recognition is **borrowed** from the Banking
   runtime's `SpeechToText` — Whisper is loaded once per process.
4. Per session: the registry gives College sessions a `CatalogLocalizer`
   (College catalog first, shared catalog second, unknown text marked); Banking
   sessions keep `ResponseLocalizer`. The service passes College runtimes the
   session context (bound `institution_id` + latest `area`/`location_id`);
   Banking's `run_turn` is called exactly as before.

## Intent-aware, evidence-aware RAG

For a knowledge intent:

1. Retrieval: `domain=college`, the session's `institution_id`, `verified=true`
   (production), narrowed to **the chosen intent's own categories only**. Other
   topics the sentence mentions are deliberately not merged in — merging made
   "When are the semester examinations?" answer from the calendar and "What are
   the hostel fees?" from the tuition-fee document (found and fixed in this phase).
2. Not answerable (no institution documents, none in the category, best score
   < 0.30) → "I don't have verified information about <topic> yet. Please contact
   the college office for help." — **the model is not called**.
3. Otherwise `GroundedAnswerer`: evidence is the only source; the model must reply
   `NO_ANSWER` when the evidence does not answer; **every number in the answer must
   occur in the evidence** (Western/Kannada/Devanagari digits, separators
   ignored). Declined, ungrounded, empty or failed → the same uncertainty reply,
   logged (redacted) as unanswered with the reason.
4. Answers carry `sources` (document metadata, never content). The similarity
   threshold is therefore one of four gates, not the decision.

## Wire changes (additive)

`TurnResponse`: `intent`, `outcome` (`answered`, `no_verified_information`,
`clarify`, `out_of_scope`, `unsupported`, `workflow_pending`, `control`, `error`),
`sources` `[{id, title, institution_id, category, document_type, source,
source_reference, version, verified}]`. All `null` for Banking.

## Language

English and Kannada: examples, keywords and fixed replies; answers are requested
in the session language and script, keeping numbers, codes and names as written.
Hindi: fixed replies rendered; intents rely on the encoder (no Hindi examples).
**Tulu (`tcy`) is not supported**: a `tcy` session is answered in English, not
presented as Tulu. The intended Tulu-via-Kannada path is documented in the
catalogue and not implemented.

## Tests

`python -m debugging.test_college_runtime` — 130 checks: catalogue and mapping,
no reply text in detection, profile validation, dev/held-out English and Kannada,
Banking-sentence rejection (tuning and untouched sets), other-domain gate,
ambiguity/clarification, category- and institution-scoped retrieval through the
runtime, near-topic → no answer without a model call, invented amount rejected,
model decline/failure, no retrieval for out-of-scope/workflow intents,
verified-only enforcement (fixtures and production config), answer language,
Tulu not claimed, control words / repeat / exit, runtime registration and
one-time build, shared encoder and borrowed STT, build failure → unavailable and
retried, HTTP: College fields, Banking fields null, institution from context,
Kannada, session isolation (incl. 12 concurrent sessions over two institutions),
no fallback to Banking when College cannot be built.

Mutation checks (each must fail the suite): merging related categories (4),
disabling the number check (2), disabling category narrowing (8), disabling the
Banking gate (4).

## Regression (2026-11-07)

All 55 engine suites run one at a time: the 52 baseline suites have the
baseline's exit codes and pass counts; summary-less suites print identical
output; the same 7 live-LLM/interactive scripts stop for the same reasons.
`test_domain_isolation` 101/101, `test_college_rag` 100/100,
`test_college_runtime` 130/130. Banking backend unit 75/75, e2e 96/96; Banking
frontend 584/584. `backend/`, `frontend/`, `college-domain/` untouched.

## Known limitations

- Intent thresholds rest on small, assistant-authored sets; the no-keyword margin
  on two true cases. Re-measure with real student utterances and native review.
- Answer behaviour with the real model (NO_ANSWER compliance, Kannada answer
  quality) is not measured offline; the number check is the deterministic guard.
  Numbers written as words are not checked.
- The production College collection is empty, so every College knowledge
  question currently gets the uncertainty reply.
- Not exercised here: a live service start with College warm-up, live Groq calls.
