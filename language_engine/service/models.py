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


class TtsRequest(BaseModel):
    # The language is decided by NestJS from the visit, never sent
    # independently by a browser.
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", min_length=2, max_length=16)


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    active_sessions: int
