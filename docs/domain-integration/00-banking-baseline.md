# Banking test baseline (before domain integration)

Recorded on 2026-11-06 from commit `7081b66`, working tree clean, **before any
domain-integration code change**. Every later phase is compared with this.

## Banking frontend — `frontend/`

`npx vitest run` → **37 files, 584 / 584 tests passed.**

## Banking backend — `backend/`

| Command | Result |
|---|---|
| `npx jest --config test/jest-unit.js` | **6 suites, 75 / 75 passed** |
| `npx jest --config test/jest-e2e.js` (`npm test`, real local database; deletes only rows it created) | **5 suites, 96 / 96 passed** |

## Language engine — `language_engine/`

Each suite run separately: `PYTHONIOENCODING=utf-8 venv/Scripts/python.exe -m debugging.<suite>`.

**45 suites passed (exit 0):**

test_audio_decoding (36), test_cancel_confirmation_exit (129), test_conversation,
test_evaluation_harness (102), test_intent, test_knowledge, test_llm_cancel_confirmation (84),
test_m1_amounts (140), test_m10_policy (49), test_m10_routing (82), test_m3_language_cues (146),
test_m4_intent (108), test_m5_normalization (70), test_m6_localization (93), test_m7_knowledge (82),
test_m8_speech (69), test_m9_asr (62), test_phase25, test_phase31, test_phase32, test_phase32b1,
test_phase32b1_control_routing, test_phase32b12, test_phase32b13, test_phase32b14,
test_phase32b15_audit, test_phase32b2, test_phase32b3, test_phase32b4, test_proactive_assistance (210),
test_remediation, test_retriever, test_romanized_batch1 (131), test_romanized_g3g4 (163),
test_service_config (35), test_service_housekeeping (68), test_service_language (88),
test_service_registry (33), test_service_tts (32), test_service_turn, test_translation,
test_tts_diagnostics (59), test_vad_recorder, test_workflow, test_workflow_snapshot (28).

(Numbers in brackets are the suite's own check counts where it prints one.)

**7 suites did not pass, all for environmental reasons that exist before any change:**

| Suite | Reason |
|---|---|
| test_dialogue, test_dialogue_understanding, test_full_pipeline, test_pipeline, test_question | Live-LLM scripts: construct the Groq client and stop with `GROQ_API_KEY environment variable is not set`. The debugging scripts do not load `.env` (only the FastAPI service does). |
| test_stt, test_tts | Interactive manual scripts (`input()` prompts); stop with `EOFError` when run unattended. |

These seven are tracked as "same before and after", not as regressions.

## College (reference only, not Banking)

| Command | Result |
|---|---|
| `college-domain/backend`: `npm test` | 5 suites, 75 / 75 passed |
| `college-domain/frontend`: `npx vitest run` | 18 files, 203 / 203 passed |
| `college-domain/backend`: `npm run test:e2e` | Not run: no `.env.test` (a `_test` database) is configured on this machine |
