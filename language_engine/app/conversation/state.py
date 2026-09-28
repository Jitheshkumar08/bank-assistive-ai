from enum import Enum
from typing import NamedTuple


class SessionState(Enum):
    """
    Lifecycle of the assistant itself: what it is doing right
    now (idle, listening, processing, speaking). Independent of
    any banking workflow -- the assistant can be READY while a
    workflow sits SUSPENDED, COMPLETED, or CANCELLED.
    """

    IDLE = "idle"
    READY = "ready"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"
    EXITED = "exited"


class WorkflowState(Enum):
    """
    Lifecycle of the currently loaded banking workflow, if any.
    Independent of SessionState -- suspending, cancelling, or
    completing a workflow must never end the assistant session.
    """

    NONE = "none"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PausedWorkflow(NamedTuple):
    """A complete snapshot of one paused banking request (Phase 3.2B-14).

    ConversationManager has exactly ONE workflow slot. That is deliberate --
    there is one customer at one counter doing one thing -- but it means that
    starting a second request overwrites the first one's workflow, step and
    entities even when the customer explicitly asked for it to be PAUSED
    rather than cancelled.

    This is what keeps the paused request recoverable: everything needed to put
    it back exactly where it was, and nothing else. It is NOT a second workflow
    slot and nothing executes against it -- no step is read from it, no
    transition reads it, and the assistant never acts on it. Only
    ConversationManager.restore_paused_workflow() consumes it, which moves it
    back into the one real slot as SUSPENDED.

    One snapshot, like recent_side_question: storing a new one REPLACES the old
    one, so nothing can accumulate and no bound has to be enforced.
    """

    intent: str
    workflow: str
    step: int
    entities: dict
