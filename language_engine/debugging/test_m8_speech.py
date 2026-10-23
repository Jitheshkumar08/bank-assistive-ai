"""
M8 -- TTS LANGUAGE CONSISTENCY AND SPEECH-OUTPUT SAFETY

Regression tests for app/speech/speech_plan.py, service/tts.py synthesis,
the /tts endpoint and the CLI's TextToSpeech.speak.

WHAT IS SIMULATED

Edge TTS is replaced by a generator that records (text, voice) and writes
fake bytes. These tests prove WHICH voice is asked to read WHICH text, that
the text is unchanged, and what is refused. They do NOT prove anything
sounds right: pronunciation, intelligibility and how a voice change
mid-reply sounds need real audio heard by Kannada and Hindi speakers.

Offline: no network, no model, no audio device.

Run from language_engine/:

    python -m debugging.test_m8_speech
"""

import asyncio
import os
import sys

from fastapi import HTTPException

from app.dialogue.localization import localize
from app.dialogue.localization_catalog import INSTRUCTIONS, SENTENCES, UNTRANSLATED_MARKER
from app.speech.speech_plan import (
    UnsupportedScriptError, UnsupportedSpeechLanguageError, plan_speech, script_of, word_script,
)
import service.tts as tts


PASSED = []
FAILED = []

VOICES = {"en": "en-IN-NeerjaNeural", "kn": "kn-IN-SapnaNeural", "hi": "hi-IN-SwaraNeural"}
ID3 = b"ID3\x03\x00\x00\x00\x00\x00\x05" + b"TAGXX"     # 10-byte header + 5 bytes of tag
FRAMES = b"\xff\xfb\x90\x00" + b"frames"


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def plan(text, language):
    return [(s.language, s.text) for s in plan_speech(text, language)]


def recording(record, payload=ID3 + FRAMES, fail_on=None):
    async def generator(text, voice, path):
        record.append({"text": text, "voice": voice, "path": path})
        if fail_on is not None and len(record) == fail_on:
            raise RuntimeError("voice service down")
        with open(path, "wb") as handle:
            handle.write(payload)
    return generator


def synth(text, language, record, **kwargs):
    return asyncio.run(tts.synthesize(text, language, generator=recording(record, **kwargs),
                                      voices=VOICES, sanitizer=lambda t: t))


# =========================================================
# 1  SCRIPTS
# =========================================================

def test_letters_and_non_letters():
    check("Kannada letter", script_of("ಕ") == "kannada")
    check("Kannada vowel sign counts with its script", script_of("ಿ") == "kannada")
    check("Devanagari letter", script_of("क") == "devanagari")
    check("Latin letter", script_of("a") == "latin" and script_of("é") == "latin")
    check("Tamil letter is 'other'", script_of("த") == "other")
    for char, name in (("।", "danda"), ("॥", "double danda"), ("೫", "Kannada digit"), ("५", "Devanagari digit"),
                       ("5", "digit"), ("₹", "rupee sign"), ("‌", "ZWNJ"), (".", "full stop")):
        check(f"{name} is not a letter", script_of(char) is None)
    check("a word's script is its majority", word_script("ಲೋನ್‌ಗೆ") == "kannada" and word_script("5000") is None)


# =========================================================
# 2  THE POLICY
# =========================================================

def test_single_language_replies_use_one_voice():
    for text, language in (("Please take a deposit slip.", "en"),
                           ("ಸರಿ. ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ.", "kn"),
                           ("जारी रख रहा हूँ। निकाली जाने वाली राशि लिखिए।", "hi")):
        got = plan(text, language)
        check(f"[{language}] one segment, the {language} voice", got == [(language, text)], f"{got}")


def test_code_mixed_sentences_keep_their_language():
    for text, language in (("ಡೆಪಾಸಿಟ್ ಸ್ಲಿಪ್ ಎಂದರೆ deposit slip ನಮೂನೆ.", "kn"),
                           ("ನಿಮ್ಮ cheque book ಸುರಕ್ಷಿತವಾಗಿ ಇಟ್ಟುಕೊಳ್ಳಿ.", "kn"),
                           ("आपकी deposit slip भरकर काउंटर पर दीजिए।", "hi"),
                           ("आपका cheque book सुरक्षित रखिए।", "hi")):
        got = plan(text, language)
        check(f"[{language}] English terms inside a {language} sentence stay with its voice",
              got == [(language, text)], f"{got}")


def test_voice_follows_the_text_not_the_session():
    check("an English reply in a Kannada session is read by the English voice",
          plan("Please take a deposit slip.", "kn") == [("en", "Please take a deposit slip.")])
    check("a Kannada reply in a Hindi session (re-read after a switch) keeps the Kannada voice",
          plan("ಸರಿ.", "hi") == [("kn", "ಸರಿ.")])
    check("a Hindi reply in an English session keeps the Hindi voice",
          plan("ठीक है.", "en") == [("hi", "ठीक है.")])


def test_mixed_replies_are_split_explicitly():
    marker = UNTRANSLATED_MARKER["kn"]
    text = f"ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ. {marker} Please insert your card into the ATM."
    check("the M6 fallback marker is Kannada and the English after it is English",
          plan(text, "kn") == [("kn", f"ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ. {marker}"),
                               ("en", "Please insert your card into the ATM.")], f"{plan(text, 'kn')}")
    hi = "उत्तर यहाँ है। Sign the withdrawal slip."
    check("a Hindi answer followed by an English sentence is split",
          plan(hi, "hi") == [("hi", "उत्तर यहाँ है।"), ("en", "Sign the withdrawal slip.")])


def test_numbers_and_ties():
    check("a number alone takes the session voice", plan("5000.", "kn") == [("kn", "5000.")])
    check("a number joins the sentence before it", plan("ಉತ್ತರ. 5000. Sign here.", "kn")
          == [("kn", "ಉತ್ತರ. 5000."), ("en", "Sign here.")])
    check("a tie goes to the session language", plan("ok ಸರಿ", "kn") == [("kn", "ok ಸರಿ")])


def test_text_is_never_changed():
    for text in ("ಮುಂದುವರಿಸುತ್ತಿದ್ದೇನೆ. (ಈ ಭಾಗ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತ್ರ ಲಭ್ಯವಿದೆ:) Please insert your card.",
                 "उत्तर यहाँ है। Sign the withdrawal slip.", "ಹಂತ 2: ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ."):
        rejoined = " ".join(s.text for s in plan_speech(text, "kn"))
        check(f"segments rejoin to the original text: {text[:30]!r}", rejoined == " ".join(text.split()))


def test_refusals():
    for text, label in (("வணக்கம் sir", "Tamil"), ("مرحبا", "Arabic"), ("ನಮಸ್ಕಾರ மேடம்", "Kannada with Tamil")):
        try:
            plan_speech(text, "kn")
            check(f"{label} text is refused whole", False, "no error")
        except UnsupportedScriptError:
            check(f"{label} text is refused whole", True)
    for language in ("fr", "tcy", "zz"):
        try:
            plan_speech("hello", language)
            check(f"session language {language!r} is refused", False, "no error")
        except UnsupportedSpeechLanguageError:
            check(f"session language {language!r} is refused", True)
    check("empty text plans nothing", plan_speech("", "kn") == [])


def test_every_fixed_reply_uses_only_its_own_voice():
    samples = [t for t, _ in SENTENCES] + list(INSTRUCTIONS)
    values = {"{instruction}": "Fill in your account number.", "{workflow}": "deposit",
              "{workflow2}": "withdrawal", "{current}": "deposit", "{requested}": "withdrawal",
              "{n}": "2", "{k}": "3"}
    wrong = []
    for english in samples:
        for slot, value in values.items():
            english = english.replace(slot, value)
        for language in ("kn", "hi"):
            rendered = localize(english, language)[0]
            voices = {s.language for s in plan_speech(rendered, language)}
            if voices != {language}:
                wrong.append(f"[{language}] {english!r}: {voices}")
        if {s.language for s in plan_speech(english, "en")} != {"en"}:
            wrong.append(f"[en] {english!r}")
    check(f"all {len(samples)} fixed replies, in en/kn/hi, are read by their own voice only",
          not wrong, "; ".join(wrong))


# =========================================================
# 3  SYNTHESIS
# =========================================================

def test_single_language_is_one_call():
    record = []
    audio, content_type = synth("ಸರಿ. ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ.", "kn", record)
    check("one synthesis call", len(record) == 1)
    check("the Kannada voice", record[0]["voice"] == VOICES["kn"])
    check("the text sent is the reply", record[0]["text"] == "ಸರಿ. ನಿಮ್ಮ ಖಾತೆ ಸಂಖ್ಯೆಯನ್ನು ಬರೆಯಿರಿ.")
    check("audio and type returned as before", audio == ID3 + FRAMES and content_type == "audio/mpeg")


def test_mixed_reply_is_one_call_per_voice_joined():
    record = []
    text = "उत्तर यहाँ है। Sign the withdrawal slip."
    audio, _ = synth(text, "hi", record)
    check("two calls", len(record) == 2)
    check("Hindi voice, then English voice",
          [r["voice"] for r in record] == [VOICES["hi"], VOICES["en"]], f"{[r['voice'] for r in record]}")
    check("each part reads its own sentence",
          [r["text"] for r in record] == ["उत्तर यहाँ है।", "Sign the withdrawal slip."])
    check("parts are joined in order, the repeated ID3 tag dropped", audio == ID3 + FRAMES + FRAMES)
    check("no temporary file is left", not any(os.path.exists(r["path"]) for r in record))


def test_a_failed_part_returns_no_audio():
    record = []
    try:
        synth("उत्तर यहाँ है। Sign the withdrawal slip.", "hi", record, fail_on=2)
        check("a failed second part is reported", False, "no error")
    except tts.TtsError as error:
        check("a failed second part is reported, no partial audio", not isinstance(error, tts.UnsupportedLanguageError))
    check("no temporary file is left after a failure", not any(os.path.exists(r["path"]) for r in record))


def test_refusals_happen_before_any_generation():
    for text, language, label in (("hello", "fr", "unsupported language"),
                                  ("வணக்கம் sir", "kn", "unsupported script")):
        record = []
        try:
            synth(text, language, record)
            check(f"{label} refused", False, "no error")
        except tts.UnsupportedLanguageError:
            check(f"{label} refused as UnsupportedLanguageError (HTTP 400)", True)
        check(f"{label}: nothing generated", record == [])

    for empty in ("", "   ", "**"):
        try:
            asyncio.run(tts.synthesize(empty, "kn", generator=recording([]), voices=VOICES,
                                       sanitizer=lambda t: t.replace("*", "")))
            check(f"empty text {empty!r} refused", False, "no error")
        except tts.TtsError:
            check(f"empty text {empty!r} refused", True)


def test_mp3_joining():
    check("no parts, no bytes", tts.join_mp3([]) == b"")
    check("one part unchanged", tts.join_mp3([ID3 + FRAMES]) == ID3 + FRAMES)
    check("ID3 length read from the synchsafe header", tts._id3v2_length(ID3 + FRAMES) == 15)
    check("bare frames have no tag", tts._id3v2_length(FRAMES) == 0)


# =========================================================
# 4  THE /tts ENDPOINT AND THE CLI
# =========================================================

def test_endpoint_contract():
    import service.main as main
    from service.models import TtsRequest

    record = []
    saved = tts._edge_tts_generator, tts.load_engine_speech
    tts._edge_tts_generator = recording(record)
    tts.load_engine_speech = lambda: ((lambda t: t), VOICES)
    try:
        response = asyncio.run(main.speak(TtsRequest(text="ಸರಿ. Sign here.", language="kn")))
        check("200 with audio", response.status_code == 200 and response.body == ID3 + FRAMES + FRAMES)
        check("content type and no-store as before",
              response.media_type == "audio/mpeg" and response.headers.get("cache-control") == "no-store")
        check("voices followed the text", [r["voice"] for r in record] == [VOICES["kn"], VOICES["en"]])

        for text, language in (("வணக்கம்", "kn"), ("hello", "fr")):
            try:
                asyncio.run(main.speak(TtsRequest(text=text, language=language)))
                check(f"{text!r}/{language} refused", False, "no error")
            except HTTPException as error:
                check(f"{text!r}/{language} refused with 400", error.status_code == 400, str(error.status_code))
    finally:
        tts._edge_tts_generator, tts.load_engine_speech = saved


def test_cli_follows_the_same_policy():
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        from app.speech.tts import TextToSpeech

    played = []
    speaker = TextToSpeech.__new__(TextToSpeech)
    speaker._ensure_mixer = lambda: True
    speaker._play = lambda text, voice: played.append((text, voice))

    speaker.speak("उत्तर यहाँ है। Sign the withdrawal slip.", "hi")
    check("the CLI plays each part with its own voice",
          played == [("उत्तर यहाँ है।", VOICES["hi"]), ("Sign the withdrawal slip.", VOICES["en"])], f"{played}")

    played.clear()
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        speaker.speak("Hello", "fr")
    check("the CLI no longer falls back to English for an unsupported language",
          played == [] and "Not speaking" in out.getvalue())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M8 SPEECH TESTS")
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
