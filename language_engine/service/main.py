"""
FastAPI wrapper around the existing engine.

This is an internal service. NestJS is the public boundary: it
authenticates the customer, confirms the visit belongs to them, and only
then calls here. Nothing in this file re-checks who the customer is,
which is exactly why it must not be exposed to a browser.
"""

from __future__ import annotations

import dataclasses
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Path, Request, UploadFile, status
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from app.conversation.manager import ConversationManager
from service import LOADED_ENV_NAMES
from service.config import DEFAULT_ENV_PATH, describe
from service.domain_runtime import register_builtin_domain_runtimes
from service.domains import (
    Caller,
    DEVELOPMENT,
    DomainAuth,
    DomainError,
    DomainUnavailable,
    ExpiredWorkflowAction,
    InvalidContext,
    InvalidWorkflowResult,
    MismatchedWorkflowAction,
    NoPendingWorkflowAction,
    bound_context,
    engine_environment,
    validate_context,
)
from service.engine import (
    DomainRuntimeUnavailable,
    EngineRuntime,
    TranscriptionError,
    TurnResult,
    domain_runtime_status,
    get_domain_runtime,
    get_runtime,
)
from service.housekeeping import IdleSessionReaper, idle_timeout_from_env, purge_interval_from_env
from service.assistance import offer_assistance
from service import interpreter
from service.language import normalise_language
from app.translation.interpreter_translator import (
    EmptyTextError,
    INTERPRETER_LANGUAGES,
    InterpreterTranslationError,
    UnsupportedLanguagePairError,
    language_name,
)
from service.models import (
    AssistanceRequest,
    AssistanceResponse,
    HealthResponse,
    InterpreterLanguagesResponse,
    InterpreterTranscriptResponse,
    InterpreterTranslateRequest,
    InterpreterTranslateResponse,
    SessionSnapshotResponse,
    TextTurnRequest,
    TtsRequest,
    TurnResponse,
    WorkflowResultRequest,
    WorkflowSnapshot,
)
from service.snapshot import workflow_snapshot
from app.domains import domain_ids, get_domain
from app.workflow.domain_runner import ActionExpired, ActionTypeMismatch, NoPendingAction, UnknownOutcome
from app.workflow.loader import WorkflowLoader
from service.tts import TtsError, UnsupportedLanguageError, synthesize
from service.tts import request_id as tts_request_id
from service.registry import SessionRegistry
from app.tulu import TULU
from app.tulu.intent.matcher import understand as understand_tulu
from app.tulu.translation.renderer import control_acknowledgements as tulu_control_acknowledgements
from app.tulu.translation.renderer import render as tulu_render
from app.tulu.data.dataset import CONTROL_REPLY_PLAN as TULU_CONTROL_REPLY_PLAN
from app.conversation.state import WorkflowState
from service.tulu_routes import router as tulu_router

logger = logging.getLogger("assistant-service")

# uvicorn configures its own loggers and leaves the root logger without a
# handler, so without this the service's startup lines are discarded and
# a run that failed halfway looks identical to one that never started.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")

#: Matches the limit NestJS enforces. Checked here too, because a limit
#: that only exists at one hop stops existing the moment anything else
#: calls this service.
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))

#: Shared secret with the BANKING backend (the engine's original token).
#: Optional in local development; required when AI_ENGINE_ENV=production.
INTERNAL_TOKEN = os.getenv("AI_ENGINE_TOKEN", "").strip()

#: Shared secret with the COLLEGE backend. Same rules as INTERNAL_TOKEN.
COLLEGE_TOKEN = os.getenv("AI_ENGINE_COLLEGE_TOKEN", "").strip()

#: "development" (default) or "production". Production refuses to start
#: without a distinct token for every domain (service/domains.py).
ENGINE_ENV = engine_environment()

#: The service's single in-process Banking domain id.
BANKING = "banking"

registry = SessionRegistry(idle_timeout_seconds=idle_timeout_from_env())

# Every non-Banking domain's runtime factory (Phase 4). Registration builds
# nothing; the lifespan below warms them after Banking.
register_builtin_domain_runtimes()

# Releases conversations of customers who walked away without signing
# out. Started and stopped by the lifespan below, never anywhere else.
reaper = IdleSessionReaper(registry, purge_interval_from_env())


def domain_auth() -> DomainAuth:
    """
    Token-to-domain resolution from the current configuration.

    Read from the module globals on every call (it is cheap), so a test that
    sets INTERNAL_TOKEN or COLLEGE_TOKEN is honoured exactly as before.
    """
    return DomainAuth({BANKING: INTERNAL_TOKEN, "college": COLLEGE_TOKEN}, ENGINE_ENV)


def authenticate_caller(
    x_internal_token: Optional[str] = Header(default=None),
    x_assistant_domain: Optional[str] = Header(default=None),
) -> Caller:
    """
    Every route's gate: which domain's backend is calling.

    401 for a missing or wrong token whenever any token is configured. The
    declared domain is checked when the route resolves it (Caller.resolve).
    """
    auth = domain_auth()
    return Caller(auth=auth, authenticated=auth.authenticate(x_internal_token), declared=x_assistant_domain)


def require_known_domain(caller: Caller = Depends(authenticate_caller)) -> str:
    """For routes that only need the domain checked, not used (e.g. /tts)."""
    return caller.resolve()


def require_internal_token(caller: Caller = Depends(authenticate_caller)) -> None:
    """
    The face-to-face interpreter's gate (restored Banking feature).

    The interpreter belongs to the Banking visit -- it keeps that visit alive
    and uses Banking's speech recognition -- so only the Banking backend may
    call it: its token, or no token at all in development, exactly as the
    original check allowed. Any other domain's token is refused.
    """
    if caller.resolve() != BANKING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The interpreter is not available for this assistant.",
        )


def _caller(value: object) -> Caller:
    """
    The route's Caller.

    Over HTTP FastAPI always supplies one. A route function called directly
    in-process -- as the debugging suites do -- receives the Depends marker
    instead; that call carries no headers, so it resolves like an
    unauthenticated pre-domain caller (declarations, else Banking).
    """
    if isinstance(value, Caller):
        return value

    return Caller(auth=DomainAuth({}, DEVELOPMENT), authenticated=None)


def _form_value(value: object) -> Optional[str]:
    """A form field's value; None for an absent field or a direct call's default marker."""
    return value if isinstance(value, str) and value != "" else None


def _runtime_for(domain: str) -> EngineRuntime:
    """
    The runtime that serves `domain`.

    Banking keeps going through get_runtime() exactly as before. Any other
    domain gets only its own runtime; one that is not available is refused
    with 503, never answered by Banking's.
    """
    if domain == BANKING:
        return get_runtime()

    try:
        return get_domain_runtime(domain)
    except DomainRuntimeUnavailable as error:
        raise DomainUnavailable(
            "This assistant is not available yet. Please try again later."
        ) from error


def require_maintenance_token(x_internal_token: Optional[str] = Header(default=None)) -> None:
    """
    The knowledge maintenance endpoints (Phase 3A). Unlike the customer
    endpoints these never run open: they re-index the knowledge and expose
    the gap review, which nothing in the customer flow needs. Without
    AI_ENGINE_TOKEN they are switched off.
    """
    if not INTERNAL_TOKEN:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Knowledge maintenance needs AI_ENGINE_TOKEN to be set.")

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

    # Before anything slow: a misconfigured deployment stops here.
    auth = domain_auth()
    problems = auth.startup_problems()
    if problems:
        raise RuntimeError("Engine authentication is misconfigured: " + " ".join(problems))
    if not auth.auth_enabled:
        logger.warning(
            "Engine authentication is DISABLED (AI_ENGINE_ENV=%s and no domain token set). "
            "Acceptable only on a loopback-only development machine.",
            ENGINE_ENV,
        )

    require_llm_key()

    # Whisper and two sentence-transformer encoders load here, once.
    # Doing it per request would make every turn take tens of seconds.
    logger.info("Loading engine models...")
    get_runtime()
    logger.info("Engine ready.")

    # Other domains, after Banking and independently of it: a domain that
    # fails to build is logged and answers 503 until it can be built, while
    # Banking keeps serving.
    for domain in domain_ids():
        if domain == BANKING or domain_runtime_status(domain) == "unavailable":
            continue
        try:
            get_domain_runtime(domain)
            logger.info("Domain %s ready.", domain)
        except Exception as error:  # noqa: BLE001
            logger.error("Domain %s could not be loaded (%s); it will answer 503.", domain, type(error).__name__)

    reaper.start()

    try:
        yield
    finally:
        await reaper.stop()
        registry.clear()


app = FastAPI(title="Shared assistant engine", version="1.1.0", lifespan=lifespan)

# Tulu language capability (normalize / understand / translate / speak /
# recognise). Additive routes under /tulu; no existing route changes.
app.include_router(tulu_router, dependencies=[Depends(require_known_domain)])


def _snapshot(conversation: ConversationManager, runtime: EngineRuntime) -> WorkflowSnapshot:
    """Workflow progress, totalled from the dialogue manager's own definitions."""
    return workflow_snapshot(conversation, runtime.dialogue.workflow_loader)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    # Deliberately does not construct the runtime: a health check should
    # not be what triggers a multi-second model load.
    from service import engine as engine_module

    models_loaded = engine_module._runtime is not None

    return HealthResponse(
        status="ok",
        models_loaded=models_loaded,
        active_sessions=len(registry),
        domains={
            domain: ("ready" if models_loaded else "registered")
            if domain == BANKING
            else domain_runtime_status(domain)
            for domain in domain_ids()
        },
    )


@app.exception_handler(DomainError)
async def domain_refused(_request: Request, error: DomainError) -> JSONResponse:
    """Domain, authentication and context refusals: one shape, no echoed input."""
    return JSONResponse(
        status_code=error.status_code,
        content={"detail": error.message, "error": error.code},
    )


def _run_turn(runtime: EngineRuntime, entry, text: str):
    """
    One turn on `runtime`. Domain runtimes receive the session's context
    (its fixed institution plus the latest area/location); Banking's runtime
    is called exactly as before.
    """
    if getattr(runtime, "accepts_context", False):
        context = {**entry.context, **entry.bound_context}
        return runtime.run_turn(entry.conversation, text, entry.localizer, context=context)
    if entry.language == TULU and text:
        # Banking only: the verified Tulu data is banking (deposit, withdraw).
        # The Tulu text becomes an English pivot for the SAME engine -- no
        # second intent detector, dialogue manager or workflow (app/tulu/intent).
        understood = understand_tulu(text)
        # The exit offer made by the previous turn is valid for THIS turn only.
        exit_offered, entry.tulu_exit_offered = entry.tulu_exit_offered, False
        if understood.role == "control" and understood.control == "STOP_REQUEST":
            return _tulu_stop(runtime, entry, understood, exit_offered)
        if understood.pivot_en is None:
            # Rejected (ambiguous, or too uncertain): ask again, in English (no
            # verified Tulu exists for these sentences), without touching the
            # workflow or history, and without calling the LLM.
            reply = TULU_AMBIGUOUS_REPLY if understood.method == "rejected_ambiguous" else TULU_LOW_CONFIDENCE_REPLY
            return TurnResult(reply=reply, canonical_reply=reply, outcome="clarify")
        if understood.role == "control":
            # A Tulu control phrase (repeat / pause / decline help / clarify /
            # next / continue). Its pivot is the engine's OWN deterministic
            # control word, so the existing control tier executes it -- no LLM
            # call, no new logic. The reply is then composed for the situation.
            result = runtime.run_turn(entry.conversation, understood.pivot_en, entry.localizer)
            return _compose_tulu_control_reply(runtime, entry.conversation, understood, result)
        text = understood.pivot_en
    return runtime.run_turn(entry.conversation, text, entry.localizer)


#: Asked after a Tulu "stop". English: no verified Tulu sentence exists for it.
TULU_EXIT_OFFER = "Say stop again to end the conversation."


def _tulu_stop(runtime, entry, understood, exit_offered):
    """
    Tulu "stop" (C03), team rule 2026-11-19:

      1st stop -> CANCEL the open request at once (no "are you sure?"), then
                  offer to end the conversation: C03 Tulu reply + TULU_EXIT_OFFER.
                  With no open request, only the offer is made.
      2nd stop -> right after the offer: END the conversation (the engine's
                  own session exit and farewell).

    Any other turn after the offer simply clears it. Cancelling reuses the
    engine's own cancel: "stop" is sent, and if the engine asks for its usual
    confirmation, "stop" is sent once more as that confirmation -- so state,
    history and replies stay exactly the engine's. English and Kannada
    sessions keep the engine's confirm-first cancel unchanged.
    """
    conversation = entry.conversation
    ack = tulu_control_acknowledgements().get(understood.group)

    if exit_offered:
        result = runtime.run_turn(conversation, "exit", entry.localizer)
        return dataclasses.replace(result, intent="EXIT_CONVERSATION")

    def request_open():
        return conversation.current_workflow is not None and conversation.workflow_state in (
            WorkflowState.ACTIVE, WorkflowState.SUSPENDED)

    if request_open():
        result = runtime.run_turn(conversation, "stop", entry.localizer)
        if request_open():                 # the engine asked "Say cancel to confirm ..."
            result = runtime.run_turn(conversation, "stop", entry.localizer)
        if request_open() or result.ended:
            # Not cancelled (e.g. the engine needs another answer first): its own words, no offer.
            return dataclasses.replace(result, intent=understood.control)

    reply = f"{ack.tulu_kannada} {TULU_EXIT_OFFER}" if ack else TULU_EXIT_OFFER
    entry.tulu_exit_offered = True
    return TurnResult(reply=reply, canonical_reply=reply, intent=understood.control)


def _current_instruction(runtime, conversation):
    """The active (or paused) workflow's current step instruction, or None."""
    if conversation.current_workflow is None or conversation.workflow_state not in (
        WorkflowState.ACTIVE, WorkflowState.SUSPENDED
    ):
        return None
    loader = getattr(getattr(runtime, "dialogue", None), "workflow_loader", None)
    workflow = loader.load_workflow(conversation.current_workflow) if loader else None
    steps = (workflow or {}).get("steps") or []
    step = conversation.current_step
    return steps[step - 1]["instruction"] if step and 1 <= step <= len(steps) else None


def _compose_tulu_control_reply(runtime, conversation, understood, result):
    """
    A Tulu control reply for the CURRENT situation.

    The group's dataset Tulu reply says what the assistant is doing ("I will
    say what to do next"); CONTROL_REPLY_PLAN (from each reply's English
    meaning) says what must follow it. The step comes from the conversation
    AFTER the engine acted, so "next" while paused at step 2 gives the C05
    reply plus step 2 (the engine resumes and never skips an unfinished step).
    The step is rendered in verified Tulu where one exists, else English.

    The engine's own reply is kept unchanged when there was nothing to act on
    ("There's nothing active right now.") -- a Tulu "I'll repeat it" would
    contradict it -- and when the conversation has ended.
    """
    ack = tulu_control_acknowledgements().get(understood.group)
    plan = TULU_CONTROL_REPLY_PLAN.get(understood.group)
    canonical = str(result.canonical_reply or "")
    # C03 ("stop") never reaches here: _tulu_stop() handles it.
    # The engine's two "nothing to act on" wordings: "There's nothing ..." and
    # "There's no active request right now. ..."
    nothing_to_act_on = canonical.startswith(("There's nothing", "There's no "))
    if result.ended or ack is None or plan is None or nothing_to_act_on:
        return result

    instruction = _current_instruction(runtime, conversation)
    parts = [ack.tulu_kannada]
    if plan["with_step"] and instruction is None:
        if understood.control != "REPEAT_STEP":
            return result            # e.g. "continue" with nothing active: engine's words
        parts.append(result.reply)   # repeat with no workflow: the engine repeated its last message
    elif plan["with_step"]:
        if plan["with_explanation"] and instruction in canonical:
            explanation = canonical.split(instruction, 1)[0].strip()
            if explanation:
                parts.append(explanation)   # English: no verified Tulu exists for explanations
        parts.append(tulu_render(instruction)[0])
    return dataclasses.replace(result, reply=" ".join(parts), intent=understood.control)


#: Replies to Tulu input the matcher rejected. English: there is no verified
#: Tulu rendering of either sentence.
TULU_AMBIGUOUS_REPLY = ("Sorry, I could not tell which service you need. "
                        "Please say again whether you want to deposit or withdraw money.")
TULU_LOW_CONFIDENCE_REPLY = "Sorry, I could not understand that clearly. Please say it again, or type it."


def _turn_response(result, workflow: WorkflowSnapshot, domain: str, transcript: Optional[str] = None) -> TurnResponse:
    return TurnResponse(
        reply=result.reply,
        transcript=transcript,
        workflow=workflow,
        ended=result.ended,
        domain=domain,
        intent=getattr(result, "intent", None),
        outcome=getattr(result, "outcome", None),
        sources=getattr(result, "sources", None),
        steps=getattr(result, "steps", None),
        action=getattr(result, "action", None),
    )


def _session_for(caller: Caller, session_id: str, language: str, context: Optional[dict], declared: Optional[str] = None):
    """
    Resolves the domain, validates the context and finds or creates the visit.

    Returns (domain, context, entry, runtime). The runtime is resolved before
    the visit is created, so a refused domain never leaves a session behind.
    """
    domain = caller.resolve(declared)
    checked = validate_context(domain, context)
    runtime = _runtime_for(domain)
    entry = registry.get_or_create(
        session_id, language, domain=domain, bound=bound_context(domain, checked)
    )
    # None (not {}) when the turn carried no context: keep the visit's last one.
    return domain, (checked if context else None), entry, runtime


@app.post("/turn", response_model=TurnResponse)
def text_turn(request: TextTurnRequest, caller: Caller = Depends(authenticate_caller)) -> TurnResponse:
    """A typed message. The same pipeline speech ends up in."""
    context = request.context.model_dump(exclude_none=True) if request.context else None
    caller = _caller(caller)
    if request.model_extra and caller.resolve(request.domain) != BANKING:
        # Phase 6: nothing but the defined fields is accepted from a domain
        # backend -- in particular no student data. Refused before any session.
        raise InvalidContext("The request carries fields this assistant does not accept.")
    domain, context, entry, runtime = _session_for(
        caller, request.session_id, request.language, context, request.domain
    )

    # Serialised per session: two turns for one visit must not interleave
    # halfway through a workflow step. The turn's language is applied once
    # the lock is held, so a visit whose language changed answers in the
    # new one from this turn on.
    with registry.in_turn(entry, request.language, context):
        # The visit's own localizer, so the reply leaves in the visit's
        # language while canonical English stays in history.
        result = _run_turn(runtime, entry, request.text)

        return _turn_response(result, _snapshot(entry.conversation, runtime), domain)


@app.post("/turn/audio", response_model=TurnResponse)
async def audio_turn(
    session_id: str = Form(...),
    language: str = Form("en"),
    audio: UploadFile = File(...),
    institution_id: Optional[str] = Form(None),
    branch_id: Optional[str] = Form(None),
    area: Optional[str] = Form(None),
    location_id: Optional[str] = Form(None),
    caller: Caller = Depends(authenticate_caller),
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

    context = {
        key: value
        for key, value in (
            ("institution_id", _form_value(institution_id)),
            ("branch_id", _form_value(branch_id)),
            ("area", _form_value(area)),
            ("location_id", _form_value(location_id)),
        )
        if value is not None
    }
    domain, context, entry, runtime = _session_for(_caller(caller), session_id, language, context or None)

    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"

    with registry.in_turn(entry, language, context):
        # A conversation the customer has left answers every turn with the
        # same farewell -- before transcription, so a recording sent after
        # an exit is neither transcribed nor able to fail differently.
        if runtime.has_exited(entry.conversation):
            result = _run_turn(runtime, entry, "")

            return _turn_response(result, _snapshot(entry.conversation, runtime), domain)

        try:
            # The recording is transcribed and discarded. It is never
            # stored, and its contents are never logged.
            #
            # entry.language, not the raw form field: it is the same
            # normalised value the localizer renders this turn's reply in,
            # applied by in_turn() above.
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

        result = _run_turn(runtime, entry, transcript)

        # The RAW transcript, deliberately: this is shown back as the
        # customer's own words, so it must be what was actually heard, not
        # the normalized form the router used.
        return _turn_response(result, _snapshot(entry.conversation, runtime), domain, transcript)


# ---------------------------------------------------------------------------
# Face-to-face interpreter
#
# Transcription and translation ONLY. None of these routes reaches
# run_turn(), intent detection or the dialogue manager, so an interpreted
# sentence -- "I'd like to deposit this cheque" from a member of staff --
# can never start, advance or cancel the customer's workflow. A visit's
# conversation is only touched, so it does not idle out while paused.
# ---------------------------------------------------------------------------


def _keep_visit_alive(session_id: Optional[str]) -> None:
    """Marks an existing conversation as in use. Never creates or reads one."""
    if not session_id:
        return

    entry = registry.peek(session_id)

    if entry is not None:
        registry.touch(entry)


def _interpreter_language(value: str) -> str:
    language = normalise_language(value)

    if language not in INTERPRETER_LANGUAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The interpreter does not support {language_name(language)}.",
        )

    return language


@app.get(
    "/interpret/languages",
    response_model=InterpreterLanguagesResponse,
    dependencies=[Depends(require_internal_token)],
)
def interpreter_languages() -> InterpreterLanguagesResponse:
    """The languages the interpreter offers, and which can be spoken."""
    return InterpreterLanguagesResponse(languages=interpreter.capabilities())


@app.post(
    "/interpret/transcribe",
    response_model=InterpreterTranscriptResponse,
    dependencies=[Depends(require_internal_token)],
)
async def interpreter_transcribe(
    language: str = Form(...),
    session_id: Optional[str] = Form(None),
    audio: UploadFile = File(...),
) -> InterpreterTranscriptResponse:
    """
    What one interpreter speaker said, in the language they speak.

    The same speech recognition a voice turn uses, and nothing after it:
    the text is returned, not routed. The recording is discarded and never
    logged.
    """
    spoken = _interpreter_language(language)
    payload = await audio.read()

    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The recording was empty.")

    if len(payload) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That recording is too long.",
        )

    _keep_visit_alive(session_id)

    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"

    try:
        text = get_runtime().transcribe(payload, language=spoken, suffix=suffix)
    except TranscriptionError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error

    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="I could not hear anything in that recording.",
        )

    return InterpreterTranscriptResponse(text=text, language=spoken)


@app.post(
    "/interpret/translate",
    response_model=InterpreterTranslateResponse,
    dependencies=[Depends(require_internal_token)],
)
def interpreter_translate(request: InterpreterTranslateRequest) -> InterpreterTranslateResponse:
    """
    One utterance, translated. Nothing is answered, and no conversation is read.

    400 for a language the interpreter does not offer, 422 for text that is
    empty, 502 when the translation could not be produced. The text itself is
    never logged.
    """
    source = _interpreter_language(request.source_language)
    target = _interpreter_language(request.target_language)

    _keep_visit_alive(request.session_id)

    try:
        translation = interpreter.get_translator().translate(request.text, source, target)
    except UnsupportedLanguagePairError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error.message) from error
    except EmptyTextError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error.message) from error
    except InterpreterTranslationError as error:
        logger.warning("interpreter.translate failed source=%s target=%s", source, target)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=error.message) from error

    return InterpreterTranslateResponse(
        translation=translation,
        source_language=source,
        target_language=target,
    )


#: A correlation id from the caller is used only if it looks like one.
#: Anything else -- spaces, newlines, oversize -- is replaced, so a header
#: can never forge or break a log line.
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")

#: Category for a /tts body that failed schema validation.
INVALID_REQUEST = "invalid_request"


def _correlation_id(supplied: Optional[str]) -> str:
    if supplied and _REQUEST_ID.match(supplied):
        return supplied

    return uuid.uuid4().hex


class TtsHttpError(HTTPException):
    """
    A /tts refusal: the HTTP status, the customer-safe message, a stable
    category and the request id.

    Still an HTTPException, so callers that catch one -- the debugging
    suites call speak() directly -- see exactly the status they did before.
    """

    def __init__(self, status_code: int, error: TtsError, request_id: str) -> None:
        super().__init__(
            status_code=status_code,
            detail=str(error),
            headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
        )
        self.category = error.category
        self.request_id = request_id


def _tts_body(detail: str, category: str, request_id: str) -> dict:
    """The one error shape /tts returns. `detail` stays a string for NestJS."""
    return {"detail": detail, "error": category, "request_id": request_id}


@app.exception_handler(TtsHttpError)
async def tts_refused(_request: Request, error: TtsHttpError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content=_tts_body(error.detail, error.category, error.request_id),
        headers=error.headers,
    )


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
    """
    Gives a /tts schema failure the same shape and logging as any other
    /tts refusal. Every other route keeps FastAPI's own 422 unchanged.

    Logged by field location and error type only: the rejected value is
    the reply text, and is never written to the log.
    """
    if request.url.path != "/tts":
        return await request_validation_exception_handler(request, error)

    correlation = _correlation_id(request.headers.get("x-request-id"))
    fields = ",".join(
        ".".join(str(part) for part in item.get("loc", ())) + ":" + str(item.get("type", "?"))
        for item in error.errors()
    )
    logger.warning(
        "tts.response request_id=%s status=422 category=%s fields=%s",
        correlation, INVALID_REQUEST, fields,
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_tts_body("The spoken reply request was not valid.", INVALID_REQUEST, correlation),
        headers={"X-Request-ID": correlation, "Cache-Control": "no-store"},
    )


@app.post("/tts", dependencies=[Depends(require_known_domain)])
async def speak(
    request: TtsRequest,
    x_request_id: Annotated[Optional[str], Header()] = None,
) -> Response:
    """
    Reads a reply aloud.

    Stateless by design: text and an authoritative language in, audio
    out. It never touches a ConversationManager, so speech can never
    disturb a customer's workflow state.

    The audio is returned as bytes for the browser to play. Nothing is
    stored, and the text being spoken is not logged.

    `X-Request-ID` from NestJS correlates this request's log lines with
    the caller's; it is echoed back on every response, success or not.
    """
    correlation = _correlation_id(x_request_id)
    token = tts_request_id.set(correlation)

    try:
        audio, content_type = await synthesize(request.text, request.language)
    except TtsError as error:
        code = (
            status.HTTP_400_BAD_REQUEST
            if isinstance(error, UnsupportedLanguageError)
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        logger.warning(
            "tts.response request_id=%s status=%s category=%s", correlation, code, error.category
        )
        raise TtsHttpError(code, error, correlation) from error
    finally:
        tts_request_id.reset(token)

    logger.info("tts.response request_id=%s status=200", correlation)

    return Response(
        content=audio,
        media_type=content_type,
        # Generated per request and never reused; caching it would keep
        # a customer's reply sitting in a browser cache.
        headers={"Cache-Control": "no-store", "X-Request-ID": correlation},
    )


#: How long a snapshot waits for a turn in progress before reporting busy.
SNAPSHOT_LOCK_TIMEOUT_SECONDS = 2.0

#: Reads workflow definitions only, to total the steps. Its own instance, so
#: a snapshot never constructs -- or waits on -- the model-loading runtime.
_snapshot_loader = WorkflowLoader()
_domain_snapshot_loaders: dict = {}


def _snapshot_loader_for(domain: str) -> WorkflowLoader:
    """The domain's own workflow definitions (Phase 5); Banking's as before."""
    if domain == BANKING:
        return _snapshot_loader
    loader = _domain_snapshot_loaders.get(domain)
    if loader is None:
        loader = _domain_snapshot_loaders[domain] = WorkflowLoader(get_domain(domain).workflows_dir)
    return loader


@app.get("/sessions/{session_id}/snapshot", response_model=SessionSnapshotResponse)
def session_snapshot(
    session_id: Annotated[str, Path(min_length=1, max_length=128)],
    caller: Caller = Depends(authenticate_caller),
) -> SessionSnapshotResponse:
    """
    Where a visit's conversation stands, without changing it.

    For a caller whose turn reply never arrived: the turn may still have
    been applied here, and this is how the UI learns what is true now.

    READ-ONLY BY CONSTRUCTION
    - peek(), not get_or_create(): an unknown visit is reported as unknown,
      never created, and nothing is evicted to make room.
    - No touch(): reading a visit does not keep it alive past its idle
      timeout. Only the customer's own turns do that.
    - No runtime: no speech recognition, no LLM, no intent detection, no
      dialogue routing, and not even model loading. The workflow loader
      only reads definitions, to total the steps.
    - The visit's own turn lock, held only to READ, so a snapshot is never
      a half-applied turn. If a turn is still running it answers 409 rather
      than waiting out the caller's timeout or reporting unsettled state.
    - The caller's own domain only: another domain's visit with the same id
      is reported as unknown.
    """
    domain = _caller(caller).resolve()
    entry = registry.peek(session_id, domain=domain)

    if entry is None:
        return SessionSnapshotResponse(known=False)

    if not entry.lock.acquire(timeout=SNAPSHOT_LOCK_TIMEOUT_SECONDS):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The assistant is still working on the last request.",
        )

    try:
        conversation = entry.conversation

        return SessionSnapshotResponse(
            known=True,
            ended=EngineRuntime.has_exited(conversation),
            workflow=workflow_snapshot(conversation, _snapshot_loader_for(domain)),
        )
    finally:
        entry.lock.release()


@app.post("/sessions/{session_id}/assistance", response_model=AssistanceResponse)
def session_assistance(
    session_id: Annotated[str, Path(min_length=1, max_length=128)],
    request: AssistanceRequest,
    caller: Caller = Depends(authenticate_caller),
) -> AssistanceResponse:
    """
    An offer of help for a customer who has gone quiet on a step.

    The browser decides when they are quiet; this decides whether an offer
    fits the conversation and words it (service/assistance.py). Same rules
    as the snapshot for everything around it: peek() so an unknown visit is
    never created, no touch() so an offer never keeps an idle visit alive,
    no runtime and no model, and the turn lock with a bounded wait -- 409
    while a turn is running, because a customer mid-turn is not quiet.
    Looks only in the caller's own domain.
    """
    domain = _caller(caller).resolve()
    entry = registry.peek(session_id, domain=domain)

    if entry is None:
        return AssistanceResponse(offered=False, reason="unknown_session")

    if domain != BANKING:
        # Assistance offers are worded from Banking's form-filling steps;
        # other domains' workflows have none (yet). Never Banking text.
        return AssistanceResponse(offered=False, reason="not_available")

    if not entry.lock.acquire(timeout=SNAPSHOT_LOCK_TIMEOUT_SECONDS):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The assistant is still working on the last request.",
        )

    try:
        conversation = entry.conversation

        return offer_assistance(
            conversation,
            _snapshot_loader,
            entry.localizer,
            ended=EngineRuntime.has_exited(conversation),
            avoid=request.avoid,
        )
    finally:
        entry.lock.release()


@app.post("/sessions/{session_id}/workflow-result", response_model=TurnResponse)
def workflow_result(
    session_id: Annotated[str, Path(min_length=1, max_length=128)],
    request: WorkflowResultRequest,
    caller: Caller = Depends(authenticate_caller),
) -> TurnResponse:
    """
    The calling backend's answer to a WorkflowAction it was given (Phase 5).

    The backend authorised and performed the action itself (for admission
    status: the signed-in student's own record, inside the College backend)
    and sends back ONLY an outcome code. The reply is worded here, in the
    visit's language, and the workflow completes. Refused -- and nothing
    changes -- unless the visit exists in the caller's own domain, is waiting
    for exactly this action, and the workflow defines the outcome.
    """
    domain = _caller(caller).resolve()
    entry = registry.peek(session_id, domain=domain)
    if entry is None:
        raise NoPendingWorkflowAction("This visit has no pending request.")
    runtime = _runtime_for(domain)
    if not hasattr(runtime, "apply_workflow_result"):
        raise NoPendingWorkflowAction("This visit has no pending request.")

    with registry.in_turn(entry):
        try:
            result = runtime.apply_workflow_result(entry.conversation, request.action_id, request.outcome,
                                                   entry.localizer, action_type=request.action_type)
        except ActionExpired:
            raise ExpiredWorkflowAction("This request has expired. Please ask again.") from None
        except ActionTypeMismatch:
            raise MismatchedWorkflowAction("This visit has no pending request of that kind.") from None
        except NoPendingAction:
            raise NoPendingWorkflowAction("This visit has no pending request.") from None
        except UnknownOutcome:
            raise InvalidWorkflowResult("That outcome is not defined for this request.") from None
        return _turn_response(result, _snapshot(entry.conversation, runtime), domain)


@app.delete("/sessions/{session_id}")
def end_session(
    session_id: Annotated[str, Path(min_length=1, max_length=128)],
    caller: Caller = Depends(authenticate_caller),
) -> JSONResponse:
    """
    Frees a visit's conversation when the customer signs out. Own domain only.

    Phase 7A: the id is bounded like every other /sessions/{id} route (422
    beyond 128 characters), so an oversized id is refused before it reaches
    the registry.
    """
    removed = registry.remove(session_id, domain=_caller(caller).resolve())

    return JSONResponse({"removed": removed})


# ---------------------------------------------------------------------------
# Knowledge maintenance (Phase 2). Internal-token only, like every route.
# ---------------------------------------------------------------------------


@app.get("/knowledge/gaps", dependencies=[Depends(require_maintenance_token)])
def knowledge_gaps(limit: int = 100, grouped: bool = False, include_resolved: bool = True) -> JSONResponse:
    """
    Recent questions the assistant could not answer well, for review.

    Redacted (no digits, no e-mail addresses, no "my name is ..." names),
    held in memory only unless KNOWLEDGE_GAP_LOG is set; see
    app/knowledge/gaps.py. grouped=true returns one row per question.
    """
    runtime = get_runtime()
    if grouped:
        return JSONResponse({"groups": runtime.knowledge_gap_groups(include_resolved)[: max(1, min(limit, 500))]})
    return JSONResponse({"gaps": runtime.knowledge_gaps(max(1, min(limit, 500)))})


@app.post("/knowledge/gaps/{question_hash}/resolve", dependencies=[Depends(require_maintenance_token)])
def knowledge_gap_resolve(question_hash: str, resolution: str, note: str = "") -> JSONResponse:
    """Records what a maintainer did about one group of gap records."""
    try:
        return JSONResponse(get_runtime().resolve_knowledge_gap(question_hash, resolution, note))
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such question.")


@app.post("/knowledge/refresh", dependencies=[Depends(require_maintenance_token)])
def knowledge_refresh() -> JSONResponse:
    """Re-reads the knowledge collection; only changed articles are re-embedded."""
    return JSONResponse(get_runtime().refresh_knowledge())


@app.exception_handler(Exception)
async def unhandled(_request, error: Exception) -> JSONResponse:
    # Tracebacks, file paths and engine internals stop here. NestJS turns
    # this into its own error shape for the browser.
    logger.exception("Unhandled error in assistant service: %s", type(error).__name__)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "The assistant is temporarily unavailable."},
    )
