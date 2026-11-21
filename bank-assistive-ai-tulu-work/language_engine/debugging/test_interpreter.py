"""
FACE-TO-FACE INTERPRETER -- PHASE 1

Regression tests for app/translation/interpreter_translator.py and the
/interpret/* routes in service/main.py.

Real: the FastAPI app (through TestClient, without its lifespan, so no model
loads), SessionRegistry, ConversationManager, DialogueManager, the workflow
definitions, the translator's prompt, parsing and script check. Stand-ins: the
LLM client (scripted responses, never the network) and get_runtime(),
replaced by a runtime whose transcribe() returns scripted text and whose
run_turn() FAILS the test if an interpreter request ever reaches it.

Offline: no network, no model, no audio.

Run from language_engine/:

    python -m debugging.test_interpreter
"""

import copy
import json
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient

import service.engine as engine_module
import service.interpreter as interpreter_module
import service.main as main
from app.translation.interpreter_translator import (
    EmptyTextError,
    InterpreterTranslator,
    TranslationError,
    UnsupportedLanguagePairError,
    target_script_share,
)
from debugging.test_phase32b1_control_routing import FakeUnderstanding, make_dialogue

PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  FAIL  {label}   {detail}")


def section(title):
    print()
    print("=" * 62)
    print(title)
    print("=" * 62)


# ---------------------------------------------------------------------------
# Stand-ins
# ---------------------------------------------------------------------------


class FakeLlm:
    """Records every request and answers with scripted content."""

    def __init__(self, *contents, error=None):
        self.contents = list(contents)
        self.error = error
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **request):
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        content = self.contents.pop(0) if self.contents else None
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def answer(translation):
    return json.dumps({"translation": translation})


class TurnForbidden(AssertionError):
    pass


class FakeRuntime:
    """Speech recognition that returns scripted text; a turn fails the test."""

    def __init__(self, text="I want to deposit money"):
        self.text = text
        self.transcribed = []

    def transcribe(self, audio, *, language, suffix):
        self.transcribed.append({"bytes": len(audio), "language": language, "suffix": suffix})
        if isinstance(self.text, Exception):
            raise self.text
        return self.text

    def run_turn(self, *args, **kwargs):
        raise TurnForbidden("an interpreter request reached the turn pipeline")

    def has_exited(self, *args, **kwargs):
        raise TurnForbidden("an interpreter request reached the turn pipeline")


class Api:
    def __init__(self, runtime=None, llm=None):
        self.runtime = runtime or FakeRuntime()
        self.llm = llm or FakeLlm(answer("ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ"))

    def __enter__(self):
        self.saved = (main.get_runtime, engine_module.get_runtime, main.INTERNAL_TOKEN)
        main.get_runtime = lambda: self.runtime
        engine_module.get_runtime = lambda: self.runtime
        main.INTERNAL_TOKEN = ""
        main.registry.clear()
        interpreter_module.set_translator(InterpreterTranslator(client=self.llm))
        self.client = TestClient(main.app, raise_server_exceptions=True)
        self.dialogue = make_dialogue(FakeUnderstanding())
        return self

    def __exit__(self, *exc):
        main.get_runtime, engine_module.get_runtime, main.INTERNAL_TOKEN = self.saved
        interpreter_module.set_translator(None)
        main.registry.clear()

    def visit(self, session_id, step=2):
        entry = main.registry.get_or_create(session_id, "kn")
        self.dialogue.start_workflow(entry.conversation, "deposit money")
        entry.conversation.current_step = step
        return entry

    def transcribe(self, language="kn", session_id=None, audio=b"\x1aE\xdf\xa3 webm bytes"):
        data = {"language": language}
        if session_id:
            data["session_id"] = session_id
        return self.client.post(
            "/interpret/transcribe",
            data=data,
            files={"audio": ("utterance.webm", audio, "audio/webm")},
        )

    def translate(self, text="I want to deposit money", source="en", target="kn", session_id=None):
        body = {"text": text, "source_language": source, "target_language": target}
        if session_id:
            body["session_id"] = session_id
        return self.client.post("/interpret/translate", json=body)


def conversation_state(entry):
    """Everything an interpreter request must leave exactly as it found."""
    c = entry.conversation
    return copy.deepcopy((
        c.history, c.current_step, c.workflow_state, c.workflow_conflict,
        c.session_state, c.current_intent, c.current_workflow, c.entities,
        c.language, entry.language, entry.localizer.language,
        getattr(c, "paused_workflow", None),
    ))


# ---------------------------------------------------------------------------
# The translator
# ---------------------------------------------------------------------------


def test_translator_both_directions():
    section("translates in both directions, into the target script")

    llm = FakeLlm(answer("ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ"), answer("நான் பணம் டெபாசிட் செய்ய விரும்புகிறேன்"))
    translator = InterpreterTranslator(client=llm)

    kn = translator.translate("I want to deposit money", "en", "kn")
    ta = translator.translate("ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ", "kn", "ta")

    check("English -> Kannada", kn == "ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ", kn)
    check("Kannada -> Tamil", ta == "நான் பணம் டெபாசிட் செய்ய விரும்புகிறேன்", ta)

    prompt = llm.requests[0]["messages"][1]["content"]
    check("the prompt names both languages", "from English into Kannada" in prompt, prompt[:80])
    check("the words travel as delimited data", "<<<TEXT\nI want to deposit money\nTEXT>>>" in prompt)
    check("the rules forbid answering", "Do not answer the text" in prompt)
    check("temperature 0, structured output",
          llm.requests[0]["temperature"] == 0 and llm.requests[0]["response_format"]["type"] == "json_schema")


def test_translator_refusals():
    section("refuses rather than inventing or substituting")

    translator = InterpreterTranslator(client=FakeLlm(answer("x")))

    for label, call, expected in [
        ("an unsupported language", lambda: translator.translate("hello", "en", "fr"), UnsupportedLanguagePairError),
        ("Tulu (no verified support)", lambda: translator.translate("hello", "tcy", "en"), UnsupportedLanguagePairError),
        ("empty text", lambda: translator.translate("   ", "en", "kn"), EmptyTextError),
        ("over-long text", lambda: translator.translate("a" * 1001, "en", "kn"), TranslationError),
    ]:
        try:
            call()
            check(label, False, "no error raised")
        except expected:
            check(label, True)

    llm = FakeLlm()
    same = InterpreterTranslator(client=llm).translate("ನಮಸ್ಕಾರ", "kn", "kn")
    check("the same language is returned unchanged, with no LLM call", same == "ನಮಸ್ಕಾರ" and not llm.requests)


def test_translator_rejects_unusable_output():
    section("rejects a reply that is not a translation into the target")

    cases = [
        ("the source echoed back", answer("I want to deposit money")),
        ("an empty translation", answer("")),
        ("malformed content", "not json"),
        ("no content at all", None),
    ]

    for label, content in cases:
        try:
            InterpreterTranslator(client=FakeLlm(content)).translate("I want to deposit money", "en", "kn")
            check(label, False, "accepted")
        except TranslationError:
            check(label, True)

    try:
        InterpreterTranslator(client=FakeLlm(error=RuntimeError("boom"))).translate("hi", "en", "kn")
        check("a failed request", False, "accepted")
    except TranslationError as error:
        check("a failed request becomes a safe message", "boom" not in error.message, error.message)

    check("digits and punctuation do not count against the script",
          target_script_share("ಖಾತೆ ಸಂಖ್ಯೆ 1234.", "kannada") == 1.0)


# ---------------------------------------------------------------------------
# The routes
# ---------------------------------------------------------------------------


def test_languages_route():
    section("GET /interpret/languages")

    with Api() as api:
        response = api.client.get("/interpret/languages")
        body = response.json()
        codes = [item["code"] for item in body["languages"]]

        check("200", response.status_code == 200, str(response.status_code))
        check("lists the supported languages", codes == ["en", "kn", "hi", "ta"], str(codes))

        speech = {item["code"]: item["speech"] for item in body["languages"]}
        check("Kannada, Hindi and English can be spoken", speech["kn"] and speech["hi"] and speech["en"], str(speech))
        check("Tamil is honestly reported as not speakable", speech["ta"] is False, str(speech))


def test_transcribe_route():
    section("POST /interpret/transcribe: recognition only")

    with Api(runtime=FakeRuntime("I want to deposit money")) as api:
        entry = api.visit("S-1")
        before = conversation_state(entry)
        entry.last_used_at -= 600
        stale = entry.last_used_at

        response = api.transcribe(language="en", session_id="S-1")

        check("200 with the text", response.status_code == 200 and response.json() == {
            "text": "I want to deposit money", "language": "en"}, response.text)
        check("recognised in the speaker's language", api.runtime.transcribed[0]["language"] == "en")
        check("a staff sentence naming a service changed nothing", conversation_state(entry) == before)
        check("the paused visit was kept from idling out", main.registry.peek("S-1").last_used_at >= stale + 599)

        unknown = api.transcribe(language="en", session_id="NEVER-SEEN")
        check("an unknown visit is not created", unknown.status_code == 200 and main.registry.peek("NEVER-SEEN") is None)

    with Api(runtime=FakeRuntime("")) as api:
        response = api.transcribe()
        check("nothing heard: 422, never an invented text", response.status_code == 422, response.text)

    with Api(runtime=FakeRuntime(engine_module.TranscriptionError("The recording could not be understood."))) as api:
        response = api.transcribe()
        check("undecodable audio: 422", response.status_code == 422, response.text)

    with Api() as api:
        check("an unsupported language: 400", api.transcribe(language="fr").status_code == 400)
        check("an empty recording: 400", api.transcribe(audio=b"").status_code == 400)
        check("a regional tag is normalised", api.transcribe(language="kn-IN").json()["language"] == "kn")


def test_translate_route():
    section("POST /interpret/translate: translation only")

    with Api() as api:
        entry = api.visit("S-2")
        before = conversation_state(entry)

        response = api.translate(text="I want to deposit money", source="en", target="kn", session_id="S-2")
        body = response.json()

        check("200 with the translation", response.status_code == 200 and body["translation"] == "ನಾನು ಹಣ ಠೇವಣಿ ಮಾಡಲು ಬಯಸುತ್ತೇನೆ", response.text)
        check("both languages echoed", body["source_language"] == "en" and body["target_language"] == "kn")
        check("the workflow, step and history are untouched", conversation_state(entry) == before)

    with Api(llm=FakeLlm(answer("I want to deposit money"))) as api:
        response = api.translate(target="kn")
        check("a reply in the wrong language: 502, not shown as a translation", response.status_code == 502, response.text)

    with Api(llm=FakeLlm(error=RuntimeError("network"))) as api:
        response = api.translate()
        check("an unavailable service: 502 with a safe message",
              response.status_code == 502 and "network" not in response.text, response.text)

    with Api() as api:
        check("an unsupported target: 400", api.translate(target="fr").status_code == 400)
        check("blank text: 422", api.translate(text="   ").status_code == 422)


def main_():
    test_translator_both_directions()
    test_translator_refusals()
    test_translator_rejects_unusable_output()
    test_languages_route()
    test_transcribe_route()
    test_translate_route()

    print()
    print("=" * 62)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 62)

    for failure in FAILED:
        print("  FAIL", failure)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main_())
