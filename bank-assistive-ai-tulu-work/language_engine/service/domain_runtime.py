"""
The runtime for a knowledge-first domain such as College (domain integration, Phases 4-5).

Banking is still served by EngineRuntime, unchanged. A domain registered here
gets a DomainKnowledgeRuntime: the same turn sequence as EngineRuntime.run_turn
(exit check, empty turn, normalisation, deterministic control words, history,
one output boundary), with the domain's own parts where Banking's are
domain-specific:

    shared, reused as is          domain-specific, from configuration
    ---------------------------   -----------------------------------------
    normalize_turn                intent profile  -> ProfileIntentDetector
    classify_turn (control)       knowledge       -> DomainKnowledgeBase
    resolve_step_completion       reply catalog   -> CatalogLocalizer
    sentence encoder (cached)     persona         -> GroundedAnswerer
    Whisper (the Banking runtime's  workflows dir -> WorkflowLoader(folder)
      own instance, not a copy)   campus maps     -> CampusMapCollection
    EngineRuntime.transcribe,
      _render, has_exited
    ConversationManager / state
    answer_language

WHAT A TURN DOES

  control word   help / thanks / acknowledgement / repeat answered from the
                 catalog; next, cancel, pause, resume and step references go
                 to the workflow in progress (DomainWorkflowRunner), or say
                 there is no task.
  in a workflow  a sentence that continues it (a destination, "I've done
                 that") is the workflow's; anything else is routed as usual.
  intent         ProfileIntentDetector.detect():
                   AMBIGUOUS     -> "Do you mean X or Y?"
                   not an intent -> out of scope / unsupported / acknowledged
                   workflow      -> the workflow's first step (Phase 5)
                   knowledge     -> evidence-aware answer, below
  answer         retrieval narrowed to the chosen intent's own categories
                 (never those of other topics the sentence mentions), for the
                 session's institution, verified documents only. Not answerable ->
                 "I don't have verified information about <topic> yet." The
                 model is asked only with evidence, may decline (NO_ANSWER),
                 and every number it writes must be in the evidence;
                 otherwise the same uncertainty reply, and the question is
                 logged (redacted) as unanswered.

PRIVATE DATA

Admission status is a backend_action: the turn returns an action request, the
College backend looks up the SIGNED-IN student's own record and answers with
an outcome code only (apply_workflow_result). No record, and nothing the
student typed, is ever put into an action. Conversation history keeps the
student's words redacted (numbers and e-mail addresses removed).

One runtime serves every session of the domain. It holds no per-session
state: conversation history, workflow state and the last reply live in each
session's ConversationManager and localizer, exactly as for Banking.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Callable, Dict, List, Optional

from app.conversation.state import SessionState
from app.dialogue.catalog_localizer import compose_parts
from app.dialogue.llm.answer_language import answer_language
from app.dialogue.llm.grounded_answer import GroundedAnswerer
from app.dialogue.localization import GeneratedText, ResponseLocalizer
from app.dialogue.manager import classify_turn
from app.dialogue.text_normalization import normalize_turn, word_tokens
from app.intent.profile import AMBIGUOUS, IntentProfile, ProfileIntentDetector
from app.knowledge.domain_retrieval import DomainKnowledgeBase
from app.knowledge.unanswered_log import redact
from app.workflow.domain_runner import DomainWorkflowRunner, StepReply, WorkflowTexts
from app.workflow.loader import WorkflowLoader
from service.engine import EngineRuntime, TurnResult

#: Turn outcomes reported in TurnResult.outcome.
ANSWERED = "answered"
NO_VERIFIED_INFORMATION = "no_verified_information"
CLARIFY = "clarify"
OUT_OF_SCOPE = "out_of_scope"
UNSUPPORTED = "unsupported"
WORKFLOW_PENDING = "workflow_pending"
CONTROL = "control"

#: Control words that only make sense inside a workflow.
_WORKFLOW_CONTROLS = {"pause", "resume", "cancel", "next"}

#: A typed token that looks like a reference number: letters/digits with at
#: least one digit and five or more characters ("NU2025-0042").
_REFERENCE_TOKEN = re.compile(r"(?=[A-Za-z0-9/-]*\d)[A-Za-z0-9/-]{5,}")
_REFERENCE_WORDS = ("reference", "nucat", "roll", "registration", "ರೆಫರೆನ್ಸ್", "ನೋಂದಣಿ", "रेफ़रेंस", "रेफरेंस")


@dataclass(frozen=True)
class ReplyTexts:
    """A domain's canonical (English) fixed replies. Must all be in its catalog."""

    no_verified_info: str          # with {topic}
    contact_office: str
    out_of_scope: str
    unsupported: str
    acknowledged: str
    thanks: str
    help: str
    clarify: str                   # with {topic} and {topic2}
    workflow_pending: str          # with {topic}
    use_portal: str
    no_task: str
    nothing_to_repeat: str
    farewell: str
    apology: str
    did_not_catch: str
    no_institution: str
    topic_by_intent: Dict[str, str] = field(default_factory=dict)
    #: Said before an admission-status answer when a reference number was typed.
    reference_warning: Optional[str] = None
    nothing_paused: Optional[str] = None


@dataclass
class _Decision:
    reply: str
    outcome: str
    intent: Optional[str] = None
    sources: List[dict] = field(default_factory=list)
    steps: Optional[list] = None
    action: Optional[dict] = None


def _from_step(step: StepReply) -> _Decision:
    return _Decision(step.reply, step.outcome, intent=step.intent, sources=step.sources,
                     steps=step.steps, action=step.action)


def mentions_reference_number(text: str) -> bool:
    """Whether a sentence carries something that looks like a reference number."""
    return bool(_REFERENCE_TOKEN.search(text or ""))


class DomainKnowledgeRuntime(EngineRuntime):
    """
    A domain's runtime, built on EngineRuntime.

    EngineRuntime.__init__ is deliberately NOT called: it constructs Banking's
    intent detector and dialogue manager. Every attribute the inherited
    methods read (stt, through the property below) is provided here.
    """

    #: Tells the service to pass the session's context into run_turn.
    accepts_context = True

    def __init__(
        self,
        *,
        domain: str,
        profile: IntentProfile,
        detector: ProfileIntentDetector,
        knowledge: DomainKnowledgeBase,
        answerer: GroundedAnswerer,
        replies: ReplyTexts,
        workflows_dir=None,
        stt_provider: Optional[Callable[[], object]] = None,
        workflow_texts: Optional[WorkflowTexts] = None,
        catalog=None,
        campus_for: Optional[Callable[[str], object]] = None,
    ) -> None:
        self.domain = domain
        self.profile = profile
        self.intent_detector = detector
        self.knowledge = knowledge
        self.answerer = answerer
        self.replies = replies
        self._stt_provider = stt_provider
        self._stt = None
        loader = WorkflowLoader(workflows_dir)
        # What the service's workflow snapshot reads. The domain's OWN folder.
        self.dialogue = SimpleNamespace(workflow_loader=loader)
        self.workflows: Optional[DomainWorkflowRunner] = None
        if workflow_texts is not None and workflows_dir is not None:
            self.workflows = DomainWorkflowRunner(
                loader=loader, texts=workflow_texts, catalog=catalog, answer=self._knowledge_step,
                campus_for=campus_for or (lambda _institution: None),
            )
            self.workflows.validate_all()

    # -----------------------------------------------------------------
    # Shared speech recognition
    # -----------------------------------------------------------------

    @property
    def stt(self):
        """The engine's one SpeechToText (Whisper), borrowed on first use."""
        if self._stt is None:
            if self._stt_provider is None:
                raise RuntimeError("No speech recogniser is available to this runtime.")
            self._stt = self._stt_provider()
        return self._stt

    # -----------------------------------------------------------------
    # One turn
    # -----------------------------------------------------------------

    def _farewell(self, localizer: Optional[ResponseLocalizer]) -> TurnResult:
        farewell = self.replies.farewell
        return TurnResult(reply=self._render(localizer, farewell, remember=False), ended=True,
                          canonical_reply=farewell, outcome=CONTROL)

    def _result(self, decision: _Decision, localizer) -> TurnResult:
        return TurnResult(
            reply=self._render(localizer, decision.reply, remember=True),
            canonical_reply=decision.reply,
            intent=decision.intent,
            sources=decision.sources,
            outcome=decision.outcome,
            steps=[self._render(localizer, s, remember=False) for s in decision.steps] if decision.steps else None,
            action=decision.action,
        )

    def run_turn(self, conversation, user_text, localizer=None, context=None) -> TurnResult:
        if self.has_exited(conversation):
            return self._farewell(localizer)

        raw_text = (user_text or "").strip()
        if not raw_text:
            text = self.replies.did_not_catch
            return TurnResult(reply=self._render(localizer, text, remember=False), canonical_reply=text,
                              outcome=CONTROL)

        turn = normalize_turn(raw_text)
        control = classify_turn(turn.routing)

        if control == "session_exit":
            conversation.update_session_state(SessionState.EXITED)
            return self._farewell(localizer)

        conversation.update_session_state(SessionState.PROCESSING)
        # Redacted: a reference number or e-mail typed into the chat is not kept.
        conversation.add_history("User", redact(raw_text))

        language = getattr(localizer, "language", None) or "en"

        try:
            decision = self._respond(conversation, control, turn.normalized, raw_text, localizer,
                                     context or {}, language)
        except Exception as error:  # noqa: BLE001 - one turn lost, never the session
            print(f"[{self.domain}] turn failed ({type(error).__name__})")
            conversation.update_session_state(SessionState.READY)
            apology = self.replies.apology
            return TurnResult(reply=self._render(localizer, apology, remember=False), canonical_reply=apology,
                              outcome="error")

        conversation.add_history("Assistant", str(decision.reply))
        conversation.update_session_state(SessionState.READY)
        return self._result(decision, localizer)

    def apply_workflow_result(self, conversation, action_id: str, outcome: str, localizer=None,
                              action_type: Optional[str] = None) -> TurnResult:
        """
        The calling backend's answer to a pending action (an outcome code).
        Raises NoPendingAction / UnknownOutcome (domain_runner) on refusal;
        nothing changes then.
        """
        if self.workflows is None:
            from app.workflow.domain_runner import NoPendingAction
            raise NoPendingAction("This domain has no workflows.")
        decision = _from_step(self.workflows.apply_result(conversation, action_id, outcome, action_type))
        conversation.add_history("Assistant", str(decision.reply))
        return self._result(decision, localizer)

    # -----------------------------------------------------------------
    # Routing
    # -----------------------------------------------------------------

    def _topic(self, intent: str) -> str:
        return self.replies.topic_by_intent[intent]

    def _respond(self, conversation, control, text, question, localizer, context, language) -> _Decision:
        r, wf = self.replies, self.workflows

        if control is not None:
            if control == "repeat":
                last = getattr(localizer, "last_canonical", None)
                return _Decision(last if last else r.nothing_to_repeat, CONTROL)
            if control == "help":
                return _Decision(r.help, CONTROL)
            if control == "thanks":
                return _Decision(r.thanks, CONTROL)
            if control == "acknowledgement":
                return _Decision(r.acknowledged, CONTROL)
            # next / cancel / pause / resume / a step reference: the workflow's.
            step = wf.control(conversation, control, context, language) if wf else None
            if step is not None:
                return _from_step(step)
            if control == "resume" and r.nothing_paused:
                return _Decision(r.nothing_paused, CONTROL)
            return _Decision(r.no_task, CONTROL)

        institution = context.get("institution_id")
        if not institution:
            return _Decision(r.no_institution, CONTROL)

        if wf is not None:
            step = wf.continue_turn(conversation, text, context, language)
            if step is not None:
                return _from_step(step)

        detection = self.intent_detector.detect(text)
        kind = detection["kind"]

        if wf is not None and wf.awaiting_destination(conversation):
            # "Where would you like to go?" was asked and no place was named.
            # Only a request that NAMES something else (by keyword) moves on:
            # an embedding-only match ("the moon base" -> examinations, no
            # keyword) is a place the map does not have, not a new question.
            other = detection["is_intent"] and detection["intent"] != conversation.current_intent \
                and detection["intent"] in detection["evidence"]
            if not other:
                return _from_step(wf.retry_destination(conversation, context))
            wf.release(conversation)

        detection = self._navigation_by_place(detection, text, context)

        if kind == AMBIGUOUS:
            first, second = detection["alternatives"]
            return _Decision(r.clarify.format(topic=self._topic(first), topic2=self._topic(second)), CLARIFY)

        if not detection["is_intent"]:
            if kind == "UNSUPPORTED":
                return _Decision(r.unsupported, UNSUPPORTED)
            if kind in ("ACKNOWLEDGEMENT", "CONTROL"):
                return _Decision(r.acknowledged, CONTROL)
            return _Decision(r.out_of_scope, OUT_OF_SCOPE)

        intent = detection["intent"]
        spec = self.profile.spec(intent)

        if spec.handler != "knowledge":
            return self._start_workflow(conversation, intent, spec, text, question, context, language)

        decision = self._answer(intent, text, question, institution, language)
        hint = wf.hint(conversation) if wf is not None else None
        if hint:
            decision.reply = compose_parts(decision.reply, hint)
        return decision

    def _navigation_intents(self) -> set:
        """Intents whose workflow starts by asking where to go (read from the definitions)."""
        found = set()
        for spec in self.profile.intents:
            if spec.handler.startswith("workflow:"):
                definition = self.dialogue.workflow_loader.load_workflow(spec.handler.split(":", 1)[1])
                if definition and definition["steps"][0].get("kind") == "destination":
                    found.add(spec.name)
        return found

    def _navigation_by_place(self, detection: dict, text: str, context: dict) -> dict:
        """
        "Take me to the library": navigation words AND a place of the
        institution's VERIFIED campus map. "library" also names student
        services, and the embeddings can prefer it; a sentence that both asks
        the way and names a mapped place is a request for directions. Never
        applies without a verified map, so it can only route to directions
        the map actually has.
        """
        if self.workflows is None or not detection.get("is_intent"):
            return detection
        navigation = self._navigation_intents() & set(detection.get("evidence") or ())
        if not navigation or detection["intent"] in navigation:
            return detection
        campus = self.workflows.campus_for(context.get("institution_id"))
        if campus is None or not campus.find_places(text).places:
            return detection
        return {**detection, "intent": sorted(navigation)[0], "routed_by": "campus_place"}

    def _start_workflow(self, conversation, intent, spec, text, question, context, language) -> _Decision:
        r = self.replies
        workflow_id = spec.handler.split(":", 1)[1] if spec.handler.startswith("workflow:") else None
        step = self.workflows.start(conversation, workflow_id, intent, text, context, language) \
            if self.workflows is not None and workflow_id else None
        if step is None:
            reply = f"{r.workflow_pending.format(topic=self._topic(intent))} {r.use_portal}"
            return _Decision(reply, WORKFLOW_PENDING, intent=intent)
        decision = _from_step(step)
        if r.reference_warning and self._typed_reference(intent, question):
            # Never used, never forwarded: the action carries no text at all.
            decision.reply = compose_parts(r.reference_warning, decision.reply)
        return decision

    @staticmethod
    def _typed_reference(intent: str, question: str) -> bool:
        if not mentions_reference_number(question):
            return False
        if intent == "admission_status":
            return True
        words = " ".join(word_tokens(question))
        return any(word in words for word in _REFERENCE_WORDS)

    # -----------------------------------------------------------------
    # Evidence-aware answers
    # -----------------------------------------------------------------

    def _knowledge_step(self, question, categories, topic, context, language) -> StepReply:
        """A workflow's knowledge step: the same gates as any answer."""
        decision = self._answer(None, question, question, context.get("institution_id"), language,
                                categories=set(categories), topic=topic)
        return StepReply(decision.reply, decision.outcome, sources=decision.sources)

    def _answer(self, intent, text, question, institution, language, *, categories=None, topic=None) -> _Decision:
        r = self.replies
        # ONLY the chosen intent's own categories. Other topics the sentence
        # names ("semester" in "When are the semester examinations?",
        # "hostel" in "hostel fees") are NOT merged in: doing so answered an
        # examination question from the academic calendar and a hostel-fee
        # question from the tuition-fee document -- the near-topic failure
        # Phase 3 recorded. Without merging, a category with no document is
        # "no verified information", and evidence that lacks the answer
        # leaves the model only NO_ANSWER (or a number the check rejects).
        if categories is None:
            categories = set(self.profile.spec(intent).categories)
        topic = topic or self._topic(intent)

        uncertain = f"{r.no_verified_info.format(topic=topic)} {r.contact_office}"

        outcome = self.knowledge.retrieve(text, institution, categories=categories)
        if not outcome.answerable:
            return _Decision(uncertain, NO_VERIFIED_INFORMATION, intent=intent)

        passages = [
            {"source": result["source"], "title": result["metadata"].get("title"), "content": result["content"]}
            for result in outcome.results
        ]
        answer = self.answerer.answer(question, passages, language)

        if not answer.ok:
            self.knowledge.unanswered_log.record(
                domain=self.domain, institution_id=institution, question=question,
                reason=answer.status, category=",".join(sorted(categories)), top_score=outcome.top_score,
            )
            return _Decision(uncertain, NO_VERIFIED_INFORMATION, intent=intent)

        return _Decision(GeneratedText(answer.text, language=answer_language(language)), ANSWERED,
                         intent=intent, sources=outcome.sources())


# ---------------------------------------------------------------------
# The College runtime
# ---------------------------------------------------------------------

def college_replies() -> ReplyTexts:
    from app.domains.college import responses as R

    return ReplyTexts(
        no_verified_info=R.NO_VERIFIED_INFO, contact_office=R.CONTACT_OFFICE, out_of_scope=R.OUT_OF_SCOPE,
        unsupported=R.UNSUPPORTED, acknowledged=R.ACKNOWLEDGED, thanks=R.THANKS, help=R.HELP,
        clarify=R.CLARIFY, workflow_pending=R.WORKFLOW_PENDING, use_portal=R.USE_PORTAL, no_task=R.NO_TASK,
        nothing_to_repeat=R.NOTHING_TO_REPEAT, farewell=R.FAREWELL, apology=R.APOLOGY,
        did_not_catch=R.DID_NOT_CATCH, no_institution=R.NO_INSTITUTION, topic_by_intent=dict(R.TOPIC_BY_INTENT),
        reference_warning=R.REFERENCE_WARNING, nothing_paused=R.NOTHING_PAUSED,
    )


def college_workflow_texts() -> WorkflowTexts:
    from app.domains.college import responses as R

    return WorkflowTexts(
        stopped=R.STOPPED, paused=R.PAUSED, continue_hint=R.CONTINUE_HINT, step_hint=R.STEP_HINT,
        say_next_topic=R.GUIDANCE_SAY_NEXT, ask_destination=R.ASK_DESTINATION, no_campus_map=R.NO_CAMPUS_MAP,
        no_current_location=R.NO_CURRENT_LOCATION, unknown_current_location=R.UNKNOWN_CURRENT_LOCATION,
        place_not_found=R.PLACE_NOT_FOUND, ask_another_place=R.ASK_ANOTHER_PLACE, say_next_step=R.SAY_NEXT_STEP,
        last_step=R.LAST_STEP, contact_office=R.CONTACT_OFFICE, no_route=R.NO_ROUTE,
        already_there=R.ALREADY_THERE, directions_intro=R.DIRECTIONS_INTRO, step_of=R.STEP_OF,
        clarify_place=R.CLARIFY_PLACE,
    )


def build_college_runtime(
    *,
    stt_provider: Optional[Callable[[], object]] = None,
    knowledge: Optional[DomainKnowledgeBase] = None,
    answerer: Optional[GroundedAnswerer] = None,
    model=None,
    campus=None,
    campus_include_unverified: bool = False,
) -> DomainKnowledgeRuntime:
    """
    The College runtime from the College domain configuration.

    Tests pass `knowledge` (fixtures), `answerer` (a fake model) and `campus`
    (fixture maps, with campus_include_unverified). In production all three
    come from configuration: the verified-only College collection, the
    Groq-backed grounded answerer and the verified-only campus maps.
    """
    from app.domains import get_domain
    from app.domains.college.intents import COLLEGE_INTENT_PROFILE
    from app.domains.college.responses import COLLEGE_CATALOG, PERSONA
    from app.navigation.campus_map import CampusMapCollection

    config = get_domain("college")
    maps = campus if campus is not None else CampusMapCollection.for_domain(config)
    unverified = bool(campus is not None and campus_include_unverified)

    return DomainKnowledgeRuntime(
        domain=config.id,
        profile=COLLEGE_INTENT_PROFILE,
        detector=ProfileIntentDetector(COLLEGE_INTENT_PROFILE, model=model),
        knowledge=knowledge or DomainKnowledgeBase.for_domain(config, **({"model": model} if model else {})),
        answerer=answerer or GroundedAnswerer(PERSONA),
        replies=college_replies(),
        workflows_dir=config.workflows_dir,
        stt_provider=stt_provider,
        workflow_texts=college_workflow_texts(),
        catalog=COLLEGE_CATALOG,
        campus_for=lambda institution: maps.for_institution(institution, include_unverified=unverified)
        if institution else None,
    )


def register_builtin_domain_runtimes() -> None:
    """
    Registers every non-Banking domain's runtime factory with service.engine.

    Registration builds nothing; the runtime is built on first use (or when
    the service warms it at start-up). Speech recognition is borrowed from the
    Banking runtime's SpeechToText, so Whisper is loaded once per process.
    """
    from service import engine

    engine.register_domain_runtime(
        "college",
        lambda: build_college_runtime(stt_provider=lambda: engine.get_runtime().stt),
    )
