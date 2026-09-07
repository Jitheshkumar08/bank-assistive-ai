from enum import Enum


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
