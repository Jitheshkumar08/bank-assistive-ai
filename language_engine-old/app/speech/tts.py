import asyncio
import os
import re
import uuid
import edge_tts
import pygame
import time


# =========================================================
# MARKDOWN -> SPEECH SANITIZATION
#
# The LLM may legitimately return Markdown, and the printed
# response keeps it. Edge TTS, however, vocalizes formatting
# characters -- "*take*" is sent as ['*', 'take', '*'], so the
# customer hears punctuation artifacts mid-sentence.
#
# The text handed to TTS is therefore stripped of Markdown
# syntax while wording, numbers, currency symbols and ordinary
# punctuation are left untouched. This is done in the
# application, not by forbidding Markdown in the prompt.
# =========================================================

_CODE_FENCE = re.compile(r"```[^\n]*\n?")
_INLINE_CODE = re.compile(r"`+([^`]*)`+")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_HORIZONTAL_RULE = re.compile(
    r"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$",
    re.MULTILINE
)
_HEADING = re.compile(r"^[ \t]*#{1,6}[ \t]*", re.MULTILINE)
_BLOCKQUOTE = re.compile(r"^[ \t]*>[ \t]?", re.MULTILINE)
_BULLET = re.compile(r"^[ \t]*[-*+][ \t]+", re.MULTILINE)
_EMPHASIS_STAR = re.compile(
    r"\*{1,3}(?=\S)(.+?)(?<=\S)\*{1,3}",
    re.DOTALL
)
_EMPHASIS_UNDERSCORE = re.compile(
    r"(?<![A-Za-z0-9_])_{1,3}(?=\S)(.+?)(?<=\S)_{1,3}(?![A-Za-z0-9_])",
    re.DOTALL
)
_STRAY_STAR = re.compile(r"\*+")
_SPACES = re.compile(r"[ \t]{2,}")
_BLANK_LINES = re.compile(r"\n{3,}")


def sanitize_for_speech(text):
    """
    Removes Markdown syntax so Edge TTS does not pronounce it.

    Preserves wording, numbers, currency symbols and normal
    punctuation. Returns "" for empty input.
    """

    if not text:
        return ""

    cleaned = str(text)

    cleaned = _CODE_FENCE.sub("", cleaned)
    cleaned = _LINK.sub(r"\1", cleaned)
    cleaned = _HORIZONTAL_RULE.sub("", cleaned)
    cleaned = _HEADING.sub("", cleaned)
    cleaned = _BLOCKQUOTE.sub("", cleaned)
    cleaned = _BULLET.sub("", cleaned)
    cleaned = _INLINE_CODE.sub(r"\1", cleaned)
    cleaned = _EMPHASIS_STAR.sub(r"\1", cleaned)
    cleaned = _EMPHASIS_UNDERSCORE.sub(r"\1", cleaned)
    cleaned = _STRAY_STAR.sub("", cleaned)

    cleaned = _SPACES.sub(" ", cleaned)
    cleaned = _BLANK_LINES.sub("\n\n", cleaned)

    return cleaned.strip()


class TextToSpeech:

    VOICES = {
        "en": "en-IN-NeerjaNeural",
        "kn": "kn-IN-SapnaNeural",
        "hi": "hi-IN-SwaraNeural",
    }

    def __init__(self):

        # -----------------------------------------------------
        # Audio hardware is deliberately NOT touched here.
        #
        # pygame.mixer.init() raises on a machine with no usable
        # audio device, and this object is constructed during
        # pipeline startup -- before the user has even chosen
        # Voice or Type mode. Initializing lazily means text-only
        # mode works without an audio device, and a mixer failure
        # degrades TTS instead of ending the session.
        # -----------------------------------------------------

        self._mixer_ready = False
        self._mixer_failed = False

        print("Text-to-Speech Ready ✅")

    def _ensure_mixer(self):
        """
        Initializes the pygame mixer on first actual use.

        Returns True when audio playback is available. A failure
        is reported once and then remembered, so a machine with
        no audio device does not stall on every turn.
        """

        if self._mixer_ready:
            return True

        if self._mixer_failed:
            return False

        try:

            pygame.mixer.init()

            self._mixer_ready = True

            return True

        except Exception as error:

            self._mixer_failed = True

            print(
                f"[TTS] Audio playback unavailable, "
                f"continuing without speech: {error}"
            )

            return False

    def speak(self, text, language="en"):

        # -------------------------------------------------
        # Strip Markdown before it reaches Edge TTS
        # -------------------------------------------------

        speech_text = sanitize_for_speech(text)

        if not speech_text:
            return

        if not self._ensure_mixer():
            return

        language = (language or "en").lower()

        # Handle en-US / kn-IN / hi-IN
        if "-" in language:
            language = language.split("-")[0]

        voice = self.VOICES.get(
            language,
            self.VOICES["en"]
        )

        filename = f"tts_{uuid.uuid4().hex}.mp3"

        try:

            # -----------------------------------------
            # Generate speech
            # -----------------------------------------

            asyncio.run(
                self._generate_audio(
                    speech_text,
                    voice,
                    filename
                )
            )

            print("🔊 Assistant speaking...")

            # -----------------------------------------
            # Play speech
            # -----------------------------------------

            pygame.mixer.music.load(filename)

            pygame.mixer.music.play()

            # -----------------------------------------
            # WAIT until speech finishes
            # -----------------------------------------

            while pygame.mixer.music.get_busy():

                time.sleep(0.1)

            print("🔊 Speech finished ✅")

            pygame.mixer.music.unload()

        except Exception as error:

            print(f"[TTS] Speech failed: {error}")

        finally:

            # -----------------------------------------
            # Delete temporary TTS file
            # -----------------------------------------

            if os.path.exists(filename):

                try:

                    os.remove(filename)

                except OSError:

                    pass

    async def _generate_audio(
        self,
        text,
        voice,
        filename
    ):

        communicate = edge_tts.Communicate(
            text,
            voice
        )

        await communicate.save(filename)
