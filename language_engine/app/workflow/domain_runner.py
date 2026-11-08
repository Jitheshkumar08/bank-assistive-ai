"""Running a domain's workflow definitions (domain integration, Phase 5).

This is NOT a second workflow framework. Definitions are the engine's usual
JSON files, loaded by WorkflowLoader from the domain's own folder; workflow
state is the engine's usual ConversationManager slot (load_workflow,
current_step, entities, suspend / resume / cancel / complete, WorkflowState);
control words come from the shared classify_turn, and "I'm done" from the
shared resolve_step_completion. Banking's DialogueManager steps through
Banking's form-filling workflows; this runner steps through the kinds of step
a knowledge-first domain needs:

  knowledge       answer `question` from the domain's verified knowledge,
                  narrowed to the step's `categories` (the runtime's own
                  evidence-only answerer, passed in as `answer`).
  destination     find where the student wants to go, by the names in the
                  institution's verified campus map; ask when it is missing.
  directions      read the verified route for (where the QR code says the
                  student is, destination) one step at a time.
  backend_action  ask the calling backend to perform `action` (admission
                  status); accept back ONLY one of the step's `outcomes`.

WHAT IT DOES NOT DO

  - detect intents, retrieve documents, translate, recognise speech or
    resolve QR codes: those are passed in (answer, campus_for) or happen
    before/after it (the runtime and the localizer);
  - write any reply text of its own: every sentence is the definition's or
    the domain's catalog's (WorkflowTexts), in canonical English;
  - invent a place, a route, a step or a record. A missing place, route or
    location is said to be missing.
"""

from __future__ import annotations

import hmac
import os
import secrets
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from app.conversation.state import WorkflowState
from app.dialogue.catalog_localizer import RenderedText, SentenceCatalog, compose_parts
from app.dialogue.completion_semantics import resolve_step_completion
from app.workflow.loader import WorkflowLoader

KNOWLEDGE = "knowledge"
DESTINATION = "destination"
DIRECTIONS = "directions"
BACKEND_ACTION = "backend_action"
STEP_KINDS = frozenset({KNOWLEDGE, DESTINATION, DIRECTIONS, BACKEND_ACTION})

#: Step outcomes (TurnResult.outcome), in addition to the runtime's own.
ASK = "ask"
CLARIFY = "clarify"
NOT_FOUND = "not_found"
NEEDS_LOCATION = "needs_location"
DIRECTIONS_GIVEN = "directions"
ACTION_REQUIRED = "action_required"
WORKFLOW_RESULT = "workflow_result"
ANSWERED = "answered"
NO_VERIFIED_INFORMATION = "no_verified_information"
CONTROL = "control"


class WorkflowDefinitionError(ValueError):
    """A definition the runner cannot execute. `problems` lists every reason."""

    def __init__(self, problems: List[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


class NoPendingAction(LookupError):
    """A backend result for an action this conversation is not waiting for."""


class ActionExpired(NoPendingAction):
    """A backend result that arrived after the pending action's lifetime (Phase 6)."""


class ActionTypeMismatch(NoPendingAction):
    """A backend result for a different kind of action than the one pending (Phase 6)."""


#: How long a backend_action stays answerable (Phase 6). The calling backend
#: answers within the same request cycle, so this only has to cover a slow
#: lookup; an answer arriving later is refused and the request abandoned.
DEFAULT_ACTION_TTL_SECONDS = 120.0


def action_ttl_from_env(environ=os.environ) -> float:
    """AI_ENGINE_ACTION_TTL_SECONDS, bounded to 5..900 s; the default when unset or invalid."""
    try:
        value = float(environ.get("AI_ENGINE_ACTION_TTL_SECONDS", DEFAULT_ACTION_TTL_SECONDS))
    except (TypeError, ValueError):
        return DEFAULT_ACTION_TTL_SECONDS
    if value != value:  # NaN
        return DEFAULT_ACTION_TTL_SECONDS
    return min(max(value, 5.0), 900.0)


class UnknownOutcome(ValueError):
    """A backend result whose outcome the workflow does not define."""


@dataclass
class StepReply:
    reply: object
    outcome: str
    intent: Optional[str] = None
    sources: List[dict] = field(default_factory=list)
    #: Canonical texts of a step-by-step list (directions), or None.
    steps: Optional[list] = None
    #: A request for the calling backend: {"id", "type", "workflow"}.
    action: Optional[dict] = None


@dataclass(frozen=True)
class WorkflowTexts:
    """The domain's canonical sentences the runner composes with."""

    stopped: str                # {topic}
    paused: str                 # {topic}
    continue_hint: str          # {topic}
    step_hint: str
    say_next_topic: str         # {topic}
    ask_destination: str
    no_campus_map: str
    no_current_location: str
    unknown_current_location: str
    place_not_found: str
    ask_another_place: str
    say_next_step: str
    last_step: str
    contact_office: str
    # Data sentences, filled with catalog.fill():
    no_route: str               # {place} {place2}
    already_there: str          # {place}
    directions_intro: str       # {place} {place2}
    step_of: str                # {n} {k}
    clarify_place: str          # {place} {place2}


def validate_definition(definition: dict) -> List[str]:
    """Every reason a definition cannot be run (empty = runnable)."""
    problems = []
    name = definition.get("workflow") if isinstance(definition, dict) else None
    label = name or "<unnamed>"
    if not isinstance(name, str) or not name.strip():
        return [f"{label}: 'workflow' name is required"]
    if not isinstance(definition.get("topic"), str):
        problems.append(f"{label}: 'topic' is required")
    steps = definition.get("steps")
    if not isinstance(steps, list) or not steps:
        return problems + [f"{label}: no steps"]
    for index, step in enumerate(steps, start=1):
        where = f"{label} step {index}"
        if not isinstance(step, dict) or step.get("step") != index:
            problems.append(f"{where}: steps must be numbered 1..n in order")
            continue
        kind = step.get("kind")
        if kind not in STEP_KINDS:
            problems.append(f"{where}: unknown kind {kind!r}")
            continue
        if not isinstance(step.get("instruction"), str) or not step["instruction"].strip():
            problems.append(f"{where}: 'instruction' is required")
        if kind == KNOWLEDGE:
            for key in ("question", "topic", "name"):
                if not isinstance(step.get(key), str) or not step[key].strip():
                    problems.append(f"{where}: knowledge steps need '{key}'")
            categories = step.get("categories")
            if not isinstance(categories, list) or not categories or not all(isinstance(c, str) for c in categories):
                problems.append(f"{where}: knowledge steps need 'categories'")
        elif kind == DESTINATION:
            if step.get("field") != "destination":
                problems.append(f"{where}: destination steps need field 'destination'")
            following = steps[index] if index < len(steps) else None
            if not isinstance(following, dict) or following.get("kind") != DIRECTIONS:
                problems.append(f"{where}: a destination step must be followed by a directions step")
        elif kind == BACKEND_ACTION:
            if not isinstance(step.get("action"), str) or not step["action"].strip():
                problems.append(f"{where}: backend_action steps need 'action'")
            outcomes = step.get("outcomes")
            if not isinstance(outcomes, dict) or not outcomes or not all(
                    isinstance(k, str) and isinstance(v, list) and v and all(isinstance(s, str) and s for s in v)
                    for k, v in outcomes.items()):
                problems.append(f"{where}: backend_action steps need 'outcomes' (code -> sentences)")
    if any(isinstance(s, dict) and s.get("kind") == KNOWLEDGE for s in steps) and not isinstance(definition.get("done"), str):
        problems.append(f"{label}: knowledge workflows need a 'done' sentence")
    return problems


def _place(place) -> RenderedText:
    return RenderedText(place.name, place.names)


class DomainWorkflowRunner:
    """
    Executes one domain's workflow definitions against a conversation.

    Holds no per-session state: everything lives in the conversation's own
    workflow slot, so one runner serves every session of the domain.

        answer(question, categories, topic, context, language) -> StepReply
        campus_for(institution_id) -> InstitutionCampus | None (verified only
            in production)
    """

    def __init__(
        self,
        *,
        loader: WorkflowLoader,
        texts: WorkflowTexts,
        catalog: SentenceCatalog,
        answer: Callable[..., StepReply],
        campus_for: Callable[[str], object],
        action_ttl_seconds: Optional[float] = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.loader = loader
        self.action_ttl_seconds = action_ttl_from_env() if action_ttl_seconds is None else action_ttl_seconds
        self.clock = clock
        self.texts = texts
        self.catalog = catalog
        self.answer = answer
        self.campus_for = campus_for

    # -----------------------------------------------------------------
    # Definitions
    # -----------------------------------------------------------------

    def validate_all(self) -> None:
        """Refuses to run with any definition it cannot execute."""
        problems = []
        for name in self.loader.available_workflows():
            definition = self.loader.load_workflow(name)
            problems += [f"{name}: unreadable"] if definition is None else validate_definition(definition)
        if problems:
            raise WorkflowDefinitionError(problems)

    def _definition(self, conversation) -> Optional[dict]:
        name = conversation.current_workflow
        return self.loader.load_workflow(name) if name else None

    @staticmethod
    def _step(definition: dict, number: int) -> Optional[dict]:
        steps = definition["steps"]
        return steps[number - 1] if 1 <= number <= len(steps) else None

    def current(self, conversation):
        """(definition, step) of the ACTIVE workflow, or (None, None)."""
        if conversation.workflow_state != WorkflowState.ACTIVE:
            return None, None
        definition = self._definition(conversation)
        if definition is None:
            return None, None
        return definition, self._step(definition, conversation.current_step)

    def active(self, conversation) -> bool:
        return self.current(conversation)[1] is not None

    def awaiting_destination(self, conversation) -> bool:
        step = self.current(conversation)[1]
        return step is not None and step["kind"] == DESTINATION

    def release(self, conversation) -> None:
        """Frees the slot when the student moved on to something else."""
        conversation.release_workflow()

    # -----------------------------------------------------------------
    # Starting
    # -----------------------------------------------------------------

    def start(self, conversation, workflow_id: str, intent: str, text: str, context: dict,
              language: str) -> Optional[StepReply]:
        """
        Starts `workflow_id` with the sentence that asked for it. None when
        the definition is missing or unusable (nothing is activated).
        """
        definition = self.loader.load_workflow(workflow_id)
        if definition is None or validate_definition(definition):
            return None
        conversation.set_intent(intent)
        conversation.load_workflow(definition["workflow"])
        step = self._step(definition, 1)
        if step["kind"] == KNOWLEDGE:
            # The first step answers what was actually asked.
            reply = self._knowledge(conversation, definition, step, context, language, question=text)
        elif step["kind"] == DESTINATION:
            reply = self._destination(conversation, definition, text, context, starting=True)
        else:
            reply = self._backend_action(conversation, definition, step)
        return self._remember(conversation, reply)

    # -----------------------------------------------------------------
    # Continuing
    # -----------------------------------------------------------------

    def control(self, conversation, control, context: dict, language: str) -> Optional[StepReply]:
        """next / cancel / pause / resume / a step reference inside a workflow. None = no workflow."""
        t = self.texts
        state = conversation.workflow_state
        if state not in (WorkflowState.ACTIVE, WorkflowState.SUSPENDED):
            return None
        definition = self._definition(conversation)
        if definition is None:
            return None
        topic = definition["topic"]

        if control == "cancel":
            conversation.cancel_workflow()
            conversation.entities.pop("action", None)
            return self._reply(t.stopped.format(topic=topic), CONTROL, conversation)
        if control == "pause":
            if state != WorkflowState.ACTIVE:
                return None
            conversation.suspend_workflow()
            return self._reply(t.paused.format(topic=topic), CONTROL, conversation)
        if control == "resume":
            # "continue" / ಮುಂದುವರಿಸಿ is read as resume by the shared
            # classifier. On an ACTIVE workflow there is nothing to unpause:
            # restate where it stands rather than say "nothing is paused".
            conversation.resume_workflow()
            prompt = conversation.entities.get("prompt")
            return self._reply(prompt or t.step_hint, CONTROL, conversation)
        if state != WorkflowState.ACTIVE:
            return None
        if control == "next":
            return self._advance(conversation, definition, context, language)
        # A step reference ("step 3"): College steps are followed in order.
        return self._reply(t.step_hint, CONTROL, conversation)

    def continue_turn(self, conversation, text: str, context: dict, language: str) -> Optional[StepReply]:
        """
        A non-control sentence while a workflow is ACTIVE. None = not part of
        the workflow; the runtime then routes it as usual.
        """
        definition, step = self.current(conversation)
        if step is None:
            return None
        kind = step["kind"]
        if kind == DESTINATION:
            campus = self.campus_for(context.get("institution_id"))
            if campus is not None and campus.find_places(text).places:
                return self._remember(conversation, self._destination(conversation, definition, text, context,
                                                                      starting=False))
            return None
        if kind == DIRECTIONS:
            spoken = self._route_step(conversation)
            if spoken is not None and resolve_step_completion(text, str(spoken)) is True:
                return self._advance(conversation, definition, context, language)
            return None
        if kind == BACKEND_ACTION:
            # The backend answers an action in the same request cycle; a new
            # sentence means that request was abandoned. Never kept waiting.
            conversation.entities.pop("action", None)
            self.release(conversation)
        return None

    def retry_destination(self, conversation, context: dict) -> StepReply:
        """The sentence that answered "where to?" named no place in the map."""
        definition, _ = self.current(conversation)
        if conversation.entities.get("destination"):
            # Waiting only for the student's location (a new QR scan).
            return self._remember(conversation, self._destination(conversation, definition, None, context,
                                                                  starting=False))
        t = self.texts
        return self._remember(conversation, StepReply(compose_parts(t.place_not_found, t.ask_another_place),
                                                      NOT_FOUND, intent=conversation.current_intent))

    def hint(self, conversation) -> Optional[str]:
        """What to say after a side answer while a workflow is in progress."""
        definition, step = self.current(conversation)
        if step is None or step["kind"] not in (KNOWLEDGE, DIRECTIONS):
            return None
        return self.texts.continue_hint.format(topic=definition["topic"])

    def _advance(self, conversation, definition, context, language) -> StepReply:
        step = self._step(definition, conversation.current_step)
        kind = step["kind"]
        if kind == DIRECTIONS:
            route = conversation.entities.get("route") or []
            index = conversation.entities.get("direction", 0) + 1
            if index >= len(route):
                conversation.complete_workflow()
                return self._reply(self.texts.last_step, CONTROL, conversation)
            conversation.entities["direction"] = index
            return self._remember(conversation, self._directions(conversation))
        if kind == DESTINATION:
            return self._remember(conversation, StepReply(self.texts.ask_destination, ASK,
                                                          intent=conversation.current_intent))
        if kind == BACKEND_ACTION:
            return self._reply(step["instruction"], ACTION_REQUIRED, conversation)
        following = self._step(definition, conversation.current_step + 1)
        if following is None:
            return self._reply(definition["done"], CONTROL, conversation)
        conversation.current_step += 1
        return self._remember(conversation, self._knowledge(conversation, definition, following, context, language))

    # -----------------------------------------------------------------
    # Step kinds
    # -----------------------------------------------------------------

    def _knowledge(self, conversation, definition, step, context, language, question=None) -> StepReply:
        answered = self.answer(question or step["question"], frozenset(step["categories"]), step["topic"],
                               context, language)
        parts = [] if question else [step["instruction"]]
        parts.append(answered.reply)
        following = self._step(definition, step["step"] + 1)
        if following is not None:
            parts.append(self.texts.say_next_topic.format(topic=following["name"]))
        else:
            parts.append(definition["done"])
            conversation.complete_workflow()
        return StepReply(compose_parts(*parts), answered.outcome, intent=conversation.current_intent,
                         sources=answered.sources)

    def _destination(self, conversation, definition, text, context, *, starting) -> StepReply:
        t, intent = self.texts, conversation.current_intent
        campus = self.campus_for(context.get("institution_id"))
        if campus is None:
            self.release(conversation)
            return StepReply(compose_parts(t.no_campus_map, t.contact_office), NO_VERIFIED_INFORMATION, intent=intent)

        # Where the student is: ONLY what their QR code identified.
        origin_id = context.get("location_id") or context.get("area")
        destination_id = conversation.entities.get("destination")

        if text is not None:
            named = campus.find_places(text).places
            candidates = [p for p in named if p != origin_id]
            if not candidates:
                if origin_id and origin_id in named:
                    self.release(conversation)
                    return StepReply(self.catalog.fill(t.already_there, place=_place(campus.place(origin_id))),
                                     ANSWERED, intent=intent)
                if starting or not destination_id:
                    return StepReply(t.ask_destination if starting else compose_parts(t.place_not_found,
                                                                                         t.ask_another_place),
                                     ASK if starting else NOT_FOUND, intent=intent)
            elif len(candidates) > 1:
                first, second = (campus.place(p) for p in candidates[:2])
                return StepReply(self.catalog.fill(t.clarify_place, place=_place(first), place2=_place(second)),
                                 CLARIFY, intent=intent)
            else:
                destination_id = candidates[0]
                conversation.entities["destination"] = destination_id

        if not destination_id:
            return StepReply(t.ask_destination, ASK, intent=intent)
        if not origin_id:
            # Kept: the next turn after a scan carries the location.
            return StepReply(t.no_current_location, NEEDS_LOCATION, intent=intent)

        origin, destination = campus.place(origin_id), campus.place(destination_id)
        if origin is None:
            self.release(conversation)
            return StepReply(compose_parts(t.unknown_current_location, t.contact_office), NO_VERIFIED_INFORMATION,
                             intent=intent)
        route = campus.route(origin_id, destination_id)
        if route is None:
            self.release(conversation)
            return StepReply(compose_parts(self.catalog.fill(t.no_route, place=_place(origin),
                                                             place2=_place(destination)), t.contact_office),
                             NO_VERIFIED_INFORMATION, intent=intent)

        conversation.current_step += 1          # -> the directions step
        conversation.entities.update(route=[dict(s) for s in route.steps], direction=0,
                                     origin=origin_id, destination=destination_id)
        intro = self.catalog.fill(t.directions_intro, place=_place(origin), place2=_place(destination))
        return self._directions(conversation, intro=intro)

    def _route_step(self, conversation) -> Optional[RenderedText]:
        route = conversation.entities.get("route") or []
        index = conversation.entities.get("direction", 0)
        if not 0 <= index < len(route):
            return None
        return RenderedText(route[index]["en"], route[index])

    def _directions(self, conversation, intro=None) -> StepReply:
        t = self.texts
        route = conversation.entities["route"]
        index = conversation.entities["direction"]
        parts = [intro, self.catalog.fill(t.step_of, n=str(index + 1), k=str(len(route))),
                 self._route_step(conversation)]
        if index + 1 < len(route):
            parts.append(t.say_next_step)
        else:
            parts.append(t.last_step)
            conversation.complete_workflow()
        return StepReply(compose_parts(*parts), DIRECTIONS_GIVEN, intent=conversation.current_intent,
                         steps=[RenderedText(s["en"], s) for s in route])

    def _backend_action(self, conversation, definition, step) -> StepReply:
        action_id = secrets.token_urlsafe(16)
        # issued_at: when the action expires (Phase 6). Never sent anywhere.
        conversation.entities["action"] = {"id": action_id, "type": step["action"], "issued_at": self.clock()}
        return StepReply(step["instruction"], ACTION_REQUIRED, intent=conversation.current_intent,
                         action={"id": action_id, "type": step["action"], "workflow": definition["workflow"]})

    # -----------------------------------------------------------------
    # A backend's answer to an action
    # -----------------------------------------------------------------

    def apply_result(self, conversation, action_id: str, outcome: str,
                     action_type: Optional[str] = None) -> StepReply:
        """
        The calling backend's answer to the pending action: an outcome CODE,
        nothing else. Refused unless this conversation is waiting for exactly
        this action, and unless the workflow defines the outcome.

        Phase 6: also refused when `action_type` (when the caller names it) is
        not the pending action's type, and when the action has expired. An
        expired action is abandoned, so a late answer can never be replayed.
        """
        definition, step = self.current(conversation)
        pending = conversation.entities.get("action")
        if step is None or step["kind"] != BACKEND_ACTION or not isinstance(pending, dict) \
                or not hmac.compare_digest(str(pending.get("id", "")), str(action_id or "")):
            raise NoPendingAction("No such pending action.")
        if action_type is not None and not hmac.compare_digest(str(pending.get("type", "")), str(action_type)):
            raise ActionTypeMismatch("The result is for a different kind of action.")
        issued_at = pending.get("issued_at")
        if isinstance(issued_at, (int, float)) and self.clock() - issued_at > self.action_ttl_seconds:
            conversation.entities.pop("action", None)
            self.release(conversation)
            raise ActionExpired("The pending action has expired.")
        sentences = step["outcomes"].get(outcome)
        if sentences is None:
            raise UnknownOutcome("Unknown outcome.")
        conversation.entities.pop("action", None)
        conversation.complete_workflow()
        return self._remember(conversation, StepReply(compose_parts(*sentences), WORKFLOW_RESULT,
                                                      intent=conversation.current_intent))

    # -----------------------------------------------------------------

    def _reply(self, text, outcome, conversation) -> StepReply:
        return StepReply(text, outcome, intent=conversation.current_intent)

    @staticmethod
    def _remember(conversation, reply: StepReply) -> StepReply:
        """The workflow's last prompt, replayed on resume."""
        conversation.entities["prompt"] = reply.reply
        return reply
