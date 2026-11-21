"""Tulu speech synthesis: newly generated audio from Tulu text.

WHAT THIS IS -- AND IS NOT

No native Tulu TTS model exists (none on Hugging Face; MMS has no `tcy`), and
the native-speaker recordings (4 assistant clips, ~15 s of speech) are far too
little to train or fine-tune one -- see docs/tulu-dataset-audit.md. Voice
cloning is not used: consent for the speaker's voice is not documented.

So Tulu is spoken by the project's existing, already-integrated neural voice
for Kannada (Microsoft Edge `kn-IN-SapnaNeural`), reading Tulu text written
in Kannada script:

    Romanized Tulu --(normalization.roman_to_kannada)--> Kannada-script Tulu
                  --(Edge neural TTS, Kannada voice)--> NEW audio (MP3)

The words are Tulu; the pronunciation model is Kannada-trained. Tulu sounds
Kannada lacks, and vowel length the romanization does not mark, may be
mispronounced. This is reported as "a Kannada-trained voice synthesizing
Tulu text", never as native Tulu TTS.

GUARANTEES

  - Audio is generated from text on every call. This module never opens,
    reads, concatenates or returns any dataset recording; it has no path to
    them. Tests assert the output differs from every dataset recording.
  - Sentences with no Tulu evidence (English fallback text) are left in the
    Latin script so the speech planner gives them the English voice; they
    are never transliterated into Kannada letters and passed off as Tulu.
"""

from __future__ import annotations

import asyncio
import os
import re
import tempfile
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from app.tulu.normalization.text import classify_text, normalize_display, roman_to_kannada
from app.tulu.translation.renderer import verified_renderings

#: The voice that reads Kannada-script Tulu. Same as the engine's Kannada voice.
KANNADA_VOICE = "kn-IN-SapnaNeural"
ENGLISH_VOICE = "en-IN-NeerjaNeural"
VOICE_ID = "tcy-text/kn-IN-SapnaNeural"
ENGINE = "edge-tts (Microsoft neural TTS, cloud)"
DISCLOSURE = ("Kannada-trained neural voice synthesizing Tulu text written in Kannada script; "
              "not a native Tulu TTS model.")

_SENTENCE = re.compile(r"(?<=[.?!।])\s+|\n+")

AudioGenerator = Callable[[str, str, str], Awaitable[None]]


class TuluTtsError(RuntimeError):
    """Speech could not be produced. Message is safe to show."""

    def __init__(self, message: str, category: str = "synthesis_failed"):
        super().__init__(message)
        self.category = category


@dataclass
class SpeechPreparation:
    spoken_text: str
    sentences: list = field(default_factory=list)   # [(original, spoken, kind)]


def _is_tulu_sentence(sentence: str) -> bool:
    if sentence in {r.tulu_romanized for r in verified_renderings().values()}:
        return True
    return classify_text(sentence)["label"].startswith("tcy")


def prepare_speech_text(text: str, assume_tulu: bool = False) -> SpeechPreparation:
    """
    Text a Kannada voice can read for the Tulu parts, English kept for the rest.

    Kannada-script sentences pass through. A Latin-script sentence is
    transliterated when it is Tulu (verified rendering, verified Tulu words,
    or `assume_tulu`); otherwise it stays English for the English voice.
    """
    prepared = []
    for sentence in (s for s in _SENTENCE.split(normalize_display(text)) if s.strip()):
        has_latin = re.search(r"[A-Za-z]", sentence) is not None
        has_kannada = re.search(r"[ಀ-೿]", sentence) is not None
        if has_kannada and not has_latin:
            prepared.append((sentence, sentence, "tulu-kannada-script"))
        elif has_latin and (assume_tulu or _is_tulu_sentence(sentence)):
            prepared.append((sentence, roman_to_kannada(sentence), "tulu-romanized->kannada-script"))
        else:
            prepared.append((sentence, sentence, "english" if has_latin else "other"))
    return SpeechPreparation(" ".join(p[1] for p in prepared), prepared)


async def _edge_generate(text: str, voice: str, path: str) -> None:
    import edge_tts

    await edge_tts.Communicate(text, voice).save(path)


@dataclass
class TuluSpeechResult:
    audio: bytes
    content_type: str
    voice_id: str
    engine: str
    disclosure: str
    input_text: str
    spoken_text: str
    segments: list


class TuluSpeechSynthesizer:
    """Text in, newly synthesized audio out. Stateless."""

    MAX_CHARS = 2000

    def __init__(self, generator: Optional[AudioGenerator] = None):
        self._generate = generator or _edge_generate

    async def synthesize(self, text: str, assume_tulu: bool = True) -> TuluSpeechResult:
        cleaned = normalize_display(text)
        if not cleaned:
            raise TuluTtsError("There is nothing to read out.", "empty_text")
        if len(cleaned) > self.MAX_CHARS:
            raise TuluTtsError("That text is too long to read out.", "text_too_long")

        prep = prepare_speech_text(cleaned, assume_tulu=assume_tulu)

        # Runs of the same voice become one synthesis call each.
        runs: list[list] = []
        for _original, spoken, kind in prep.sentences:
            voice = ENGLISH_VOICE if kind == "english" else KANNADA_VOICE
            if runs and runs[-1][0] == voice:
                runs[-1][1] += " " + spoken
            else:
                runs.append([voice, spoken])

        parts = []
        for voice, segment in runs:
            handle, path = tempfile.mkstemp(suffix=".mp3", prefix="tulu-tts-")
            os.close(handle)
            try:
                await self._generate(segment, voice, path)
                with open(path, "rb") as fh:
                    part = fh.read()
            except TuluTtsError:
                raise
            except Exception as error:
                raise TuluTtsError("The spoken reply could not be produced.") from error
            finally:
                try:
                    os.remove(path)
                except OSError:
                    pass
            if not part:
                raise TuluTtsError("The spoken reply could not be produced.", "empty_audio")
            parts.append(part)

        from service.tts import detect_content_type, join_mp3   # shared MP3 helpers

        audio = join_mp3(parts)
        return TuluSpeechResult(
            audio=audio,
            content_type=detect_content_type(audio),
            voice_id=VOICE_ID,
            engine=ENGINE,
            disclosure=DISCLOSURE,
            input_text=cleaned,
            spoken_text=prep.spoken_text,
            segments=[{"voice": v, "chars": len(t)} for v, t in runs],
        )

    def synthesize_sync(self, text: str, assume_tulu: bool = True) -> TuluSpeechResult:
        return asyncio.run(self.synthesize(text, assume_tulu=assume_tulu))
