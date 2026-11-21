"""
PHASE 1 -- TTS FAILURE DIAGNOSTICS

Regression tests for the /tts observability added to service/tts.py and
service/main.py: every failure has a stable category, every log line
carries the request id, the original exception TYPE (and HTTP status, when
there is one) is logged, and neither the reply text nor an exception's
message ever reaches the log or the response.

WHAT IS SIMULATED

Edge TTS is never called: synthesize() is given an injected generator that
writes fake MP3 bytes, writes nothing, or raises. The HTTP checks go through
FastAPI's TestClient against the real app, real exception handlers and real
validation -- without the lifespan, so no model is loaded and no Groq key is
needed.

These prove WHERE a failure is reported and HOW. They do not establish why
production /tts returns 422: that needs these logs from a real failing
request.

Offline: no network, no model, no audio device.

Run from language_engine/:

    python -m debugging.test_tts_diagnostics
"""

import asyncio
import logging
import sys

from fastapi import HTTPException
from fastapi.testclient import TestClient

import service.main as main
from service import tts
from service.models import TtsRequest


PASSED = []
FAILED = []

VOICES = {"en": "en-IN-NeerjaNeural", "kn": "kn-IN-SapnaNeural", "hi": "hi-IN-SwaraNeural"}
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 8

#: A reply carrying the kind of detail that must never be logged.
SECRET_REPLY = "Deposit 98765 rupees into account 1234567890."
SECRETS = ("98765", "1234567890", "Deposit", "rupees")


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


class Captured(logging.Handler):
    """Collects formatted records from the service loggers."""

    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())

    def text(self):
        return "\n".join(self.lines)

    def __enter__(self):
        self.lines.clear()
        self.logger = logging.getLogger("assistant-service")
        self.saved_level = self.logger.level
        self.logger.setLevel(logging.DEBUG)
        self.logger.addHandler(self)
        return self

    def __exit__(self, *exc):
        self.logger.removeHandler(self)
        self.logger.setLevel(self.saved_level)


def writes(payload):
    async def generator(text, voice, path):
        with open(path, "wb") as fh:
            fh.write(payload)
    return generator


class VoiceServiceRefused(Exception):
    """Shaped like aiohttp's handshake error: a status, and a message
    carrying a URL with a token -- which must never be logged."""

    def __init__(self):
        super().__init__("403, message='Invalid response status', "
                         "url='wss://speech.example/edge?TrustedClientToken=SECRET-TOKEN'")
        self.status = 403


def raises(error):
    async def generator(text, voice, path):
        raise error
    return generator


def synth(text, language="en", generator=None, sanitizer=lambda t: t):
    return asyncio.run(tts.synthesize(text, language, generator=generator or writes(MP3),
                                      voices=VOICES, sanitizer=sanitizer))


def no_secrets(label, log_text):
    leaked = [s for s in SECRETS + ("SECRET-TOKEN", "TrustedClientToken") if s in log_text]
    check(label, not leaked, f"leaked {leaked}")


# =========================================================
# 1  SYNTHESIS: CATEGORIES AND LOG LINES
# =========================================================

def test_empty_text_before_cleaning():
    for empty in ("", "   "):
        with Captured() as log:
            try:
                synth(empty)
                check(f"{empty!r} refused", False, "no error")
            except tts.TtsError as error:
                check(f"{empty!r}: category empty_text", error.category == tts.EMPTY_TEXT, error.category)
                check(f"{empty!r}: customer message unchanged", str(error) == "There is nothing to read out.")
        check(f"{empty!r}: request logged as empty", "tts.request" in log.text() and "empty_in=True" in log.text(),
              log.text())
        check(f"{empty!r}: failure logged at the validate stage",
              "tts.failed" in log.text() and "category=empty_text" in log.text() and "stage=validate" in log.text())


def test_empty_after_cleaning():
    from app.speech.tts import sanitize_for_speech

    # Inputs the REAL sanitizer reduces to nothing: emphasis markers alone,
    # a horizontal rule, an empty heading.
    for markdown in ("***", "** **", "---", "# "):
        with Captured() as log:
            try:
                synth(markdown, "kn", sanitizer=sanitize_for_speech)
                check(f"{markdown!r} refused", False, "no error")
            except tts.TtsError as error:
                check(f"{markdown!r}: category empty_after_cleaning",
                      error.category == tts.EMPTY_AFTER_CLEANING, error.category)
        check(f"{markdown!r}: logged as non-empty input, empty after cleaning",
              "empty_in=False" in log.text() and "category=empty_after_cleaning" in log.text()
              and "chars_clean=0" in log.text(), log.text())


def test_synthesis_exception():
    with Captured() as log:
        try:
            synth(SECRET_REPLY, "en", generator=raises(VoiceServiceRefused()))
            check("a voice-service refusal is reported", False, "no error")
        except tts.TtsError as error:
            check("category synthesis_failed", error.category == tts.SYNTHESIS_FAILED, error.category)
            check("customer message unchanged", str(error) == "The spoken reply could not be produced.")
            check("original exception kept as the cause", isinstance(error.__cause__, VoiceServiceRefused))
    text = log.text()
    check("the exception TYPE is logged", "exc_type=" in text and "VoiceServiceRefused" in text, text)
    check("its HTTP status is logged", "exc_status=403" in text, text)
    check("the failing segment and voice are logged",
          "segment=1/1" in text and "voice=en-IN-NeerjaNeural" in text, text)
    no_secrets("no reply text, exception message or token in the log", text)

    with Captured() as log:
        try:
            synth("Hello.", "en", generator=raises(PermissionError(13, "denied", "C:/secret/path.mp3")))
        except tts.TtsError:
            pass
    check("an OSError logs its errno, not its path",
          "exc_errno=13" in log.text() and "secret" not in log.text(), log.text())


def test_empty_audio():
    with Captured() as log:
        try:
            synth("Hello.", "en", generator=writes(b""))
            check("empty audio refused", False, "no error")
        except tts.TtsError as error:
            check("category empty_audio", error.category == tts.EMPTY_AUDIO, error.category)
            check("customer message unchanged", str(error) == "The spoken reply could not be produced.")
    check("empty audio logged with bytes=0",
          "category=empty_audio" in log.text() and "bytes=0" in log.text(), log.text())


def test_unsupported_language_and_script_have_categories():
    for text, language, category in (("hello", "fr", tts.UNSUPPORTED_LANGUAGE),
                                     ("வணக்கம் sir", "kn", tts.UNSUPPORTED_SCRIPT)):
        try:
            synth(text, language)
            check(f"{category} refused", False, "no error")
        except tts.UnsupportedLanguageError as error:
            check(f"{language}: category {category}", error.category == category, error.category)


def test_success_is_logged_without_text():
    with Captured() as log:
        audio, content_type = synth(SECRET_REPLY, "en")
    text = log.text()
    check("audio returned unchanged", audio == MP3 and content_type == "audio/mpeg")
    check("plan logged: language, segments, voice",
          "tts.plan" in text and "language=en" in text and "segments=1" in text
          and "voices=en-IN-NeerjaNeural" in text, text)
    check("success logged with byte count and recognised audio",
          "tts.ok" in text and f"bytes={len(MP3)}" in text and "recognised_audio=True" in text, text)
    no_secrets("success log carries no reply text", text)

    with Captured() as log:
        audio, content_type = synth("Hello.", "en", generator=writes(b"<html>not audio</html>"))
    check("unrecognised bytes still returned as before", audio == b"<html>not audio</html>"
          and content_type == tts.DEFAULT_CONTENT_TYPE)
    check("but flagged as unrecognised audio", "recognised_audio=False" in log.text(), log.text())


def test_request_id_reaches_every_line():
    token = tts.request_id.set("corr-42")
    try:
        with Captured() as log:
            try:
                synth("Hello.", "en", generator=raises(RuntimeError("x")))
            except tts.TtsError:
                pass
    finally:
        tts.request_id.reset(token)
    tts_lines = [line for line in log.lines if line.startswith("tts.")]
    check("every tts line carries the request id",
          tts_lines and all("request_id=corr-42" in line for line in tts_lines), "\n".join(tts_lines))


# =========================================================
# 2  THE /tts ENDPOINT
# =========================================================

class Endpoint:
    """The real app, with synthesize() given an injected generator."""

    def __init__(self, generator):
        self.generator = generator

    def __enter__(self):
        self.saved = main.synthesize
        generator = self.generator

        async def offline(text, language):
            return await tts.synthesize(text, language, generator=generator,
                                        voices=VOICES, sanitizer=lambda t: t)

        main.synthesize = offline
        self.client = TestClient(main.app, raise_server_exceptions=False)
        return self

    def __exit__(self, *exc):
        main.synthesize = self.saved

    def post(self, body, request_id=None):
        headers = {}
        if main.INTERNAL_TOKEN:
            headers["X-Internal-Token"] = main.INTERNAL_TOKEN
        if request_id is not None:
            headers["X-Request-ID"] = request_id
        return self.client.post("/tts", json=body, headers=headers)


def safe_body(label, response):
    text = response.text
    check(f"{label}: no traceback, path or exception internals in the body",
          "Traceback" not in text and ".py" not in text and "VoiceServiceRefused" not in text
          and "SECRET-TOKEN" not in text, text)


def test_endpoint_expected_failure_shape():
    with Endpoint(raises(VoiceServiceRefused())) as api, Captured() as log:
        response = api.post({"text": SECRET_REPLY, "language": "en"}, request_id="nest-123")
    body = response.json()
    check("422 for a synthesis failure", response.status_code == 422, str(response.status_code))
    check("stable body: detail, error, request_id",
          body == {"detail": "The spoken reply could not be produced.",
                   "error": "synthesis_failed", "request_id": "nest-123"}, str(body))
    check("request id echoed in the header", response.headers.get("x-request-id") == "nest-123")
    check("not cached", response.headers.get("cache-control") == "no-store")
    safe_body("synthesis failure", response)
    check("status and category logged for the response",
          "tts.response request_id=nest-123 status=422 category=synthesis_failed" in log.text(), log.text())
    no_secrets("endpoint log carries no reply text or token", log.text())

    with Endpoint(writes(b"")) as api:
        response = api.post({"text": "Hello.", "language": "en"})
    check("empty audio is 422 empty_audio", response.status_code == 422
          and response.json()["error"] == "empty_audio", response.text)


def test_endpoint_unsupported_language_is_400():
    with Endpoint(writes(MP3)) as api:
        response = api.post({"text": "hello", "language": "fr"})
    body = response.json()
    check("400 for an unsupported language", response.status_code == 400, str(response.status_code))
    check("with category unsupported_language", body.get("error") == "unsupported_language", str(body))
    check("and a generated request id", len(body.get("request_id", "")) == 32, str(body))


def test_endpoint_schema_failure_is_categorised():
    long_text = "9" * 2001
    with Endpoint(writes(MP3)) as api, Captured() as log:
        response = api.post({"text": long_text, "language": "en"}, request_id="nest-v")
    body = response.json()
    check("schema failure is 422", response.status_code == 422, str(response.status_code))
    check("with category invalid_request and a string detail",
          body.get("error") == "invalid_request" and isinstance(body.get("detail"), str)
          and body.get("request_id") == "nest-v", str(body))
    check("logged by field and type", "fields=body.text:string_too_long" in log.text(), log.text())
    check("the rejected text is not logged", long_text not in log.text() and "9999" not in log.text())

    with Endpoint(writes(MP3)) as api:
        other = api.client.post("/turn", json={}, headers=(
            {"X-Internal-Token": main.INTERNAL_TOKEN} if main.INTERNAL_TOKEN else {}))
    check("other routes keep FastAPI's own validation body",
          other.status_code == 422 and isinstance(other.json().get("detail"), list), other.text)


def test_endpoint_request_id_is_sanitised():
    with Endpoint(writes(MP3)) as api, Captured() as log:
        response = api.post({"text": "Hello.", "language": "en"}, request_id="evil value x" * 10)
    rid = response.headers.get("x-request-id", "")
    check("an unusable request id is replaced", rid and " " not in rid and len(rid) == 32, rid)
    check("the supplied value is not logged", "evil value" not in log.text(), log.text())


def test_endpoint_success():
    with Endpoint(writes(MP3)) as api:
        response = api.post({"text": "Hello.", "language": "en"}, request_id="nest-ok")
    check("200 with audio", response.status_code == 200 and response.content == MP3)
    check("audio content type", response.headers.get("content-type") == "audio/mpeg")
    check("request id echoed on success", response.headers.get("x-request-id") == "nest-ok")


def test_direct_call_contract_unchanged():
    """The debugging suites call speak() directly and catch HTTPException."""
    saved = main.synthesize

    async def failing(text, language):
        raise tts.TtsError("The spoken reply could not be produced.")

    main.synthesize = failing
    try:
        asyncio.run(main.speak(TtsRequest(text="Hello.", language="en")))
        check("direct call refused", False, "no error")
    except HTTPException as error:
        check("still an HTTPException with 422", error.status_code == 422, str(error.status_code))
        check("detail still the customer message", error.detail == "The spoken reply could not be produced.")
    finally:
        main.synthesize = saved


def main_():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("PHASE 1 TTS DIAGNOSTICS TESTS")
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
    sys.exit(main_())
