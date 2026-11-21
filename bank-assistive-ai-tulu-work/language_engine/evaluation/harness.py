"""
M0 -- OFFLINE MULTILINGUAL EVALUATION HARNESS

Measures the engine's deterministic language path against a fixed set of
labelled sentences, and writes a report. It changes no engine behaviour: every
function it calls is the engine's own, called the way production calls it.

WHAT IS MEASURED, AND HOW FAR EACH MEASUREMENT REACHES

  service_request / knowledge_question
      The resting-state router, mirroring VoiceAssistantPipeline._respond for
      a turn with no workflow in progress:

          normalize_banking_terms -> classify_turn (control tier)
          -> question / control prefilter -> IntentDetector

      When a prefilter fires, production asks the LLM to classify the turn.
      The LLM is not called here, so those turns are recorded as LLM_GATED and
      left UNSCORED rather than guessed. The IntentDetector's own verdict is
      still recorded for every sentence (the "detector-only" view), because
      the same detector also decides workflow conflicts mid-task.

  knowledge_question retrieval
      KnowledgeRetriever.search(top_k=2), as answer_question() calls it,
      scored as a hit when an expected document is among the two returned.

  control          classify_turn, the deterministic tier.
  amount           extract_amount, the deterministic gap-filler used when the
                   LLM returns no amount. The LLM's own extraction is NOT
                   measured.
  negation         contains_negation, plus whether DialogueManager.
                   _detect_workflow_conflict would raise a conflict while the
                   fixture's workflow is active. That method needs only the
                   detector, so it runs offline; in production it is reached
                   only after the LLM has classified the turn.
  conflict_answer  The pending-conflict path: the control tier first
                   (CONFLICT_CONTROL_CHOICES), then
                   DialogueManager._conflict_choice_from_text.

OFFLINE BY CONSTRUCTION

Hugging Face is forced offline before anything is imported, and a socket guard
refuses every non-loopback connection for the whole run. A code path that
tried to reach Groq or the Hub would fail loudly rather than quietly succeed.

Run from language_engine/:

    venv/Scripts/python.exe -m evaluation.harness --name baseline_m0
"""
from __future__ import annotations

import os

# Set before any import can construct a Hugging Face client.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import argparse
import hashlib
import json
import platform
import socket
import sys
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_FIXTURES = ROOT / "fixtures" / "multilingual_v1.json"
DEFAULT_REPORTS = ROOT / "reports"
DOCUMENTS_DIR = ROOT.parent / "app" / "knowledge" / "documents"

LANGUAGE_GROUPS = ("en", "kn", "hi", "kn-en", "hi-en", "rom-kn", "rom-hi")

CATEGORIES = (
    "service_request",
    "knowledge_question",
    "control",
    "amount",
    "negation",
    "conflict_answer",
    # Added in M3, used by evaluation/fixtures/m3_language_cues.json. The M0
    # fixture file has none, so its results are unaffected.
    "refusal",
    # Added in M4, used by evaluation/fixtures/m4_heldout.json: a request
    # that names no single service ("I need money") must not start one.
    "ambiguous_request",
)

# Kept literal rather than imported so validation needs no engine import.
# The self-test asserts these still equal the engine's own values.
INTENT_LABELS = (
    "deposit money",
    "withdraw money",
    "check account balance",
    "apply for loan",
    "open new account",
)
CONTROL_COMMANDS = (
    "pause", "resume", "cancel", "repeat", "next",
    "session_exit", "thanks", "acknowledgement",
)
CONFLICT_CHOICES = ("cancel", "pause", "continue")

# =========================================================
# OUTCOMES
#
# Every fixture gets exactly one outcome. Severity is what the report counts:
#
#   critical  -- the engine did the WRONG thing (wrong service, a question
#                started a workflow, a wrong amount, a wrong control, a
#                refusal treated as a request)
#   miss      -- the engine did NOTHING useful (abstained, no amount, asked
#                again). Costs the customer a turn, never their request.
#   unscored  -- the decision belongs to the LLM, which is not called.
# =========================================================

CORRECT = "correct"

INTERCEPTED_BY_CONTROL = "intercepted_by_control"
WRONG_SERVICE = "wrong_service"
QUESTION_TO_WORKFLOW = "question_to_workflow"
WRONG_AMOUNT = "wrong_amount"
FALSE_AMOUNT = "false_amount"
WRONG_COMMAND = "wrong_command"
WRONG_CHOICE = "wrong_choice"
FALSE_CONFLICT = "false_conflict"
REFUSAL_STARTED_WORKFLOW = "refusal_started_workflow"
GUESSED_SERVICE = "guessed_service"

ABSTAINED = "abstained"
WRONG_NON_BANKING = "wrong_non_banking"
MISSED_AMOUNT = "missed_amount"
MISSED_COMMAND = "missed_command"
REASKED = "reasked"
MISSED_NEGATION = "missed_negation"
FALSE_NEGATION = "false_negation"

LLM_GATED = "llm_gated"

SEVERITY = {
    CORRECT: "ok",
    INTERCEPTED_BY_CONTROL: "critical",
    WRONG_SERVICE: "critical",
    QUESTION_TO_WORKFLOW: "critical",
    WRONG_AMOUNT: "critical",
    FALSE_AMOUNT: "critical",
    WRONG_COMMAND: "critical",
    WRONG_CHOICE: "critical",
    FALSE_CONFLICT: "critical",
    REFUSAL_STARTED_WORKFLOW: "critical",
    GUESSED_SERVICE: "critical",
    ABSTAINED: "miss",
    WRONG_NON_BANKING: "miss",
    MISSED_AMOUNT: "miss",
    MISSED_COMMAND: "miss",
    REASKED: "miss",
    MISSED_NEGATION: "miss",
    FALSE_NEGATION: "miss",
    LLM_GATED: "unscored",
}

SEVERITIES = ("ok", "critical", "miss", "unscored")


class FixtureError(ValueError):
    """The fixture file is malformed. Nothing is evaluated."""


class NetworkBlocked(RuntimeError):
    """Raised when anything in the run tries to leave the machine."""


# =========================================================
# NETWORK GUARD
# =========================================================

_LOOPBACK = ("127.", "::1", "localhost")


def _is_loopback(address):
    host = address[0] if isinstance(address, tuple) else address
    return isinstance(host, str) and host.startswith(_LOOPBACK)


def install_network_guard():
    """Refuses every non-loopback socket connection from now on."""

    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def guarded_connect(self, address):
        if not _is_loopback(address):
            raise NetworkBlocked(f"evaluation harness is offline; refused {address!r}")
        return original_connect(self, address)

    def guarded_connect_ex(self, address):
        if not _is_loopback(address):
            raise NetworkBlocked(f"evaluation harness is offline; refused {address!r}")
        return original_connect_ex(self, address)

    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex


# =========================================================
# FIXTURES
# =========================================================

def load_fixtures(path):
    """Reads and validates a fixture file. Returns (document, sha256)."""

    raw = Path(path).read_bytes()
    document = json.loads(raw.decode("utf-8"))
    validate_fixtures(document)
    return document, hashlib.sha256(raw).hexdigest()


def known_documents():
    return {p.name for p in DOCUMENTS_DIR.glob("*.md")}


def validate_fixtures(document, documents=None):
    """Raises FixtureError on the first problem; returns None when valid."""

    fixtures = document.get("fixtures") if isinstance(document, dict) else None

    if not isinstance(fixtures, list) or not fixtures:
        raise FixtureError("the file must contain a non-empty 'fixtures' list")

    documents = known_documents() if documents is None else documents
    seen = set()

    for index, fixture in enumerate(fixtures):
        where = f"fixture #{index} ({fixture.get('id', '?') if isinstance(fixture, dict) else '?'})"

        if not isinstance(fixture, dict):
            raise FixtureError(f"{where}: must be an object")

        for key in ("id", "lang", "category", "text", "expected", "source"):
            if key not in fixture:
                raise FixtureError(f"{where}: missing '{key}'")

        if fixture["id"] in seen:
            raise FixtureError(f"{where}: duplicate id")
        seen.add(fixture["id"])

        if fixture["lang"] not in LANGUAGE_GROUPS:
            raise FixtureError(f"{where}: unknown language group {fixture['lang']!r}")

        if fixture["category"] not in CATEGORIES:
            raise FixtureError(f"{where}: unknown category {fixture['category']!r}")

        if not isinstance(fixture["text"], str) or not fixture["text"].strip():
            raise FixtureError(f"{where}: text must be a non-empty string")

        expected = fixture["expected"]

        if not isinstance(expected, dict):
            raise FixtureError(f"{where}: expected must be an object")

        _validate_expected(where, fixture["category"], expected, fixture.get("context"), documents)


def _validate_expected(where, category, expected, context, documents):

    if category == "service_request":
        if expected.get("intent") not in INTENT_LABELS:
            raise FixtureError(f"{where}: expected.intent must be one of {INTENT_LABELS}")

    elif category == "knowledge_question":
        if expected.get("route") != "knowledge":
            raise FixtureError(f"{where}: expected.route must be 'knowledge'")
        if "sources" not in expected:
            raise FixtureError(f"{where}: expected.sources is required (null when no document applies)")
        sources = expected["sources"]
        if sources is not None:
            if not isinstance(sources, list) or not sources:
                raise FixtureError(f"{where}: expected.sources must be a non-empty list or null")
            unknown = [s for s in sources if s not in documents]
            if unknown:
                raise FixtureError(f"{where}: unknown knowledge documents {unknown}")

    elif category == "control":
        if expected.get("command") not in CONTROL_COMMANDS:
            raise FixtureError(f"{where}: expected.command must be one of {CONTROL_COMMANDS}")

    elif category == "amount":
        if "amount" not in expected:
            raise FixtureError(f"{where}: expected.amount is required (null for no amount)")
        amount = expected["amount"]
        if amount is not None and (not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0):
            raise FixtureError(f"{where}: expected.amount must be a positive integer or null")

    elif category == "negation":
        if not isinstance(expected.get("negated"), bool):
            raise FixtureError(f"{where}: expected.negated must be true or false")
        active = (context or {}).get("active_workflow")
        if active is not None and active not in INTENT_LABELS:
            raise FixtureError(f"{where}: context.active_workflow must be an intent label")

    elif category == "conflict_answer":
        if "choice" not in expected:
            raise FixtureError(f"{where}: expected.choice is required (null for 'ask again')")
        if expected["choice"] is not None and expected["choice"] not in CONFLICT_CHOICES:
            raise FixtureError(f"{where}: expected.choice must be one of {CONFLICT_CHOICES} or null")

    elif category == "ambiguous_request":
        if expected.get("starts_workflow") is not False:
            raise FixtureError(f"{where}: expected.starts_workflow must be false")

    elif category == "refusal":
        if expected.get("starts_workflow") is not False:
            raise FixtureError(f"{where}: expected.starts_workflow must be false")
        active = (context or {}).get("active_workflow")
        if active is not None and active not in INTENT_LABELS:
            raise FixtureError(f"{where}: context.active_workflow must be an intent label")


# =========================================================
# PURE SCORING -- no engine imports, unit-tested directly
# =========================================================

def outcome_for_request(expected_intent, route):
    """Outcome of a service request through the resting-state router."""

    stage = route["stage"]

    if stage == "control_tier":
        return INTERCEPTED_BY_CONTROL

    if stage == "llm_gate":
        return LLM_GATED

    if not route["is_banking"]:
        return ABSTAINED

    if _refused(route):
        # The routing layer's refusal gate stops a negated utterance before
        # a workflow starts; for a genuine request that is a lost turn.
        return ABSTAINED

    return CORRECT if route["intent"] == expected_intent else WRONG_SERVICE


def outcome_for_question(route):
    """Outcome of a knowledge question through the resting-state router."""

    stage = route["stage"]

    if stage == "control_tier":
        return INTERCEPTED_BY_CONTROL

    if stage == "llm_gate":
        return LLM_GATED

    if route["is_banking"]:
        # Stopped by the refusal gate: no workflow, but the question gets an
        # acknowledgement rather than an answer.
        return WRONG_NON_BANKING if _refused(route) else QUESTION_TO_WORKFLOW

    return CORRECT if route["category"] == "KNOWLEDGE_QUESTION" else WRONG_NON_BANKING


def outcome_for_refusal(route, conflict_raised):
    """
    A refusal must neither start a workflow nor raise a workflow conflict.

    The conflict is checked first: it is the mid-task failure, and the more
    disruptive one. A refusal the control tier claims ("ಬೇಡ") starts nothing
    in a resting state, so it counts as correct here.
    """

    if conflict_raised:
        return FALSE_CONFLICT

    stage = route["stage"]

    if stage == "control_tier":
        return CORRECT

    if stage == "llm_gate":
        return LLM_GATED

    if route["is_banking"] and not _refused(route):
        return REFUSAL_STARTED_WORKFLOW

    return CORRECT


def outcome_for_ambiguous(route):
    """A request naming no single service must not start any workflow."""

    stage = route["stage"]

    if stage == "control_tier":
        return INTERCEPTED_BY_CONTROL

    if stage == "llm_gate":
        return LLM_GATED

    if route["is_banking"] and not _refused(route):
        return GUESSED_SERVICE

    return CORRECT


def _refused(route):
    """True when production's refusal gate (M3) stops this utterance."""

    return bool(route.get("refusal_gate") and route.get("negated"))


def detector_only(route):
    """The same route with the control tier, prefilters and refusal gate ignored."""

    return dict(route, stage="detector", refusal_gate=False)


def outcome_for_amount(expected, got):

    if got == expected:
        return CORRECT

    if expected is None:
        return FALSE_AMOUNT

    if got is None:
        return MISSED_AMOUNT

    return WRONG_AMOUNT


def outcome_for_command(expected, got):

    if got == expected:
        return CORRECT

    return MISSED_COMMAND if got is None else WRONG_COMMAND


def outcome_for_negation(expected_negated, negated, conflict_raised):
    """
    A negated request must never raise a workflow conflict -- that is the
    critical failure. A guard that missed the negation is a miss even when
    nothing else happened to fire, because the guard is what is measured.
    """

    if expected_negated:
        if conflict_raised:
            return FALSE_CONFLICT
        return CORRECT if negated else MISSED_NEGATION

    return FALSE_NEGATION if negated else CORRECT


def outcome_for_choice(expected, got):

    if got == expected:
        return CORRECT

    if expected is not None and got is None:
        return REASKED

    return WRONG_CHOICE


# =========================================================
# EVALUATION -- the engine's own functions, called as production calls them
# =========================================================

class Engine:
    """The engine pieces the harness calls. Built once per run."""

    def __init__(self, detector, retriever=None):
        from app.conversation.manager import ConversationManager
        from app.dialogue import manager as dialogue_manager
        from app.dialogue.indic_numbers import extract_amount
        from app.dialogue.term_normalizer import normalize_banking_terms
        from app.dialogue.workflow_conflict import CONFLICT_CONTROL_CHOICES

        self.detector = detector
        self.retriever = retriever

        self._dm_module = dialogue_manager
        self._conversation_factory = ConversationManager
        self._extract_amount = extract_amount
        # The text production routes on. Since M5 that is the canonical
        # routing text from app/dialogue/text_normalization; before M5 it
        # was normalize_banking_terms() alone. Mirroring whichever engine is
        # under test keeps a pre-M5 measurement honest.
        try:
            from app.dialogue.text_normalization import routing_text

            self._normalize = routing_text
        except ImportError:
            self._normalize = normalize_banking_terms
        self._conflict_control_choices = CONFLICT_CONTROL_CHOICES

        # DialogueManager.__init__ builds a Groq client. The two methods used
        # here read only `intent_detector`, so the instance is created without
        # running __init__ -- the same pattern every offline suite uses.
        self._dialogue = dialogue_manager.DialogueManager.__new__(dialogue_manager.DialogueManager)
        self._dialogue.intent_detector = detector

        # M3 added a refusal gate to the routing layer: a negated utterance
        # never starts a workflow. The harness mirrors whichever engine it
        # is run against, so the gate is applied only when the engine has it
        # -- measuring pre-M3 code with it would report a fix that was not
        # there.
        self._refusal_gate = hasattr(dialogue_manager.DialogueManager, "handle_refused_request")

    # ---------------------------------------------------------- routing

    def route(self, text):
        """The resting-state router up to the point where the LLM would run."""

        dm = self._dm_module
        normalized = self._normalize(text)
        detected = self.detector.detect_intent(normalized)

        route = {
            "stage": "detector",
            "control": None,
            "is_banking": bool(detected.get("is_banking_intent")),
            "intent": detected.get("intent"),
            "category": detected.get("category"),
            "margin": detected.get("margin"),
            "negated": bool(dm.contains_negation(normalized)),
            "refusal_gate": self._refusal_gate,
        }

        control = dm.classify_turn(normalized)

        if control is not None:
            route["stage"] = "control_tier"
            route["control"] = control if isinstance(control, str) else repr(control)
        elif dm.looks_like_a_question(normalized) or dm.looks_like_a_control_utterance(normalized):
            route["stage"] = "llm_gate"

        return route

    def control(self, text):
        found = self._dm_module.classify_turn(self._normalize(text))
        if found is None or isinstance(found, str):
            return found
        return repr(found)

    def amount(self, text):
        return self._extract_amount(self._normalize(text))

    def negation(self, text, active_workflow):
        normalized = self._normalize(text)
        negated = bool(self._dm_module.contains_negation(normalized))
        conflict = None

        if active_workflow:
            conversation = self._quiet(self._active_conversation, active_workflow)
            found = self._dialogue._detect_workflow_conflict(conversation, normalized)
            conflict = found.requested_workflow if found is not None else None

        return negated, conflict

    def conflict_choice(self, text):
        normalized = self._normalize(text)
        command = self._dm_module.classify_turn(normalized)

        if command is not None:
            if not isinstance(command, str):
                # A step reference is answered read-only; the conflict stays
                # pending and is asked again.
                return None
            if command == "session_exit":
                return "session_exit"
            return self._conflict_control_choices.get(command)

        return self._dialogue._conflict_choice_from_text(normalized)

    def retrieve(self, text):
        hits = self.retriever.search(self._normalize(text), top_k=2)
        return [{"source": h["source"], "score": round(float(h["score"]), 3)} for h in hits]

    # ---------------------------------------------------------- helpers

    def _active_conversation(self, workflow):
        conversation = self._conversation_factory()
        conversation.start_conversation()
        conversation.set_intent(workflow)
        conversation.load_workflow(workflow)
        return conversation

    @staticmethod
    def _quiet(function, *args):
        """ConversationManager prints on every state change; keep the run readable."""
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            return function(*args)


def evaluate_fixture(engine, fixture):
    """One fixture -> one result record."""

    category = fixture["category"]
    expected = fixture["expected"]
    text = fixture["text"]
    result = OrderedDict(
        id=fixture["id"],
        lang=fixture["lang"],
        category=category,
        text=text,
        expected=expected,
    )

    if category in ("service_request", "knowledge_question"):
        route = engine.route(text)

        if category == "service_request":
            outcome = outcome_for_request(expected["intent"], route)
            detector_outcome = outcome_for_request(expected["intent"], detector_only(route))
        else:
            outcome = outcome_for_question(route)
            detector_outcome = outcome_for_question(detector_only(route))

        result["got"] = OrderedDict(
            stage=route["stage"],
            control=route["control"],
            detector_intent=route["intent"],
            detector_category=route["category"],
            detector_is_banking=route["is_banking"],
            detector_margin=route["margin"],
            refused=_refused(route),
        )
        result["detector_outcome"] = detector_outcome

        if category == "knowledge_question" and engine.retriever is not None:
            # Every knowledge question is retrieved (M7): those the knowledge
            # base can answer are scored on ranking; those it cannot
            # (sources: null) on whether retrieval correctly returned nothing.
            hits = engine.retrieve(text)
            sources = expected.get("sources")
            result["retrieval"] = OrderedDict(
                top2=hits,
                answerable=bool(sources),
                abstained=not hits,
                top1_hit=bool(sources) and bool(hits) and hits[0]["source"] in sources,
                hit=bool(sources) and any(h["source"] in sources for h in hits),
            )
            if fixture.get("topic"):
                result["topic"] = fixture["topic"]

    elif category == "control":
        got = engine.control(text)
        outcome = outcome_for_command(expected["command"], got)
        result["got"] = OrderedDict(command=got)

    elif category == "amount":
        got = engine.amount(text)
        outcome = outcome_for_amount(expected["amount"], got)
        result["got"] = OrderedDict(amount=got)

    elif category == "negation":
        active = (fixture.get("context") or {}).get("active_workflow")
        negated, conflict = engine.negation(text, active)
        outcome = outcome_for_negation(expected["negated"], negated, conflict is not None)
        result["got"] = OrderedDict(negated=negated, active_workflow=active, conflict_requested=conflict)

    elif category == "refusal":
        # Measured twice: in a resting state (would it START a workflow?)
        # and, when the fixture names one, mid-task (would it raise a
        # CONFLICT with the workflow in progress?).
        route = engine.route(text)
        active = (fixture.get("context") or {}).get("active_workflow")
        conflict = engine.negation(text, active)[1] if active else None
        outcome = outcome_for_refusal(route, conflict is not None)
        result["got"] = OrderedDict(
            stage=route["stage"],
            control=route["control"],
            detector_intent=route["intent"],
            detector_is_banking=route["is_banking"],
            negated=route["negated"],
            refused=_refused(route),
            active_workflow=active,
            conflict_requested=conflict,
        )

    elif category == "ambiguous_request":
        route = engine.route(text)
        outcome = outcome_for_ambiguous(route)
        result["got"] = OrderedDict(
            stage=route["stage"],
            control=route["control"],
            detector_intent=route["intent"],
            detector_category=route["category"],
            detector_is_banking=route["is_banking"],
            detector_margin=route["margin"],
            refused=_refused(route),
        )

    else:  # conflict_answer
        got = engine.conflict_choice(text)
        outcome = outcome_for_choice(expected["choice"], got)
        result["got"] = OrderedDict(choice=got)

    result["outcome"] = outcome
    result["severity"] = SEVERITY[outcome]
    return result


# =========================================================
# SUMMARY
# =========================================================

HEADLINE = (
    ("Wrong-service routing (request started the wrong workflow)", "service_request", WRONG_SERVICE),
    ("Question started a workflow", "knowledge_question", QUESTION_TO_WORKFLOW),
    ("Request or question swallowed by the control tier", None, INTERCEPTED_BY_CONTROL),
    ("Wrong amount (a value, but not the spoken one)", "amount", WRONG_AMOUNT),
    ("Invented amount (a value where none was spoken)", "amount", FALSE_AMOUNT),
    ("Wrong control command", "control", WRONG_COMMAND),
    ("Negated request raised a workflow conflict", "negation", FALSE_CONFLICT),
    ("Wrong conflict choice", "conflict_answer", WRONG_CHOICE),
    ("Refusal started a workflow (resting state)", "refusal", REFUSAL_STARTED_WORKFLOW),
    ("Refusal raised a workflow conflict (mid-task)", "refusal", FALSE_CONFLICT),
    ("Ambiguous request started a workflow", "ambiguous_request", GUESSED_SERVICE),
)

ABSTENTIONS = (
    ("Service request abstained (no workflow started)", "service_request", ABSTAINED),
    ("Question answered as a non-question (ack / control / refusal)", "knowledge_question", WRONG_NON_BANKING),
    ("Amount missed (no value)", "amount", MISSED_AMOUNT),
    ("Control command missed (left to the LLM)", "control", MISSED_COMMAND),
    ("Negation not detected", "negation", MISSED_NEGATION),
    ("Negation detected where there was none", "negation", FALSE_NEGATION),
    ("Conflict answer not understood (asked again)", "conflict_answer", REASKED),
)


def summarize(results):
    """Pure: the same results always give the same summary."""

    def count(predicate):
        return sum(1 for r in results if predicate(r))

    by_cell = OrderedDict()
    for lang in LANGUAGE_GROUPS:
        for category in CATEGORIES:
            cell = [r for r in results if r["lang"] == lang and r["category"] == category]
            if cell:
                severities = Counter(r["severity"] for r in cell)
                by_cell[f"{lang}|{category}"] = OrderedDict(
                    [("n", len(cell))] + [(s, severities.get(s, 0)) for s in SEVERITIES]
                )

    by_category = OrderedDict()
    for category in CATEGORIES:
        cell = [r for r in results if r["category"] == category]
        outcomes = Counter(r["outcome"] for r in cell)
        by_category[category] = OrderedDict(
            [("n", len(cell))] + sorted(outcomes.items())
        )

    by_lang = OrderedDict()
    for lang in LANGUAGE_GROUPS:
        cell = [r for r in results if r["lang"] == lang]
        severities = Counter(r["severity"] for r in cell)
        by_lang[lang] = OrderedDict([("n", len(cell))] + [(s, severities.get(s, 0)) for s in SEVERITIES])

    detector_view = OrderedDict()
    for lang in LANGUAGE_GROUPS:
        for category in ("service_request", "knowledge_question"):
            cell = [r for r in results if r["lang"] == lang and r["category"] == category]
            if cell:
                detector_view[f"{lang}|{category}"] = OrderedDict(
                    [("n", len(cell))] + sorted(Counter(r["detector_outcome"] for r in cell).items())
                )

    # Per expected service (M4): what the router did with each request, and
    # where the wrong ones went.
    by_intent = OrderedDict()
    for intent in INTENT_LABELS:
        cell = [r for r in results if r["category"] == "service_request" and r["expected"]["intent"] == intent]
        if cell:
            wrong_to = Counter(r["got"]["detector_intent"] for r in cell if r["outcome"] == WRONG_SERVICE)
            by_intent[intent] = OrderedDict(
                [("n", len(cell))]
                + sorted(Counter(r["outcome"] for r in cell).items())
                + [("wrong_to", OrderedDict(sorted(wrong_to.items())))]
            )

    retrieval = OrderedDict()
    for lang in LANGUAGE_GROUPS:
        cell = [r for r in results if r["lang"] == lang and "retrieval" in r]
        answerable = [r for r in cell if r["retrieval"].get("answerable", True)]
        unanswerable = [r for r in cell if not r["retrieval"].get("answerable", True)]
        if cell:
            retrieval[lang] = OrderedDict(
                n=len(answerable),
                top1=sum(1 for r in answerable if r["retrieval"].get("top1_hit")),
                hit_at_2=sum(1 for r in answerable if r["retrieval"]["hit"]),
                wrong_top1=sum(1 for r in answerable
                               if not r["retrieval"].get("top1_hit") and not r["retrieval"].get("abstained")),
                abstained=sum(1 for r in answerable if r["retrieval"].get("abstained")),
                no_answer_n=len(unanswerable),
                no_answer_abstained=sum(1 for r in unanswerable if r["retrieval"].get("abstained")),
            )

    # Agreement with the equivalent English question (fixtures sharing a
    # `topic`): does each language retrieve the same top article English does?
    topic_agreement = OrderedDict()
    english_top = {r["topic"]: (r["retrieval"]["top2"][0]["source"] if r["retrieval"]["top2"] else None)
                   for r in results if r.get("topic") and r["lang"] == "en"}
    for lang in LANGUAGE_GROUPS:
        if lang == "en":
            continue
        cell = [r for r in results if r.get("topic") in english_top and r["lang"] == lang]
        if cell:
            same = sum(1 for r in cell
                       if (r["retrieval"]["top2"][0]["source"] if r["retrieval"]["top2"] else None)
                       == english_top[r["topic"]])
            topic_agreement[lang] = OrderedDict(n=len(cell), same_top1_as_english=same)

    headline = OrderedDict(
        (label, count(lambda r, c=category, o=outcome: r["outcome"] == o and (c is None or r["category"] == c)))
        for label, category, outcome in HEADLINE
    )
    abstentions = OrderedDict(
        (label, count(lambda r, c=category, o=outcome: r["outcome"] == o and r["category"] == c))
        for label, category, outcome in ABSTENTIONS
    )

    return OrderedDict(
        total=len(results),
        severity=OrderedDict((s, count(lambda r, s=s: r["severity"] == s)) for s in SEVERITIES),
        llm_gated=count(lambda r: r["outcome"] == LLM_GATED),
        headline=headline,
        abstentions=abstentions,
        by_lang=by_lang,
        by_category=by_category,
        by_cell=by_cell,
        detector_view=detector_view,
        by_intent=by_intent,
        retrieval=retrieval,
        topic_agreement=topic_agreement,
    )


def compare(previous, current):
    """Fixtures whose outcome changed between two JSON reports."""

    before = {r["id"]: r["outcome"] for r in previous.get("results", [])}
    changes = []
    for r in current["results"]:
        old = before.get(r["id"])
        if old != r["outcome"]:
            changes.append(OrderedDict(id=r["id"], before=old, after=r["outcome"]))
    return changes


# =========================================================
# REPORT
# =========================================================

def _fmt_expected(r):
    e = r["expected"]
    return {
        "service_request": lambda: e["intent"],
        "knowledge_question": lambda: "knowledge",
        "control": lambda: e["command"],
        "amount": lambda: str(e["amount"]),
        "negation": lambda: "negated" if e["negated"] else "not negated",
        "conflict_answer": lambda: str(e["choice"]),
        "refusal": lambda: "no workflow, no conflict",
        "ambiguous_request": lambda: "no workflow",
    }[r["category"]]()


def _fmt_got(r):
    g = r["got"]
    if r["category"] in ("service_request", "knowledge_question", "ambiguous_request"):
        if g["stage"] == "control_tier":
            return f"control tier: {g['control']}"
        verdict = g["detector_intent"] if g["detector_is_banking"] else g["detector_category"]
        prefix = "LLM gate; detector would say " if g["stage"] == "llm_gate" else ""
        suffix = "; stopped by the refusal gate" if g.get("refused") else ""
        return f"{prefix}{verdict} (margin {g['detector_margin']:+.3f}){suffix}"
    if r["category"] == "refusal":
        if g["stage"] == "control_tier":
            start = f"control tier: {g['control']}"
        elif g["stage"] == "llm_gate":
            start = "LLM gate"
        elif g["detector_is_banking"]:
            start = (f"{g['detector_intent']} stopped by the refusal gate" if g["refused"]
                     else f"starts {g['detector_intent']}")
        else:
            start = "detector abstains"
        conflict = f", conflict={g['conflict_requested']}" if g["active_workflow"] else ""
        return f"{start}{conflict}"
    if r["category"] == "negation":
        conflict = g["conflict_requested"] or "none"
        return f"negated={g['negated']}, conflict={conflict}"
    return str(next(iter(g.values())))


def _md_escape(text):
    return str(text).replace("|", "\\|")


def render_markdown(report):
    s = report["summary"]
    meta = report["meta"]
    lines = []
    add = lines.append

    add(f"# Multilingual evaluation report: {meta['name']}")
    add("")
    add("Generated by `python -m evaluation.harness` from actual execution. Offline: no LLM, no network.")
    add("")
    add("**These numbers describe the fixture set only.** It is small and hand-authored, so it shows "
        "which behaviours fail, not how often real customers hit them. Do not quote these as accuracy.")
    add("")
    add("| | |")
    add("|---|---|")
    add(f"| Fixtures | `{meta['fixtures_file']}` ({meta['fixtures_version']}) |")
    add(f"| Fixture SHA-256 | `{meta['fixtures_sha256']}` |")
    add(f"| Embedding model | `{meta['embedding_model']}` |")
    add(f"| Retrieval | {'measured' if meta['retrieval'] else 'skipped (--no-retrieval)'} |")
    add(f"| Python | {meta['python']} |")
    add(f"| Total fixtures | {s['total']} |")
    sev = s["severity"]
    add(f"| Correct / critical / miss / unscored (LLM) | {sev['ok']} / {sev['critical']} / {sev['miss']} / {sev['unscored']} |")
    add("")

    add("## Critical errors (the engine did the wrong thing)")
    add("")
    add("| Measure | Count |")
    add("|---|---|")
    for label, value in s["headline"].items():
        add(f"| {label} | {value} |")
    add("")

    add("## Misses and abstentions (the engine did nothing useful)")
    add("")
    add("| Measure | Count |")
    add("|---|---|")
    for label, value in s["abstentions"].items():
        add(f"| {label} | {value} |")
    add(f"| Routing turns left to the LLM (unscored) | {s['llm_gated']} |")
    add("")

    add("## By language group")
    add("")
    add("| Group | n | correct | critical | miss | unscored |")
    add("|---|---|---|---|---|---|")
    for lang, c in s["by_lang"].items():
        add(f"| {lang} | {c['n']} | {c['ok']} | {c['critical']} | {c['miss']} | {c['unscored']} |")
    add("")

    add("## By language group and category")
    add("")
    add("Each cell: correct / critical / miss / unscored (n).")
    add("")
    add("| Group | " + " | ".join(CATEGORIES) + " |")
    add("|---|" + "---|" * len(CATEGORIES))
    for lang in LANGUAGE_GROUPS:
        row = [lang]
        for category in CATEGORIES:
            c = s["by_cell"].get(f"{lang}|{category}")
            row.append("–" if c is None else f"{c['ok']}/{c['critical']}/{c['miss']}/{c['unscored']} ({c['n']})")
        add("| " + " | ".join(row) + " |")
    add("")

    add("## Outcomes by category")
    add("")
    for category, c in s["by_category"].items():
        parts = ", ".join(f"{k} {v}" for k, v in c.items() if k != "n")
        add(f"- **{category}** (n={c['n']}): {parts}")
    add("")

    add("## IntentDetector alone (control tier and prefilters ignored)")
    add("")
    add("The router above leaves prefiltered turns to the LLM. The detector still decides workflow "
        "conflicts mid-task, so its own verdict on every sentence is shown here.")
    add("")
    add("| Group / category | n | outcomes |")
    add("|---|---|---|")
    for key, c in s["detector_view"].items():
        parts = ", ".join(f"{k} {v}" for k, v in c.items() if k != "n")
        add(f"| {key.replace('|', ' / ')} | {c['n']} | {parts} |")
    add("")

    if s.get("by_intent"):
        add("## Service requests by expected intent")
        add("")
        add("| Expected intent | n | correct | wrong service (to) | abstained | LLM gate | other |")
        add("|---|---|---|---|---|---|---|")
        for intent, c in s["by_intent"].items():
            wrong_to = ", ".join(f"{k} {v}" for k, v in c["wrong_to"].items()) or "–"
            known = c.get(CORRECT, 0) + c.get(WRONG_SERVICE, 0) + c.get(ABSTAINED, 0) + c.get(LLM_GATED, 0)
            add(f"| {intent} | {c['n']} | {c.get(CORRECT, 0)} | {c.get(WRONG_SERVICE, 0)} ({wrong_to}) "
                f"| {c.get(ABSTAINED, 0)} | {c.get(LLM_GATED, 0)} | {c['n'] - known} |")
        add("")

    if s["retrieval"]:
        add("## Knowledge retrieval")
        add("")
        add("Answerable questions (an expected article exists): top-1 and top-2 hits, wrong top-1, abstentions. "
            "Unanswerable questions: how often retrieval correctly returned nothing.")
        add("")
        add("| Group | answerable | top-1 | top-2 | wrong top-1 | abstained | unanswerable | correctly empty |")
        add("|---|---|---|---|---|---|---|---|")
        for lang, c in s["retrieval"].items():
            add(f"| {lang} | {c['n']} | {c.get('top1', '–')} | {c['hit_at_2']} | {c.get('wrong_top1', '–')} "
                f"| {c.get('abstained', '–')} | {c.get('no_answer_n', 0)} | {c.get('no_answer_abstained', 0)} |")
        add("")

    if s.get("topic_agreement"):
        add("## Same top article as the equivalent English question")
        add("")
        add("| Group | questions | same top-1 as English |")
        add("|---|---|---|")
        for lang, c in s["topic_agreement"].items():
            add(f"| {lang} | {c['n']} | {c['same_top1_as_english']} |")
        add("")

    if report.get("changes") is not None:
        add(f"## Changes against `{report['compared_with']}`")
        add("")
        if not report["changes"]:
            add("No fixture changed outcome.")
        else:
            add("| Fixture | before | after |")
            add("|---|---|---|")
            for c in report["changes"]:
                add(f"| {c['id']} | {c['before']} | {c['after']} |")
        add("")

    add("## Every fixture that was not correct")
    add("")
    add("| Fixture | Group | Text | Expected | Got | Outcome |")
    add("|---|---|---|---|---|---|")
    for r in report["results"]:
        if r["outcome"] != CORRECT:
            add(f"| {r['id']} | {r['lang']} | {_md_escape(r['text'])} | {_md_escape(_fmt_expected(r))} "
                f"| {_md_escape(_fmt_got(r))} | {r['outcome']} ({r['severity']}) |")
    add("")

    retrieval_misses = [r for r in report["results"] if "retrieval" in r
                        and r["retrieval"].get("answerable", True) and not r["retrieval"].get("top1_hit")]
    if retrieval_misses:
        add("## Retrieval misses (expected article not first)")
        add("")
        add("| Fixture | Text | Expected | Top 2 |")
        add("|---|---|---|---|")
        for r in retrieval_misses:
            top = ", ".join(f"{h['source']} ({h['score']:.3f})" for h in r["retrieval"]["top2"]) or "(nothing)"
            add(f"| {r['id']} | {_md_escape(r['text'])} | {', '.join(r['expected']['sources'])} | {top} |")
        add("")

    add("## Limits of this measurement")
    add("")
    for limit in report["limits"]:
        add(f"- {limit}")
    add("")
    return "\n".join(lines)


LIMITS = (
    "The LLM (Groq gpt-oss-20b) is never called. Turns the question or control prefilter sends to it "
    "are counted as unscored, and the LLM's own amount extraction is not measured.",
    "Speech recognition is not exercised: every fixture is text. Code-mixed ASR output is not measured.",
    "Conflict detection is measured in isolation. In production it runs only after the LLM has "
    "classified a mid-workflow turn.",
    "Reply language (localization, knowledge-answer language, TTS voice) is not scored in M0.",
    "Fixtures are hand-authored and few per cell; Kannada and Hindi labels have not yet had a "
    "native-speaker review. Results show which behaviours fail, not how often customers hit them.",
)


# =========================================================
# ENTRY POINT
# =========================================================

def build_engine(with_retrieval):
    import contextlib
    import io

    # Model loading prints progress; the report is what matters.
    with contextlib.redirect_stdout(io.StringIO()):
        from app.intent.detector import IntentDetector

        detector = IntentDetector()
        retriever = None

        if with_retrieval:
            from app.knowledge.retriever import KnowledgeRetriever

            retriever = KnowledgeRetriever()

    return Engine(detector, retriever)


def run(fixtures_path, with_retrieval=True, engine=None):
    document, digest = load_fixtures(fixtures_path)
    engine = engine or build_engine(with_retrieval)
    results = [evaluate_fixture(engine, f) for f in document["fixtures"]]

    try:
        rel = Path(fixtures_path).resolve().relative_to(ROOT.parent).as_posix()
    except ValueError:
        rel = Path(fixtures_path).name

    return OrderedDict(
        meta=OrderedDict(
            fixtures_file=rel,
            fixtures_version=document.get("version"),
            fixtures_sha256=digest,
            embedding_model="paraphrase-multilingual-MiniLM-L12-v2",
            retrieval=with_retrieval,
            python=platform.python_version(),
        ),
        summary=summarize(results),
        limits=list(LIMITS),
        results=results,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline multilingual evaluation (M0).")
    parser.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
    parser.add_argument("--out", default=str(DEFAULT_REPORTS))
    parser.add_argument("--name", default="latest", help="report file stem (default: latest)")
    parser.add_argument("--no-retrieval", action="store_true", help="skip knowledge retrieval")
    parser.add_argument("--compare", help="a previous JSON report to list outcome changes against")
    args = parser.parse_args(argv)

    sys.stdout.reconfigure(encoding="utf-8")
    install_network_guard()

    try:
        report = run(args.fixtures, with_retrieval=not args.no_retrieval)
    except FixtureError as error:
        print(f"Fixture error: {error}", file=sys.stderr)
        return 2

    report["meta"]["name"] = args.name

    if args.compare:
        previous = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        report["compared_with"] = Path(args.compare).name
        report["changes"] = compare(previous, report)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / f"{args.name}.json"
    md_path = out / f"{args.name}.md"

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")

    s = report["summary"]
    print(f"{s['total']} fixtures: " + ", ".join(f"{k} {v}" for k, v in s["severity"].items()))
    for label, value in s["headline"].items():
        print(f"  {value:3}  {label}")
    if report.get("changes") is not None:
        print(f"  {len(report['changes'])} fixture(s) changed outcome against {args.compare}")
    print(f"Wrote {md_path} and {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
