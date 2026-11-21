"""
Phase 6 (domain integration): College backend <-> engine contract hardening.

  - pending workflow actions expire (AI_ENGINE_ACTION_TTL_SECONDS) and an
    expired action is abandoned, so a late answer can never be replayed;
  - a result may name the action type, which must match the pending action;
  - HTTP: action_expired / action_mismatch refusal codes, forged context and
    record fields refused, Banking token cannot act as College (and back),
    no Banking fallback, sessions isolated per student;
  - the student's own rank / batch / admission hall questions go to the
    admission_status workflow (a backend action), not to campus directions.

Offline (local sentence encoder only). SYNTHETIC fixtures only.

    python -m debugging.test_college_integration
"""

import sys
import time

from debugging.test_college_runtime import A, B, BANK_TOKEN, COLLEGE_TOKEN, Service, detector  # noqa: E402
from debugging.test_college_workflows import Visit, runtime  # noqa: E402

from app.workflow.domain_runner import (  # noqa: E402
    DEFAULT_ACTION_TTL_SECONDS,
    ActionExpired,
    ActionTypeMismatch,
    NoPendingAction,
    action_ttl_from_env,
)

PASSED, FAILED_CHECKS = [], []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED_CHECKS.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def runtime_with_clock(ttl=60.0):
    rt, _ = runtime()
    clock = Clock()
    rt.workflows.clock = clock
    rt.workflows.action_ttl_seconds = ttl
    return rt, clock


def raises(fn, exc):
    try:
        fn()
    except exc:
        return True
    except Exception:  # noqa: BLE001
        return False
    return False


# =========================================================
# Runner level
# =========================================================

def test_action_ttl_configuration():
    check("default TTL is 120 s", action_ttl_from_env({}) == DEFAULT_ACTION_TTL_SECONDS == 120.0)
    check("TTL read from AI_ENGINE_ACTION_TTL_SECONDS", action_ttl_from_env({"AI_ENGINE_ACTION_TTL_SECONDS": "30"}) == 30.0)
    check("TTL is bounded below (5 s) and above (900 s)",
          action_ttl_from_env({"AI_ENGINE_ACTION_TTL_SECONDS": "0"}) == 5.0
          and action_ttl_from_env({"AI_ENGINE_ACTION_TTL_SECONDS": "99999"}) == 900.0)
    check("an invalid TTL falls back to the default",
          action_ttl_from_env({"AI_ENGINE_ACTION_TTL_SECONDS": "soon"}) == 120.0
          and action_ttl_from_env({"AI_ENGINE_ACTION_TTL_SECONDS": "nan"}) == 120.0)


def test_action_within_ttl_is_accepted_once():
    rt, clock = runtime_with_clock(ttl=60)
    visit = Visit(rt)
    action = visit.say("What is my admission status?").action
    check("the action carries id, type and workflow only (no issue time)",
          set(action) == {"id", "type", "workflow"}, str(action))
    clock.now += 59
    result = visit.result(action["id"], "details_available")
    check("a result inside the TTL is accepted", result.outcome == "workflow_result", str(result.outcome))
    check("and cannot be replayed", raises(lambda: visit.result(action["id"], "details_available"), NoPendingAction))


def test_expired_action_is_refused_and_abandoned():
    rt, clock = runtime_with_clock(ttl=60)
    visit = Visit(rt)
    action = visit.say("What is my admission status?").action
    clock.now += 61
    check("a result after the TTL is refused as expired",
          raises(lambda: visit.result(action["id"], "details_available"), ActionExpired))
    check("the expired action is abandoned: a second attempt is 'no pending action'",
          raises(lambda: visit.result(action["id"], "details_available"), NoPendingAction)
          and "action" not in visit.conv.entities)
    check("the workflow no longer waits", not rt.workflows.active(visit.conv))
    again = visit.say("What is my admission status?").action
    check("asking again issues a NEW action", again and again["id"] != action["id"])
    check("which can be answered", visit.result(again["id"], "no_record").outcome == "workflow_result")


def test_action_type_must_match():
    rt, _ = runtime_with_clock()
    visit = Visit(rt)
    action = visit.say("What is my admission status?").action
    check("a result naming another action type is refused",
          raises(lambda: rt.apply_workflow_result(visit.conv, action["id"], "details_available", visit.localizer,
                                                  action_type="seat_booking"), ActionTypeMismatch))
    check("the mismatch leaves the action pending (the real result still works)",
          rt.apply_workflow_result(visit.conv, action["id"], "details_available", visit.localizer,
                                   action_type="admission_status").outcome == "workflow_result")


def test_action_type_is_optional_for_compatibility():
    rt, _ = runtime_with_clock()
    visit = Visit(rt)
    action = visit.say("What is my admission status?").action
    check("a result without action_type is still accepted (Phase 5 contract)",
          visit.result(action["id"], "no_record").outcome == "workflow_result")


# =========================================================
# Intent routing for student-specific questions
# =========================================================

def test_rank_batch_hall_questions_go_to_admission_status():
    d = detector()
    for sentence in ["what is my rank", "which batch am i in", "which admission hall should i go to",
                     "where is my assigned hall", "what is my admission status"]:
        result = d.detect(sentence)
        check(f"'{sentence}' -> admission_status", result.get("intent") == "admission_status", str(result.get("intent")))
    rt, _ = runtime_with_clock()
    reply = Visit(rt).say("Which admission hall should I go to?")
    check("the hall question becomes a backend action (no campus directions, no invented hall)",
          reply.action and reply.action["type"] == "admission_status" and not reply.steps, str(reply.reply))
    gen = d.detect("what rank do i need for computer science")
    check("a general rank question is NOT routed to the student's own record",
          gen.get("intent") != "admission_status", str(gen.get("intent")))


# =========================================================
# HTTP
# =========================================================

def _post_result(svc, session, payload, token=COLLEGE_TOKEN):
    return svc.client.post(f"/sessions/{session}/workflow-result", headers={"X-Internal-Token": token}, json=payload)


def test_http_expired_and_mismatched_codes():
    holder = {}

    def factory():
        rt, clock = runtime_with_clock(ttl=60)
        holder["clock"] = clock
        return rt

    with Service(college_factory=factory) as svc:
        action = svc.college("What is my admission status?", session="E1").json()["action"]
        r = _post_result(svc, "E1", {"action_id": action["id"], "action_type": "seat_booking", "outcome": "details_available"})
        check("HTTP: a mismatched action type -> 409 action_mismatch",
              r.status_code == 409 and r.json()["error"] == "action_mismatch", r.text)
        holder["clock"].now += 61
        r = _post_result(svc, "E1", {"action_id": action["id"], "action_type": "admission_status", "outcome": "details_available"})
        check("HTTP: an expired action -> 409 action_expired",
              r.status_code == 409 and r.json()["error"] == "action_expired", r.text)
        check("HTTP: the refusal says nothing about the record", "record" not in r.text.lower() or "admission" not in r.json()["detail"].lower())
        r = _post_result(svc, "E1", {"action_id": action["id"], "action_type": "admission_status", "outcome": "details_available"})
        check("HTTP: and a retry is no_pending_action", r.status_code == 409 and r.json()["error"] == "no_pending_action", r.text)
        r = _post_result(svc, "E1", {"action_id": action["id"], "action_type": "Admission Status!", "outcome": "details_available"})
        check("HTTP: a free-text action_type is refused by the schema (422)", r.status_code == 422, r.text)


def test_http_forged_context_and_tokens():
    with Service() as svc:
        r = svc.college("What is my admission status?", session="F1", rank="1")
        check("HTTP: a student field in the turn context is refused (422)", r.status_code == 422, r.text)
        r = svc.client.post("/turn", headers={"X-Internal-Token": COLLEGE_TOKEN}, json={
            "session_id": "F2", "language": "en", "text": "hi", "context": {"institution_id": A},
            "student_context": {"verified": True, "rank": 1}})
        check("HTTP: a student_context body field is refused (422)", r.status_code == 422, r.text)
        r = svc.client.post("/turn", headers={"X-Internal-Token": BANK_TOKEN, "X-Assistant-Domain": "college"}, json={
            "session_id": "F3", "language": "en", "text": "What is my admission status?", "context": {"institution_id": A}})
        check("HTTP: the Banking token cannot act as College (403)", r.status_code == 403, r.text)
        r = svc.client.post("/turn", headers={"X-Internal-Token": COLLEGE_TOKEN, "X-Assistant-Domain": "banking"}, json={
            "session_id": "F4", "language": "en", "text": "deposit"})
        check("HTTP: the College token cannot act as Banking (403)", r.status_code == 403, r.text)
        r = svc.client.post("/turn", headers={"X-Internal-Token": COLLEGE_TOKEN}, json={
            "session_id": "F5", "language": "en", "text": "deposit money"})
        check("HTTP: a College turn without the required institution is refused, not served by Banking",
              r.status_code == 422 and not svc.banking.turns, r.text)
        check("HTTP: the Banking runtime never served any College request", not svc.banking.turns)
        r = svc.client.post("/turn", headers={"X-Internal-Token": BANK_TOKEN}, json={
            "session_id": "F6", "language": "en", "text": "deposit", "legacy_extra": "ignored"})
        check("HTTP: Banking keeps its original contract (an extra field is still ignored)",
              r.status_code == 200 and r.json()["reply"] == "banking:deposit", r.text)


def test_http_sessions_isolated_per_student():
    with Service() as svc:
        a = svc.college("What is my admission status?", session="cg-student-a").json()["action"]
        b = svc.college("What is my admission status?", session="cg-student-b").json()["action"]
        r = _post_result(svc, "cg-student-b", {"action_id": a["id"], "action_type": "admission_status", "outcome": "details_available"})
        check("HTTP: student A's action id cannot answer student B's visit", r.status_code == 409, r.text)
        r = _post_result(svc, "cg-student-b", {"action_id": b["id"], "action_type": "admission_status", "outcome": "no_record"})
        check("HTTP: B's own action works", r.status_code == 200, r.text)
        r = svc.college("hello", session="cg-student-a", institution=B)
        check("HTTP: a visit cannot switch institution (409 context_conflict)",
              r.status_code == 409 and r.json()["error"] == "context_conflict", r.text)


def main_():
    tests = [value for name, value in globals().items() if name.startswith("test_")]
    print("\n" + "=" * 60 + "\nCOLLEGE BACKEND INTEGRATION TESTS (Phase 6)\n" + "=" * 60)
    started = time.perf_counter()
    for test in tests:
        print(f"\n{test.__name__}")
        test()
    print("\n" + "=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED_CHECKS)}   ({time.perf_counter() - started:.0f} s)")
    print("=" * 60)
    return 1 if FAILED_CHECKS else 0


if __name__ == "__main__":
    sys.exit(main_())
