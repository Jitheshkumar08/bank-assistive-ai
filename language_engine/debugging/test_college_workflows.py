"""
Phase 5 (domain integration): College workflows -- admission guidance,
admission status, campus navigation, College service guidance.

Offline except for the local sentence encoder. No Groq, no network: the
grounded answerer gets a FAKE model client that records every prompt. Data is
SYNTHETIC: debugging/fixtures/college_kb (documents) and
debugging/fixtures/college_campus (maps), all verified=false.

Run from language_engine/:

    python -m debugging.test_college_workflows
"""

import copy
import hashlib
import json
import sys
import tempfile
import time
from pathlib import Path

# The Phase 4 suite's helpers. Importing it first also points the unanswered
# log at a temporary directory before any engine import.
from debugging.test_college_runtime import (  # noqa: E402
    A,
    B,
    BANK_TOKEN,
    COLLEGE_TOKEN,
    FakeLLM,
    FakeSTT,
    Service,
    conversation,
    detector,
    evidence_of,
    fixture_kb,
    model,
)

import service.main as main  # noqa: E402
from app.conversation.state import WorkflowState  # noqa: E402
from app.dialogue.catalog_localizer import CatalogLocalizer, RenderedText  # noqa: E402
from app.dialogue.llm.grounded_answer import GroundedAnswerer  # noqa: E402
from app.dialogue.localization_catalog import UNTRANSLATED_MARKER  # noqa: E402
from app.domains import COLLEGE, get_domain  # noqa: E402
from app.domains.college import responses as R  # noqa: E402
from app.domains.college.intents import COLLEGE_INTENT_PROFILE  # noqa: E402
from app.knowledge.collection import ManifestError  # noqa: E402
from app.navigation.campus_map import CampusMapCollection  # noqa: E402
from app.workflow.domain_runner import (  # noqa: E402
    NoPendingAction,
    UnknownOutcome,
    WorkflowDefinitionError,
    validate_definition,
)
from app.workflow.loader import WorkflowLoader  # noqa: E402
from service.domain_runtime import (  # noqa: E402
    NO_VERIFIED_INFORMATION,
    build_college_runtime,
    mentions_reference_number,
)

PASSED = []
FAILED_CHECKS = []

HERE = Path(__file__).resolve().parent
CAMPUS = HERE / "fixtures" / "college_campus"
WORKFLOWS = COLLEGE.workflows_dir
TMP = tempfile.TemporaryDirectory()


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED_CHECKS.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


# =========================================================
# BUILDERS
# =========================================================

def guide(prompt):
    """Answers with the evidence's first content line (it never invents)."""
    for line in evidence_of(prompt).splitlines():
        line = line.strip()
        if line and not line.startswith(("#", ">", "[", "(")) and "SYNTHETIC" not in line:
            return line
    return "NO_ANSWER"


def campus_fixtures():
    return CampusMapCollection(CAMPUS / "manifest.json", "college")


def runtime(llm=None, *, campus=True, kb=None):
    llm = llm or FakeLLM(script=guide)
    rt = build_college_runtime(
        knowledge=kb or fixture_kb(), answerer=GroundedAnswerer(R.PERSONA, client=llm), model=model(),
        stt_provider=lambda: FakeSTT(),
        **({"campus": campus_fixtures(), "campus_include_unverified": True} if campus else {}),
    )
    rt.intent_detector = detector()
    return rt, llm


def spy_retrieval(rt):
    calls = []
    original = rt.knowledge.retrieve

    def spy(text, institution, **kwargs):
        calls.append((institution, frozenset(kwargs.get("categories") or ())))
        return original(text, institution, **kwargs)

    rt.knowledge.retrieve = spy
    return calls


class Visit:
    """One student's conversation against a runtime (no HTTP)."""

    def __init__(self, rt, institution=A, language="en", area=None):
        self.rt, self.conv = rt, conversation()
        self.localizer = CatalogLocalizer(language, R.COLLEGE_CATALOG)
        self.context = {"institution_id": institution, **({"area": area} if area else {})}

    def say(self, text, **context):
        self.context.update(context)
        return self.rt.run_turn(self.conv, text, self.localizer, context=dict(self.context))

    def result(self, action_id, outcome):
        return self.rt.apply_workflow_result(self.conv, action_id, outcome, self.localizer)


def map_steps(institution, origin, destination, language="en"):
    campus = campus_fixtures().for_institution(institution, include_unverified=True)
    return [s.get(language, s["en"]) for s in campus.route(origin, destination).steps]


# =========================================================
# DEFINITIONS AND MAPPING
# =========================================================

def test_definitions_follow_the_engine_workflow_format():
    loader = WorkflowLoader(WORKFLOWS)
    names = loader.available_workflows()
    check("College has exactly the three Phase 5 workflows",
          sorted(names) == ["admission guidance", "admission status", "campus navigation"], str(names))
    for name in names:
        definition = loader.load_workflow(name)
        check(f"'{name}' loads through the engine's WorkflowLoader", definition is not None)
        check(f"'{name}' is executable", not validate_definition(definition), str(validate_definition(definition)))
        check(f"'{name}' steps carry the engine's step/instruction fields",
              all(isinstance(s.get("step"), int) and isinstance(s.get("instruction"), str) for s in definition["steps"]))

    banking = WorkflowLoader()
    check("Banking's workflows are unchanged and separate",
          sorted(banking.available_workflows()) == ["apply for loan", "deposit money", "withdraw money"]
          and banking.workflow_folder != loader.workflow_folder)
    check("no College workflow is visible to Banking",
          not any(banking.has_workflow(n) for n in names))

    bad = copy.deepcopy(loader.load_workflow("campus navigation"))
    bad["steps"].pop()
    check("a destination step without a directions step is refused", validate_definition(bad))
    bad = copy.deepcopy(loader.load_workflow("admission status"))
    bad["steps"][0]["outcomes"] = {}
    check("a backend action with no outcomes is refused", validate_definition(bad))
    bad = copy.deepcopy(loader.load_workflow("admission guidance"))
    bad["steps"][1]["kind"] = "free_text"
    check("an unknown step kind is refused", validate_definition(bad))

    with tempfile.TemporaryDirectory() as folder:
        Path(folder, "broken.json").write_text(json.dumps({"workflow": "broken", "topic": "x", "steps": [
            {"step": 1, "kind": "knowledge", "instruction": "x"}]}), encoding="utf-8")
        from app.workflow.domain_runner import DomainWorkflowRunner
        runner = DomainWorkflowRunner(loader=WorkflowLoader(folder), texts=None, catalog=None,
                                      answer=None, campus_for=None)
        try:
            runner.validate_all()
            refused = False
        except WorkflowDefinitionError:
            refused = True
        check("a runtime refuses to start with a broken definition", refused)


def test_every_workflow_sentence_is_in_the_catalog():
    sentences = {template for template, _ in R.SENTENCES}
    loader = WorkflowLoader(WORKFLOWS)
    missing = []
    for name in loader.available_workflows():
        definition = loader.load_workflow(name)
        if definition.get("done"):
            missing += [definition["done"]] if definition["done"] not in sentences else []
        if definition["topic"] not in R.TOPICS:
            missing.append(definition["topic"])
        for step in definition["steps"]:
            if step["instruction"] not in sentences:
                missing.append(step["instruction"])
            for key in ("name", "topic"):
                if key in step and step[key] not in R.TOPICS:
                    missing.append(step[key])
            for texts in step.get("outcomes", {}).values():
                missing += [t for t in texts if t not in sentences]
    check("every workflow sentence and topic has Kannada and Hindi renderings", not missing, str(missing))


def test_intent_to_workflow_mapping():
    handlers = {spec.name: spec.handler for spec in COLLEGE_INTENT_PROFILE.intents}
    check("admission_process -> admission guidance", handlers["admission_process"] == "workflow:admission_guidance")
    check("admission_status -> admission status", handlers["admission_status"] == "workflow:admission_status")
    check("campus_navigation -> campus navigation", handlers["campus_navigation"] == "workflow:campus_navigation")
    loader = WorkflowLoader(WORKFLOWS)
    check("every workflow handler names an existing definition",
          all(loader.has_workflow(h.split(":", 1)[1]) for h in handlers.values() if h.startswith("workflow:")))
    services = ["fee_information", "payment_process", "hostel_information", "transport_information",
                "scholarship_information", "course_information", "department_information", "academic_calendar",
                "examination_information", "student_services", "contact_information"]
    check("College service intents stay knowledge-answered", all(handlers[i] == "knowledge" for i in services))

    rt, _ = runtime()
    for text, intent in [("What is the admission process?", "admission_process"),
                         ("What is my admission status?", "admission_status"),
                         ("How do I get to the library?", "campus_navigation"),
                         ("ಪ್ರವೇಶ ಪ್ರಕ್ರಿಯೆ ಏನು", "admission_process"),
                         ("ಗ್ರಂಥಾಲಯಕ್ಕೆ ಹೇಗೆ ಹೋಗುವುದು", "campus_navigation")]:
        visit = Visit(rt, area="admissions-desk")
        result = visit.say(text)
        check(f"{text!r} starts the {intent} workflow",
              result.intent == intent and visit.conv.current_workflow is not None, f"{result.intent}")


# =========================================================
# A. ADMISSION GUIDANCE
# =========================================================

def test_admission_guidance_walks_through_verified_steps():
    rt, llm = runtime()
    calls = spy_retrieval(rt)
    visit = Visit(rt)

    r1 = visit.say("What is the admission process?")
    check("step 1 answers the question from the admission-process document",
          r1.outcome == "answered" and r1.sources and r1.sources[0]["id"] == "a-admission-process", str(r1.sources))
    check("step 1 offers the next step by name", r1.reply.endswith("Say next to continue with the documents you need."),
          r1.reply)
    check("step 1 searched only admission process / deadlines for this institution",
          calls[-1] == (A, frozenset({"admission_process", "application_deadlines"})), str(calls[-1]))
    check("the workflow is active at step 1",
          visit.conv.current_workflow == "admission guidance" and visit.conv.current_step == 1
          and visit.conv.workflow_state == WorkflowState.ACTIVE)

    r2 = visit.say("next")
    check("step 2: required documents, from the documents document",
          r2.reply.startswith("Next, the documents you need.") and "ALPHA-DOCS" in r2.reply
          and r2.sources[0]["category"] == "admission_documents", r2.reply)
    check("step 2 searched only admission documents", calls[-1] == (A, frozenset({"admission_documents"})))

    prompts = len(llm.prompts)
    r3 = visit.say("next")
    check("step 3: no verified eligibility document -> says so and refers to the office",
          r3.outcome == NO_VERIFIED_INFORMATION
          and "I don't have verified information about admission eligibility yet." in r3.reply
          and R.CONTACT_OFFICE in r3.reply, r3.reply)
    check("step 3 never asked the model (nothing to answer from)", len(llm.prompts) == prompts)
    check("step 3 continues to the next step", r3.reply.endswith("Say next to continue with what to do now."))

    r4 = visit.say("ಮುಂದಿನ ಹಂತ")
    check("step 4 (Kannada 'next'): the next admission step", r4.reply.startswith("Next, what to do now."), r4.reply)

    r5 = visit.say("next")
    check("step 5: where to get help, from the contacts document",
          r5.reply.startswith("Finally, where to get help.") and "ALPHA-CONTACT" in r5.reply, r5.reply)
    check("step 5 ends the guidance", r5.reply.endswith(R.GUIDANCE_DONE)
          and visit.conv.workflow_state == WorkflowState.COMPLETED)
    r6 = visit.say("next")
    check("after the last step there is no task", r6.reply == R.NO_TASK)
    check("every guidance step was retrieved for institution A only", all(inst == A for inst, _ in calls))


def test_admission_guidance_side_questions_cancel_pause_resume():
    rt, _ = runtime()
    visit = Visit(rt)
    visit.say("How do I apply for admission?")
    side = visit.say("Is there a hostel for girls?")
    check("a side question is answered from its own category",
          "ALPHA-HOSTEL" in side.reply and side.sources[0]["category"] == "hostel", side.reply)
    check("and reminds how to continue the guidance", side.reply.endswith("Say next to continue the admission guidance."))
    nxt = visit.say("next")
    check("next then continues the guidance where it was", nxt.reply.startswith("Next, the documents you need."))

    paused = visit.say("pause")
    check("pause suspends the guidance", paused.reply == R.PAUSED.format(topic="the admission guidance")
          and visit.conv.workflow_state == WorkflowState.SUSPENDED)
    check("next while paused does not advance", visit.say("next").reply == R.NO_TASK and visit.conv.current_step == 2)
    resumed = visit.say("resume")
    check("resume replays the step where it stopped", resumed.reply.startswith("Next, the documents you need."),
          resumed.reply)
    stopped = visit.say("cancel")
    check("cancel stops the guidance", stopped.reply == R.STOPPED.format(topic="the admission guidance")
          and visit.conv.workflow_state == WorkflowState.CANCELLED)
    check("resume with nothing paused says so", visit.say("resume").reply == R.NOTHING_PAUSED)
    check("a step reference inside a workflow is not guessed at",
          Visit(rt).say("step 3").reply == R.NO_TASK)


def test_admission_guidance_institution_isolation():
    rt, llm = runtime()
    calls = spy_retrieval(rt)
    visit = Visit(rt, institution=B)
    r1 = visit.say("What is the admission process?")
    check("institution B has no process document -> no verified information, not A's",
          r1.outcome == NO_VERIFIED_INFORMATION and "ALPHA" not in r1.reply, r1.reply)
    r2 = visit.say("next")
    check("B's documents step answers from B's own document", "BETA-DOCS" in r2.reply and "ALPHA" not in r2.reply)
    check("every retrieval named institution B", all(inst == B for inst, _ in calls))
    check("no prompt ever carried institution A's evidence", not any("ALPHA" in p for p in llm.prompts))


# =========================================================
# B. ADMISSION STATUS
# =========================================================

STATUS_OUTCOMES = ["details_available", "not_signed_in", "not_a_student", "no_record", "ambiguous_record",
                   "context_invalid", "unavailable"]


def test_admission_status_is_a_backend_action_without_data():
    rt, llm = runtime()
    calls = spy_retrieval(rt)
    visit = Visit(rt)
    result = visit.say("What is my admission status?")
    action = result.action or {}
    check("admission status returns an action for the backend",
          result.outcome == "action_required" and action.get("type") == "admission_status"
          and action.get("workflow") == "admission status" and len(action.get("id", "")) >= 16, str(action))
    check("the action carries no student data and nothing typed", set(action) == {"id", "type", "workflow"})
    check("nothing was retrieved and the model was not asked", not calls and not llm.prompts)
    check("the reply only says it will check", result.reply == R.STATUS_CHECKING)
    ids = {Visit(rt).say("What is my admission status?").action["id"] for _ in range(5)}
    check("each request gets a fresh, unguessable action id", len(ids) == 5)


def test_admission_status_never_collects_reference_numbers():
    rt, _ = runtime()
    visit = Visit(rt)
    typed = "My NUCAT reference is NU2025-0042, what is my admission status?"
    result = visit.say(typed)
    check("a typed reference gets the security notice", result.reply.startswith(R.REFERENCE_WARNING), result.reply)
    check("the reference is not in the action", "NU2025" not in json.dumps(result.action))
    check("the reference is not kept in the conversation history",
          not any("NU2025" in str(h["message"]) or "0042" in str(h["message"]) for h in visit.conv.history),
          str(visit.conv.history))
    check("nor echoed in the reply", "NU2025" not in result.reply)
    check("reference-like tokens are recognised", mentions_reference_number("ref AB12345")
          and not mentions_reference_number("what is my admission status"))
    other = Visit(rt).say("My registration number is 4BX22CS001, which bus should I take?")
    check("a reference typed with another question is neither forwarded nor echoed",
          other.action is None and "4BX22CS001" not in other.reply)


def test_admission_status_accepts_only_its_own_outcome_codes():
    rt, _ = runtime()
    for outcome in STATUS_OUTCOMES:
        visit = Visit(rt)
        action = visit.say("What is my admission status?").action
        result = visit.result(action["id"], outcome)
        expected = " ".join(loader_outcomes()[outcome])
        check(f"outcome {outcome} -> its defined reply", result.reply == expected and result.outcome == "workflow_result",
              result.reply)
        check(f"outcome {outcome} completes the workflow", visit.conv.workflow_state == WorkflowState.COMPLETED)

    visit = Visit(rt)
    action = visit.say("What is my admission status?").action
    for label, args, error in [
        ("an unknown outcome code", (action["id"], "admitted_with_rank_1"), UnknownOutcome),
        ("a wrong action id", ("x" * 22, "details_available"), NoPendingAction),
    ]:
        try:
            visit.result(*args)
            refused = None
        except (NoPendingAction, UnknownOutcome) as raised:
            refused = type(raised)
        check(f"{label} is refused", refused is error)
    check("a refused result changes nothing", visit.conv.workflow_state == WorkflowState.ACTIVE)
    visit.result(action["id"], "no_record")
    try:
        visit.result(action["id"], "details_available")
        replay = False
    except NoPendingAction:
        replay = True
    check("a result cannot be replayed once applied", replay)

    visit = Visit(rt)
    action = visit.say("What is my admission status?").action
    visit.say("What are the bus routes?")
    try:
        visit.result(action["id"], "details_available")
        stale = False
    except NoPendingAction:
        stale = True
    check("a new question abandons the pending request; its result is refused", stale)

    other = Visit(rt)
    try:
        other.result(action["id"], "details_available")
        cross = False
    except NoPendingAction:
        cross = True
    check("another conversation cannot answer this one's action", cross)


def loader_outcomes():
    return WorkflowLoader(WORKFLOWS).load_workflow("admission status")["steps"][0]["outcomes"]


def test_admission_status_over_http():
    with Service(college_factory=lambda: runtime()[0]) as svc:
        body = svc.college("What is my admission status?", session="ST").json()
        action = body["action"]
        check("HTTP: the turn carries the action and no record", action and action["type"] == "admission_status"
              and body["outcome"] == "action_required" and body["sources"] in (None, []), str(body))

        def post(session, payload, token=COLLEGE_TOKEN):
            return svc.client.post(f"/sessions/{session}/workflow-result", headers={"X-Internal-Token": token},
                                   json=payload)

        r = post("ST", {"action_id": action["id"], "outcome": "details_available", "student_name": "X"})
        check("HTTP: extra fields (any record data) are refused", r.status_code == 422, r.text)
        r = post("ST", {"action_id": action["id"], "outcome": "Admitted!"})
        check("HTTP: a free-text outcome is refused", r.status_code == 422, r.text)
        r = post("ST", {"action_id": action["id"], "outcome": "details_available"}, token=BANK_TOKEN)
        check("HTTP: the Banking backend cannot answer a College action", r.status_code == 409, r.text)
        r = post("ST", {"action_id": action["id"], "outcome": "details_available"}, token="wrong-token")
        check("HTTP: an unauthenticated caller is refused", r.status_code == 401, r.text)
        r = post("NOPE", {"action_id": action["id"], "outcome": "details_available"})
        check("HTTP: an unknown visit is refused", r.status_code == 409 and r.json()["error"] == "no_pending_action")
        r = post("ST", {"action_id": action["id"], "outcome": "no_such_outcome"})
        check("HTTP: an undefined outcome is refused", r.status_code == 422
              and r.json()["error"] == "invalid_workflow_result", r.text)

        r = post("ST", {"action_id": action["id"], "outcome": "details_available"})
        body = r.json()
        check("HTTP: a defined outcome is worded by the engine", r.status_code == 200
              and body["reply"] == R.STATUS_DETAILS and body["workflow"]["state"] == "completed", r.text)
        r = post("ST", {"action_id": action["id"], "outcome": "details_available"})
        check("HTTP: and cannot be applied twice", r.status_code == 409)

        kn = svc.college("ನನ್ನ ಪ್ರವೇಶದ ಸ್ಥಿತಿ ಏನು", session="KN", language="kn").json()
        r = post("KN", {"action_id": kn["action"]["id"], "outcome": "not_signed_in"})
        check("HTTP: the outcome is worded in the visit's language (Kannada)",
              r.json()["reply"] == dict(R.SENTENCES)[R.STATUS_SIGN_IN]["kn"], r.text)


# =========================================================
# C. CAMPUS NAVIGATION
# =========================================================

def test_navigation_from_the_qr_location():
    rt, llm = runtime()
    visit = Visit(rt, area="admissions-desk")
    expected = map_steps(A, "admissions-desk", "library")

    r1 = visit.say("How do I get to the library?")
    check("directions start from the QR location",
          r1.outcome == "directions" and r1.reply.startswith("Here are the directions from Admissions desk to Library."),
          r1.reply)
    check("step 1 of 3 is the map's own first step", f"Step 1 of 3: {expected[0]}" in r1.reply, r1.reply)
    check("the full step list is the map's route, unchanged", r1.steps == expected, str(r1.steps))
    check("the student is told how to continue", r1.reply.endswith(R.SAY_NEXT_STEP))

    r2 = visit.say("next")
    check("next -> step 2", r2.reply.startswith(f"Step 2 of 3: {expected[1]}"), r2.reply)
    r3 = visit.say("ok I did it")
    check("'I did it' (shared completion reading) -> step 3, the last",
          r3.reply == f"Step 3 of 3: {expected[2]} {R.LAST_STEP}", r3.reply)
    check("the navigation completes after the last step", visit.conv.workflow_state == WorkflowState.COMPLETED)
    check("navigation never retrieved documents or asked the model", not llm.prompts)

    visit = Visit(rt, area="admissions-desk")
    r = visit.say("Take me to the library")
    check("'take me to the library' (library also names student services) is navigation",
          r.intent == "campus_navigation" and r.outcome == "directions", f"{r.intent} {r.outcome}")
    production, _ = runtime(campus=False)
    r = Visit(production, area="admissions-desk").say("Take me to the library")
    check("without a verified map that rule never applies", r.intent == "student_services", str(r.intent))


def test_navigation_asks_for_a_missing_destination():
    rt, _ = runtime()
    visit = Visit(rt, area="admissions-desk")
    r = visit.say("I need directions")
    check("no destination -> asks where to go", r.reply == R.ASK_DESTINATION and r.outcome == "ask", r.reply)
    check("and waits at the destination step", visit.conv.current_step == 1
          and visit.conv.workflow_state == WorkflowState.ACTIVE)
    r = visit.say("the examination hall")
    check("the answer is used as the destination", r.outcome == "directions"
          and r.steps == map_steps(A, "admissions-desk", "exam-hall"), r.reply)
    check("a one-step route is announced as the last step", r.reply.endswith(R.LAST_STEP))

    visit = Visit(rt, area="admissions-desk")
    visit.say("Can you give me directions on campus?")
    r = visit.say("the canteen or the library")
    check("two places named -> asks which", r.reply == "Do you mean Canteen or Library?" and r.outcome == "clarify",
          r.reply)
    r = visit.say("the library")
    check("then answers for the one chosen", r.outcome == "directions" and "Library" in r.reply)

    visit = Visit(rt, area="admissions-desk")
    visit.say("I need directions")
    check("'next' while asked for a destination asks again", visit.say("next").reply == R.ASK_DESTINATION)


def test_navigation_invalid_destinations():
    rt, llm = runtime()
    visit = Visit(rt, area="admissions-desk")
    visit.say("I need directions")
    r = visit.say("the moon base")
    check("a place not in the verified map is said to be missing",
          r.reply == f"{R.PLACE_NOT_FOUND} {R.ASK_ANOTHER_PLACE}" and r.outcome == "not_found", r.reply)
    check("an embedding-only match ('moon base' ~ examinations) does not hijack the question",
          r.intent == "campus_navigation" and not llm.prompts)
    check("and the student can try again", visit.conv.workflow_state == WorkflowState.ACTIVE)
    r = visit.say("cancel")
    check("cancel stops the directions", r.reply == R.STOPPED.format(topic="the directions"))

    visit = Visit(rt, area="admissions-desk")
    visit.say("I need directions")
    r = visit.say("What are the bus routes?")
    check("a question that names another topic moves on and is answered",
          "ALPHA-BUS" in r.reply and visit.conv.current_workflow is None, r.reply)

    visit = Visit(rt, area="admissions-desk")
    r = visit.say("How do I go to the canteen?")
    check("no verified route for this pair -> says so, refers to the office",
          r.reply == f"I don't have verified directions from Admissions desk to Canteen yet. {R.CONTACT_OFFICE}"
          and r.outcome == NO_VERIFIED_INFORMATION and r.steps is None, r.reply)
    check("even though library->canteen exists, routes are never chained",
          "Synthetic" not in r.reply)

    visit = Visit(rt, area="library")
    r = visit.say("Take me to the admissions desk")
    check("a route is never reversed (only admissions desk -> library is written)",
          r.outcome == NO_VERIFIED_INFORMATION and "Synthetic" not in r.reply, r.reply)

    visit = Visit(rt, area="library")
    r = visit.say("Take me to the library")
    check("already at the destination -> says so", r.reply == "You are already at Library.", r.reply)


def test_navigation_location_comes_only_from_the_qr_code():
    rt, _ = runtime()
    visit = Visit(rt)
    r = visit.say("How do I get to the library from the admissions desk?")
    check("no QR location -> asks to scan, never guesses from what was said",
          r.outcome in ("needs_location", "clarify") and "Synthetic" not in r.reply and r.steps is None, r.reply)

    visit = Visit(rt)
    r = visit.say("How do I get to the library?")
    check("no QR location -> asks to scan the nearest QR code", r.reply == R.NO_CURRENT_LOCATION
          and r.outcome == "needs_location", r.reply)
    r = visit.say("How do I get to the library?", area="admissions-desk")
    check("after a scan (the next turn carries the area) the directions follow",
          r.outcome == "directions" and r.steps == map_steps(A, "admissions-desk", "library"), r.reply)

    visit = Visit(rt, area="parking-lot")
    r = visit.say("How do I get to the library?")
    check("a QR location that is not in the verified map -> no directions",
          r.reply == f"{R.UNKNOWN_CURRENT_LOCATION} {R.CONTACT_OFFICE}", r.reply)

    visit = Visit(rt, area="admissions-desk")
    r = visit.say("How do I get to the library?", location_id="exam-hall")
    check("a finer location_id from the QR context takes precedence over the area",
          r.outcome == NO_VERIFIED_INFORMATION and "Examination hall" in r.reply, r.reply)


def test_navigation_institution_isolation_and_verified_only():
    rt, _ = runtime()
    r = Visit(rt, institution=B, area="main-gate").say("How do I get to the library?")
    check("institution B gets B's own route", r.steps == map_steps(B, "main-gate", "library")
          and not any("A1" in s or "A2" in s for s in r.steps), str(r.steps))
    r = Visit(rt, institution=B, area="main-gate").say("Take me to the seminar hall")
    check("a place of institution A is unknown at institution B", "Seminar" not in r.reply
          and r.steps is None, r.reply)
    r = Visit(rt, institution=B, area="admissions-desk").say("How do I get to the library?")
    check("A's QR area means nothing at B", r.reply == f"{R.UNKNOWN_CURRENT_LOCATION} {R.CONTACT_OFFICE}", r.reply)
    r = Visit(rt, institution="test-institute-c", area="library").say("How do I get to the library?")
    check("an institution with no map has no directions", r.reply == f"{R.NO_CAMPUS_MAP} {R.CONTACT_OFFICE}", r.reply)

    production, _ = runtime(campus=False)
    r = Visit(production, area="admissions-desk").say("How do I get to the library?")
    check("production: no verified map -> no directions, nothing improvised",
          r.reply == f"{R.NO_CAMPUS_MAP} {R.CONTACT_OFFICE}" and r.steps is None, r.reply)
    strict = build_college_runtime(knowledge=fixture_kb(), answerer=GroundedAnswerer(R.PERSONA, client=FakeLLM()),
                                   model=model(), campus=campus_fixtures())
    strict.intent_detector = detector()
    r = Visit(strict, area="admissions-desk").say("How do I get to the library?")
    check("unverified maps are not used unless explicitly allowed (test-only flag)",
          r.reply == f"{R.NO_CAMPUS_MAP} {R.CONTACT_OFFICE}" and r.steps is None, r.reply)
    fixtures = campus_fixtures()
    check("synthetic maps are never served as verified", fixtures.for_institution(A) is None
          and fixtures.for_institution(A, include_unverified=True) is not None)
    check("the production collection is College's own, and empty",
          CampusMapCollection.for_domain(get_domain("college")).maps == {})


def test_campus_map_validation():
    base = json.loads((CAMPUS / "manifest.json").read_text(encoding="utf-8"))
    map_a = json.loads((CAMPUS / "maps" / "test-institute-a.json").read_text(encoding="utf-8"))

    def load(manifest=None, file_a=None):
        folder = Path(tempfile.mkdtemp(dir=TMP.name))
        (folder / "maps").mkdir()
        (folder / "maps" / "test-institute-a.json").write_text(json.dumps(file_a or map_a), encoding="utf-8")
        (folder / "maps" / "test-institute-b.json").write_bytes((CAMPUS / "maps" / "test-institute-b.json").read_bytes())
        (folder / "manifest.json").write_text(json.dumps(manifest or base), encoding="utf-8")
        try:
            return CampusMapCollection(folder / "manifest.json", "college"), None
        except ManifestError as error:
            return None, error

    def entry(**changes):
        manifest = copy.deepcopy(base)
        manifest["maps"][0].update(changes)
        return manifest

    ok, error = load()
    check("the fixtures validate", ok is not None, str(error))
    _, error = load(entry(verified=True, verified_by="x", verified_on="2026-01-01", source_reference="r"))
    check("a synthetic map can never be verified", error and "never be verified" in str(error))
    real = dict(document_type="campus_map", source="Test Institute A estates office", source_reference="EST-1")
    _, error = load(entry(verified=True, **real))
    check("a verified map needs verified_by / verified_on / sha256", error and "verified_by" in str(error)
          and "sha256" in str(error))
    digest = hashlib.sha256(json.dumps(map_a).encode("utf-8")).hexdigest()
    good, error = load(entry(verified=True, verified_by="Estates officer", verified_on="2026-01-01", sha256=digest, **real))
    check("a properly verified map loads and is served", good is not None and good.for_institution(A) is not None,
          str(error))
    changed = copy.deepcopy(map_a)
    changed["routes"][0]["steps"][0]["en"] = "Walk to room 999."
    _, error = load(entry(verified=True, verified_by="Estates officer", verified_on="2026-01-01", sha256=digest, **real),
                    file_a=changed)
    check("a verified map edited afterwards is refused (sha256)", error and "sha256" in str(error))
    broken = copy.deepcopy(map_a)
    broken["routes"].append({"from": "admissions-desk", "to": "room-404", "steps": [{"en": "x"}]})
    _, error = load(file_a=broken)
    check("a route to a place not in the map is refused", error and "both ends" in str(error))
    _, error = load(entry(path="../../etc/map.json"))
    check("a map path outside maps/ is refused", error and "path" in str(error))
    _, error = load(entry(domain="banking"))
    check("a map of another domain is refused", error and "domain" in str(error))
    twice = copy.deepcopy(base)
    twice["maps"][1]["institution_id"] = A
    twice["maps"][1]["path"] = "test-institute-a.json"
    _, error = load(twice)
    check("one map per institution", error and "second map" in str(error))
    wrong = copy.deepcopy(map_a)
    wrong["institution_id"] = B
    _, error = load(file_a=wrong)
    check("a map file for another institution is refused", error and "another institution" in str(error))


def test_navigation_languages():
    rt, _ = runtime()
    visit = Visit(rt, language="kn", area="admissions-desk")
    r = visit.say("ಗ್ರಂಥಾಲಯಕ್ಕೆ ಹೇಗೆ ಹೋಗುವುದು")
    kn_steps = map_steps(A, "admissions-desk", "library", "kn")
    check("Kannada: directions in the map's own Kannada", r.steps == kn_steps and kn_steps[0] in r.reply, r.reply)
    check("Kannada: place names from the map", "ಪ್ರವೇಶ ಕೌಂಟರ್" in r.reply and "ಗ್ರಂಥಾಲಯ" in r.reply)
    r = visit.say("ಮತ್ತೆ ಹೇಳಿ")
    check("Kannada repeat replays the step in Kannada", kn_steps[0] in r.reply)

    visit = Visit(rt, language="kn", area="admissions-desk")
    r = visit.say("How do I get to the accounts office?")
    check("a step the map has only in English is shown in English, MARKED, never as Kannada",
          r.steps and all(s.startswith(UNTRANSLATED_MARKER["kn"]) for s in r.steps), str(r.steps))

    visit = Visit(rt, language="tcy", area="admissions-desk")
    r = visit.say("How do I get to the library?")
    check("Tulu is not claimed: a tcy session gets the English map text",
          r.steps == map_steps(A, "admissions-desk", "library"), str(r.steps))


def test_navigation_over_http_and_snapshot():
    with Service(college_factory=lambda: runtime()[0]) as svc:
        body = svc.college("How do I get to the library?", session="NAV", area="admissions-desk").json()
        check("HTTP: steps travel in the response's steps field",
              body["steps"] == map_steps(A, "admissions-desk", "library") and body["outcome"] == "directions", str(body))
        check("HTTP: the workflow snapshot reads College's own definition",
              body["workflow"]["name"] == "campus navigation" and body["workflow"]["total_steps"] == 2, str(body))
        snap = svc.client.get("/sessions/NAV/snapshot", headers={"X-Internal-Token": COLLEGE_TOKEN}).json()
        check("HTTP: GET snapshot totals College steps (the Phase 4 limitation is fixed)",
              snap["workflow"]["name"] == "campus navigation" and snap["workflow"]["total_steps"] == 2, str(snap))
        offer = svc.client.post("/sessions/NAV/assistance", headers={"X-Internal-Token": COLLEGE_TOKEN},
                                json={}).json()
        check("HTTP: no Banking assistance offer is made in a College visit",
              offer.get("offered") is False and offer.get("reason") == "not_available", str(offer))
        body = svc.bank("deposit").json()
        check("HTTP: Banking responses carry no steps or action", body["steps"] is None and body["action"] is None)
        bank_snap = svc.client.get("/sessions/NAV/snapshot", headers={"X-Internal-Token": BANK_TOKEN}).json()
        check("HTTP: the Banking caller cannot see the College visit", bank_snap["known"] is False)


# =========================================================
# D. COLLEGE SERVICE GUIDANCE
# =========================================================

def test_service_guidance_uses_verified_knowledge_only():
    rt, llm = runtime()
    calls = spy_retrieval(rt)
    for text, code, category in [("How much is the tuition fee?", "ALPHA-FEE", "fees"),
                                 ("Is there a hostel for girls?", "ALPHA-HOSTEL", "hostel"),
                                 ("What are the bus routes?", "ALPHA-BUS", "transport")]:
        r = Visit(rt).say(text)
        check(f"{text!r} is answered from the {category} document", code in r.reply
              and r.sources[0]["category"] == category and calls[-1][1] == frozenset({category}), r.reply)
    prompts = len(llm.prompts)
    for text, topic in [("What scholarships are available?", "scholarships"),
                        ("Which courses are offered?", "courses")]:
        r = Visit(rt).say(text)
        check(f"{text!r}: nothing verified -> clear uncertainty",
              r.reply == f"I don't have verified information about {topic} yet. {R.CONTACT_OFFICE}", r.reply)
    check("missing information never reaches the model", len(llm.prompts) == prompts)

    production = build_college_runtime(answerer=GroundedAnswerer(R.PERSONA, client=FakeLLM()), model=model())
    production.intent_detector = detector()
    check("production knowledge and maps are verified-only",
          production.knowledge.include_unverified is False)
    for text in ["How much is the tuition fee?", "Is there a hostel for girls?", "What are the bus routes?",
                 "What scholarships are available?", "Which courses are offered?"]:
        r = Visit(production, institution="nmamit").say(text)
        check(f"production: {text!r} -> uncertainty (no synthetic fixture used)",
              r.outcome == NO_VERIFIED_INFORMATION and "ALPHA" not in r.reply and "BETA" not in r.reply, r.reply)


def test_spoken_instructions_name_words_the_engine_recognises():
    from app.dialogue.manager import classify_turn
    from app.dialogue.text_normalization import normalize_turn

    kn, hi = (lambda s: dict(R.SENTENCES)[s]["kn"]), (lambda s: dict(R.SENTENCES)[s]["hi"])
    cases = [  # (the sentence that tells the student, the word it tells them to say, what it must mean)
        (kn(R.STEP_HINT), "ಮುಂದಿನದು", "next"), (kn(R.STEP_HINT), "ಮತ್ತೆ ಹೇಳಿ", "repeat"),
        (kn(R.STEP_HINT), "ನಿಲ್ಲಿಸಿ", "cancel"), (kn(R.PAUSED), "ಮುಂದುವರಿಸಿ", "resume"),
        (kn(R.SAY_NEXT_STEP), "ಮುಂದಿನದು", "next"), (kn(R.ASK_ANOTHER_PLACE), "ನಿಲ್ಲಿಸಿ", "cancel"),
        (hi(R.STEP_HINT), "अगला", "next"), (hi(R.STEP_HINT), "दोहराइए", "repeat"),
        (hi(R.STEP_HINT), "रद्द करो", "cancel"), (hi(R.PAUSED), "जारी रखिए", "resume"),
        (hi(R.SAY_NEXT_STEP), "अगला", "next"), (hi(R.ASK_ANOTHER_PLACE), "रद्द करो", "cancel"),
        (R.STEP_HINT, "next", "next"), (R.PAUSED, "resume", "resume"), (R.ASK_ANOTHER_PLACE, "cancel", "cancel"),
    ]
    wrong = [(word, classify_turn(normalize_turn(word).routing)) for sentence, word, meaning in cases
             if word not in sentence or classify_turn(normalize_turn(word).routing) != meaning]
    check("every control word a reply tells the student to say is recognised", not wrong, str(wrong))

    rt, _ = runtime()
    visit = Visit(rt)
    visit.say("What is the admission process?")
    r = visit.say("ಮುಂದುವರಿಸಿ")
    check("'continue' during an active workflow restates the step (not 'nothing paused')",
          r.reply.endswith("Say next to continue with the documents you need.") and visit.conv.current_step == 1,
          r.reply)


def test_kannada_review_cases_are_recorded():
    doc = (HERE.parent.parent / "docs" / "domain-integration" / "05-kannada-review-cases.md")
    text = doc.read_text(encoding="utf-8") if doc.exists() else ""
    phase5 = [R.STOPPED, R.PAUSED, R.CONTINUE_HINT, R.STEP_HINT, R.NOTHING_PAUSED, R.GUIDANCE_STEP_PROCESS,
              R.GUIDANCE_STEP_DOCUMENTS, R.GUIDANCE_STEP_ELIGIBILITY, R.GUIDANCE_STEP_NEXT, R.GUIDANCE_STEP_OFFICE,
              R.GUIDANCE_SAY_NEXT, R.GUIDANCE_DONE, R.STATUS_CHECKING, R.STATUS_DETAILS, R.STATUS_SIGN_IN,
              R.STATUS_NO_RECORD, R.STATUS_OTHER_EMAIL, R.STATUS_AMBIGUOUS, R.STATUS_ADMISSION_OFFICE,
              R.STATUS_SCAN_AGAIN, R.STATUS_UNAVAILABLE, R.STATUS_STUDENTS_ONLY, R.REFERENCE_WARNING,
              R.ASK_DESTINATION, R.NO_CAMPUS_MAP, R.NO_CURRENT_LOCATION, R.UNKNOWN_CURRENT_LOCATION,
              R.PLACE_NOT_FOUND, R.ASK_ANOTHER_PLACE, R.SAY_NEXT_STEP, R.LAST_STEP, R.NO_ROUTE, R.ALREADY_THERE,
              R.DIRECTIONS_INTRO, R.STEP_OF, R.CLARIFY_PLACE]
    kannada = dict(R.SENTENCES)
    missing = [s for s in phase5 if kannada[s]["kn"] not in text]
    check("every Phase 5 Kannada sentence is listed for native-speaker review", not missing, str(missing[:3]))
    check("the review list states that nothing is reviewed yet", "unreviewed" in text.lower())


def main_():
    tests = [value for name, value in globals().items() if name.startswith("test_")]
    print()
    print("=" * 60)
    print("COLLEGE WORKFLOW TESTS (Phase 5)")
    print("=" * 60)
    started = time.perf_counter()
    for test in tests:
        print(f"\n{test.__name__}")
        test()
    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED_CHECKS)}   ({time.perf_counter() - started:.0f} s)")
    print("=" * 60)
    TMP.cleanup()
    return 1 if FAILED_CHECKS else 0


if __name__ == "__main__":
    sys.exit(main_())
