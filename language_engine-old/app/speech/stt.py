import whisper


class SpeechToText:

    def __init__(self):
        print("Loading Whisper model...")

        self.model = whisper.load_model("small")

        print("Whisper loaded ✅")

    def transcribe(self, audio_path, language="en"):

        result = self.model.transcribe(
            audio_path,
            language=language,
            fp16=False
        )

        return {
            "text": result["text"].strip(),
            "language": language
        }