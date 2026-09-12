"""
FastAPI wrapper around the existing engine.

This is an internal service. NestJS is the public boundary: it
authenticates the customer, confirms the visit belongs to them, and only
then calls here. Nothing in this file re-checks who the customer is,
which is exactly why it must not be exposed to a browser.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse, Response

from app.conversation.manager import ConversationManager
from service import LOADED_ENV_NAMES
from service.config import DEFAULT_ENV_PATH, describe
from service.engine import TranscriptionError, get_runtime
from service.models import HealthResponse, TextTurnRequest, TtsRequest, TurnResponse, WorkflowSnapshot
from service.tts import TtsError, UnsupportedLanguageError, synthesize
from service.registry import SessionRegistry

logger = logging.getLogger("assistant-service")

# uvicorn configures its own loggers and leaves the root logger without a
# handler, so without this the service's startup lines are discarded and
# a run that failed halfway looks identical to one that never started.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")

#: Matches the limit NestJS enforces. Checked here too, because a limit
#: that only exists at one hop stops existing the moment anything else
#: calls this service.
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))

#: Shared secret with NestJS. Optional so local development stays simple,
#: but strongly recommended anywhere the port is reachable.
INTERNAL_TOKEN = os.getenv("AI_ENGINE_TOKEN", "").strip()

registry = SessionRegistry()


def require_internal_token(x_internal_token: Optional[str] = Header(default=None)) -> None:
    if not INTERNAL_TOKEN:
        return

    if x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authorised.")


def require_llm_key() -> None:
    """
    Stops with an actionable message when the Groq key is absent.

    The engine raises its own error deep inside model loading -- "GROQ_API_KEY
    environment variable is not set" -- which is accurate but says nothing
    about where to put it. Checking here costs nothing and names the file.
    """
    if os.getenv("GROQ_API_KEY", "").strip():
        return

    raise RuntimeError(
        "GROQ_API_KEY is not set, so the assistant cannot start. "
        f"Put it in {DEFAULT_ENV_PATH} as GROQ_API_KEY=your-key, "
        "or export it in the shell before starting the service. "
        "A key is issued at https://console.groq.com/keys"
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Names only. The values are secrets and are never logged.
    logger.info("Loaded from %s: %s", DEFAULT_ENV_PATH.name, describe(LOADED_ENV_NAMES))
    require_llm_key()

    # Whisper and two sentence-transformer encoders load here, once.
    # Doing it per request would make every turn take tens of seconds.
    logger.info("Loading engine models...")
    get_runtime()
    logger.info("Engine ready.")

    yield

    registry.clear()


app = FastAPI(title="Banking assistant engine", version="1.0.0", lifespan=lifespan)


def _snapshot(conversation: ConversationManager) -> WorkflowSnapshot:
    """Plain view of workflow progress. No engine objects cross the wire."""
    step = conversation.current_step

    return WorkflowSnapshot(
        name=conversation.current_workflow,
        state=conversation.workflow_state.value,
        step=step if step and step > 0 else None,
        total_steps=None,
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    # Deliberately does not construct the runtime: a health check should
    # not be what triggers a multi-second model load.
    from service import engine as engine_module

    return HealthResponse(
        status="ok",
        models_loaded=engine_module._runtime is not None,
        active_sessions=len(registry),
    )


@app.post("/turn", response_model=TurnResponse, dependencies=[Depends(require_internal_token)])
def text_turn(request: TextTurnRequest) -> TurnResponse:
    """A typed message. The same pipeline speech ends up in."""
    entry = registry.get_or_create(request.session_id, request.language)
    runtime = get_runtime()

    # Serialised per session: two turns for one visit must not interleave
    # halfway through a workflow step.
    with entry.lock:
        result = runtime.run_turn(entry.conversation, request.text)

        return TurnResponse(
            reply=result.reply,
            workflow=_snapshot(entry.conversation),
            ended=result.ended,
        )


@app.post(
    "/turn/audio",
    response_model=TurnResponse,
    dependencies=[Depends(require_internal_token)],
)
async def audio_turn(
    session_id: str = Form(...),
    language: str = Form("en"),
    audio: UploadFile = File(...),
) -> TurnResponse:
    """
    A spoken message.

    Speech becomes text and then takes exactly the same path a typed
    message takes. There is no separate voice pipeline, no second intent
    detector and no second dialogue manager.
    """
    payload = await audio.read()

    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The recording was empty.")

    if len(payload) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That recording is too long.",
        )

    entry = registry.get_or_create(session_id, language)
    runtime = get_runtime()

    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"

    with entry.lock:
        try:
            # The recording is transcribed and discarded. It is never
            # stored, and its contents are never logged.
            transcript = runtime.transcribe(payload, language=entry.language, suffix=suffix)
        except TranscriptionError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error

        if not transcript:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="I could not hear anything in that recording.",
            )

        result = runtime.run_turn(entry.conversation, transcript)

        return TurnResponse(
            reply=result.reply,
            transcript=transcript,
            workflow=_snapshot(entry.conversation),
            ended=result.ended,
        )


@app.post("/tts", dependencies=[Depends(require_internal_token)])
async def speak(request: TtsRequest) -> Response:
    """
    Reads a reply aloud.

    Stateless by design: text and an authoritative language in, audio
    out. It never touches a ConversationManager, so speech can never
    disturb a customer's workflow state.

    The audio is returned as bytes for the browser to play. Nothing is
    stored, and the text being spoken is not logged.
    """
    try:
        audio, content_type = await synthesize(request.text, request.language)
    except UnsupportedLanguageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except TtsError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error

    return Response(
        content=audio,
        media_type=content_type,
        # Generated per request and never reused; caching it would keep
        # a customer's reply sitting in a browser cache.
        headers={"Cache-Control": "no-store"},
    )


@app.delete("/sessions/{session_id}", dependencies=[Depends(require_internal_token)])
def end_session(session_id: str) -> JSONResponse:
    """Frees a visit's conversation when the customer signs out."""
    removed = registry.remove(session_id)

    return JSONResponse({"removed": removed})


@app.exception_handler(Exception)
async def unhandled(_request, error: Exception) -> JSONResponse:
    # Tracebacks, file paths and engine internals stop here. NestJS turns
    # this into its own error shape for the browser.
    logger.exception("Unhandled error in assistant service: %s", type(error).__name__)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "The assistant is temporarily unavailable."},
    )
