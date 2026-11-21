"""
PART 1 SPIKE -- what the INSTALLED Whisper actually accepts.

Answers exactly three questions, and refuses to answer a fourth:

  1. Which Indian language codes does the installed openai-whisper
     package recognise?
  2. Does the decoding path actually accept each of those codes
     (tokenizer + DecodingOptions), or does the code merely appear
     in a dictionary?
  3. Does SpeechToText.transcribe() pass the code through unchanged
     and return the {"text","language"} shape the pipeline reads?

  4. NOT ANSWERED: how ACCURATE Whisper is on those languages. No
     regional-language audio exists in this repository, so that
     number cannot be produced here and is not guessed.

Read-only. Imports app.speech.stt but never modifies it: the mock
boundary builds the object with object.__new__, so no model is loaded
and no file is touched.
"""

import sys
import traceback

import whisper
from whisper.tokenizer import LANGUAGES

from app.speech.stt import SpeechToText


LINE = "=" * 62


# Languages of India we might plausibly be asked for, by ISO-639-1
# where one exists. Tulu (tcy) is listed ONLY to prove its absence;
# it is out of scope for this spike.
INDIAN_LANGUAGES = [
    ("hi", "Hindi"), ("bn", "Bengali"), ("ta", "Tamil"),
    ("te", "Telugu"), ("mr", "Marathi"), ("gu", "Gujarati"),
    ("kn", "Kannada"), ("ml", "Malayalam"), ("pa", "Punjabi"),
    ("ur", "Urdu"), ("as", "Assamese"), ("or", "Odia"),
    ("ne", "Nepali"), ("sa", "Sanskrit"), ("sd", "Sindhi"),
    ("si", "Sinhala"), ("mai", "Maithili"), ("kok", "Konkani"),
    ("mni", "Manipuri"), ("sat", "Santali"), ("doi", "Dogri"),
    ("ks", "Kashmiri"), ("brx", "Bodo"), ("tcy", "Tulu"),
]

# The subset this product serves today, plus the tier the phase
# proposal names as the realistic next step.
IN_SCOPE_NOW = ("en", "kn", "hi")
IN_SCOPE_PROPOSED = ("ta", "te", "ml", "mr")


def header(title):
    print()
    print(LINE)
    print(title)
    print(LINE)


def section_1_environment():
    header("1. ENVIRONMENT (installed, not assumed)")

    import torch

    version = getattr(whisper, "__version__", "no __version__ attribute")

    print("  python            : " + sys.version.split()[0])
    print("  openai-whisper    : " + str(version))
    print("  torch             : " + str(torch.__version__))
    print("  cuda available    : " + str(torch.cuda.is_available()))
    print("  whisper languages : " + str(len(LANGUAGES)))


def section_2_code_support():
    header("2. INDIAN LANGUAGE CODES RECOGNISED BY INSTALLED WHISPER")

    accepted = []
    rejected = []

    for code, name in INDIAN_LANGUAGES:
        known = code in LANGUAGES

        if known:
            accepted.append((code, name))
        else:
            rejected.append((code, name))

        mark = "OK    " if known else "ABSENT"
        whisper_name = LANGUAGES.get(code, "-")

        print(
            "  [" + mark + "] " + code.ljust(4) + " " + name.ljust(12)
            + " whisper calls it: " + whisper_name
        )

    missing = ", ".join(c for c, _ in rejected) or "none"

    print()
    print("  recognised : " + str(len(accepted)) + " / " + str(len(INDIAN_LANGUAGES)))
    print("  absent     : " + missing)

    return accepted, rejected


def section_3_decoding_path(accepted):
    """
    A code living in LANGUAGES is not proof the decoder accepts it.

    This builds the real tokenizer and the real DecodingOptions for
    every recognised code, so a dictionary entry with no usable
    language token would surface here rather than at the first live
    recording.
    """

    header("3. DECODING PATH ACCEPTS EACH RECOGNISED CODE")

    failures = []

    for code, name in accepted:
        try:
            tokenizer = whisper.tokenizer.get_tokenizer(
                multilingual=True,
                language=code,
                task="transcribe",
            )

            # The language token must exist AND sit in the
            # start-of-transcript sequence the decoder is primed with.
            language_token = tokenizer.to_language_token(code)
            in_sot = language_token in tokenizer.sot_sequence

            options = whisper.DecodingOptions(language=code, fp16=False)
            options_ok = options.language == code

            ok = in_sot and options_ok

            print(
                "  [" + ("OK    " if ok else "FAIL  ") + "] "
                + code.ljust(4) + " " + name.ljust(12)
                + " lang_token=" + str(language_token)
                + " in_sot=" + str(in_sot)
                + " DecodingOptions=" + str(options_ok)
            )

            if not ok:
                failures.append(code)

        except Exception as error:
            print(
                "  [FAIL  ] " + code.ljust(4) + " " + name.ljust(12)
                + " " + type(error).__name__ + ": " + str(error)
            )
            failures.append(code)

    print()
    print("  decode-path failures: " + str(failures or "none"))

    return failures


class _RecordingModel:
    """
    Stand-in for the loaded Whisper model.

    Records exactly what SpeechToText hands the model, so the language
    pass-through can be verified without loading weights, touching a
    file, or editing app/speech/stt.py.
    """

    def __init__(self, text=" transcribed text "):
        self.calls = []
        self._text = text

    def transcribe(self, audio_path, **kwargs):
        call = {"audio_path": audio_path}
        call.update(kwargs)
        self.calls.append(call)

        return {"text": self._text}


def section_4_mock_boundary(accepted):
    """
    Verifies the CONTRACT the pipeline depends on, for every code:

      - the code reaches whisper unchanged
      - fp16=False is still passed
      - the returned dict carries exactly "text" and "language"
      - "text" is stripped and "language" echoes the request

    object.__new__ skips __init__, so whisper.load_model() never runs.
    Nothing in app/ is modified.
    """

    header("4. SpeechToText CONTRACT (mock boundary, no weights loaded)")

    passed = 0
    failed = 0

    codes = ["en"] + [c for c, _ in accepted]

    for code in codes:
        stt = object.__new__(SpeechToText)
        model = _RecordingModel()
        stt.model = model

        result = stt.transcribe("utterance.wav", language=code)
        call = model.calls[0] if model.calls else {}

        cases = [
            (
                code + ": language reaches whisper unchanged",
                call.get("language") == code,
            ),
            (
                code + ": fp16=False still passed",
                call.get("fp16") is False,
            ),
            (
                code + ": returns exactly text + language keys",
                set(result) == {"text", "language"},
            ),
            (
                code + ": text stripped, language echoed",
                result["text"] == "transcribed text"
                and result["language"] == code,
            ),
        ]

        for label, ok in cases:
            if ok:
                passed += 1
                print("  PASS  " + label)
            else:
                failed += 1
                print("  FAIL  " + label + "   call=" + str(call) + " result=" + str(result))

    print()
    print("  passed: " + str(passed) + "   failed: " + str(failed))

    return passed, failed


def section_5_real_audio():
    """
    The ONLY real-audio evidence available in this repository.

    phase3_format_check.wav is the single recording present. Its
    content is English, so it proves the end-to-end invocation works
    and proves NOTHING about any Indian language.
    """

    header("5. REAL AUDIO -- the one file this repository actually has")

    import time
    from pathlib import Path

    audio = Path(__file__).resolve().parents[2] / "phase3_format_check.wav"

    if not audio.exists():
        print("  SKIP  " + str(audio) + " not found")
        return

    size_kb = audio.stat().st_size / 1024

    print("  file  : " + audio.name + "  (" + format(size_kb, ".0f") + " KB)")
    print("  note  : content is English. This measures INVOCATION, not")
    print("          Indian-language accuracy.")
    print()

    model = whisper.load_model("small")

    started = time.time()
    result = model.transcribe(str(audio), language="en", fp16=False)
    elapsed = time.time() - started

    print("  language=en -> " + repr(result["text"].strip()))
    print("  wall clock  : " + format(elapsed, ".1f") + "s on CPU, whisper 'small'")


def section_6_not_measured():
    header("6. WHAT THIS SPIKE DELIBERATELY DOES NOT CLAIM")

    print()
    print("  ACCURACY ON INDIAN LANGUAGES: NOT MEASURED")
    print()
    print("  Accepting a language code and transcribing that language")
    print("  well are different properties. This repository contains no")
    print("  Kannada, Hindi, Tamil, Telugu, Malayalam or Marathi audio,")
    print("  so no word-error rate, no digit-fidelity figure and no")
    print("  code-mixing result can be produced here. None is stated")
    print("  anywhere in this output.")
    print()
    print("  Measuring it needs a held-out set of real branch-style")
    print("  utterances per language -- including ones carrying account")
    print("  numbers, amounts and code-mixed English banking terms --")
    print("  sourced under a licence that permits it. That is a")
    print("  prerequisite for choosing an ASR provider, not a follow-up.")


def main():
    print()
    print(LINE)
    print("PHASE 3.2B-6 SPIKE -- PART 1: INSTALLED WHISPER LANGUAGE SUPPORT")
    print(LINE)

    section_1_environment()

    accepted, rejected = section_2_code_support()
    failures = section_3_decoding_path(accepted)
    passed, failed = section_4_mock_boundary(accepted)

    try:
        section_5_real_audio()
    except Exception:
        print("  real-audio step failed:")
        traceback.print_exc()

    section_6_not_measured()

    now_ok = all(c == "en" or c in LANGUAGES for c in IN_SCOPE_NOW)
    next_ok = all(c in LANGUAGES for c in IN_SCOPE_PROPOSED)

    header("SUMMARY")
    print("  Indian codes recognised : " + str(len(accepted)) + "/" + str(len(INDIAN_LANGUAGES)))
    print("  Indian codes absent     : " + (", ".join(c for c, _ in rejected) or "none"))
    print("  decode-path failures    : " + str(failures or "none"))
    print("  contract checks         : " + str(passed) + " passed, " + str(failed) + " failed")
    print("  served today  " + str(IN_SCOPE_NOW) + "  : " + str(now_ok))
    print("  proposed next " + str(IN_SCOPE_PROPOSED) + " : " + str(next_ok))
    print("  ASR ACCURACY            : NOT MEASURED (no regional audio in repo)")
    print()


if __name__ == "__main__":
    main()
