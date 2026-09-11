from dotenv import load_dotenv

# Loads language_engine/.env into the process environment before
# anything reads it.
#
# Every Groq client is built downstream of this module and reads
# GROQ_API_KEY inside its own __init__ (not at import time), so
# loading here is early enough for all of them.
#
# load_dotenv() does NOT override variables that are already set,
# so a real shell or CI value still wins over the file. The value
# itself is never read, printed or logged here -- only placed in
# the environment for os.getenv() to find.

load_dotenv(override=True)



from app.pipeline.voice_pipeline import VoiceAssistantPipeline  # noqa: E402


def print_header():
    print("\n" + "=" * 60)
    print("🏦 SMART BANKING VOICE ASSISTANT")
    print("=" * 60)


def main():

    print_header()

    # Construction happens INSIDE the try as well as run().
    # The most likely first-run failures -- GROQ_API_KEY not set,
    # a model that cannot load, no usable audio device -- all
    # occur while VoiceAssistantPipeline is being built, and
    # previously escaped as an uncontrolled traceback because the
    # pipeline was created before the try block began.

    try:
        assistant = VoiceAssistantPipeline()

        context = assistant.run()

        print("\n" + "-" * 60)
        print("📊 SESSION SUMMARY")
        print("-" * 60)

        print(f"🧠 Intent     : {context['intent']}")
        print(f"📍 Step       : {context['step']}")
        print(f"✅ Completed  : {context['completed']}")

    except KeyboardInterrupt:
        print("\n\nSession ended by user.")

    except RuntimeError as error:
        # Configuration errors. These name the missing setting
        # (e.g. GROQ_API_KEY) but never its value.
        print(f"\n❌ Cannot start the assistant: {error}")
        print("   Please check the setup steps before retrying.")

    except Exception as error:
        print(f"\n❌ Error ({type(error).__name__}): {error}")


if __name__ == "__main__":
    main()
