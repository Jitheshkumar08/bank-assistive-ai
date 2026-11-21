"""
Regression tests for idle-conversation cleanup (G5) and workflow totals (G6).

Offline: no Whisper, no embeddings, no Groq, no network. Idleness runs on
an injected clock, so nothing here waits for real time to pass beyond a
few milliseconds of event-loop scheduling.

Run from language_engine/:

    python -m debugging.test_service_housekeeping
"""

import asyncio
import os
import sys

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.workflow.loader import WorkflowLoader
from service.housekeeping import (
    DEFAULT_IDLE_TIMEOUT_SECONDS,
    DEFAULT_PURGE_INTERVAL_SECONDS,
    IdleSessionReaper,
    idle_timeout_from_env,
    purge_interval_from_env,
)
from service.registry import SessionRegistry
from service.snapshot import workflow_snapshot


PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now


def registry_with_clock(timeout=60.0):
    clock = FakeClock()
    return SessionRegistry(idle_timeout_seconds=timeout, clock=clock), clock


# =========================================================
# G5 -- IDLENESS
# =========================================================

def test_recently_used_conversation_is_kept():
    registry, clock = registry_with_clock(timeout=60)
    registry.get_or_create("S1")

    clock.now += 59
    check("59 s idle with a 60 s timeout is not purged", registry.purge_idle() == 0)
    check("it is still there", registry.peek("S1") is not None)


def test_idle_conversation_is_purged():
    registry, clock = registry_with_clock(timeout=60)
    registry.get_or_create("S1")

    clock.now += 61
    check("61 s idle with a 60 s timeout is purged", registry.purge_idle() == 1)
    check("it is gone", registry.peek("S1") is None)


def test_a_turn_resets_the_idle_clock():
    registry, clock = registry_with_clock(timeout=60)
    registry.get_or_create("S1")

    clock.now += 50
    registry.get_or_create("S1")  # every turn goes through this
    clock.now += 50

    check("100 s old but used 50 s ago survives", registry.purge_idle() == 0)


def test_only_idle_conversations_are_purged():
    registry, clock = registry_with_clock(timeout=60)
    registry.get_or_create("OLD")
    clock.now += 61
    registry.get_or_create("NEW")

    check("exactly one purged", registry.purge_idle() == 1)
    check("the idle one went", registry.peek("OLD") is None)
    check("the active one stayed", registry.peek("NEW") is not None)


def test_a_conversation_mid_turn_is_never_purged():
    registry, clock = registry_with_clock(timeout=60)
    entry = registry.get_or_create("S1")

    clock.now += 600

    with entry.lock:  # a turn is running on this conversation
        purged_during_turn = registry.purge_idle()

    check("not purged while its turn holds the lock", purged_during_turn == 0)
    check("purged once the turn has finished", registry.purge_idle() == 1)


def test_a_slow_turn_does_not_count_as_idle_time():
    # Found at runtime: idleness was stamped only when a turn STARTED, so
    # a slow turn (CPU speech recognition, a slow LLM call) left its
    # conversation that much closer to being purged once it finished.
    registry, clock = registry_with_clock(timeout=60)
    entry = registry.get_or_create("S1")

    with registry.in_turn(entry):
        clock.now += 55  # the turn itself takes 55 s

    clock.now += 10  # answered 10 s ago, started 65 s ago

    check("purge counts from when the turn ended", registry.purge_idle() == 0)

    clock.now += 51
    check("and does purge once genuinely idle", registry.purge_idle() == 1)


def test_in_turn_holds_the_lock_and_releases_it():
    registry, _clock = registry_with_clock()
    entry = registry.get_or_create("S1")

    with registry.in_turn(entry):
        check("the turn holds the conversation's lock", entry.lock.locked())

    check("the lock is released afterwards", not entry.lock.locked())


def test_in_turn_survives_a_failing_turn():
    registry, clock = registry_with_clock(timeout=60)
    entry = registry.get_or_create("S1")

    try:
        with registry.in_turn(entry):
            clock.now += 55
            raise RuntimeError("transcription failed")
    except RuntimeError:
        pass

    check("a failed turn still releases the lock", not entry.lock.locked())
    clock.now += 10
    check("and still counts as activity", registry.purge_idle() == 0)


# =========================================================
# G5 -- THE REAPER'S LIFECYCLE
# =========================================================

def test_run_once_purges_and_reports():
    registry, clock = registry_with_clock(timeout=60)
    registry.get_or_create("S1")
    registry.get_or_create("S2")
    clock.now += 61

    reaper = IdleSessionReaper(registry, interval_seconds=300)

    check("run_once returns the number purged", reaper.run_once() == 2)
    check("nothing left", len(registry) == 0)


def test_run_once_survives_a_failing_pass():
    class Exploding:
        def purge_idle(self):
            raise RuntimeError("boom")

    reaper = IdleSessionReaper(Exploding(), interval_seconds=300)

    try:
        result = reaper.run_once()
        check("a failing pass does not raise", result == 0)
    except Exception as error:  # noqa: BLE001
        check("a failing pass does not raise", False, repr(error))


def test_interval_must_be_positive():
    for bad in (0, -5):
        try:
            IdleSessionReaper(SessionRegistry(), interval_seconds=bad)
            check(f"interval {bad} is refused", False)
        except ValueError:
            check(f"interval {bad} is refused", True)


def test_start_stop_lifecycle():
    async def scenario():
        registry, clock = registry_with_clock(timeout=60)
        reaper = IdleSessionReaper(registry, interval_seconds=0.01)

        check("not running before start", not reaper.running)

        reaper.start()
        first_task = reaper._task
        reaper.start()
        check("a second start does not create a second task", reaper._task is first_task)
        check("running after start", reaper.running)

        registry.get_or_create("S1")
        clock.now += 61
        await asyncio.sleep(0.05)
        check("the loop purges on its own", registry.peek("S1") is None)

        await reaper.stop()
        check("not running after stop", not reaper.running)
        check("its task finished", first_task.done())

        await reaper.stop()
        check("stopping twice is safe", not reaper.running)

        registry.get_or_create("S2")
        clock.now += 61
        await asyncio.sleep(0.05)
        check("nothing purges after stop", registry.peek("S2") is not None)

        reaper.start()
        check("it can be started again", reaper.running)
        await reaper.stop()

    asyncio.run(scenario())


def test_stop_before_start_is_safe():
    async def scenario():
        reaper = IdleSessionReaper(SessionRegistry(), interval_seconds=1)
        await reaper.stop()
        check("stop without start is a no-op", not reaper.running)

    asyncio.run(scenario())


def test_interval_from_environment():
    saved = os.environ.get("ENGINE_SESSION_PURGE_INTERVAL_SECONDS")

    try:
        cases = [
            ("", DEFAULT_PURGE_INTERVAL_SECONDS),
            ("120", 120.0),
            ("0", DEFAULT_PURGE_INTERVAL_SECONDS),
            ("-3", DEFAULT_PURGE_INTERVAL_SECONDS),
            ("soon", DEFAULT_PURGE_INTERVAL_SECONDS),
        ]

        for raw, expected in cases:
            os.environ["ENGINE_SESSION_PURGE_INTERVAL_SECONDS"] = raw
            got = purge_interval_from_env()
            check(f"interval {raw!r} -> {expected}", got == expected, f"got {got}")
    finally:
        if saved is None:
            os.environ.pop("ENGINE_SESSION_PURGE_INTERVAL_SECONDS", None)
        else:
            os.environ["ENGINE_SESSION_PURGE_INTERVAL_SECONDS"] = saved


def test_idle_timeout_from_environment():
    saved = os.environ.get("ENGINE_SESSION_IDLE_SECONDS")

    try:
        cases = [
            ("", DEFAULT_IDLE_TIMEOUT_SECONDS),
            ("1800", 1800.0),
            ("0", DEFAULT_IDLE_TIMEOUT_SECONDS),
            ("-1", DEFAULT_IDLE_TIMEOUT_SECONDS),
            ("inf", DEFAULT_IDLE_TIMEOUT_SECONDS),
            ("nan", DEFAULT_IDLE_TIMEOUT_SECONDS),
            ("an hour", DEFAULT_IDLE_TIMEOUT_SECONDS),
        ]

        for raw, expected in cases:
            os.environ["ENGINE_SESSION_IDLE_SECONDS"] = raw
            got = idle_timeout_from_env()
            check(f"idle timeout {raw!r} -> {expected}", got == expected, f"got {got}")
    finally:
        if saved is None:
            os.environ.pop("ENGINE_SESSION_IDLE_SECONDS", None)
        else:
            os.environ["ENGINE_SESSION_IDLE_SECONDS"] = saved


def test_default_idle_timeout_is_unchanged():
    check("default idle timeout is still one hour", DEFAULT_IDLE_TIMEOUT_SECONDS == 3600.0)


def test_non_finite_purge_interval_is_refused():
    saved = os.environ.get("ENGINE_SESSION_PURGE_INTERVAL_SECONDS")

    try:
        for raw in ("inf", "nan"):
            os.environ["ENGINE_SESSION_PURGE_INTERVAL_SECONDS"] = raw
            check(
                f"interval {raw!r} falls back to the default",
                purge_interval_from_env() == DEFAULT_PURGE_INTERVAL_SECONDS,
            )
    finally:
        if saved is None:
            os.environ.pop("ENGINE_SESSION_PURGE_INTERVAL_SECONDS", None)
        else:
            os.environ["ENGINE_SESSION_PURGE_INTERVAL_SECONDS"] = saved


def test_service_lifespan_starts_and_stops_the_reaper():
    # The real lifespan, with model loading replaced: this checks the
    # wiring, not the models.
    import service.main as main

    saved_runtime, saved_key = main.get_runtime, os.environ.get("GROQ_API_KEY")
    main.get_runtime = lambda: None
    os.environ["GROQ_API_KEY"] = "placeholder-for-lifespan-test"

    async def scenario():
        main.registry.get_or_create("S1")

        async with main.lifespan(main.app):
            check("the reaper runs while the service is up", main.reaper.running)

        check("the reaper is stopped at shutdown", not main.reaper.running)
        check("conversations are cleared at shutdown", len(main.registry) == 0)

    try:
        asyncio.run(scenario())
    finally:
        main.get_runtime = saved_runtime
        if saved_key is None:
            os.environ.pop("GROQ_API_KEY", None)
        else:
            os.environ["GROQ_API_KEY"] = saved_key


# =========================================================
# G6 -- WORKFLOW TOTALS
# =========================================================

LOADER = WorkflowLoader()


def fresh_conversation():
    conversation = ConversationManager()
    conversation.start_conversation()
    return conversation


def test_no_workflow_has_no_total():
    snapshot = workflow_snapshot(fresh_conversation(), LOADER)

    check("state is none", snapshot.state == "none")
    check("no name", snapshot.name is None)
    check("no step", snapshot.step is None)
    check("no total", snapshot.total_steps is None)


def test_active_workflows_report_their_real_total():
    for name in ("deposit money", "withdraw money", "apply for loan"):
        conversation = fresh_conversation()
        conversation.load_workflow(name)

        definition = LOADER.load_workflow(name)
        expected = len(definition["steps"])
        snapshot = workflow_snapshot(conversation, LOADER)

        check(
            f"{name}: total_steps is the definition's step count ({expected})",
            snapshot.total_steps == expected,
            f"got {snapshot.total_steps}",
        )
        check(f"{name}: step 1 of {expected}", snapshot.step == 1)
        check(f"{name}: active", snapshot.state == "active")


def test_deposit_total_is_four():
    # Pinned to the shipped definition, so an accidental change to the
    # file shows up here as well as in the UI.
    conversation = fresh_conversation()
    conversation.load_workflow("deposit money")

    check("deposit has 4 steps", workflow_snapshot(conversation, LOADER).total_steps == 4)


def test_total_survives_suspension_and_completion():
    conversation = fresh_conversation()
    conversation.load_workflow("deposit money")

    conversation.suspend_workflow()
    suspended = workflow_snapshot(conversation, LOADER)
    check("suspended keeps its total", suspended.total_steps == 4 and suspended.state == "suspended")

    conversation.resume_workflow()
    conversation.current_step = 5  # how the dialogue manager finishes
    conversation.complete_workflow()
    completed = workflow_snapshot(conversation, LOADER)
    check("completed keeps its total", completed.total_steps == 4 and completed.state == "completed")


def test_released_workflow_has_no_total():
    conversation = fresh_conversation()
    conversation.load_workflow("deposit money")
    conversation.release_workflow()

    snapshot = workflow_snapshot(conversation, LOADER)
    check("released: no total", snapshot.total_steps is None and snapshot.state == "none")


def test_unknown_workflow_is_not_guessed():
    conversation = fresh_conversation()
    conversation.current_workflow = "teleport money"
    conversation.workflow_state = WorkflowState.ACTIVE
    conversation.current_step = 1

    check(
        "a definition that cannot be loaded gives no total",
        workflow_snapshot(conversation, LOADER).total_steps is None,
    )


def test_without_a_loader_there_is_no_total():
    conversation = fresh_conversation()
    conversation.load_workflow("deposit money")

    check("no loader: total is None", workflow_snapshot(conversation, None).total_steps is None)


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("SERVICE HOUSEKEEPING (G5) AND WORKFLOW TOTALS (G6)")
    print("=" * 60)

    for test in tests:
        print(f"\n{test.__name__}")
        test()

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
