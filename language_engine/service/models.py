"""
Wire format between NestJS and this service.

Deliberately small and flat. Nothing here exposes an engine object: the
conversation, its workflow loader and its history stay inside the
process, and only plain values cross the boundary.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class WorkflowSnapshot(BaseModel):
    """Safe view of where the banking task has reached."""

    name: Optional[str] = None
    state: str = "none"
    step: Optional[int] = None
    total_steps: Optional[int] = None


class TextTurnRequest(BaseModel):
    # Supplied by NestJS after it has checked the visit belongs to the
    # caller. This service trusts its caller, which is why it must not be
    # reachable from a browser.
    session_id: str = Field(min_length=1, max_length=128)
    language: str = Field(default="en", min_length=2, max_length=16)
    text: str = Field(min_length=1, max_length=4000)


class TurnResponse(BaseModel):
    reply: str
    #: Present only when the turn began as speech.
    transcript: Optional[str] = None
    workflow: WorkflowSnapshot = WorkflowSnapshot()
    #: True when the customer asked to end the session.
    ended: bool = False


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
    #: "unknown_session" when this service holds no conversation for the visit.
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
