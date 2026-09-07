import sounddevice as sd
from scipy.io.wavfile import write
import os
import time


class AudioRecorder:

    def __init__(self, duration=6, fs=16000):
        self.duration = duration
        self.fs = fs
        self.filename = "temp_recording.wav"

    def record(self):

        print("\n🎤 Get ready...")
        time.sleep(0.5)

        print("🎤 Recording... Speak now")

        audio = sd.rec(
            int(self.duration * self.fs),
            samplerate=self.fs,
            channels=1,
            dtype="float32"
        )

        sd.wait()

        write(
            self.filename,
            self.fs,
            audio
        )

        print("Recording complete ✅")

        return self.filename

    def cleanup(self):

        if os.path.exists(self.filename):

            try:
                os.remove(self.filename)

            except PermissionError:
                pass