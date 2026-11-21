"""
Regression tests for web speech synthesis.

Runs offline. Edge TTS is not installed in every environment and reaching
Microsoft's voice service from a test would be slow and flaky, so the
audio generator, voice map and sanitiser are injected. What is tested is
everything around the generator: validation, voice selection, format
detection, temporary-file cleanup and error safety.

Run from the repository root:

    python -m debugging.test_service_tts
"""

import asyncio
import os
import sys

from service.tts import (
    MAX_TTS_CHARS,
    TtsError,
    UnsupportedLanguageError,
    detect_content_type,
    normalise_language,
    select_voice,
    synthesize,
    validate_text,
)


PASSED = []
FAILED = []

# Mirrors the engine's own map without importing it, so these tests do
# not require edge_tts or pygame to be installed.
VOICES = {"en": "en-IN-NeerjaNeural", "kn": "kn-IN-SapnaNeural", "hi": "hi-IN-SwaraNeural"}

#: A minimal MP3: an ID3 tag followed by a frame sync.
FAKE_MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + b"\x00" * 64


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def run(coro):
    return asyncio.run(coro)


def passthrough(text):
    return text


def generator_writing(payload, record=None):
    """An audio generator that writes fixed bytes and notes the path."""

    async def generate(text, voice, path):
        if record is not None:
            record.append({"text": text, "voice": voice, "path": path})

        with open(path, "wb") as file:
            file.write(payload)

    return generate


# =========================================================
# VALIDATION
# =========================================================

def test_rejects_empty_text():
    for value in (None, "", "   ", "\n\t"):
        try:
            validate_text(value)
            check(f"empty text rejected ({value!r})", False, "no error raised")
        except TtsError:
            check(f"empty text rejected ({value!r})", True)


def test_rejects_overlong_text():
    try:
        validate_text("a" * (MAX_TTS_CHARS + 1))
        check("overlong text rejected", False, "no error raised")
    except TtsError:
        check("overlong text rejected", True)


def test_accepts_a_normal_reply():
    check(
        "an ordinary reply is accepted",
        validate_text("  Please take a withdrawal slip.  ") == "Please take a withdrawal slip.",
    )


# =========================================================
# VOICE SELECTION
# =========================================================

def test_selects_the_engine_voice():
    check("English uses the engine voice", select_voice("en", VOICES) == "en-IN-NeerjaNeural")
    check("Kannada uses the engine voice", select_voice("kn", VOICES) == "kn-IN-SapnaNeural")
    check("Hindi uses the engine voice", select_voice("hi", VOICES) == "hi-IN-SwaraNeural")


def test_normalises_regional_tags():
    check("en-IN normalises", normalise_language("en-IN") == "en")
    check("KN-IN normalises", normalise_language("KN-IN") == "kn")
    check("regional tag still finds a voice", select_voice("kn-IN", VOICES) == "kn-IN-SapnaNeural")


def test_refuses_a_language_with_no_voice():
    # Tulu has no Edge voice and the engine's translator is still a
    # pass-through, so there is nothing to fall back to. Answering a Tulu
    # speaker in an English voice would be worse than staying silent.
    for language in ("tcy", "fr", "zz"):
        try:
            select_voice(language, VOICES)
            check(f"'{language}' refused", False, "no error raised")
        except UnsupportedLanguageError:
            check(f"'{language}' refused", True)


# =========================================================
# AUDIO FORMAT
# =========================================================

def test_detects_the_real_format():
    check("ID3-tagged MP3 detected", detect_content_type(FAKE_MP3) == "audio/mpeg")
    check("bare MPEG frame detected", detect_content_type(b"\xff\xfb\x90\x00data") == "audio/mpeg")
    check(
        "WAV detected",
        detect_content_type(b"RIFF\x24\x00\x00\x00WAVEfmt ") == "audio/wav",
    )
    check("Ogg detected", detect_content_type(b"OggS\x00\x02") == "audio/ogg")


def test_falls_back_rather_than_mislabelling():
    # Unknown bytes still get a usable type rather than an empty one.
    check("unknown bytes fall back", detect_content_type(b"\x00\x01\x02\x03") == "audio/mpeg")


# =========================================================
# SYNTHESIS
# =========================================================

def test_produces_audio_and_its_type():
    audio, content_type = run(
        synthesize(
            "Please take a withdrawal slip.",
            "en",
            generator=generator_writing(FAKE_MP3),
            voices=VOICES,
            sanitizer=passthrough,
        )
    )

    check("audio is returned", audio == FAKE_MP3)
    check("content type follows the bytes", content_type == "audio/mpeg")


def test_uses_the_language_voice():
    record = []

    run(
        synthesize(
            "ಠೇವಣಿ",
            "kn",
            generator=generator_writing(FAKE_MP3, record),
            voices=VOICES,
            sanitizer=passthrough,
        )
    )

    check("the Kannada voice was used", record[0]["voice"] == "kn-IN-SapnaNeural")


def test_strips_markdown_before_speaking():
    record = []

    run(
        synthesize(
            "Please **take** a `slip`.",
            "en",
            generator=generator_writing(FAKE_MP3, record),
            voices=VOICES,
            # The engine's real sanitiser, reached through the default
            # path, does this. Here a simple stand-in proves the text
            # handed to the generator is what the sanitiser returned.
            sanitizer=lambda text: text.replace("**", "").replace("`", ""),
        )
    )

    spoken = record[0]["text"]
    check("markdown is not read aloud", "*" not in spoken and "`" not in spoken, spoken)


def test_deletes_the_temporary_file():
    record = []

    run(
        synthesize(
            "hello",
            "en",
            generator=generator_writing(FAKE_MP3, record),
            voices=VOICES,
            sanitizer=passthrough,
        )
    )

    path = record[0]["path"]
    check("no generated audio is left on disk", not os.path.exists(path), path)


def test_deletes_the_temporary_file_after_failure():
    seen = {}

    async def failing(text, voice, path):
        seen["path"] = path
        with open(path, "wb") as file:
            file.write(b"partial")
        raise RuntimeError("edge-tts exploded")

    try:
        run(synthesize("hello", "en", generator=failing, voices=VOICES, sanitizer=passthrough))
        check("a generator failure is reported", False, "no error raised")
    except TtsError as error:
        check("a generator failure is reported", True)
        check(
            "the failure message carries no internals",
            "edge-tts exploded" not in str(error),
            str(error),
        )

    check("no audio survives a failure", not os.path.exists(seen["path"]), seen.get("path", ""))


def test_rejects_empty_generated_audio():
    try:
        run(
            synthesize(
                "hello",
                "en",
                generator=generator_writing(b""),
                voices=VOICES,
                sanitizer=passthrough,
            )
        )
        check("empty audio is rejected", False, "no error raised")
    except TtsError:
        check("empty audio is rejected", True)


def test_rejects_text_that_sanitises_to_nothing():
    try:
        run(
            synthesize(
                "***",
                "en",
                generator=generator_writing(FAKE_MP3),
                voices=VOICES,
                sanitizer=lambda _text: "",
            )
        )
        check("text that is only markup is rejected", False, "no error raised")
    except TtsError:
        check("text that is only markup is rejected", True)


def test_does_not_generate_for_an_unsupported_language():
    record = []

    try:
        run(
            synthesize(
                "hello",
                "tcy",
                generator=generator_writing(FAKE_MP3, record),
                voices=VOICES,
                sanitizer=passthrough,
            )
        )
        check("unsupported language stops before generating", False, "no error raised")
    except UnsupportedLanguageError:
        check("unsupported language stops before generating", True)

    check("no audio was generated", record == [])


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("WEB SPEECH SYNTHESIS REGRESSION TESTS")
    print("=" * 60)

    for test in tests:
        print(f"\n{test.__name__}")
        test()

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
