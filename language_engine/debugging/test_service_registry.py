"""
Regression tests for the per-session conversation registry.

Runs entirely offline: no Whisper, no embeddings, no Groq, no network.
The registry deliberately imports nothing expensive, so these tests run
anywhere Python does -- which matters, because session isolation is the
one thing that must never regress. Two customers sharing a
ConversationManager would mean one person's banking workflow appearing
in another person's screen.

Run from the repository root:

    python -m debugging.test_service_registry
"""

import sys
import threading

from app.conversation.state import SessionState, WorkflowState
from service.registry import SessionRegistry


PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


# =========================================================
# CREATION AND REUSE
# =========================================================

def test_creates_a_conversation_per_session():
    registry = SessionRegistry()

    first = registry.get_or_create("S001")
    second = registry.get_or_create("S002")

    check(
        "different sessions get different conversations",
        first.conversation is not second.conversation,
    )
    check("registry holds both", len(registry) == 2)


def test_reuses_the_same_conversation():
    registry = SessionRegistry()

    first = registry.get_or_create("S001")
    again = registry.get_or_create("S001")

    check("the same session is reused", first.conversation is again.conversation)
    check("reuse does not add an entry", len(registry) == 1)


def test_a_returning_session_keeps_its_state():
    registry = SessionRegistry()

    entry = registry.get_or_create("S001")
    entry.conversation.set_intent("withdraw money")
    entry.conversation.load_workflow("withdraw money")
    entry.conversation.current_step = 3
    entry.conversation.add_entities({"amount": 2000})

    # A later turn in the same visit -- a spoken one, say, after a typed
    # one -- must continue where the customer left off.
    later = registry.get_or_create("S001")

    check("workflow survives", later.conversation.current_workflow == "withdraw money")
    check("step survives", later.conversation.current_step == 3)
    check("entities survive", later.conversation.entities.get("amount") == 2000)
    check("state survives", later.conversation.workflow_state == WorkflowState.ACTIVE)


def test_a_new_conversation_starts_ready():
    registry = SessionRegistry()

    entry = registry.get_or_create("S001", language="kn")

    check("conversation is ready", entry.conversation.session_state == SessionState.READY)
    check("no workflow yet", entry.conversation.workflow_state == WorkflowState.NONE)
    check("language is carried through", entry.conversation.language == "kn")


def test_rejects_a_missing_session_id():
    registry = SessionRegistry()

    try:
        registry.get_or_create("")
        check("empty session id is rejected", False, "no error raised")
    except ValueError:
        check("empty session id is rejected", True)


# =========================================================
# ISOLATION
# =========================================================

def test_sessions_never_share_state():
    registry = SessionRegistry()

    a = registry.get_or_create("S001")
    b = registry.get_or_create("S002")

    a.conversation.set_intent("withdraw money")
    a.conversation.load_workflow("withdraw money")
    a.conversation.current_step = 4
    a.conversation.add_entities({"amount": 5000})
    a.conversation.add_history("User", "I want to withdraw money")

    check("intent does not leak", b.conversation.current_intent is None)
    check("workflow does not leak", b.conversation.current_workflow is None)
    check("step does not leak", b.conversation.current_step == 0)
    check("entities do not leak", b.conversation.entities == {})
    check("history does not leak", b.conversation.history == [])
    check("workflow state does not leak", b.conversation.workflow_state == WorkflowState.NONE)


def test_entities_are_not_a_shared_dict():
    registry = SessionRegistry()

    a = registry.get_or_create("S001")
    b = registry.get_or_create("S002")

    check(
        "entity dictionaries are distinct objects",
        a.conversation.entities is not b.conversation.entities,
    )
    check(
        "history lists are distinct objects",
        a.conversation.history is not b.conversation.history,
    )


# =========================================================
# CONCURRENCY
# =========================================================

def test_concurrent_creation_is_safe():
    registry = SessionRegistry()
    seen = []
    barrier = threading.Barrier(20)

    def worker():
        # Every thread races for the same session id at the same moment.
        barrier.wait()
        seen.append(registry.get_or_create("S001").conversation)

    threads = [threading.Thread(target=worker) for _ in range(20)]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    check("only one conversation was created", len({id(c) for c in seen}) == 1)
    check("registry holds a single entry", len(registry) == 1)


def test_concurrent_distinct_sessions_are_safe():
    registry = SessionRegistry()
    barrier = threading.Barrier(25)

    def worker(index):
        barrier.wait()
        registry.get_or_create(f"S{index:03d}")

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(25)]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    check("every session was registered", len(registry) == 25)


def test_per_session_lock_serialises_turns():
    registry = SessionRegistry()
    entry = registry.get_or_create("S001")
    order = []

    def worker(tag):
        with entry.lock:
            order.append(f"{tag}-start")
            order.append(f"{tag}-end")

    threads = [threading.Thread(target=worker, args=(t,)) for t in ("a", "b", "c")]

    for thread in threads:
        thread.start()

    for thread in threads:
        thread.join()

    interleaved = any(
        order[i].endswith("-start") and order[i + 1].endswith("-start")
        for i in range(len(order) - 1)
    )

    check("turns in one session never interleave", not interleaved, str(order))


# =========================================================
# CLEANUP
# =========================================================

def test_removes_a_session():
    registry = SessionRegistry()
    registry.get_or_create("S001")

    check("removal reports success", registry.remove("S001") is True)
    check("session is gone", registry.peek("S001") is None)
    check("removing twice is safe", registry.remove("S001") is False)


def test_purges_idle_sessions():
    # Everything is immediately considered idle.
    registry = SessionRegistry(idle_timeout_seconds=-1)
    registry.get_or_create("S001")
    registry.get_or_create("S002")

    purged = registry.purge_idle()

    check("idle conversations are forgotten", purged == 2 and len(registry) == 0)


def test_keeps_active_sessions_when_purging():
    registry = SessionRegistry(idle_timeout_seconds=3600)
    registry.get_or_create("S001")

    check("an active conversation survives a purge", registry.purge_idle() == 0)
    check("it is still there", registry.peek("S001") is not None)


def test_evicts_when_full():
    registry = SessionRegistry(max_sessions=3, idle_timeout_seconds=3600)

    for index in range(3):
        registry.get_or_create(f"S{index}")

    # Touch the first two so the third is the least recently used.
    registry.get_or_create("S0")
    registry.get_or_create("S1")
    registry.get_or_create("S9")

    check("registry stays within its limit", len(registry) == 3)
    check("least recently used was evicted", registry.peek("S2") is None)
    check("the newcomer was admitted", registry.peek("S9") is not None)


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("SESSION REGISTRY REGRESSION TESTS")
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
