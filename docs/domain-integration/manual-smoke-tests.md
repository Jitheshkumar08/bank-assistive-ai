# Manual smoke tests

Manual checks run by a person against the running system. Each stage is recorded
separately; a stage is marked **Passed** only when its observed result was
written down. "Not recorded" means the check was run but that stage's result
was not captured — it is neither a pass nor a failure.

## MS-01 — Banking voice interaction (after Phase 2)

| | |
|---|---|
| Date | 2026-11-06 (reported) |
| Build | Working tree after Phase 2 (domain resolution), uncommitted, base commit `7081b66` |
| Application | Banking (`frontend/` → `backend/` → `language_engine/`) |
| Input | Spoken: "Please take a withdrawal slip." |
| Tester | Project owner |

| Stage | What to observe | Observed | Status |
|---|---|---|---|
| 1. ASR transcription | Transcript shown back in the chat matches the spoken sentence | — | Not recorded |
| 2. Intent detection | Engine log line `🧠 Intent: … \| Category: …` (expected: a withdrawal request, `BANKING_INTENT`, or an abstention category) | — | Not recorded |
| 3. Workflow selection | Workflow card / snapshot shows the selected workflow and step (e.g. `withdraw money`, step 1) or none | — | Not recorded |
| 4. TTS output | Reply is spoken aloud in the session language | — | Not recorded |

**Overall:** reported as checked by the tester; per-stage results not yet
supplied, so no stage is claimed as passed. To complete this record, fill in
the "Observed" column from the chat screen and the "AI engine :8000" console
window and set each status to Passed / Failed.

Note for stage 2–3: "Please take a withdrawal slip." is also the wording of
step 1 of the withdrawal workflow (`app/workflow/workflows/withdraw.json`), so
the expected outcome depends on whether a workflow was already active when it
was spoken.
