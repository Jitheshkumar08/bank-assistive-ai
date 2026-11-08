# Phase 2 — Domain-aware language engine

The shared engine (`language_engine/`) now knows which application domain a
request belongs to, and keeps the domains apart. Phase 2 adds no College
knowledge, intents or workflows (Phases 3–5); until those exist a College
turn is refused with `503 domain_unavailable`, and is never answered by
Banking.

## Domain configuration (`language_engine/app/domains/`)

Configuration only — no language processing.

| Domain | Token variable | Context accepted | Required | Fixed per session |
|---|---|---|---|---|
| `banking` | `AI_ENGINE_TOKEN` (the existing token) | `branch_id` | — | `branch_id` |
| `college` | `AI_ENGINE_COLLEGE_TOKEN` | `institution_id`, `area`, `location_id` | `institution_id` | `institution_id` |

Adding a domain = a `config.py` under `app/domains/<id>/` plus one line in
`app/domains/__init__.py`.

## How a request's domain is resolved (`language_engine/service/domains.py`)

1. **The token decides.** The `X-Internal-Token` a request presents is matched
   (constant time) against every domain's token. As soon as any token is
   configured, every request must present a valid one (`401 not_authorised`).
2. **A declaration can only confirm.** A request may name its domain in the
   `X-Assistant-Domain` header or `domain` in a `/turn` body. A name that is
   not registered → `422 unknown_domain`; one that differs from the token's
   domain (or from another declaration) → `403 domain_forbidden`.
3. **Development without tokens.** With `AI_ENGINE_ENV=development` and no
   token set there is no caller identity, so the declaration decides; a request
   that declares nothing is a pre-domain caller and keeps the original
   (Banking) contract. This is why the Banking backend needed **no change**.
   The College backend will always declare `college`.
4. **Production.** `AI_ENGINE_ENV=production` refuses to start unless every
   domain has its own token of ≥ 32 characters. Two domains sharing a token is
   refused in every environment. When authentication is off the service logs a
   warning at startup.

## Isolation

- **Sessions** are keyed by `(domain, session_id)`. The same id used by both
  backends is two separate conversations; snapshot, assistance and end-session
  only see the caller's own domain.
- **Institution binding.** A College session is fixed to the `institution_id`
  of its first turn; a later turn naming another → `409 context_conflict`.
  `area` / `location_id` may change between turns (a new QR scan).
- **Context policy.** College keys in a Banking turn (or the reverse), unknown
  keys, and non-identifier values → `422 invalid_context`.
- **Runtimes.** Banking is still served by `get_runtime()`, unchanged. Other
  domains get their own runtime from a factory registered with
  `service.engine.register_domain_runtime()`, built once on first use. Models
  (sentence encoder, Whisper) are shared through their existing caches;
  dialogue and session state are not.
- A refused request reaches no runtime and creates no session.

## Wire changes (all additive)

- `POST /turn` body: optional `domain`, optional `context`
  `{institution_id, branch_id, area, location_id}`.
- `POST /turn/audio` form: optional `institution_id`, `branch_id`, `area`, `location_id`.
- Every route: optional `X-Assistant-Domain` header.
- `TurnResponse.domain`; `GET /health` → `domains: {banking, college}` status.
- Refusals: `{"detail": "<safe message>", "error": "<code>"}` — never echoes a token or input.

## Environment

`language_engine/.env.example`: `AI_ENGINE_TOKEN`, `AI_ENGINE_COLLEGE_TOKEN`,
`AI_ENGINE_ENV`. `AI_ENGINE_COLLEGE_TOKEN` is treated as a secret (never logged).

## Tests

`python -m debugging.test_domain_isolation` (offline, fake runtimes): config
validation, token→domain resolution, startup checks, context policy, registry
isolation, institution binding, HTTP refusals, no fallback to Banking,
cross-domain snapshot/assistance/delete, legacy Banking contract, `/tts`
domain check, health, and 40 concurrent mixed-domain turns.

## Regression verification (2026-11-06)

Compared with `00-banking-baseline.md`. Engine suites were run one at a time
(the first 29 in one batch run, which stopped on a low-memory warning; the
other 24 then individually in the foreground).

- **Engine:** 53 suites = the baseline's 52 + `test_domain_isolation` (101 / 101).
  Every one of the 52 has the **same exit code** as in the baseline; every suite
  with a summary line prints the **identical** pass count; the six that print no
  summary (`test_conversation`, `test_intent`, `test_knowledge`, `test_retriever`,
  `test_translation`, `test_workflow`) produce output **identical** to the baseline.
- **Not verifiable here (unchanged from the baseline, same stop reason):**
  live-LLM `test_dialogue`, `test_dialogue_understanding`, `test_full_pipeline`,
  `test_pipeline`, `test_question` (`GROQ_API_KEY` not exported in the shell);
  interactive `test_stt`, `test_tts` (`EOFError` at their keyboard prompt).
- **Banking backend:** unit 75 / 75, e2e 96 / 96. **Banking frontend:** 584 / 584.
  `backend/` and `frontend/` have no modified or new files.
- **New failures:** none.
