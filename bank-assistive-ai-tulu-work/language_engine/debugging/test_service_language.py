"""
M2 -- SESSION LANGUAGE AS THE SINGLE SOURCE OF TRUTH

Regression tests for the effective session language inside the engine
service.

THE DEFECT

NestJS re-reads a visit's language on every request and sends it with each
turn and each /tts call; a profile change updates the active visit. The
engine, though, fixed a session's language when the session was first seen.
After a switch, speech recognition still used the OLD language, replies were
still rendered in the OLD language, and only TTS -- which takes the language
straight from NestJS -- spoke the new one.

WHAT IS REAL HERE

Real: the FastAPI handlers (service.main.text_turn / audio_turn / speak),
SessionRegistry, ResponseLocalizer, ConversationManager, WorkflowLoader, the
ASR RoutingSpeechRecognizer and SpeechToText, EngineRuntime.transcribe,
service.tts.synthesize and select_voice.

Stand-ins: the ASR providers (no Whisper / IndicConformer model is loaded),
the Edge TTS network call, and EngineRuntime.run_turn (which needs the
embedding model and the LLM). The stand-in run_turn records the language it
was given and renders a fixed sentence through the session's REAL localizer.

Offline: no model, no network, no LLM.

Run from language_engine/:

    python -m debugging.test_service_language
"""

import asyncio
import io
import sys
import threading

from fastapi import HTTPException
from starlette.datastructures import UploadFile

from app.conversation.state import WorkflowState
from app.speech.asr.base import SpeechRecognitionResult, SpeechRecognizer
from app.speech.asr.factory import DEFAULT_LANGUAGE_PROVIDERS, RoutingSpeechRecognizer
from app.speech.asr.indic_conformer_provider import DEFAULT_MODELS
from app.speech.asr.whisper_provider import WHISPER_LANGUAGES
from app.speech.stt import SpeechToText
from app.workflow.loader import WorkflowLoader
import service.engine as engine_module
import service.main as main
import service.tts as tts
from service.engine import EngineRuntime, TurnResult
from service.language import normalise_language
from service.models import TextTurnRequest, TtsRequest


PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


#: The engine's own voice map, as test_service_tts uses it. Importing
#: app.speech.tts would pull in pygame for nothing.
VOICES = {"en": "en-IN-NeerjaNeural", "kn": "kn-IN-SapnaNeural", "hi": "hi-IN-SwaraNeural"}

#: "Okay." is one of the localizer's fixed sentences, so the rendered reply
#: shows which language the localizer actually used.
CANONICAL = "Okay."
RENDERED = {"en": "Okay.", "kn": "ಸರಿ.", "hi": "ठीक है."}


# =========================================================
# STAND-INS
# =========================================================

class FakeRecognizer(SpeechRecognizer):
    """An ASR provider claiming exactly the languages the real one claims."""

    def __init__(self, name, languages):
        self.name = name
        self.model_name = f"fake-{name}"
        self.languages = set(languages)
        self.calls = []

    def supports_language(self, language):
        return (language or "").lower() in self.languages

    def transcribe(self, audio_path, language=None):
        self.calls.append(language)
        return SpeechRecognitionResult(
            text=f"heard in {language}", language=language,
            provider=self.name, model=self.model_name,
        )


class ScriptedRuntime(EngineRuntime):
    """
    EngineRuntime with the models left out.

    transcribe() is INHERITED, so the real temp-file handling, SpeechToText
    and RoutingSpeechRecognizer run. Only run_turn is scripted.
    """

    def __init__(self):  # noqa: D401 - deliberately skips model loading
        self.whisper = FakeRecognizer("whisper", WHISPER_LANGUAGES)
        self.indic = FakeRecognizer("indicconformer", DEFAULT_MODELS)
        self.router = RoutingSpeechRecognizer(
            providers={"whisper": self.whisper, "indicconformer": self.indic},
            provider_setting="auto",
            language_providers=dict(DEFAULT_LANGUAGE_PROVIDERS),
            fallback="whisper",
        )
        self.stt = SpeechToText(recognizer=self.router)
        self.dialogue = type("Dialogue", (), {"workflow_loader": WorkflowLoader()})()
        self.turns = []

    def run_turn(self, conversation, user_text, localizer=None):
        self.turns.append({
            "text": user_text,
            "localizer_language": getattr(localizer, "language", None),
            "conversation_language": conversation.language,
        })
        conversation.add_history("User", user_text)
        conversation.add_history("Assistant", CANONICAL)
        return TurnResult(reply=localizer.render(CANONICAL), canonical_reply=CANONICAL)


class Harness:
    """A fresh registry and runtime per test, restored afterwards."""

    def __enter__(self):
        self.runtime = ScriptedRuntime()
        self.saved_runtime = engine_module._runtime
        engine_module.set_runtime(self.runtime)
        main.registry.clear()

        self.voices_used = []
        self.saved_synthesize = main.synthesize
        real_synthesize = tts.synthesize

        async def generator(text, voice, path):
            self.voices_used.append(voice)
            with open(path, "wb") as handle:
                handle.write(b"ID3fake")

        async def offline_synthesize(text, language):
            # The REAL synthesize: validation, select_voice and its refusal.
            return await real_synthesize(
                text, language, generator=generator, voices=VOICES, sanitizer=lambda t: t,
            )

        main.synthesize = offline_synthesize
        return self

    def __exit__(self, *exc):
        main.synthesize = self.saved_synthesize
        engine_module.set_runtime(self.saved_runtime)
        main.registry.clear()
        return False

    # --- the three endpoints, called exactly as FastAPI calls them

    def text(self, session_id, language, text="hello"):
        return main.text_turn(TextTurnRequest(session_id=session_id, language=language, text=text))

    def audio(self, session_id, language):
        upload = UploadFile(file=io.BytesIO(b"RIFF-not-really-audio"), filename="utterance.wav")
        return asyncio.run(main.audio_turn(session_id=session_id, language=language, audio=upload))

    def speak(self, language, text="ಸರಿ."):
        return asyncio.run(main.speak(TtsRequest(text=text, language=language)))

    def entry(self, session_id):
        return main.registry.peek(session_id)


def put_in_deposit_step_two(entry):
    """An in-progress deposit with an entity and some history."""
    conversation = entry.conversation
    conversation.set_intent("deposit money")
    conversation.load_workflow("deposit money")
    conversation.current_step = 2
    conversation.entities = {"amount": 5000}


def snapshot(entry):
    c = entry.conversation
    return {
        "state": c.workflow_state,
        "workflow": c.current_workflow,
        "intent": c.current_intent,
        "step": c.current_step,
        "entities": dict(c.entities),
        "history": list(c.history),
    }


# =========================================================
# SWITCHING LANGUAGE WITHIN ONE SESSION
# =========================================================

def test_english_to_kannada():
    with Harness() as h:
        first = h.text("S-EN-KN", "en")
        check("the first turn replies in English", first.reply == RENDERED["en"], first.reply)

        second = h.text("S-EN-KN", "kn")
        entry = h.entry("S-EN-KN")
        check("after the switch the reply is Kannada", second.reply == RENDERED["kn"], second.reply)
        check("the entry language is kn", entry.language == "kn")
        check("the localizer language is kn", entry.localizer.language == "kn")
        check("the conversation language is kn", entry.conversation.language == "kn")
        check("the turn ran with the kn localizer", h.runtime.turns[-1]["localizer_language"] == "kn")
        check("still one session, not two", len(main.registry) == 1)


def test_kannada_to_hindi_by_voice():
    with Harness() as h:
        h.audio("S-KN-HI", "kn")
        check("Kannada audio went to IndicConformer as kn",
              h.runtime.indic.calls == ["kn"], str(h.runtime.indic.calls))

        reply = h.audio("S-KN-HI", "hi")
        entry = h.entry("S-KN-HI")
        check("after the switch the audio is transcribed as hi",
              h.runtime.indic.calls == ["kn", "hi"], str(h.runtime.indic.calls))
        check("the transcript is the hi recognition", reply.transcript == "heard in hi", reply.transcript)
        check("the reply is Hindi", reply.reply == RENDERED["hi"], reply.reply)
        check("entry, localizer and conversation all say hi",
              (entry.language, entry.localizer.language, entry.conversation.language) == ("hi", "hi", "hi"))
        check("Whisper was never asked", h.runtime.whisper.calls == [])


def test_switch_back_and_forth():
    with Harness() as h:
        replies = [h.text("S-ROUND", lang).reply for lang in ("en", "kn", "hi", "kn", "en")]
        check("each turn replies in its own language",
              replies == [RENDERED[l] for l in ("en", "kn", "hi", "kn", "en")], str(replies))


def test_text_and_voice_share_one_language():
    with Harness() as h:
        h.text("S-MIX", "en")
        h.audio("S-MIX", "kn")
        reply = h.text("S-MIX", "kn")
        check("a typed turn after a Kannada voice turn replies in Kannada", reply.reply == RENDERED["kn"])
        check("the voice turn used IndicConformer for kn", h.runtime.indic.calls == ["kn"])


# =========================================================
# NO CHANGE
# =========================================================

def test_repeated_requests_in_the_same_language():
    with Harness() as h:
        h.text("S-SAME", "kn")
        entry = h.entry("S-SAME")
        localizer = entry.localizer
        conversation = entry.conversation

        for _ in range(3):
            reply = h.text("S-SAME", "kn")
            check("a repeated kn turn replies in Kannada", reply.reply == RENDERED["kn"])

        check("the same localizer object is kept", h.entry("S-SAME").localizer is localizer)
        check("the same conversation object is kept", h.entry("S-SAME").conversation is conversation)
        check("apply_language reports no change", entry.apply_language("kn") is False)


def test_existing_session_that_never_changes():
    with Harness() as h:
        h.text("S-STEADY", "hi")
        put_in_deposit_step_two(h.entry("S-STEADY"))
        before = snapshot(h.entry("S-STEADY"))

        h.text("S-STEADY", "hi")
        after = snapshot(h.entry("S-STEADY"))
        check("workflow state, step and entities are untouched",
              {k: after[k] for k in ("state", "workflow", "step", "entities")}
              == {k: before[k] for k in ("state", "workflow", "step", "entities")})
        check("the language is still hi", h.entry("S-STEADY").language == "hi")


def test_callers_without_a_language_change_nothing():
    # in_turn(entry) as written before M2: the language must stay put.
    registry = main.registry
    registry.clear()
    entry = registry.get_or_create("S-OLD-CALLER", "kn")
    with registry.in_turn(entry):
        pass
    check("in_turn without a language leaves it", entry.language == "kn" and entry.localizer.language == "kn")

    again = registry.get_or_create("S-OLD-CALLER", "hi")
    check("get_or_create on an existing session does not switch it by itself",
          again is entry and entry.language == "kn")
    registry.clear()


# =========================================================
# CONTINUITY ACROSS A SWITCH
# =========================================================

def test_workflow_and_state_survive_a_switch():
    with Harness() as h:
        h.text("S-FLOW", "en")
        entry = h.entry("S-FLOW")
        put_in_deposit_step_two(entry)
        before = snapshot(entry)

        reply = h.text("S-FLOW", "kn")
        after = snapshot(entry)

        check("still ACTIVE", after["state"] == WorkflowState.ACTIVE)
        check("same workflow", after["workflow"] == before["workflow"] == "deposit money")
        check("same intent", after["intent"] == before["intent"])
        check("same step", after["step"] == before["step"] == 2)
        check("entities carried over", after["entities"] == {"amount": 5000})
        check("history kept and extended, never reset",
              after["history"][:len(before["history"])] == before["history"]
              and len(after["history"]) == len(before["history"]) + 2)
        check("the snapshot still reports deposit step 2 of 4",
              (reply.workflow.name, reply.workflow.step, reply.workflow.total_steps)
              == ("deposit money", 2, 4), str(reply.workflow))


def test_history_stays_canonical_english():
    with Harness() as h:
        h.text("S-HIST", "en")
        h.text("S-HIST", "kn")
        texts = [m["message"] for m in h.entry("S-HIST").conversation.history
                 if m["speaker"] == "Assistant"]
        check("assistant history holds the canonical English reply in both languages",
              texts == [CANONICAL, CANONICAL], str(texts))


def test_replay_after_a_switch_uses_the_new_language():
    with Harness() as h:
        h.text("S-REPLAY", "en")
        entry = h.entry("S-REPLAY")
        # The switch itself, as the next turn applies it.
        with main.registry.in_turn(entry, "hi"):
            replay = entry.localizer.replay()
        check("the remembered reply is replayed in Hindi", replay == RENDERED["hi"], str(replay))
        check("the remembered canonical reply is unchanged", entry.localizer.last_canonical == CANONICAL)


# =========================================================
# ONE EFFECTIVE LANGUAGE EVERYWHERE
# =========================================================

def test_asr_localizer_and_voice_agree():
    expected_provider = {"en": "whisper", "kn": "indicconformer", "hi": "indicconformer"}

    for sent in ("en", "kn", "hi", "KN-IN", "hi-IN", " EN "):
        with Harness() as h:
            reply = h.audio("S-AGREE", sent)
            entry = h.entry("S-AGREE")
            effective = normalise_language(sent)
            asr_language = h.runtime.stt.last_result.language
            provider = h.runtime.stt.last_result.provider

            # The reply THIS session produced. Until M8 this read a fixed
            # Kannada word in every session and expected the session's
            # voice; since M8 the voice follows the text's script, so the
            # agreement is checked on the session's own rendered reply.
            response = h.speak(sent, text=reply.reply)
            voice = h.voices_used[-1]

            check(f"{sent!r}: entry, localizer, conversation and ASR all use {effective!r}",
                  (entry.language, entry.localizer.language, entry.conversation.language, asr_language)
                  == (effective,) * 4,
                  f"{(entry.language, entry.localizer.language, entry.conversation.language, asr_language)}")
            check(f"{sent!r}: ASR routed to {expected_provider[effective]}",
                  provider == expected_provider[effective], provider)
            check(f"{sent!r}: the reply is rendered in {effective}", reply.reply == RENDERED[effective])
            check(f"{sent!r}: TTS picked the {effective} voice", voice == VOICES[effective], voice)
            check(f"{sent!r}: TTS answered with audio", response.status_code == 200)


def test_one_normalisation_rule():
    cases = {"en": "en", "EN": "en", "en-IN": "en", "KN-IN": "kn", " hi ": "hi", "": "en", None: "en",
             "fr": "fr", "tcy": "tcy"}
    for raw, expected in cases.items():
        check(f"normalise_language({raw!r}) == {expected!r}", normalise_language(raw) == expected)
    check("service.tts uses the shared definition", tts.normalise_language is normalise_language)


def test_a_running_turn_never_changes_language_halfway():
    registry = main.registry
    registry.clear()
    entry = registry.get_or_create("S-RACE", "en")

    inside = threading.Event()
    release = threading.Event()
    seen = {}

    def long_turn():
        with registry.in_turn(entry, "en"):
            inside.set()
            release.wait(5)
            seen["language_at_end_of_turn"] = entry.language

    def switching_turn():
        inside.wait(5)
        with registry.in_turn(entry, "kn"):
            seen["language_in_next_turn"] = entry.language

    first = threading.Thread(target=long_turn)
    second = threading.Thread(target=switching_turn)
    first.start()
    second.start()
    inside.wait(5)
    check("the switch waits for the running turn", "language_in_next_turn" not in seen)
    release.set()
    first.join(5)
    second.join(5)

    check("the running turn kept its language to the end", seen.get("language_at_end_of_turn") == "en")
    check("the next turn ran in the new language", seen.get("language_in_next_turn") == "kn")
    registry.clear()


# =========================================================
# UNSUPPORTED LANGUAGES: EXPLICIT HANDLING PRESERVED
# =========================================================

def test_unsupported_language_is_refused_where_it_was_before():
    with Harness() as h:
        h.text("S-FR", "en")
        entry = h.entry("S-FR")
        put_in_deposit_step_two(entry)
        before = snapshot(entry)

        reply = h.text("S-FR", "fr")
        check("the localizer leaves the reply in English, as before", reply.reply == CANONICAL)
        check("the localizer reports it did not translate", entry.localizer.last_translated is False)

        try:
            h.audio("S-FR", "fr")
            check("speech recognition refuses fr", False, "no error")
        except HTTPException as error:
            check("speech recognition refuses fr with 422", error.status_code == 422, str(error.status_code))
        check("no ASR provider was asked to guess",
              h.runtime.whisper.calls == [] and h.runtime.indic.calls == [])

        try:
            h.speak("fr")
            check("TTS refuses fr", False, "no error")
        except HTTPException as error:
            check("TTS refuses fr with 400", error.status_code == 400, str(error.status_code))
        check("no voice was used for fr", h.voices_used == [])

        after = snapshot(entry)
        check("the workflow survived the unsupported turns",
              {k: after[k] for k in ("state", "workflow", "step", "entities")}
              == {k: before[k] for k in ("state", "workflow", "step", "entities")})

        back = h.text("S-FR", "kn")
        check("switching back to a supported language works", back.reply == RENDERED["kn"])
        check("and the workflow is still at step 2", entry.conversation.current_step == 2)


def main_():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M2 SESSION LANGUAGE TESTS")
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
