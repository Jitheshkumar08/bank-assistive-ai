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

    def __init__(self, folder=None):
        # `folder` (domain integration): another domain's own workflow
        # directory. None = the original Banking workflows, as before.
        self.workflow_folder = Path(folder) if folder is not None else Path(__file__).parent / "workflows"

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
    # ENUMERATION AND SPOKEN-NAME RESOLUTION
    #
    # Added for cross-workflow step references ("tell me step 4
    # of the deposit process"). Both methods are READ-ONLY and
    # purely additive -- nothing above them changed.
    #
    # This is the ONE place that knows which workflows exist and
    # what they are called, so no caller ever has to hardcode
    # "deposit" / "withdraw" / "loan". Adding a JSON file to the
    # workflows folder is enough to make it referenceable.
    # =====================================================

    # Words that carry no identifying information when matching a
    # spoken workflow name. "money" is here on purpose: it is
    # shared by "deposit money" and "withdraw money", so matching
    # on it could only ever be ambiguous.
    MATCH_STOPWORDS = frozenset({
        "money", "the", "a", "an", "of", "for", "my", "to",
        "process", "processes", "procedure", "procedures",
        "workflow", "workflows", "request", "form", "step",
        "steps", "please",
    })

    # A spoken token matches a workflow token when one is a
    # prefix of the other and the overlap is at least this long.
    # It is what lets "withdrawal" match "withdraw money" without
    # a stemmer. Kept at 4 so short words must match exactly.
    MIN_PREFIX_MATCH = 4

    def available_workflows(self):
        """
        Canonical names of every workflow definition on disk, in
        a stable order.

        The name comes from each file's own "workflow" field, so
        the JSON stays the single source of truth. A file whose
        field is missing or unreadable falls back to its filename
        ("apply_for_loan.json" -> "apply for loan"), so a
        malformed definition can never make this raise.
        """

        names = []

        if not self.workflow_folder.exists():
            return names

        for path in sorted(self.workflow_folder.glob("*.json")):

            name = None

            try:

                with open(path, "r", encoding="utf-8") as file:
                    definition = json.load(file)

                if isinstance(definition, dict):

                    declared = definition.get("workflow")

                    if isinstance(declared, str) and declared.strip():
                        name = declared.strip()

            except (json.JSONDecodeError, OSError):

                name = None

            if name is None:
                name = path.stem.replace("_", " ")

            if name not in names:
                names.append(name)

        return names

    @staticmethod
    def _match_tokens(text):
        """Identifying lowercase tokens of a workflow name."""

        return [
            token
            for token in str(text).lower().replace("_", " ").split()
            if token and token not in WorkflowLoader.MATCH_STOPWORDS
        ]

    @classmethod
    def _tokens_match(cls, spoken_token, workflow_token):

        if spoken_token == workflow_token:
            return True

        shorter, longer = sorted(
            (spoken_token, workflow_token),
            key=len
        )

        if len(shorter) < cls.MIN_PREFIX_MATCH:
            return False

        return longer.startswith(shorter)

    def resolve_workflow_name(self, spoken_name):
        """
        Resolves a workflow name as the customer said it into the
        canonical name of a definition that actually exists.

            "deposit"             -> "deposit money"
            "the deposit process" -> "deposit money"
            "withdrawal"          -> "withdraw money"
            "loan application"    -> "apply for loan"

        Returns None when nothing matches, when the definition
        does not exist, or when the phrase is AMBIGUOUS (matches
        more than one workflow). Ambiguity resolves to None on
        purpose: reading out the wrong workflow's banking steps is
        worse than admitting the name was unclear.
        """

        if not spoken_name or not str(spoken_name).strip():
            return None

        spoken_tokens = self._match_tokens(spoken_name)

        if not spoken_tokens:
            return None

        candidates = self.available_workflows()

        # An exact name is authoritative and skips token matching.
        normalized = " ".join(str(spoken_name).lower().split())

        for candidate in candidates:

            if candidate.lower() == normalized:
                return candidate

        matches = []

        for candidate in candidates:

            candidate_tokens = self._match_tokens(candidate)

            if any(
                self._tokens_match(spoken, existing)
                for spoken in spoken_tokens
                for existing in candidate_tokens
            ):
                matches.append(candidate)

        if len(matches) != 1:
            return None

        return matches[0] if self.has_workflow(matches[0]) else None

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
