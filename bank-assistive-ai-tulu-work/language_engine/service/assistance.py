"""
The proactive offer of help a quiet customer is given (Feature 1).

Kept out of main.py so it can be tested without FastAPI or the models.

The browser decides WHEN the customer has been quiet -- it is the only side
that knows whether they are typing, speaking, or listening to a reply. This
decides WHETHER an offer is appropriate and WHAT it says, from the engine's
own state, which is the only authority on it:

  - only for a workflow that is ACTIVE on a real step: not paused (the
    customer asked to wait), not finished, cancelled or absent;
  - never while a question is pending -- a cancel confirmation or a
    workflow-switch question is waiting for ITS answer, and an offer of
    help on top of it would bury it;
  - never after the customer said exit.

An offer changes nothing about the workflow: not the step, not the state,
not the pending-question slot. It is added to the conversation history as
the assistant's words, so dialogue understanding reads the customer's next
turn knowing help was just offered. Silence is never an answer: nothing
here, or anywhere downstream of it, treats the absence of a reply as
consent, confirmation or completion.
"""

from __future__ import annotations

from typing import Optional

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.dialogue.assistance import choose_prompt, step_field
from app.dialogue.localization import ResponseLocalizer
from app.workflow.loader import WorkflowLoader
from service.models import AssistanceResponse

OFFERED = "offered"
ENDED = "ended"
PENDING_QUESTION = "pending_question"
PAUSED = "paused"
NO_ACTIVE_STEP = "no_active_step"


def offer_assistance(
    conversation: ConversationManager,
    loader: WorkflowLoader,
    localizer: Optional[ResponseLocalizer],
    *,
    ended: bool,
    avoid: Optional[str] = None,
) -> AssistanceResponse:
    """The offer for this conversation now, or the reason there is none."""

    if ended:
        return AssistanceResponse(offered=False, reason=ENDED)

    if getattr(conversation, "workflow_conflict", None) is not None:
        return AssistanceResponse(offered=False, reason=PENDING_QUESTION)

    if conversation.workflow_state == WorkflowState.SUSPENDED:
        return AssistanceResponse(offered=False, reason=PAUSED)

    name = conversation.current_workflow

    if conversation.workflow_state != WorkflowState.ACTIVE or not name:
        return AssistanceResponse(offered=False, reason=NO_ACTIVE_STEP)

    definition = loader.load_workflow(name)
    steps = definition["steps"] if definition else []
    step = conversation.current_step

    if not 1 <= step <= len(steps):
        return AssistanceResponse(offered=False, reason=NO_ACTIVE_STEP)

    field = step_field(steps[step - 1])
    prompt_id, text = choose_prompt(field, avoid)

    conversation.add_history("Assistant", text)

    # Not remembered as the replay target: "repeat" means the step, not
    # the offer.
    rendered = localizer.render(text, remember=False) if localizer is not None else text

    return AssistanceResponse(
        offered=True,
        reason=OFFERED,
        field=field,
        prompt_id=prompt_id,
        text=rendered,
    )
