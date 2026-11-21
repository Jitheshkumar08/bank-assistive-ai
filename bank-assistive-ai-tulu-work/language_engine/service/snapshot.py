"""
The workflow progress a turn reports back to NestJS.

Kept out of main.py so it can be tested without FastAPI or the models.
"""

from __future__ import annotations

from typing import Optional

from app.conversation.manager import ConversationManager
from app.workflow.loader import WorkflowLoader
from service.models import WorkflowSnapshot


def workflow_snapshot(
    conversation: ConversationManager,
    loader: Optional[WorkflowLoader],
) -> WorkflowSnapshot:
    """
    Plain view of workflow progress. No engine objects cross the wire.

    `total_steps` is read from the same workflow definition the dialogue
    manager steps through -- `len(load_workflow(name)["steps"])`, the
    bound it checks `current_step` against -- so the total shown can
    never disagree with the point at which the workflow completes.

    It is None when there is no workflow, or its definition cannot be
    read. Never a guess.
    """
    step = conversation.current_step
    name = conversation.current_workflow

    total_steps: Optional[int] = None

    if name and loader is not None:
        definition = loader.load_workflow(name)

        if definition is not None:
            total_steps = len(definition["steps"])

    return WorkflowSnapshot(
        name=name,
        state=conversation.workflow_state.value,
        step=step if step and step > 0 else None,
        total_steps=total_steps,
    )
