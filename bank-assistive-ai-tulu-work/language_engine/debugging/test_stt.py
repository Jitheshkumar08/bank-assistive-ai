from app.speech.stt import SpeechToText
from app.speech.recorder import AudioRecorder


# Initialize modules
stt = SpeechToText()
recorder = AudioRecorder()


# =====================================================
# SELECT LANGUAGE
# =====================================================

print("\nSelect language:")
print("1. English")
print("2. Kannada")
print("3. Hindi")

choice = input("Enter choice: ").strip()


LANGUAGE_MAP = {
    "1": ("English", "en"),
    "2": ("Kannada", "kn"),
    "3": ("Hindi", "hi")
}


if choice not in LANGUAGE_MAP:

    print("Invalid choice.")
    exit()


language_name, language_code = LANGUAGE_MAP[choice]

print(f"\nSelected language: {language_name}")


# =====================================================
# RECORD
# =====================================================

audio_file = recorder.record()


# =====================================================
# SPEECH → TEXT
# =====================================================

result = stt.transcribe(
    audio_file,
    language=language_code
)


# =====================================================
# OUTPUT
# =====================================================

print("\n============================")
print("Detected Language:", result["language"])
print("Text:", result["text"])
print("============================")