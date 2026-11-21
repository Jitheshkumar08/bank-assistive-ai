"""HTTP interface of the Tulu language capability (additive, under /tulu).

Banking and College normally need none of these: a visit whose language is
"tcy" already gets Tulu through /turn, /turn/audio and /tts. These routes
expose each stage separately for testing, demonstration and integration.

    GET  /tulu/capabilities   what is verified, what is not, and why
    POST /tulu/normalize      script / language label / Kannada-script form
    POST /tulu/understand     verified-utterance match, intent, English pivot
    POST /tulu/translate      English workflow text -> verified Tulu (mapping)
    POST /tulu/tts            Tulu text -> NEWLY SYNTHESIZED audio (audio/mpeg)
    POST /tulu/asr            Tulu recording -> recognised verified utterance

Errors use the same shape as /tts: {"detail": <customer-safe>, "error": <category>}.
Model internals are not exposed beyond a voice id and a disclosure string.
"""

from __future__ import annotations

import os
import tempfile
from typing import Literal, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.tulu.data.dataset import customer_utterances, dataset_names, load_dataset
from app.tulu.intent.matcher import understand
from app.tulu.normalization.text import classify_text, matching_key, normalize_display, roman_to_kannada
from app.tulu.translation import renderer
from app.tulu.tts.synthesizer import DISCLOSURE, VOICE_ID, TuluSpeechSynthesizer, TuluTtsError

router = APIRouter(prefix="/tulu", tags=["tulu"])

MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))

_synthesizer = TuluSpeechSynthesizer()


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class TranslateIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source_language: Literal["en"] = "en"
    script: Literal["kannada", "roman"] = "kannada"


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: Literal["tcy"] = "tcy"
    voice: Literal["default"] = "default"
    format: Literal["mp3"] = "mp3"
    #: True: every Latin-script sentence is Romanized Tulu. False: only
    #: sentences with verified Tulu evidence are; the rest is read in English.
    assume_tulu: bool = True


def _error(code: int, detail: str, category: str):
    return JSONResponse(status_code=code, content={"detail": detail, "error": category})


@router.get("/capabilities")
def capabilities() -> dict:
    return {
        "language": "tcy",
        "supported_intents": {"deposit": "deposit money", "withdraw": "withdraw money"},
        "supported_controls": {"REPEAT_STEP": "repeat", "PAUSE_WORKFLOW": "pause",
                               "STOP_REQUEST": "1st stop cancels the request at once; 2nd stop ends the conversation",
                               "CLARIFY_CURRENT_STEP": "help", "NEXT_STEP": "next",
                               "RESUME_WORKFLOW": "resume"},
        "controls_without_tulu_data": ["PREVIOUS_STEP"],
        "workflow_step_coverage": renderer.coverage(),
        "workflows_without_verified_tulu": ["apply for loan", "check account balance", "open new account"],
        "input": "Romanized Tulu (authoritative) or Kannada-script Tulu",
        "understanding": f"closed-set matching against {len(customer_utterances())} verified customer utterances "
                         "+ verified verb cues, ambiguity rejection; not a trained Tulu NLU model",
        "translation": "mapping-based from verified native-speaker sentences; not neural MT",
        "speech_synthesis": {"voice_id": VOICE_ID, "disclosure": DISCLOSURE},
        "speech_recognition": "existing Kannada acoustic model + closed-set matching; refuses when unsure",
        "discrepancies": {name: [{"id": d["id"], "status": d["status"]}
                                 for d in load_dataset(name)["discrepancies"]]
                          for name in dataset_names()},
    }


@router.post("/normalize")
def normalize(body: TextIn) -> dict:
    display = normalize_display(body.text)
    label = classify_text(display)
    return {
        "display": display,
        "classification": label,
        "matching_key": matching_key(display),
        "kannada_script": roman_to_kannada(display) if label["script"] == "latin" else None,
        "kannada_script_status": "machine transliteration pending native-speaker review",
    }


@router.post("/understand")
def understand_text(body: TextIn) -> dict:
    return understand(body.text).as_dict()


@router.post("/translate")
def translate(body: TranslateIn) -> dict:
    rendered, state = renderer.render(body.text, script=body.script)
    return {"text": rendered, "status": state, "method": "verified mapping",
            "target_language": "tcy", "script": body.script}


@router.post("/tts")
async def tts(body: TtsIn):
    try:
        result = await _synthesizer.synthesize(body.text, assume_tulu=body.assume_tulu)
    except TuluTtsError as error:
        code = status.HTTP_400_BAD_REQUEST if error.category in ("empty_text", "text_too_long") \
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        return _error(code, str(error), error.category)
    return Response(
        content=result.audio,
        media_type=result.content_type,
        headers={
            "Cache-Control": "no-store",
            "X-Tulu-Voice": result.voice_id,
            "X-Tulu-Disclosure": result.disclosure,
            "X-Tulu-Generated": "true",
        },
    )


@router.post("/asr")
async def asr(audio: UploadFile = File(...)) -> dict:
    payload = await audio.read()
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The recording was empty.")
    if len(payload) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That recording is too long.")
    from app.tulu.asr.recognizer import get_recognizer

    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    handle, path = tempfile.mkstemp(suffix=suffix, prefix="tulu-asr-")
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(payload)
        return get_recognizer().recognize(path).as_dict()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
