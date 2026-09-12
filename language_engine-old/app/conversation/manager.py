from app.conversation.state import SessionState, WorkflowState


class ConversationManager:
    """
    Central owner of conversation state.

    Two independent state dimensions are tracked:

    - session_state:  what the assistant is doing right now
                       (idle / ready / listening / processing /
                       speaking / exited).

    - workflow_state: what the current banking task is doing
                       (none / active / suspended / completed /
                       cancelled).

    They are kept deliberately separate: suspending, cancelling,
    or completing a workflow must never end the assistant
    session, and the assistant session ending is the only thing
    that can move session_state to EXITED.
    """

    def __init__(self):

        self.session_state = SessionState.IDLE
        self.workflow_state = WorkflowState.NONE

        self.current_intent = None
        self.current_workflow = None
        self.current_step = 0

        self.language = "en"

        self.entities = {}

        self.history = []

        # Bounded recent side-question context (Phase 3.2B-3).
        #
        # AT MOST ONE remembered exchange, held here rather than
        # on DialogueManager because DialogueManager takes
        # `conversation` in every method and is otherwise
        # conversation-agnostic: session state kept on it would be
        # shared by every conversation using that instance. This
        # attribute belongs to THIS session and nothing else can
        # see it.
        #
        # It is deliberately NOT workflow state. No workflow
        # transition reads it, and it can never advance, complete,
        # cancel, suspend or resume anything.
        self.recent_side_question = None


    # =====================================================
    # SESSION STATE
    # =====================================================

    def update_session_state(self, new_state):

        if not isinstance(new_state, SessionState):
            raise ValueError(
                "new_state must be a SessionState."
            )

        self.session_state = new_state


    # =====================================================
    # WORKFLOW STATE
    # =====================================================

    def update_workflow_state(self, new_state):

        if not isinstance(new_state, WorkflowState):
            raise ValueError(
                "new_state must be a WorkflowState."
            )

        self.workflow_state = new_state

        print(
            f"Workflow state changed to: {self.workflow_state.value}"
        )


    # =====================================================
    # START CONVERSATION (new assistant session)
    # =====================================================

    def start_conversation(self):

        self.current_intent = None
        self.current_workflow = None
        self.current_step = 0

        self.entities = {}

        self.history = []

        # A new session starts with no remembered side question.
        self.recent_side_question = None

        self.update_workflow_state(WorkflowState.NONE)
        self.update_session_state(SessionState.READY)

        print("Conversation Started")


    # =====================================================
    # SET INTENT
    # =====================================================

    def set_intent(self, intent):

        self.current_intent = intent

        print(
            f"Intent set to: {intent}"
        )


    # =====================================================
    # LOAD WORKFLOW
    # (starting a workflow always makes it ACTIVE; this is the
    # only place workflow_state moves away from NONE / COMPLETED
    # / CANCELLED into ACTIVE)
    #
    # PRECONDITION: the caller must already have confirmed that a
    # workflow definition for `workflow` exists and parses.
    # DialogueManager.start_workflow() is the single supported
    # entry point and enforces this -- activating a workflow whose
    # definition is missing would leave the conversation ACTIVE
    # with nothing to execute, which the pipeline cannot recover
    # from without an explicit cancel.
    #
    # `workflow` is the canonical workflow identity and is the
    # value WorkflowLoader is later asked to load. It must not be
    # a second, differently-spelled name.
    # =====================================================

    def load_workflow(self, workflow):

        self.current_workflow = workflow
        self.current_step = 1

        self.entities = {}

        # Starting a workflow is a topic change: a side question
        # asked before it must not become the referent for a
        # pronoun asked inside it.
        self.recent_side_question = None

        self.update_workflow_state(WorkflowState.ACTIVE)

        print(
            f"Workflow loaded: {workflow}"
        )


    # =====================================================
    # RELEASE WORKFLOW
    #
    # Clears the workflow slot and returns to NONE without
    # marking anything completed or cancelled. Used when a
    # workflow definition becomes unusable mid-session, so the
    # assistant frees the slot for a fresh intent instead of
    # staying ACTIVE with nothing to execute.
    # =====================================================

    def release_workflow(self):

        self.current_intent = None
        self.current_workflow = None
        self.current_step = 0

        self.entities = {}

        self.recent_side_question = None

        self.update_workflow_state(WorkflowState.NONE)


    # =====================================================
    # WORKFLOW TRANSITIONS
    #
    # These are the only supported ways to move workflow_state
    # once a workflow is loaded. Each is a no-op from a state it
    # doesn't apply to, so callers don't need to guard state
    # themselves.
    # =====================================================

    def suspend_workflow(self):

        if self.workflow_state == WorkflowState.ACTIVE:
            self.update_workflow_state(WorkflowState.SUSPENDED)

    def resume_workflow(self):

        if self.workflow_state == WorkflowState.SUSPENDED:
            self.update_workflow_state(WorkflowState.ACTIVE)

    def cancel_workflow(self):

        if self.workflow_state in (
            WorkflowState.ACTIVE,
            WorkflowState.SUSPENDED
        ):
            self.update_workflow_state(WorkflowState.CANCELLED)

    def complete_workflow(self):

        self.update_workflow_state(WorkflowState.COMPLETED)


    # =====================================================
    # ENTITIES
    #
    # Information the user has provided (amount, account
    # number, name, phone number, ...) is preserved here across
    # turns, including through a pause/suspend/resume cycle.
    # =====================================================

    def add_entities(self, entities):

        if not entities:
            return

        for key, value in entities.items():

            if value is not None:
                self.entities[key] = value


    # =====================================================
    # HISTORY
    # =====================================================

    def add_history(self, speaker, message):

        self.history.append({
            "speaker": speaker,
            "message": message
        })


    # =====================================================
    # RECENT SIDE-QUESTION CONTEXT  (Phase 3.2B-3)
    #
    # One slot, one exchange. Storing a new exchange REPLACES the
    # old one -- there is no list, so nothing can accumulate and
    # no bound has to be enforced.
    #
    # Cleared whenever the topic genuinely changes: a new session
    # (start_conversation), a workflow being loaded (load_workflow)
    # and the workflow slot being released (release_workflow). A
    # spelling question asked during a withdrawal must not still be
    # the referent for "what does this mean?" three requests later.
    #
    # Deliberately NOT cleared by pause, resume, repeat, step
    # references or acknowledgements: those keep the customer on
    # the same task, so the side interaction they just had is still
    # the relevant one.
    # =====================================================

    def remember_side_question(self, recent_side_question):

        self.recent_side_question = recent_side_question

    def clear_side_question_context(self):

        self.recent_side_question = None


    # =====================================================
    # BACKWARD-COMPATIBLE STATUS FLAGS
    #
    # completed/cancelled used to be independent booleans.
    # They are now derived from workflow_state so existing
    # callers reading conversation.completed / .cancelled keep
    # working unchanged. Setting them still works too (routed
    # through the proper transition methods) for any caller
    # that assigns to them directly.
    # =====================================================

    @property
    def completed(self):
        return self.workflow_state == WorkflowState.COMPLETED

    @completed.setter
    def completed(self, value):

        if value:
            self.complete_workflow()

        # Setting False is a no-op: workflow_state resets happen
        # through start_conversation() / load_workflow() /
        # cancel_workflow() instead.

    @property
    def cancelled(self):
        return self.workflow_state == WorkflowState.CANCELLED

    @cancelled.setter
    def cancelled(self, value):

        if value:
            self.cancel_workflow()

        # Setting False is a no-op, for the same reason as above.


    # =====================================================
    # CONTEXT
    # =====================================================

    def get_context(self):

        return {
            "session_state": self.session_state.value,
            "workflow_state": self.workflow_state.value,
            "intent": self.current_intent,
            "workflow": self.current_workflow,
            "step": self.current_step,
            "language": self.language,
            "completed": self.completed,
            "cancelled": self.cancelled,
            "entities": self.entities,
            "history": self.history
        }
