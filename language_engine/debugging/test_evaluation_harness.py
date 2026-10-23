"""
Regression tests for the M0 multilingual evaluation harness.

Runs entirely offline: no embedding model, no Groq, no network. The harness's
scoring is pure, so it is tested against hand-built inputs; its wiring to the
engine is tested with a stand-in detector, so the engine's own control tier,
negation guard, conflict detector and amount parser run for real while no
model is loaded.

What this protects is the MEASUREMENT, not the engine: a harness that
silently mis-scored a wrong amount as a miss, or a fixture file that lost its
expected labels, would make every later milestone's numbers meaningless.

Run from language_engine/:

    python -m debugging.test_evaluation_harness
"""

import copy
import json
import socket
import sys

from evaluation import harness as h


PASSED = []
FAILED = []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def raises(function, error):
    try:
        function()
    except error:
        return True
    except Exception:  # pragma: no cover - wrong error type is a failure
        return False
    return False


class FixedDetector:
    """Answers every sentence with the same verdict."""

    def __init__(self, intent="withdraw money", banking=True, category="BANKING_INTENT"):
        self.result = {
            "intent": intent,
            "confidence": 0.9,
            "category": category,
            "is_banking_intent": banking,
            "margin": 0.2 if banking else -0.2,
        }

    def detect_intent(self, text):
        return dict(self.result)


# =========================================================
# THE FIXTURE FILE
# =========================================================

def test_fixture_file_is_valid():
    document, digest = h.load_fixtures(h.DEFAULT_FIXTURES)
    fixtures = document["fixtures"]

    check("the fixture file validates", True)
    check("the digest is a SHA-256", len(digest) == 64)
    check("every fixture has an expected outcome", all(f.get("expected") for f in fixtures))
    check("every fixture has a category", all(f.get("category") in h.CATEGORIES for f in fixtures))
    check("every fixture names its source",
          all(f["source"] in document["sources"] for f in fixtures))
    check("ids are unique", len({f["id"] for f in fixtures}) == len(fixtures))


def test_every_language_group_and_category_is_present():
    document, _ = h.load_fixtures(h.DEFAULT_FIXTURES)
    fixtures = document["fixtures"]

    # The categories this file uses. `refusal` arrived in M3 with its own
    # fixture file; the M0 file is frozen and does not contain it.
    for category in sorted({f["category"] for f in fixtures}):
        groups = {f["lang"] for f in fixtures if f["category"] == category}
        missing = set(h.LANGUAGE_GROUPS) - groups
        check(f"{category} covers every language group", not missing, f"missing {sorted(missing)}")


def test_ids_name_their_group_and_category():
    # svc-kn-en-03 must be a kn-en service request; a mismatch means a
    # fixture was moved without being relabelled.
    document, _ = h.load_fixtures(h.DEFAULT_FIXTURES)
    prefixes = {
        "service_request": "svc", "knowledge_question": "kq", "control": "ctl",
        "amount": "amt", "negation": "neg", "conflict_answer": "cfa", "refusal": "ref",
        "ambiguous_request": "amb",
    }
    for path in sorted(h.DEFAULT_FIXTURES.parent.glob("*.json")):
        document, _ = h.load_fixtures(path)
        bad = [f["id"] for f in document["fixtures"]
               if not f["id"].startswith(f"{prefixes[f['category']]}-{f['lang']}-")]
        check(f"{path.name}: every id is <category>-<group>-<n>", not bad, f"{bad}")


def test_the_m0_fixtures_are_frozen():
    # The M0 baseline is only comparable while its fixtures are unchanged.
    _, digest = h.load_fixtures(h.DEFAULT_FIXTURES)
    check("multilingual_v1.json still has its M0 digest",
          digest == "28807176c2c7ab487a59936d2339b204ed0bddc2310b5b29f972a9b2852fc2f9", digest)


def test_harness_labels_match_the_engine():
    from app.dialogue.workflow_conflict import CHOICE_CANCEL, CHOICE_CONTINUE, CHOICE_PAUSE
    from app.intent.intents import INTENTS

    check("intent labels match INTENTS", tuple(INTENTS) == h.INTENT_LABELS)
    check("conflict choices match the engine",
          set(h.CONFLICT_CHOICES) == {CHOICE_CANCEL, CHOICE_PAUSE, CHOICE_CONTINUE})


# =========================================================
# VALIDATION REJECTS BROKEN FIXTURES
# =========================================================

def _valid():
    return {"fixtures": [{
        "id": "amt-en-01", "lang": "en", "category": "amount",
        "text": "5000", "expected": {"amount": 5000}, "source": "m0-new",
    }]}


def test_validation_rejects_bad_fixtures():
    docs = {"loan.md"}
    check("a valid document passes", h.validate_fixtures(_valid(), docs) is None)

    def broken(mutate):
        document = copy.deepcopy(_valid())
        mutate(document["fixtures"][0], document)
        return lambda: h.validate_fixtures(document, docs)

    cases = {
        "missing expected": lambda f, d: f.pop("expected"),
        "unknown language group": lambda f, d: f.update(lang="ta"),
        "unknown category": lambda f, d: f.update(category="greeting"),
        "empty text": lambda f, d: f.update(text="  "),
        "duplicate id": lambda f, d: d["fixtures"].append(dict(f)),
        "amount must be positive": lambda f, d: f.update(expected={"amount": 0}),
        "amount must not be a bool": lambda f, d: f.update(expected={"amount": True}),
        "unknown intent": lambda f, d: f.update(category="service_request", expected={"intent": "buy gold"}),
        "unknown command": lambda f, d: f.update(category="control", expected={"command": "jump"}),
        "unknown conflict choice": lambda f, d: f.update(category="conflict_answer", expected={"choice": "maybe"}),
        "unknown knowledge document": lambda f, d: f.update(
            category="knowledge_question", expected={"route": "knowledge", "sources": ["nope.md"]}),
        "sources key required": lambda f, d: f.update(
            category="knowledge_question", expected={"route": "knowledge"}),
        "negated must be a bool": lambda f, d: f.update(category="negation", expected={"negated": "yes"}),
    }

    for label, mutate in cases.items():
        check(f"rejects: {label}", raises(broken(mutate), h.FixtureError))

    check("rejects an empty file", raises(lambda: h.validate_fixtures({"fixtures": []}, docs), h.FixtureError))


# =========================================================
# PURE SCORING
# =========================================================

def _route(stage="detector", banking=True, intent="deposit money", category="BANKING_INTENT"):
    return {"stage": stage, "control": None, "is_banking": banking,
            "intent": intent, "category": category, "margin": 0.1}


def test_request_scoring():
    o = h.outcome_for_request
    check("right service is correct", o("deposit money", _route()) == h.CORRECT)
    check("other service is wrong_service", o("withdraw money", _route()) == h.WRONG_SERVICE)
    check("abstaining is a miss", o("deposit money", _route(banking=False)) == h.ABSTAINED)
    check("the LLM gate is unscored", o("deposit money", _route(stage="llm_gate")) == h.LLM_GATED)
    check("the control tier swallowing it is critical",
          o("deposit money", _route(stage="control_tier")) == h.INTERCEPTED_BY_CONTROL)
    check("detector-only ignores the gate",
          o("deposit money", h.detector_only(_route(stage="llm_gate"))) == h.CORRECT)


def test_question_scoring():
    o = h.outcome_for_question
    check("a question starting a workflow is critical", o(_route()) == h.QUESTION_TO_WORKFLOW)
    check("knowledge abstention is correct",
          o(_route(banking=False, category="KNOWLEDGE_QUESTION")) == h.CORRECT)
    check("acknowledgement abstention is a miss",
          o(_route(banking=False, category="ACKNOWLEDGEMENT")) == h.WRONG_NON_BANKING)
    check("the LLM gate is unscored", o(_route(stage="llm_gate")) == h.LLM_GATED)


def test_amount_scoring():
    o = h.outcome_for_amount
    check("equal amounts are correct", o(5000, 5000) == h.CORRECT)
    check("no amount where none expected is correct", o(None, None) == h.CORRECT)
    check("a different value is wrong_amount (critical)", o(25000, 1000) == h.WRONG_AMOUNT)
    check("a value where none was spoken is false_amount", o(None, 2) == h.FALSE_AMOUNT)
    check("no value is a miss, never critical", o(5000, None) == h.MISSED_AMOUNT)
    check("wrong_amount is critical", h.SEVERITY[h.WRONG_AMOUNT] == "critical")
    check("missed_amount is a miss", h.SEVERITY[h.MISSED_AMOUNT] == "miss")


def test_command_choice_and_negation_scoring():
    check("matching command is correct", h.outcome_for_command("pause", "pause") == h.CORRECT)
    check("no command is a miss", h.outcome_for_command("pause", None) == h.MISSED_COMMAND)
    check("pause read as cancel is critical", h.outcome_for_command("pause", "cancel") == h.WRONG_COMMAND)

    check("matching choice is correct", h.outcome_for_choice("cancel", "cancel") == h.CORRECT)
    check("asked again is a miss", h.outcome_for_choice("cancel", None) == h.REASKED)
    check("a refusal read as cancel is critical", h.outcome_for_choice(None, "cancel") == h.WRONG_CHOICE)
    check("ending the session is a wrong choice", h.outcome_for_choice("pause", "session_exit") == h.WRONG_CHOICE)

    n = h.outcome_for_negation
    check("negated, guarded, no conflict: correct", n(True, True, False) == h.CORRECT)
    check("negated but raised a conflict: critical", n(True, False, True) == h.FALSE_CONFLICT)
    check("conflict outranks a detected negation", n(True, True, True) == h.FALSE_CONFLICT)
    check("negation missed without a conflict: miss", n(True, False, False) == h.MISSED_NEGATION)
    check("negation flagged on a plain request: miss", n(False, True, False) == h.FALSE_NEGATION)


def test_refusal_scoring_and_the_gate():
    gated = dict(_route(), negated=True, refusal_gate=True)
    ungated = dict(_route(), negated=True, refusal_gate=False)
    plain = dict(_route(), negated=False, refusal_gate=True)

    r = h.outcome_for_refusal
    check("a refusal the gate stops is correct", r(gated, False) == h.CORRECT)
    check("a refusal that starts a workflow is critical", r(ungated, False) == h.REFUSAL_STARTED_WORKFLOW)
    check("an undetected refusal starts a workflow", r(plain, False) == h.REFUSAL_STARTED_WORKFLOW)
    check("a conflict outranks everything", r(gated, True) == h.FALSE_CONFLICT)
    check("a detector abstention is correct", r(dict(gated, is_banking=False), False) == h.CORRECT)
    check("a control-tier refusal starts nothing", r(dict(gated, stage="control_tier"), False) == h.CORRECT)
    check("the LLM gate is unscored", r(dict(gated, stage="llm_gate"), False) == h.LLM_GATED)

    check("a request the gate stops is a miss",
          h.outcome_for_request("deposit money", gated) == h.ABSTAINED)
    check("without the gate the same request is correct",
          h.outcome_for_request("deposit money", ungated) == h.CORRECT)
    check("a question the gate stops gets no answer, but no workflow",
          h.outcome_for_question(gated) == h.WRONG_NON_BANKING)
    check("detector-only ignores the refusal gate",
          h.outcome_for_request("deposit money", h.detector_only(gated)) == h.CORRECT)


def test_ambiguous_request_scoring():
    o = h.outcome_for_ambiguous
    check("an ambiguous request that starts a workflow is critical", o(_route()) == h.GUESSED_SERVICE)
    check("abstaining is correct", o(_route(banking=False, category="KNOWLEDGE_QUESTION")) == h.CORRECT)
    check("the LLM gate is unscored", o(_route(stage="llm_gate")) == h.LLM_GATED)
    check("the refusal gate stopping it is correct",
          o(dict(_route(), negated=True, refusal_gate=True)) == h.CORRECT)


def test_every_outcome_has_a_severity():
    outcomes = [v for k, v in vars(h).items() if k.isupper() and isinstance(v, str)
                and v in h.SEVERITY]
    check("every outcome constant is in SEVERITY", set(outcomes) == set(h.SEVERITY))
    check("severities are the documented four", set(h.SEVERITY.values()) == set(h.SEVERITIES))


def test_summary_is_deterministic_and_counts_correctly():
    results = [
        {"id": "a", "lang": "kn", "category": "amount", "outcome": h.WRONG_AMOUNT, "severity": "critical"},
        {"id": "b", "lang": "kn", "category": "amount", "outcome": h.CORRECT, "severity": "ok"},
        {"id": "c", "lang": "hi", "category": "service_request", "outcome": h.WRONG_SERVICE,
         "severity": "critical", "detector_outcome": h.WRONG_SERVICE,
         "expected": {"intent": "withdraw money"}, "got": {"detector_intent": "deposit money"}},
    ]
    first = json.dumps(h.summarize(results))
    second = json.dumps(h.summarize(copy.deepcopy(results)))

    check("the same results give the same summary", first == second)
    s = h.summarize(results)
    check("wrong amounts are counted", s["headline"]["Wrong amount (a value, but not the spoken one)"] == 1)
    check("wrong service is counted",
          s["headline"]["Wrong-service routing (request started the wrong workflow)"] == 1)
    check("the kn amount cell counts both", s["by_cell"]["kn|amount"]["n"] == 2)
    check("per-intent results record where a wrong request went",
          s["by_intent"]["withdraw money"]["wrong_to"] == {"deposit money": 1})


def test_compare_lists_only_changes():
    before = {"results": [{"id": "a", "outcome": h.CORRECT}, {"id": "b", "outcome": h.WRONG_AMOUNT}]}
    after = {"results": [{"id": "a", "outcome": h.CORRECT}, {"id": "b", "outcome": h.MISSED_AMOUNT}]}
    changes = h.compare(before, after)
    check("one change is reported", len(changes) == 1 and changes[0]["id"] == "b")


# =========================================================
# WIRING TO THE ENGINE (stand-in detector, real engine functions)
# =========================================================

def _fixture(category, text, expected, lang="en", context=None):
    f = {"id": f"x-{lang}-1", "lang": lang, "category": category, "text": text,
         "expected": expected, "source": "m0-new"}
    if context:
        f["context"] = context
    return f


def test_engine_wiring():
    engine = h.Engine(FixedDetector("withdraw money"))
    run = lambda f: h.evaluate_fixture(engine, f)

    r = run(_fixture("service_request", "I need to withdraw cash", {"intent": "withdraw money"}))
    check("a request reaches the detector", r["got"]["stage"] == "detector" and r["outcome"] == h.CORRECT)

    r = run(_fixture("service_request", "pause", {"intent": "withdraw money"}))
    check("the control tier runs first", r["outcome"] == h.INTERCEPTED_BY_CONTROL)

    r = run(_fixture("knowledge_question", "what is a cheque book",
                     {"route": "knowledge", "sources": None}))
    check("an English question is gated to the LLM", r["outcome"] == h.LLM_GATED)
    check("the detector-only view is still recorded", r["detector_outcome"] == h.QUESTION_TO_WORKFLOW)

    r = run(_fixture("amount", "ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು", {"amount": 5000}, lang="kn"))
    check("the engine's amount parser is used", r["got"]["amount"] == 5000)

    r = run(_fixture("control", "ಮತ್ತೆ ಹೇಳಿ", {"command": "repeat"}, lang="kn"))
    check("the engine's control tier is used", r["outcome"] == h.CORRECT)

    active = {"active_workflow": "deposit money"}
    r = run(_fixture("negation", "I don't want to withdraw", {"negated": True}, context=active))
    check("an English refusal is guarded (no conflict)",
          r["outcome"] == h.CORRECT and r["got"]["conflict_requested"] is None)

    r = run(_fixture("negation", "I want to withdraw money", {"negated": False}, context=active))
    check("a plain request raises the conflict", r["got"]["conflict_requested"] == "withdraw money")

    r = run(_fixture("conflict_answer", "pause the deposit", {"choice": "pause"}))
    check("free-text conflict answers use the engine resolver", r["outcome"] == h.CORRECT)

    r = run(_fixture("conflict_answer", "cancel", {"choice": "cancel"}))
    check("a control word answers the conflict", r["got"]["choice"] == "cancel")

    r = run(_fixture("conflict_answer", "Exit.", {"choice": "cancel"}))
    check("ending the session is reported, not mapped", r["got"]["choice"] == "session_exit")


# =========================================================
# OFFLINE GUARANTEE
# =========================================================

def test_network_guard_refuses_outbound_connections():
    original = (socket.socket.connect, socket.socket.connect_ex)
    try:
        h.install_network_guard()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            # TEST-NET-3: never routable, and the guard refuses before any packet.
            blocked = raises(lambda: sock.connect(("203.0.113.1", 443)), h.NetworkBlocked)
        finally:
            sock.close()
        check("an outbound connection is refused", blocked)
        check("loopback is still allowed", h._is_loopback(("127.0.0.1", 80)))
    finally:
        socket.socket.connect, socket.socket.connect_ex = original


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M0 EVALUATION HARNESS REGRESSION TESTS")
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
    sys.exit(main())
