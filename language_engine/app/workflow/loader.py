import json
from pathlib import Path


class WorkflowLoader:
    """
    Loads banking workflows from JSON files.

    This class is the ONE place that turns a workflow identity
    (e.g. "withdraw money") into a workflow definition on disk.
    It never raises for a missing or malformed definition -- it
    reports failure by returning None, so callers can decide
    safely instead of crashing the session.
    """

    def __init__(self):
        self.workflow_folder = Path(__file__).parent / "workflows"

    # =====================================================
    # NAME -> FILE RESOLUTION
    # =====================================================

    def resolve_filename(self, workflow_name):
        """
        Normalizes a workflow identity into its JSON filename.

            "withdraw money"  -> "withdraw.json"
            "apply for loan"  -> "apply_for_loan.json"

        " money" is stripped only as a trailing suffix, never
        from the middle of a name, so a future workflow such as
        "send money abroad" cannot silently resolve to the wrong
        file.
        """

        if not workflow_name:
            return None

        name = workflow_name.strip().lower()
        name = name.removesuffix(" money")
        name = name.strip().replace(" ", "_")

        if not name:
            return None

        return f"{name}.json"

    def workflow_path(self, workflow_name):

        filename = self.resolve_filename(workflow_name)

        if filename is None:
            return None

        return self.workflow_folder / filename

    # =====================================================
    # EXPLICIT EXISTENCE CHECK
    #
    # Callers use this (or a None result from load_workflow)
    # BEFORE activating a workflow, so a missing definition can
    # never move the conversation into ACTIVE.
    # =====================================================

    def has_workflow(self, workflow_name):

        path = self.workflow_path(workflow_name)

        return path is not None and path.exists()

    # =====================================================
    # LOAD
    # =====================================================

    def load_workflow(self, workflow_name):
        """
        Returns the workflow definition dict, or None when the
        workflow does not exist, cannot be read, or does not
        contain a usable "steps" list.
        """

        path = self.workflow_path(workflow_name)

        if path is None or not path.exists():
            print(f"Workflow not found: {workflow_name}")
            return None

        try:

            with open(path, "r", encoding="utf-8") as file:
                workflow = json.load(file)

        except (json.JSONDecodeError, OSError) as error:

            print(
                f"Workflow could not be loaded "
                f"({path.name}): {error}"
            )

            return None

        steps = (
            workflow.get("steps")
            if isinstance(workflow, dict)
            else None
        )

        if not steps or not isinstance(steps, list):

            print(f"Workflow has no usable steps: {path.name}")

            return None

        return workflow
