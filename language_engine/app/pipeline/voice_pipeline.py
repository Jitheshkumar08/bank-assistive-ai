from app.speech.stt import SpeechToText
from app.speech.recorder import AudioRecorder
from app.speech.tts import TextToSpeech
from app.intent.detector import IntentDetector

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState, WorkflowState
from app.dialogue.localization import ResponseLocalizer
from app.dialogue.manager import DialogueManager, contains_negation
from app.dialogue.text_normalization import normalize_turn


LANGUAGES = {
    "1": ("English", "en"),
    "2": ("Kannada", "kn"),
    "3": ("Hindi", "hi")
}

# Session-exit and workflow-control classification (including
# proper STT punctuation/casing normalization -- e.g. "Exit.")
# lives in ONE place: DialogueManager.detect_control(). There is
# deliberately no separate exit-word set here anymore -- a
# second, weaker matcher living in this file is exactly what let
# real Whisper output like "Exit." slip past the old exit check.

# Workflow states that permit a fresh intent to be detected.
# SUSPENDED is intentionally excluded -- a suspended workflow
# must never be abandoned just because the user spoke again.
NEEDS_NEW_INTENT_STATES = (
    WorkflowState.NONE,
    WorkflowState.COMPLETED,
    WorkflowState.CANCELLED
)


def _accepts_keyword(function, name):
    """Whether `function` takes keyword `name` (or **kwargs)."""
    import inspect

    try:
        parameters = inspect.signature(function).parameters
    except (TypeError, ValueError):
        return False
    return name in parameters or any(
        p.kind is inspect.Parameter.VAR_KEYWORD for p in parameters.values()
    )


class VoiceAssistantPipeline:

    def __init__(self):

        print("Initializing Smart Banking Assistant...\n")

        self.recorder = AudioRecorder()
        self.stt = SpeechToText()
        self.tts = TextToSpeech()
        self.intent_detector = IntentDetector()

        self.conversation = ConversationManager()

        # The dialogue manager is given THE SAME detector, not one
        # of its own (Phase 3.2B-14). It needs to ask one question
        # -- "is this a request for a different banking service
        # than the one in progress?" -- and this engine has exactly
        # one intent classifier. Sharing it also means the model is
        # loaded once.
        self.dialogue = DialogueManager(
            intent_detector=self.intent_detector
        )

        # Renders replies in the session language at the output
        # boundary; see the turn loop for why it lives there.
        self.localizer = ResponseLocalizer()

        print("System Ready ✅")

    # ===========================================================
    # SESSION SETUP
    # ===========================================================

    def select_language(self):

        print("\nSelect language:")
        print("1. English")
        print("2. Kannada")
        print("3. Hindi")

        choice = input("Enter choice: ").strip()

        if choice not in LANGUAGES:
            print("Invalid choice. Defaulting to English.")
            return LANGUAGES["1"]

        return LANGUAGES[choice]

    def select_input_mode(self):

        print("\nChoose input method:")
        print("1. Voice")
        print("2. Type")

        mode = input("Choice: ").strip()

        if mode not in {"1", "2"}:
            print("Invalid choice. Defaulting to Voice.")
            return "1"

        return mode

    # ===========================================================
    # ONE USER TURN OF INPUT (VOICE OR TEXT)
    # ===========================================================

    def listen(self, mode, language_code):

        if mode == "2":
            return input("\nYou: ").strip()

        # -----------------------------
        # Voice input
        # -----------------------------

        try:
            audio_file = self.recorder.record()

            # The recorder returns None when the VAD heard no
            # meaningful speech -- plain silence, or a noise burst
            # too short to be a word. That is a recording-layer
            # outcome only: it is reported as empty input, exactly
            # like an empty transcription, and the loop below
            # simply listens again.
            #
            # Whisper is deliberately not run on silence. Besides
            # being wasted work, it is what makes Whisper invent
            # filler text ("Thank you.") that could then be read
            # as a real banking utterance.

            if audio_file is None:
                return ""

            stt_result = self.stt.transcribe(
                audio_file,
                language=language_code
            )

            text = stt_result["text"].strip()

            print("\n📝 Recognized Text:", text)

            self.recorder.cleanup()

            return text

        except Exception as e:
            print("\n❌ Speech recognition failed:", e)
            return ""

    # ===========================================================
    # SPEAK RESPONSE (VOICE MODE ONLY)
    # ===========================================================

    def _get_localizer(self):
        """The session's response localizer, created on first use.

        Built lazily rather than assumed, because the debugging suites
        construct a pipeline with object.__new__() to avoid loading models,
        and a turn must still render correctly in that harness.
        """

        localizer = getattr(self, "localizer", None)

        if localizer is None:
            language = getattr(self.conversation, "language", None) or "en"
            localizer = ResponseLocalizer(language)
            self.localizer = localizer

        return localizer

    def speak(self, mode, response, language_code):

        if mode != "1":
            return

        try:
            self.tts.speak(response, language_code)

        except Exception as e:
            print("\n❌ TTS failed:", e)

    # ===========================================================
    # RUN — full conversational session through one banking visit
    # ===========================================================

    def run(self):

        language_name, language_code = self.select_language()
        print(f"\nSelected language: {language_name}")

        mode = self.select_input_mode()

        self.conversation.start_conversation()
        self.conversation.language = language_code
        self._get_localizer().set_language(language_code)

        while True:

            # -----------------------------
            # Get User Input (Voice or Text)
            # -----------------------------

            self.conversation.update_session_state(SessionState.LISTENING)

            raw_input_text = self.listen(mode, language_code)

            if not raw_input_text:
                print("🎤 No speech detected. Listening again...")
                self.conversation.update_session_state(SessionState.READY)
                continue

            # -----------------------------
            # Normalisation  (M5: app/dialogue/text_normalization)
            #
            # One call, three representations: the ORIGINAL, the
            # NORMALIZED spelling (NFC, dandas, spacing), and the
            # ROUTING text -- mis-heard banking terms repaired
            # ("Chuck Book" -> "cheque book") and loanwords written
            # in English (ಲೋನ್ / लोन -> loan). Native Kannada and
            # Hindi words are never translated.
            #
            # The ORIGINAL is what gets recorded in the
            # conversation history, so debugging always shows
            # what was actually heard. The routing text is used
            # only for control detection, understanding,
            # retrieval and intent detection.
            # -----------------------------

            user_input = normalize_turn(raw_input_text).routing

            if user_input != raw_input_text:
                print("🔤 Normalized Text:", user_input)

            # -----------------------------
            # Control Command Detection
            # (checked before intent detection -- covers BOTH
            # session exit and workflow control, through one
            # normalized classifier, so neither can ever be
            # shadowed by workflow/intent logic. This is the
            # ONLY place "exit"/"quit"/"goodbye"/etc. are
            # recognized -- it is robust to STT punctuation and
            # casing, e.g. "Exit.", "EXIT!", "Goodbye.")
            #
            # Deterministic and LLM-free, so it stays OUTSIDE the
            # per-turn exception boundary below: the user must be
            # able to leave even while the LLM is failing.
            # -----------------------------

            control = self.dialogue.detect_control(user_input)

            if control == "session_exit":
                self.conversation.update_session_state(SessionState.EXITED)
                print()
                print("👋 Thank you for using Smart Banking Voice Assistant.")
                break

            self.conversation.update_session_state(SessionState.PROCESSING)

            self.conversation.add_history("User", raw_input_text)

            # -----------------------------
            # PER-TURN EXCEPTION BOUNDARY
            #
            # Dialogue understanding, RAG question answering and
            # intent detection all reach the network. A transient
            # failure there must cost the user one turn, not the
            # whole session and not an in-progress workflow.
            #
            # ConversationManager is untouched by a failure here,
            # so workflow_state, current_step and the collected
            # entities all survive, and the next turn resumes
            # exactly where this one left off.
            # -----------------------------

            try:

                response = self._respond(control, user_input)

            except Exception as error:

                print()
                print(
                    f"[TURN] Failed to produce a response "
                    f"({type(error).__name__}): {error}"
                )

                response = (
                    "Sorry, I hit a temporary problem handling "
                    "that. Your request is still saved -- please "
                    "say that again."
                )

            # -----------------------------
            # SELECTED-LANGUAGE RENDERING  (Phase 3.2B-12, K)
            #
            # The engine composes every reply in English. The
            # session language was previously only handed to TTS,
            # so a Kannada session heard English sentences in a
            # Kannada voice.
            #
            # Rendering happens HERE, at the single output
            # boundary, after the reply exists and before it is
            # shown or spoken, so no handler needs to know about
            # languages and the canonical English text is what
            # goes into conversation history (and therefore into
            # the LLM context) unchanged.
            #
            # The localizer also remembers the canonical reply,
            # which is what lets "ಮತ್ತೆ ಹೇಳಿ" replay in Kannada
            # instead of replaying stored English.
            # -----------------------------

            self.conversation.add_history("Assistant", response)

            spoken_response = self._get_localizer().render(response)

            print()
            print("🤖 Assistant:")
            print(spoken_response)

            response = spoken_response

            # -----------------------------
            # Text To Speech
            # -----------------------------

            self.conversation.update_session_state(SessionState.SPEAKING)
            self.speak(mode, response, language_code)
            self.conversation.update_session_state(SessionState.READY)

        return self.conversation.get_context()

    # ===========================================================
    # ONE TURN OF DIALOGUE
    # ===========================================================

    def _respond(self, control, user_input):
        """
        Produces the assistant response for a single user turn.

        Kept separate from run() so the whole turn has exactly one
        exception boundary, and so control handling, knowledge
        routing and workflow dialogue share one path to the
        printing/TTS stage.
        """

        # -----------------------------
        # Workflow Control Command
        # ("cancel", "pause", "stop", "repeat", "next", ...
        # can never be misread as a request for a brand new
        # banking service, regardless of workflow_state)
        # -----------------------------

        if control is not None:

            # The words travel with the classification when the
            # dialogue manager takes them: answering "do you want to
            # cancel?" with "ಬೇಡ" ("no, don't") classifies as cancel,
            # and only the text shows it is a refusal. Same
            # signature-tolerant pattern as the language argument below.
            text_argument = {}
            if _accepts_keyword(self.dialogue.handle_control_command, "user_input"):
                text_argument["user_input"] = user_input

            return self.dialogue.handle_control_command(
                self.conversation,
                control,
                **text_argument
            )

        # -----------------------------
        # Active or suspended workflow
        # -----------------------------

        needs_new_intent = (
            self.conversation.workflow_state in NEEDS_NEW_INTENT_STATES
        )

        if not needs_new_intent:

            return self.dialogue.generate_response(
                self.conversation,
                user_input
            )

        # ---------------------------------------------
        # Knowledge / General Question Routing
        # (checked BEFORE intent detection, so questions
        # like "What all things do you know about
        # banking system?" are never forced into a
        # banking workflow by IntentDetector, which has
        # no confidence threshold)
        # ---------------------------------------------

        # The session language (M7), so a knowledge answer is asked for
        # in it. Passed only to a dialogue manager that accepts it; the
        # conversation itself is still NOT passed here, so the control
        # guard behaves exactly as before.
        language_argument = {}
        if _accepts_keyword(self.dialogue.answer_general_question, "language"):
            language_argument["language"] = getattr(self.conversation, "language", None)

        question_response = self.dialogue.answer_general_question(
            user_input,
            **language_argument
        )

        if question_response is not None:
            return question_response

        # ---------------------------------------------
        # Intent Detection
        # ---------------------------------------------

        intent_result = self.intent_detector.detect_intent(
            user_input
        )

        print()
        print(
            "🧠 Intent:", intent_result["intent"],
            "| Confidence:", intent_result["confidence"],
            "| Category:", intent_result.get("category"),
            "| Margin:", intent_result.get("margin")
        )

        # ---------------------------------------------
        # ABSTENTION GATE  (Phase 3.2B-12)
        #
        # The detector no longer has to answer with a banking
        # label. When the utterance matches a non-banking anchor
        # better than any banking intent -- a knowledge question,
        # an acknowledgement, a control word, or a request the
        # assistant must not serve such as "I want to rob the
        # bank" -- NO workflow starts and conversation state is
        # left exactly as it was.
        #
        # This is the invariant that stops "Thank you." from
        # enrolling a customer in a loan, and it is enforced here
        # rather than inside start_workflow() so the decision is
        # visible at the routing layer.
        # ---------------------------------------------

        if not intent_result.get("is_banking_intent", True):

            # M10: the detector withholds a start it cannot justify (no
            # service named, a question about a service, an operation the
            # assistant does not offer). Before M10 such a sentence was a
            # banking verdict, so a negated one reached the refusal gate
            # below; it still does, and refusals keep their reply. A
            # complaint ("the app is not showing my balance", policy D7)
            # is negated but is not a refusal.
            if (intent_result.get("withheld_start")
                    and intent_result.get("abstain_reason") != "troubleshooting"
                    and contains_negation(user_input)):

                return self.dialogue.handle_refused_request(
                    self.conversation
                )

            return self.dialogue.handle_non_banking_request(
                intent_result.get("category"),
                user_input,
                self.conversation
            )

        # ---------------------------------------------
        # REFUSAL GATE  (M3)
        #
        # A refusal names the service it refuses, so the detector
        # finds a banking intent in "ನನಗೆ ಲೋನ್ ಬೇಡ" (I don't want a
        # loan) as readily as in "ನನಗೆ ಲೋನ್ ಬೇಕು" (I want one). A
        # negated utterance never starts a workflow: it is answered
        # without touching conversation state. Same placement and
        # reasoning as the abstention gate above.
        # ---------------------------------------------

        if contains_negation(user_input):

            return self.dialogue.handle_refused_request(
                self.conversation
            )

        # ---------------------------------------------
        # Workflow activation
        #
        # start_workflow() activates ONLY when the workflow
        # definition actually loaded. When it did not, no
        # conversation state was modified, so the session stays
        # usable and a different service can still be started.
        # ---------------------------------------------

        _started, response = self.dialogue.start_workflow(
            self.conversation,
            intent_result["intent"]
        )

        return response
