from app.workflow.loader import WorkflowLoader
from app.dialogue.llm.dialogue_understanding import DialogueUnderstanding
from app.conversation.state import WorkflowState


# =========================================================
# TIER-1 DETERMINISTIC CONTROL COMMANDS (SESSION EXIT +
# WORKFLOW CONTROL)
#
# These are short, near-exact control phrases that are handled
# WITHOUT calling the LLM and WITHOUT ever reaching intent
# detection. Session-exit and workflow-control phrases are
# classified together, through ONE normalization path, so the
# two checks can never drift apart again -- that drift (a
# separate, weaker exit-word check living in the pipeline) is
# exactly what let real Whisper output like "Exit." (with a
# trailing period) slip past the old exit check and reach
# IntentDetector.
#
# Only short utterances are matched here. Anything longer or
# more specific (e.g. "repeat step 3", "cancel my loan
# application") intentionally falls through to the existing LLM
# understanding path, unchanged, so richer natural-language
# handling keeps working exactly as before.
#
# NOTE: these phrases are English-only. Kannada/Hindi control
# phrasing is not matched here and falls through to the LLM
# path, same as today -- this is a known limitation, not a
# regression.
# =========================================================

# Phrases that unambiguously mean "end the assistant session".
# Deliberately narrow and exact-match only -- "don't exit" or
# "I don't want to exit" must NOT match this.
SESSION_EXIT_PHRASES = {
    "exit", "quit", "goodbye", "bye",
    "end session", "close assistant", "exit assistant"
}

WORKFLOW_CONTROL_PHRASES = {
    "pause": {
        "pause", "hold on", "hold up", "wait",
        "hang on", "give me a moment", "give me a minute"
    },
    "resume": {
        "resume", "continue", "carry on",
        "let's continue", "lets continue"
    },
    "cancel": {
        "cancel", "stop", "never mind", "nevermind", "forget it"
    },
    "repeat": {
        "repeat", "again", "say that again",
        "come again", "pardon", "say again"
    },
    "next": {
        "next", "what next", "what's next", "whats next"
    },
}

# Control phrases are at most this many words -- anything longer
# is left to the LLM rather than risk swallowing richer phrasing.
MAX_CONTROL_PHRASE_WORDS = 4


def normalize_command_text(text):
    """
    Normalizes raw STT/typed text for exact-phrase control
    matching: lowercases, trims whitespace, and strips the
    trailing sentence punctuation Whisper commonly adds
    ("Exit." / "EXIT!" / "exit..." -> "exit"). This is the
    single normalization path used by BOTH session-exit and
    workflow-control classification below.
    """

    if not text:
        return ""

    normalized = text.strip().lower()
    normalized = normalized.rstrip(" .!?,;:")

    return normalized


def classify_command(text):
    """
    Deterministically classifies a short user utterance as
    either a session-exit command, a workflow-control command,
    or neither.

    Returns one of:
        "session_exit", "pause", "resume", "cancel", "repeat",
        "next", or None (caller should proceed with normal
        knowledge routing / intent detection / dialogue
        understanding).

    Matching is exact-phrase against a normalized utterance,
    never substring matching -- so "don't exit" or "cancel my
    appointment tomorrow" are never misclassified.
    """

    normalized = normalize_command_text(text)

    if not normalized:
        return None

    if normalized in SESSION_EXIT_PHRASES:
        return "session_exit"

    if len(normalized.split()) > MAX_CONTROL_PHRASE_WORDS:
        return None

    for action, phrases in WORKFLOW_CONTROL_PHRASES.items():

        if normalized in phrases:
            return action

    return None


# =========================================================
# KNOWLEDGE / GENERAL QUESTION PRE-FILTER
#
# Cheap, English-focused heuristic used ONLY to decide whether
# it's worth asking the LLM to classify an utterance as a
# general question BEFORE committing to intent detection. This
# is a pre-filter, not the actual decision -- the LLM's own
# `type` classification (see DialogueManager.
# answer_general_question) makes the real call.
#
# Deliberately conservative: an utterance that doesn't look
# like a question here is sent straight to intent detection,
# exactly as before Phase 2's corrective patch. This means it
# can NEVER cause a genuine banking request (English, Kannada,
# or Hindi) to be misrouted away from intent detection -- it
# can only add a new path for utterances that already look like
# questions, which is exactly the reported bug.
# =========================================================

QUESTION_LEAD_WORDS = {
    "what", "why", "how", "who", "when", "where", "which",
    "is", "are", "was", "were", "can", "could", "would",
    "should", "do", "does", "did", "will", "explain", "tell",
    "define",
}


def looks_like_a_question(text):

    if not text:
        return False

    normalized = text.strip().lower()

    if normalized.endswith("?"):
        return True

    first_word = normalized.split(" ", 1)[0].strip(" .,!?")

    return first_word in QUESTION_LEAD_WORDS


class DialogueManager:

    def __init__(self):
        self.workflow_loader = WorkflowLoader()
        self.dialogue_understanding = DialogueUnderstanding()

        print("Dialogue Manager Ready ✅")

    # =====================================================
    # TIER-1 CONTROL COMMAND DETECTION
    # (called by the pipeline BEFORE intent detection)
    #
    # Returns "session_exit", a workflow-control action name,
    # or None.
    # =====================================================

    def detect_control(self, user_input):

        return classify_command(user_input)

    # =====================================================
    # TIER-1 CONTROL COMMAND HANDLING
    # =====================================================

    def handle_control_command(self, conversation, command):

        has_workflow = (
            conversation.current_intent is not None
            and conversation.workflow_state in (
                WorkflowState.ACTIVE,
                WorkflowState.SUSPENDED
            )
        )

        if not has_workflow:
            return self._handle_control_without_workflow(command)

        workflow_state = conversation.workflow_state

        current_instruction = self._resolve_current_instruction(
            conversation
        )

        # ---------------------------------------------
        # PAUSE
        # ---------------------------------------------

        if command == "pause":

            conversation.suspend_workflow()

            return (
                "Okay, I've paused this request. "
                "Let me know when you're ready to continue."
            )

        # ---------------------------------------------
        # RESUME / CONTINUE
        # ---------------------------------------------

        if command == "resume":

            was_suspended = (
                workflow_state == WorkflowState.SUSPENDED
            )

            conversation.resume_workflow()

            if current_instruction is None:
                return "Let's continue."

            if was_suspended:
                return f"Continuing. {current_instruction}"

            return current_instruction

        # ---------------------------------------------
        # CANCEL
        # ---------------------------------------------

        if command == "cancel":

            conversation.cancel_workflow()

            return (
                "Okay, I've cancelled that request. "
                "Let me know if you'd like help with "
                "something else."
            )

        # ---------------------------------------------
        # REPEAT
        # (never resumes a suspended workflow by itself --
        # it only recalls the instruction)
        # ---------------------------------------------

        if command == "repeat":

            if current_instruction is None:
                return "There's nothing to repeat right now."

            return current_instruction

        # ---------------------------------------------
        # NEXT
        # (restates the current instruction, never skips
        # ahead; while suspended, this implicitly resumes
        # since the user is asking what to do)
        # ---------------------------------------------

        if command == "next":

            if current_instruction is None:
                return "There's nothing active right now."

            if workflow_state == WorkflowState.SUSPENDED:
                conversation.resume_workflow()
                return f"Continuing. {current_instruction}"

            return current_instruction

        return "Okay."

    def _handle_control_without_workflow(self, command):

        if command == "cancel":
            return "There's nothing active to cancel right now."

        if command == "pause":
            return "There's nothing active to pause right now."

        if command == "repeat":
            return "There's nothing to repeat right now."

        # "resume" or "next" with no workflow loaded
        return (
            "There's no active request right now. "
            "What banking service would you like help with?"
        )

    def _resolve_current_instruction(self, conversation):

        workflow = self.workflow_loader.load_workflow(
            conversation.current_workflow
        )

        if workflow is None:
            return None

        steps = workflow["steps"]

        if 1 <= conversation.current_step <= len(steps):
            return steps[conversation.current_step - 1]["instruction"]

        return None

    # =====================================================
    # WORKFLOW ACTIVATION
    #
    # The single entry point for starting a banking workflow.
    # A workflow becomes ACTIVE only after its definition has
    # actually been loaded, so a detected intent with no JSON
    # definition (e.g. "check account balance", "open new
    # account") can never move the conversation into ACTIVE and
    # wedge the session.
    # =====================================================

    def start_workflow(self, conversation, intent):
        """
        Attempts to activate the workflow for `intent`.

        Returns (started, response).

        On failure NO conversation state is modified at all: an
        existing valid workflow is preserved untouched, and a
        conversation with no workflow stays in its current
        resting state, so the user can keep asking questions and
        can still start a different, valid service afterwards.
        """

        workflow = self.workflow_loader.load_workflow(intent)

        if workflow is None:

            return False, (
                "I understood your request, but I don't have a "
                "guided procedure for that service yet. You can "
                "still ask me questions about it, or tell me "
                "another banking service you'd like help with."
            )

        conversation.set_intent(intent)
        conversation.load_workflow(intent)

        return True, workflow["steps"][0]["instruction"]

    # =====================================================
    # MAIN DIALOGUE RESPONSE (LLM-assisted path)
    # =====================================================

    def generate_response(self, conversation, user_input=None):

        # =================================================
        # 1. CHECK WHETHER THERE IS AN ACTIVE WORKFLOW
        # =================================================

        if conversation.current_workflow is None:

            if user_input:

                response = self.answer_general_question(user_input)

                if response is not None:
                    return response

            return (
                "What banking service would you like help with?"
            )

        workflow = self.workflow_loader.load_workflow(
            conversation.current_workflow
        )

        if workflow is None:

            # Defensive only. start_workflow() refuses to activate
            # a workflow whose definition is missing, so reaching
            # here means the definition disappeared mid-session.
            # Release the workflow slot rather than leaving the
            # conversation ACTIVE with nothing to execute, which
            # would wedge the session permanently.

            conversation.release_workflow()

            return (
                "Sorry, I can no longer access the steps for that "
                "request. Let me know which banking service you'd "
                "like help with."
            )

        steps = workflow["steps"]

        # =================================================
        # 2. WORKFLOW COMPLETED OR CANCELLED
        #
        # Resting states. The assistant session stays fully
        # alive; side questions are still answered; nothing
        # here can advance or reactivate the workflow --
        # starting something new requires a fresh intent,
        # detected by the pipeline before this method is
        # ever called with a resting workflow_state.
        # =================================================

        if conversation.workflow_state in (
            WorkflowState.COMPLETED,
            WorkflowState.CANCELLED
        ):

            status_message = (
                "Your request is already completed."
                if conversation.workflow_state == WorkflowState.COMPLETED
                else "That request was cancelled."
            )

            if not user_input:
                return (
                    f"{status_message} "
                    "Would you like help with anything else?"
                )

            understanding = self.dialogue_understanding.understand(
                user_text=user_input,
                current_workflow=conversation.current_intent,
                current_step=conversation.current_step,
                current_instruction=""
            )

            print("AI Understanding:", understanding)

            message_type = understanding.get("type", "unknown")

            if message_type in {"help", "question"}:

                return self.dialogue_understanding.answer_question(
                    question=user_input,
                    workflow_context=(
                        status_message
                        + " Workflow: "
                        + conversation.current_intent
                    ),
                    current_instruction=""
                )

            return (
                f"{status_message} "
                "Would you like help with anything else?"
            )

        # =================================================
        # 3. START WORKFLOW
        # =================================================

        if conversation.current_step == 0:

            conversation.current_step = 1

            return steps[0]["instruction"]

        # =================================================
        # 4. GET CURRENT INSTRUCTION
        # =================================================

        current_step = conversation.current_step

        if current_step > len(steps):

            conversation.complete_workflow()

            return "Workflow Completed."

        current_instruction = steps[
            current_step - 1
        ]["instruction"]

        # =================================================
        # 5. NO USER INPUT
        #
        # This covers the user silently performing the task
        # (e.g. filling in a form). workflow_state and
        # current_step are NOT touched here, regardless of
        # whether the workflow is ACTIVE or SUSPENDED.
        # =================================================

        if not user_input:

            return current_instruction

        # =================================================
        # 6. UNDERSTAND USER MESSAGE
        # =================================================

        understanding = self.dialogue_understanding.understand(
            user_text=user_input,
            current_workflow=conversation.current_intent,
            current_step=current_step,
            current_instruction=current_instruction
        )

        print(
            "AI Understanding:",
            understanding
        )

        message_type = understanding.get(
            "type",
            "unknown"
        )

        action = understanding.get(
            "action",
            "none"
        )

        entities = understanding.get(
            "entities",
            {}
        )

        # =================================================
        # 7. CANCEL
        # =================================================

        if action == "cancel":

            conversation.cancel_workflow()

            return (
                "Okay, I've cancelled that request. "
                "Let me know if you'd like help with "
                "something else."
            )

        # =================================================
        # 8. REPEAT
        # (does not resume a suspended workflow by itself)
        # =================================================

        # A turn can be classified as repeat AND as a question
        # ("can you repeat what you said about the loan rate?").
        # Asking about information outranks re-stating the current
        # workflow instruction, so those fall through to the
        # help/question branch below. A plain "repeat" -- which the
        # pipeline's deterministic control path already handles
        # before the LLM is ever consulted -- still repeats.

        if (
            action == "repeat"
            and message_type not in {"help", "question"}
        ):

            step_number = entities.get("step_number")

            # ---------------------------------------------
            # Specific step requested
            # ---------------------------------------------

            if step_number is not None:

                if 1 <= step_number <= len(steps):

                    return steps[
                        step_number - 1
                    ]["instruction"]

                return (
                    "That step is not available "
                    "in the current workflow."
                )

            # ---------------------------------------------
            # No specific step -> repeat current step
            # ---------------------------------------------

            return current_instruction

        # =================================================
        # 9. ACKNOWLEDGEMENT
        # (does not resume a suspended workflow by itself)
        # =================================================

        if message_type == "acknowledgement":

            return (
                f"Okay. {current_instruction} "
                "Let me know when you have completed it."
            )

        # =================================================
        # 10. GENERAL BANKING QUESTION / HELP
        #
        # IMPORTANT:
        #
        # Questions must be handled BEFORE next_step, and must
        # never advance or resume the workflow -- ACTIVE stays
        # ACTIVE, SUSPENDED stays SUSPENDED, current_step is
        # untouched either way.
        #
        # =================================================

        if message_type in {
            "help",
            "question"
        }:

            return self.handle_question(
                conversation,
                workflow,
                current_instruction,
                user_input,
                entities
            )

        # =================================================
        # 11. NEXT STEP REQUEST
        #
        # Restates the current instruction without advancing.
        # If the workflow is SUSPENDED, the user asking what to
        # do next is treated as an implicit resume.
        # =================================================

        if action == "next_step":

            if conversation.workflow_state == WorkflowState.SUSPENDED:

                conversation.resume_workflow()

                return f"Continuing. {current_instruction}"

            return current_instruction

        # =================================================
        # 12. COMPLETE CURRENT STEP
        #
        # If the workflow is SUSPENDED, completing a step is a
        # clear engagement signal -- implicitly resume first.
        #
        # A "complete" turn (e.g. "I entered 2000.") can carry
        # an extracted entity even though it isn't classified as
        # message_type == "information" -- persist it here too,
        # not just in the information branch below, so amounts
        # etc. given alongside a completion are never dropped.
        # =================================================

        if action == "complete":

            if conversation.workflow_state == WorkflowState.SUSPENDED:
                conversation.resume_workflow()

            conversation.add_entities(entities)

            conversation.current_step += 1

            # ---------------------------------------------
            # Workflow finished
            # ---------------------------------------------

            if conversation.current_step > len(steps):

                conversation.complete_workflow()

                return "Workflow Completed."

            # ---------------------------------------------
            # Return next instruction
            # ---------------------------------------------

            return steps[
                conversation.current_step - 1
            ]["instruction"]

        # =================================================
        # 13. INFORMATION PROVIDED BY USER
        #
        # Providing requested information is also an
        # engagement signal -- implicitly resume if suspended.
        # =================================================

        if (
            message_type == "information"
            or action == "provide_information"
        ):

            if conversation.workflow_state == WorkflowState.SUSPENDED:
                conversation.resume_workflow()

            return self.handle_information(
                conversation,
                current_instruction,
                entities
            )

        # =================================================
        # 14. UNCERTAIN / UNKNOWN
        # (workflow_state, ACTIVE or SUSPENDED, is left as-is)
        # =================================================

        if message_type in {
            "uncertain",
            "unknown"
        }:

            return (
                f"Okay. {current_instruction} "
                "Take your time and let me know "
                "when you are ready."
            )

        # =================================================
        # 15. DEFAULT
        # =================================================

        return current_instruction

    # =====================================================
    # GENERAL QUESTION / HELP HANDLER
    # =====================================================

    def handle_question(
        self,
        conversation,
        workflow,
        current_instruction,
        user_input,
        entities
    ):

        """
        Handles general banking questions and help requests.

        Questions do NOT modify the workflow state.

        The question is passed to the knowledge retrieval
        system through DialogueUnderstanding.answer_question().
        """

        workflow_context = self.build_workflow_context(
            workflow
        )

        response = self.dialogue_understanding.answer_question(
            question=user_input,
            workflow_context=workflow_context,
            current_instruction=current_instruction
        )

        return response

    # =====================================================
    # KNOWLEDGE / GENERAL QUESTION ROUTING
    # (called by the pipeline BEFORE intent detection, and by
    # generate_response() as a defensive fallback when no
    # intent is set at all)
    # =====================================================

    def answer_general_question(self, user_input):

        """
        Determines whether `user_input` is a general or banking
        knowledge question -- rather than a request to start a
        specific banking workflow -- and if so, answers it using
        the existing RAG + LLM question-answering path.

        Returns the answer string if this was a question, or
        None if the caller should proceed with normal intent
        detection.

        This is NOT a confidence-score decision. A cheap
        English-focused heuristic (looks_like_a_question) first
        decides whether it's even worth asking the LLM; if it
        is, the LLM's own `type` classification (question/help
        vs. workflow_action/information/...) makes the real
        call. Declarative statements -- in any language,
        including Kannada/Hindi banking requests -- never reach
        this classification at all, so this can never reject a
        legitimate banking request the way a numeric confidence
        threshold on IntentDetector would.
        """

        if not looks_like_a_question(user_input):
            return None

        understanding = self.dialogue_understanding.understand(
            user_text=user_input,
            current_workflow=None,
            current_step=None,
            current_instruction=""
        )

        print("AI Understanding (pre-intent):", understanding)

        message_type = understanding.get("type", "unknown")

        if message_type not in {"help", "question"}:
            return None

        return self.dialogue_understanding.answer_question(
            question=user_input,
            workflow_context=(
                "No banking workflow is currently active. "
                "Answer general banking questions helpfully."
            ),
            current_instruction=""
        )

    # =====================================================
    # INFORMATION HANDLER
    # =====================================================

    def handle_information(
        self,
        conversation,
        current_instruction,
        entities
    ):

        """
        Handles information explicitly provided by the user.

        Information does not automatically advance the
        workflow unless the LLM explicitly determines that
        the current step has been completed. Extracted
        entities are persisted on the conversation so they
        survive a pause/resume cycle.
        """

        if entities:

            useful_entities = {
                key: value
                for key, value in entities.items()
                if value is not None
            }

            if useful_entities:

                conversation.add_entities(useful_entities)

                print(
                    "Information received:",
                    useful_entities
                )

        return (
            "I've noted that. "
            + current_instruction
        )

    # =====================================================
    # BUILD WORKFLOW CONTEXT
    # =====================================================

    def build_workflow_context(
        self,
        workflow
    ):

        """
        Converts the active workflow into context that can
        be supplied to the banking question-answering LLM.
        """

        context = []

        for index, step in enumerate(
            workflow["steps"],
            start=1
        ):

            context.append(
                f"Step {index}: "
                f"{step['instruction']}"
            )

        return "\n".join(context)
