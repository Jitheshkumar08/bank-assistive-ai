"""
Wire format between NestJS and this service.

Deliberately small and flat. Nothing here exposes an engine object: the
conversation, its workflow loader and its history stay inside the
process, and only plain values cross the boundary.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

#: Context values are identifiers -- never free text.
_CONTEXT_ID = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"


class AssistantContext(BaseModel):
    """
    Where the user is, as the calling backend resolved it (QR scan, session).

    Which keys a domain accepts, requires and fixes per session is the
    domain's policy (app/domains), checked by service/domains.py. Unknown
    keys are refused here rather than ignored.
    """

    model_config = ConfigDict(extra="forbid")

    institution_id: Optional[str] = Field(default=None, pattern=_CONTEXT_ID)
    branch_id: Optional[str] = Field(default=None, pattern=_CONTEXT_ID)
    area: Optional[str] = Field(default=None, pattern=_CONTEXT_ID)
    location_id: Optional[str] = Field(default=None, pattern=_CONTEXT_ID)


class WorkflowSnapshot(BaseModel):
    """Safe view of where the banking task has reached."""

    name: Optional[str] = None
    state: str = "none"
    step: Optional[int] = None
    total_steps: Optional[int] = None


class TextTurnRequest(BaseModel):
    #: Unknown fields are kept (not ignored) so the route can refuse them for
    #: non-Banking domains (Phase 6: e.g. a forged "student_context"). Banking
    #: keeps its original behaviour: extra fields are ignored.
    model_config = ConfigDict(extra="allow")

    # Supplied by NestJS after it has checked the visit belongs to the
    # caller. This service trusts its caller, which is why it must not be
    # reachable from a browser.
    session_id: str = Field(min_length=1, max_length=128)
    language: str = Field(default="en", min_length=2, max_length=16)
    text: str = Field(min_length=1, max_length=4000)
    #: Optional declaration of the caller's domain. It can only confirm the
    #: domain the caller's token belongs to (service/domains.py).
    domain: Optional[str] = Field(default=None, min_length=1, max_length=32)
    context: Optional[AssistantContext] = None


class SourceReference(BaseModel):
    """Where an answer came from: document metadata, never its content."""

    id: str
    title: Optional[str] = None
    institution_id: Optional[str] = None
    category: Optional[str] = None
    document_type: Optional[str] = None
    source: Optional[str] = None
    source_reference: Optional[str] = None
    version: Optional[str] = None
    verified: bool = False


class WorkflowAction(BaseModel):
    """
    A request for the calling backend (Phase 5), e.g. "look up the signed-in
    student's admission status". Carries no data: the backend decides,
    authorises and performs it, then answers POST
    /sessions/{id}/workflow-result with this `id` and an outcome code.
    """

    id: str
    type: str
    workflow: str


class WorkflowResultRequest(BaseModel):
    """
    The backend's answer to a WorkflowAction: an outcome CODE only. Any other
    field (a record, a name, a reference number) is refused by extra="forbid".
    """

    model_config = ConfigDict(extra="forbid")

    action_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    outcome: str = Field(min_length=2, max_length=40, pattern=r"^[a-z][a-z_]*$")
    #: Phase 6: the action's type as the backend understood it. Optional for
    #: compatibility; when present it must equal the pending action's type.
    action_type: Optional[str] = Field(default=None, min_length=2, max_length=40, pattern=r"^[a-z][a-z_]*$")


class TurnResponse(BaseModel):
    reply: str
    #: Present only when the turn began as speech.
    transcript: Optional[str] = None
    workflow: WorkflowSnapshot = WorkflowSnapshot()
    #: True when the customer asked to end the session.
    ended: bool = False
    #: The domain that served the turn.
    domain: Optional[str] = None
    #: Domain runtimes only (Phase 4); None for Banking. The detected intent,
    #: how the turn ended, and the documents an answer was grounded in.
    intent: Optional[str] = None
    outcome: Optional[str] = None
    sources: Optional[List[SourceReference]] = None
    #: Domain workflows only (Phase 5); None otherwise. A step-by-step list
    #: in the session language (directions), and a request for the backend.
    steps: Optional[List[str]] = None
    action: Optional[WorkflowAction] = None


class SessionSnapshotResponse(BaseModel):
    """
    A read-only view of a visit's conversation, for re-syncing the UI after
    a turn whose reply never arrived (a timeout, a dropped connection).

    Carries status only -- never history, entities, or anything said.
    """

    #: False when this service holds no conversation for the visit: never
    #: spoken to, purged after idling, or lost to a restart. The workflow is
    #: then UNKNOWN (None), which is not the same as "no workflow".
    known: bool
    #: True once the customer has said exit; no further turns are accepted.
    ended: bool = False
    #: Same shape as a turn's snapshot. None only when `known` is False.
    workflow: Optional[WorkflowSnapshot] = None


class AssistanceRequest(BaseModel):
    """Asks whether a quiet customer should be offered help now."""

    #: The id of the last offer shown, so the next one is worded differently.
    avoid: Optional[str] = Field(default=None, max_length=64, pattern=r"^[a-z_]+\.\d+$")


class AssistanceResponse(BaseModel):
    """
    An offer of help, or why there is none. Changes no workflow state.

    `text` is already in the visit's language. `field` is the current step's
    field type from the workflow definition.
    """

    offered: bool
    #: "offered", "ended", "pending_question", "paused" or "no_active_step";
    #: "unknown_session" when this service holds no conversation for the visit;
    #: "not_available" for a domain whose workflows have no assistance offers.
    reason: str
    field: Optional[str] = None
    prompt_id: Optional[str] = None
    text: Optional[str] = None


class TtsRequest(BaseModel):
    # The language is decided by NestJS from the visit, never sent
    # independently by a browser.
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", min_length=2, max_length=16)


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    active_sessions: int
    #: Per domain: "ready", "registered" (built on first use) or "unavailable".
    domains: Dict[str, str] = {}
