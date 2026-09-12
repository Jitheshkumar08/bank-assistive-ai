from app.speech.stt import SpeechToText
from app.speech.recorder import AudioRecorder
from app.speech.tts import TextToSpeech
from app.intent.detector import IntentDetector

from app.conversation.manager import ConversationManager
from app.conversation.state import SessionState, WorkflowState
from app.dialogue.manager import DialogueManager
from app.dialogue.term_normalizer import normalize_banking_terms


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


class VoiceAssistantPipeline:

    def __init__(self):

        print("Initializing Smart Banking Assistant...\n")

        self.recorder = AudioRecorder()
        self.stt = SpeechToText()
        self.tts = TextToSpeech()
        self.intent_detector = IntentDetector()

        self.conversation = ConversationManager()
        self.dialogue = DialogueManager()

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
            # Domain terminology normalization
            #
            # Whisper mishears a small, known set of banking
            # terms ("cheque book" -> "Chuck Book"). Only those
            # listed phrases are rewritten; everything else --
            # including Kannada and Hindi -- passes through
            # untouched.
            #
            # The RAW transcript is what gets recorded in the
            # conversation history, so debugging always shows
            # what was actually heard. The normalized form is
            # used only for control detection, understanding,
            # retrieval and intent detection.
            # -----------------------------

            user_input = normalize_banking_terms(raw_input_text)

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

            self.conversation.add_history("Assistant", response)

            print()
            print("🤖 Assistant:")
            print(response)

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

            return self.dialogue.handle_control_command(
                self.conversation,
                control
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

        question_response = self.dialogue.answer_general_question(
            user_input
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
            "| Confidence:", intent_result["confidence"]
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
