from app.speech.stt import SpeechToText
from app.speech.recorder import AudioRecorder
from app.intent.detector import IntentDetector
from app.conversation.manager import ConversationManager
from app.dialogue.manager import DialogueManager
from app.speech.tts import TextToSpeech


# =====================================================
# INITIALIZE MODULES
# =====================================================

stt = SpeechToText()
tts = TextToSpeech()
recorder = AudioRecorder()
intent_detector = IntentDetector()
conversation = ConversationManager()
dialogue = DialogueManager()


# =====================================================
# LANGUAGE SELECTION
# =====================================================

print("\n==============================")
print(" Select Speech Language")
print("==============================")
print("1. English")
print("2. Kannada")
print("3. Hindi")

choice = input("\nEnter choice: ").strip()


LANGUAGE_MAP = {
    "1": ("English", "en"),
    "2": ("Kannada", "kn"),
    "3": ("Hindi", "hi")
}


if choice not in LANGUAGE_MAP:

    print("Invalid language choice.")
    exit()


language_name, language_code = LANGUAGE_MAP[choice]

print(f"\nSelected language: {language_name}")


# =====================================================
# INTENT -> WORKFLOW MAPPING
#
# Removed. This local map was a second workflow identity that
# disagreed with WorkflowLoader ("loan" resolved to a
# non-existent loan.json, "account_opening" likewise) and was
# silently discarded because loading actually used the intent.
# DialogueManager.start_workflow() is now the single entry
# point and owns both existence checking and activation.
# =====================================================

# =====================================================
# INPUT MODE SELECTION
# =====================================================

print("\n==============================")
print("Choose input method:")
print("1. Voice")
print("2. Type")
print("==============================")

mode = input("Choice: ").strip()

if mode not in {"1", "2"}:

    print("Invalid choice.")
    exit()


# =====================================================
# START CONVERSATION
# =====================================================

conversation.start_conversation()


# =====================================================
# MAIN CONVERSATION LOOP
# =====================================================

while True:

    # =================================================
    # GET USER INPUT
    # =================================================

    if mode == "1":

        # ---------------------------------------------
        # VOICE MODE
        # ---------------------------------------------

        try:

            audio_file = recorder.record()

            result = stt.transcribe(
                audio_file,
                language=language_code
            )

            user_input = result["text"].strip()

            print(
                f"\nDetected Language: "
                f"{result['language']}"
            )

            print(
                f"Recognized Speech: "
                f"{user_input}"
            )

            # Remove temporary recording
            recorder.cleanup()

        except Exception as e:

            print(
                "\nSpeech recognition failed:"
            )

            print(e)

            continue

    else:

        # ---------------------------------------------
        # TEXT MODE
        # ---------------------------------------------

        user_input = input(
            "\nYou: "
        ).strip()


    # =================================================
    # EMPTY INPUT
    # =================================================

    if not user_input:
        print("🎤 No speech detected. Listening again...")
        continue


    # =================================================
    # EXIT THROUGH VOICE OR TEXT
    # =================================================

    if user_input.lower() in {
        "exit",
        "quit",
        "stop",
        "goodbye"
    }:

        print("\nExiting assistant...")

        break


    # =================================================
    # CHECK WHETHER NEW INTENT IS REQUIRED
    # =================================================

    workflow_completed = getattr(
        conversation,
        "completed",
        False
    )


    if (
        conversation.current_intent is None
        or workflow_completed
    ):

        # ---------------------------------------------
        # Detect intent
        # ---------------------------------------------

        intent_result = (
            intent_detector.detect_intent(
                user_input
            )
        )

        intent = intent_result["intent"]

        print(
            f"Detected Intent: {intent}"
        )


        # ---------------------------------------------
        # Start workflow
        #
        # start_workflow() activates the conversation only when
        # the workflow definition actually loaded. When it did
        # not, no conversation state is modified, so this loop
        # cannot be wedged by a missing definition either.
        # ---------------------------------------------

        _started, response = dialogue.start_workflow(
            conversation,
            intent
        )


    # =================================================
    # ACTIVE WORKFLOW
    # =================================================

    else:

        response = (
            dialogue.generate_response(
                conversation,
                user_input
            )
        )


    # =================================================
    # ASSISTANT OUTPUT
    # =================================================

    print("\n🤖 Assistant:")
    print(response)


    # =================================================
    # TEXT TO SPEECH
    # =================================================

    if mode == "1":

        try:

            tts.speak(
                response,
                language_code
            )

        except Exception as e:

            print(
                "\nTTS failed:"
            )

            print(e)