"""
P4 -- READ-ONLY WORKFLOW SNAPSHOT

Regression tests for GET /sessions/{session_id}/snapshot (service/main.py):
the read-only view a caller uses to learn where a visit stands after a turn
whose reply never arrived.

Real: the FastAPI app (through TestClient, without its lifespan, so no model
loads), SessionRegistry, ConversationManager, DialogueManager and the
workflow definitions. Stand-ins: dialogue understanding (never consulted by a
snapshot), and get_runtime(), replaced by a function that FAILS the test if a
snapshot ever reaches the runtime -- speech recognition, the LLM, intent
detection or model loading.

Offline: no network, no model, no audio.

Run from language_engine/:

    python -m debugging.test_workflow_snapshot
"""

import copy
import sys
import threading

from fastapi.testclient import TestClient

import service.engine as engine_module
import service.main as main
from app.conversation.state import SessionState, WorkflowState
from app.workflow.loader import WorkflowLoader
from debugging.test_phase32b1_control_routing import FakeUnderstanding, make_dialogue


PASSED = []
FAILED = []

DEPOSIT_STEPS = len(WorkflowLoader().load_workflow("deposit money")["steps"])


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label}   {detail}")


def section(title):
    print()
    print("=" * 62)
    print(title)
    print("=" * 62)


class RuntimeForbidden(AssertionError):
    pass


def forbidden_runtime():
    raise RuntimeForbidden("a snapshot reached the engine runtime")


class Api:
    """The real app, with the runtime made untouchable."""

    def __enter__(self):
        self.saved = (main.get_runtime, engine_module.get_runtime, main.INTERNAL_TOKEN)
        main.get_runtime = forbidden_runtime
        engine_module.get_runtime = forbidden_runtime
        main.INTERNAL_TOKEN = ""
        main.registry.clear()
        self.client = TestClient(main.app, raise_server_exceptions=True)
        self.dialogue = make_dialogue(FakeUnderstanding())
        return self

    def __exit__(self, *exc):
        main.get_runtime, engine_module.get_runtime, main.INTERNAL_TOKEN = self.saved
        main.registry.clear()

    def visit(self, session_id, workflow="deposit money", step=1):
        """A conversation in the registry, optionally with a workflow."""
        entry = main.registry.get_or_create(session_id, "en")
        if workflow:
            self.dialogue.start_workflow(entry.conversation, workflow)
            entry.conversation.current_step = step
        return entry

    def snapshot(self, session_id, **headers):
        return self.client.get(f"/sessions/{session_id}/snapshot", headers=headers)


def state_of(entry):
    """Everything a snapshot must leave exactly as it found."""
    c = entry.conversation
    return copy.deepcopy((
        c.history, c.current_step, c.workflow_state, c.workflow_conflict,
        c.session_state, c.current_intent, c.current_workflow, c.entities,
        c.language, entry.language, entry.localizer.language, entry.last_used_at,
        getattr(c, "paused_workflow", None), getattr(c, "recent_side_question", None),
    ))


# =========================================================
# ACCURATE SNAPSHOTS
# =========================================================

def test_active_workflow():
    section("an active workflow is reported exactly")
    with Api() as api:
        api.visit("S-ACTIVE", step=2)
        response = api.snapshot("S-ACTIVE")
        body = response.json()
        check("200", response.status_code == 200, str(response.status_code))
        check("known, not ended", body["known"] is True and body["ended"] is False, str(body))
        check("the workflow, its state, step and total",
              body["workflow"] == {"name": "deposit money", "state": "active",
                                   "step": 2, "total_steps": DEPOSIT_STEPS}, str(body["workflow"]))
        check("only status fields cross the boundary",
              set(body) == {"known", "ended", "workflow"}, str(sorted(body)))


def test_paused_completed_cancelled():
    section("paused, completed and cancelled are reported as they are")
    with Api() as api:
        entry = api.visit("S-PAUSED", step=3)
        entry.conversation.suspend_workflow()
        body = api.snapshot("S-PAUSED").json()
        check("paused: state suspended, same step",
              body["workflow"]["state"] == "suspended" and body["workflow"]["step"] == 3, str(body))

        entry = api.visit("S-DONE")
        entry.conversation.complete_workflow()
        check("completed: state completed",
              api.snapshot("S-DONE").json()["workflow"]["state"] == "completed")

        entry = api.visit("S-CANCELLED")
        entry.conversation.cancel_workflow()
        check("cancelled: state cancelled",
              api.snapshot("S-CANCELLED").json()["workflow"]["state"] == "cancelled")


def test_no_workflow():
    section("a visit with no workflow says so -- no invented progress")
    with Api() as api:
        api.visit("S-IDLE", workflow=None)
        body = api.snapshot("S-IDLE").json()
        check("known, no workflow",
              body["known"] is True and body["workflow"] == {
                  "name": None, "state": "none", "step": None, "total_steps": None}, str(body))


def test_unknown_visit():
    section("an unknown visit is unknown -- and is not created")
    with Api() as api:
        before = len(main.registry)
        body = api.snapshot("S-NEVER-SEEN").json()
        check("known is false and the workflow is unknown (null), not 'none'",
              body == {"known": False, "ended": False, "workflow": None}, str(body))
        check("no conversation was created for it",
              len(main.registry) == before and main.registry.peek("S-NEVER-SEEN") is None)


def test_exited_session():
    section("an exited session stays exited")
    with Api() as api:
        entry = api.visit("S-EXITED", step=2)
        entry.conversation.update_session_state(SessionState.EXITED)
        first = api.snapshot("S-EXITED").json()
        second = api.snapshot("S-EXITED").json()
        check("ended is reported", first["ended"] is True, str(first))
        check("the workflow is still shown as it was",
              first["workflow"]["state"] == "active" and first["workflow"]["step"] == 2, str(first))
        check("still EXITED after snapshots",
              entry.conversation.session_state == SessionState.EXITED and second == first)


# =========================================================
# READ-ONLY
# =========================================================

def test_snapshot_changes_nothing():
    section("taking snapshots changes nothing at all")
    with Api() as api:
        entry = api.visit("S-RO", step=2)
        # A cancel confirmation pending, and some history, to be sure the
        # pending question and the record survive too.
        api.dialogue.handle_control_command(entry.conversation, "cancel")
        entry.conversation.add_history("User", "cancel")
        before = state_of(entry)
        registry_size = len(main.registry)

        bodies = [api.snapshot("S-RO").json() for _ in range(5)]

        check("history, step, state, pending confirmation, session state, "
              "language and idle timer are unchanged", state_of(entry) == before)
        check("the cancel confirmation is still pending",
              entry.conversation.workflow_conflict is not None
              and entry.conversation.workflow_conflict.requested_workflow is None)
        check("repeated snapshots are identical", all(b == bodies[0] for b in bodies), str(bodies))
        check("the registry did not grow", len(main.registry) == registry_size)
        check("the turn lock is free again", entry.lock.acquire(blocking=False))
        entry.lock.release()


def test_never_reaches_the_runtime():
    section("no speech recognition, LLM, intent detection or model load")
    with Api() as api:
        api.visit("S-RT", step=2)
        runtime_before = engine_module._runtime
        try:
            response = api.snapshot("S-RT")
            check("served without the runtime", response.status_code == 200, response.text)
        except RuntimeForbidden as error:
            check("served without the runtime", False, str(error))
        check("the runtime slot is exactly as it was (nothing built or replaced)",
              engine_module._runtime is runtime_before)


# =========================================================
# CONCURRENCY, AUTH, VALIDATION
# =========================================================

def test_turn_in_progress_is_reported_busy():
    section("a turn still running is reported as busy, not as half-applied state")
    with Api() as api:
        entry = api.visit("S-BUSY", step=2)
        saved = main.SNAPSHOT_LOCK_TIMEOUT_SECONDS
        main.SNAPSHOT_LOCK_TIMEOUT_SECONDS = 0.05
        entry.lock.acquire()   # a turn holding the visit
        try:
            response = api.snapshot("S-BUSY")
            check("409 while the turn holds the lock", response.status_code == 409, str(response.status_code))
            check("with a plain detail", isinstance(response.json().get("detail"), str), response.text)
        finally:
            entry.lock.release()
            main.SNAPSHOT_LOCK_TIMEOUT_SECONDS = saved

        check("and an accurate snapshot once the turn is done",
              api.snapshot("S-BUSY").json()["workflow"]["step"] == 2)

        # A snapshot waits for a short turn rather than failing.
        entry.lock.acquire()
        timer = threading.Timer(0.1, entry.lock.release)
        timer.start()
        response = api.snapshot("S-BUSY")
        timer.join()
        check("a turn that finishes within the wait is waited for", response.status_code == 200)


def test_internal_token_is_required_when_configured():
    section("the internal token guards it like every other route")
    with Api() as api:
        api.visit("S-AUTH", step=2)
        main.INTERNAL_TOKEN = "secret"
        check("401 without the token", api.snapshot("S-AUTH").status_code == 401)
        check("401 with a wrong token",
              api.snapshot("S-AUTH", **{"X-Internal-Token": "nope"}).status_code == 401)
        check("200 with the token",
              api.snapshot("S-AUTH", **{"X-Internal-Token": "secret"}).status_code == 200)


def test_validation():
    section("an oversized session id is refused")
    with Api() as api:
        check("422 for a 129-character id", api.snapshot("x" * 129).status_code == 422)


def main_():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in globals().items() if name.startswith("test_")]

    for test in tests:
        test()

    print()
    print("=" * 62)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    for failure in FAILED:
        print(f"  FAILED: {failure}")
    print("=" * 62)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main_())
