from app.speech.tts import TextToSpeech


tts = TextToSpeech()

print("\n==============================")
print("Testing English TTS")
print("==============================")

tts.speak(
    "Please take a withdrawal slip.",
    "en"
)

input("\nPress Enter for Kannada...")


print("\n==============================")
print("Testing Kannada TTS")
print("==============================")

tts.speak(
    "ದಯವಿಟ್ಟು ಹಿಂಪಡೆಯುವ ಸ್ಲಿಪ್ ತೆಗೆದುಕೊಳ್ಳಿ.",
    "kn"
)

input("\nPress Enter for Hindi...")


print("\n==============================")
print("Testing Hindi TTS")
print("==============================")

tts.speak(
    "कृपया निकासी पर्ची लें।",
    "hi"
)

input("\nPress Enter to finish...")