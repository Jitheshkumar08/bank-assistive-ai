"""
Phase 4 (domain integration): College intent detection and the College runtime.

Offline except for the local sentence encoder (as test_retriever). No Groq,
no network: the grounded answerer is given a FAKE LLM client that records
every prompt, so the tests can prove when the model is -- and is not -- asked.
Knowledge comes from the SYNTHETIC fixtures (debugging/fixtures/college_kb).

Run from language_engine/:

    python -m debugging.test_college_runtime
"""

import json
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace

# Before any engine import: the production College runtime built by these
# tests must log unanswered questions to a temporary directory, never to
# language_engine/runtime/.
_LOGS = tempfile.TemporaryDirectory()
os.environ["UNANSWERED_LOG_DIR"] = _LOGS.name

from fastapi.testclient import TestClient

import service.engine as engine_module
import service.main as main
from app.conversation.manager import ConversationManager
from app.dialogue.catalog_localizer import CatalogLocalizer
from app.dialogue.llm.grounded_answer import (
    DECLINED,
    FAILED,
    UNGROUNDED_NUMBER,
    GroundedAnswerer,
    build_prompt,
)
from app.dialogue.localization import GeneratedText
from app.domains import COLLEGE
from app.domains.college import responses as R
from app.domains.college.intents import COLLEGE_INTENT_PROFILE, INTENTS, banking_sentence
from app.intent.intent_examples import BANKING_INTENT_EXAMPLES
from app.intent.profile import AMBIGUOUS, OUT_OF_SCOPE, IntentProfile, IntentSpec, ProfileIntentDetector
from app.knowledge.collection import COLLEGE_CATEGORIES
from app.knowledge.domain_retrieval import DomainKnowledgeBase
from app.knowledge.embedding_model import get_embedding_model
from app.knowledge.unanswered_log import UnansweredLog
from app.dialogue.manager import classify_turn
from app.dialogue.text_normalization import normalize_turn
from service.domain_runtime import (
    ANSWERED,
    CLARIFY,
    NO_VERIFIED_INFORMATION,
    OUT_OF_SCOPE as OUTCOME_OUT_OF_SCOPE,
    WORKFLOW_PENDING,
    DomainKnowledgeRuntime,
    build_college_runtime,
    register_builtin_domain_runtimes,
)
from service.engine import TurnResult

PASSED = []
FAILED_CHECKS = []

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
EVALUATION = HERE.parent / "evaluation" / "fixtures"
A, B = "test-institute-a", "test-institute-b"
BANK_TOKEN = "bank-token-" + "b" * 40
COLLEGE_TOKEN = "college-token-" + "c" * 40


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED_CHECKS.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


# =========================================================
# FAKES AND BUILDERS
# =========================================================

class FakeLLM:
    """A Groq-shaped client. `script(prompt) -> str` decides each answer."""

    def __init__(self, script=None):
        self.prompts = []
        self.systems = []
        self.script = script or faithful
        self.chat = SimpleNamespace(completions=self)
        self._lock = threading.Lock()

    def create(self, **kwargs):
        system, user = kwargs["messages"][0]["content"], kwargs["messages"][1]["content"]
        with self._lock:
            self.prompts.append(user)
            self.systems.append(system)
        content = self.script(user)
        if isinstance(content, Exception):
            raise content
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def evidence_of(prompt):
    return prompt.split("EVIDENCE", 2)[2].split("QUESTION")[0]


def faithful(prompt):
    """Answers with the evidence's first 'Fixture code' sentence, or declines."""
    for line in evidence_of(prompt).splitlines():
        if "Fixture code" in line:
            return line.strip()
    return "NO_ANSWER"


class FakeSTT:
    def transcribe(self, path, language="en"):
        return {"text": "How much is the tuition fee?"}


TMP = tempfile.TemporaryDirectory()
MODEL = None


def model():
    global MODEL
    if MODEL is None:
        MODEL = get_embedding_model()
    return MODEL


def fixture_kb(include_unverified=True, log_dir=None):
    return DomainKnowledgeBase(
        "college", FIXTURES / "college_kb" / "manifest.json", min_score=COLLEGE.knowledge.min_score,
        include_unverified=include_unverified, model=model(), cache_dir=Path(TMP.name) / "cache",
        unanswered_log=UnansweredLog(Path(log_dir or Path(TMP.name) / "log")),
    )


DETECTOR = None


def detector():
    global DETECTOR
    if DETECTOR is None:
        DETECTOR = ProfileIntentDetector(COLLEGE_INTENT_PROFILE, model=model())
    return DETECTOR


def runtime(llm=None, kb=None, **kwargs):
    llm = llm or FakeLLM()
    rt = build_college_runtime(knowledge=kb or fixture_kb(), answerer=GroundedAnswerer(R.PERSONA, client=llm),
                               model=model(), stt_provider=lambda: FakeSTT(), **kwargs)
    rt.intent_detector = detector()  # the same profile; built once for speed
    return rt, llm


def conversation():
    c = ConversationManager()
    c.start_conversation()
    return c


def ask(rt, text, institution=A, language="en", conv=None, localizer=None):
    conv = conv or conversation()
    localizer = localizer or CatalogLocalizer(language, R.COLLEGE_CATALOG)
    result = rt.run_turn(conv, text, localizer, context={"institution_id": institution} if institution else {})
    return result, conv, localizer


def detect(text):
    turn = normalize_turn(text)
    if classify_turn(turn.routing) is not None:
        return {"kind": "CONTROL", "is_intent": False, "intent": None}
    return detector().detect(turn.normalized)


def cases(name):
    return json.loads((FIXTURES / "college_intents" / f"{name}.json").read_text(encoding="utf-8"))["cases"]


KANNADA = re.compile(r"[ಀ-೿]")

# =========================================================
# 1. THE CATALOGUE
# =========================================================

REQUESTED = {
    "admission_process", "admission_documents", "admission_eligibility", "admission_status",
    "fee_information", "payment_process", "scholarship_information",
    "course_information", "department_information", "academic_calendar", "examination_information",
    "hostel_information", "transport_information", "student_services", "contact_information",
    "campus_navigation", "office_location", "general_college_query",
}

EXPECTED_CATEGORIES = {
    "admission_process": {"admission_process", "application_deadlines"},
    "admission_documents": {"admission_documents"},
    "admission_eligibility": {"admission_eligibility"},
    "fee_information": {"fees"},
    "payment_process": {"fees"},
    "scholarship_information": {"scholarships"},
    "course_information": {"programmes"},
    "department_information": {"departments"},
    "academic_calendar": {"academic_calendar"},
    "examination_information": {"examinations"},
    "hostel_information": {"hostel"},
    "transport_information": {"transport"},
    "student_services": {"student_services", "facilities"},
    "contact_information": {"contacts"},
    "office_location": {"office_locations", "contacts"},
    "general_college_query": {"overview", "faq"},
}


def test_catalogue_covers_the_requested_intents():
    names = {spec.name for spec in INTENTS}
    check("all 18 requested intents exist, and no others", names == REQUESTED, str(names ^ REQUESTED))
    groups = {spec.name: spec.group for spec in INTENTS}
    check("intents are grouped as specified",
          {g for n, g in groups.items() if n.startswith("admission")} == {"admissions"}
          and groups["fee_information"] == groups["payment_process"] == groups["scholarship_information"] == "fees"
          and groups["campus_navigation"] == groups["office_location"] == groups["general_college_query"] == "campus")
    for name, expected in EXPECTED_CATEGORIES.items():
        check(f"{name} -> categories {sorted(expected)}", COLLEGE_INTENT_PROFILE.spec(name).categories == expected)
    check("every category is a known College knowledge category",
          all(spec.categories <= COLLEGE_CATEGORIES for spec in INTENTS))
    check("admission_status is a workflow, never retrieval",
          COLLEGE_INTENT_PROFILE.spec("admission_status").handler == "workflow:admission_status"
          and not COLLEGE_INTENT_PROFILE.spec("admission_status").categories)
    check("campus_navigation is a workflow, never retrieval",
          COLLEGE_INTENT_PROFILE.spec("campus_navigation").handler == "workflow:campus_navigation")
    check("every intent has English and Kannada examples",
          all(any(KANNADA.search(e) for e in spec.examples) and any(not KANNADA.search(e) for e in spec.examples)
              for spec in INTENTS))


def test_intent_detection_holds_no_reply_text():
    source = (HERE.parent / "app" / "domains" / "college" / "intents.py").read_text(encoding="utf-8")
    profile_source = (HERE.parent / "app" / "intent" / "profile.py").read_text(encoding="utf-8")
    sentences = [template.split("{")[0].strip() for template, _ in R.SENTENCES]
    check("no fixed reply appears in the intent catalogue", not any(s and s in source for s in sentences))
    check("no fixed reply appears in the detector", not any(s and s in profile_source for s in sentences))
    check("IntentSpec has no field for reply text",
          not any("reply" in f or "response" in f for f in IntentSpec.__dataclass_fields__))


def test_profile_is_validated():
    spec = IntentSpec("x", "g", frozenset({"fees"}), examples=("x",))

    def bad(**kw):
        try:
            IntentProfile(**{"domain": "d", "intents": (spec,), "anchors": {OUT_OF_SCOPE: ("y",)},
                             "margin": 0.0, "ambiguity_gap": 0.02, **kw})
        except ValueError:
            return True
        return False

    check("duplicate intents refused", bad(intents=(spec, spec)))
    check("a profile without OUT_OF_SCOPE anchors refused", bad(anchors={"ACK": ("ok",)}))
    check("a knowledge intent without categories refused",
          bad(intents=(IntentSpec("y", "g", frozenset(), examples=("y",)),)))
    check("an intent without examples refused", bad(intents=(IntentSpec("z", "g", frozenset({"fees"})),)))


# =========================================================
# 2. DETECTION: ENGLISH, KANNADA, OTHER DOMAIN
# =========================================================

def score(name):
    rows = cases(name)
    hits, kn_hits, kn_total, rejected, negatives, misses = 0, 0, 0, 0, 0, []
    for row in rows:
        r = detect(row["text"])
        expected = row["expect"]
        if expected == "NOT_INTENT":
            negatives += 1
            ok = not r["is_intent"]
            rejected += ok
        else:
            ok = r["is_intent"] and r["intent"] == expected
            if KANNADA.search(row["text"]):
                kn_total += 1
                kn_hits += ok
        hits += ok
        if not ok:
            misses.append(f"{row['text']!r}->{r.get('intent')}/{r.get('kind')}")
    return hits, len(rows), kn_hits, kn_total, rejected, negatives, misses


def test_development_set():
    hits, total, kn_hits, kn_total, rejected, negatives, misses = score("dev")
    check(f"dev set: {hits}/{total} correct (tuned on it)", hits == total, "; ".join(misses))
    check(f"dev set Kannada: {kn_hits}/{kn_total}", kn_hits == kn_total)
    check(f"dev set non-intents rejected: {rejected}/{negatives}", rejected == negatives)


def test_held_out_set():
    hits, total, kn_hits, kn_total, rejected, negatives, misses = score("heldout")
    print(f"        held-out: {hits}/{total} ({hits / total:.0%}); Kannada {kn_hits}/{kn_total}; "
          f"misses: {'; '.join(misses)}")
    check("held-out accuracy at least 90%", hits / total >= 0.90, f"{hits}/{total}")
    check("held-out Kannada accuracy at least 85%", kn_hits / kn_total >= 0.85, f"{kn_hits}/{kn_total}")
    check("held-out: every non-intent (banking, small talk) rejected", rejected == negatives,
          f"{rejected}/{negatives}")


def test_banking_sentences_are_not_college_intents():
    examples = [t for texts in BANKING_INTENT_EXAMPLES.values() for t in texts]
    accepted = [t for t in examples if detect(t)["is_intent"]]
    check(f"Banking's own intent examples: 0/{len(examples)} accepted as College", not accepted, str(accepted[:3]))

    def accepted_in(name):
        rows = json.loads((EVALUATION / f"{name}.json").read_text(encoding="utf-8"))["fixtures"]
        texts = [row["text"] for row in rows]
        return [t for t in texts if detect(t)["is_intent"]], len(texts)

    # Banking sets that informed the out-of-scope rules: must stay clean.
    for name in ("m4_heldout", "multilingual_v1", "m10_dev"):
        wrong, total = accepted_in(name)
        check(f"Banking {name} (used for tuning): {len(wrong)}/{total} accepted as College", not wrong, str(wrong))

    # Banking sets never looked at while tuning: the honest measurement.
    wrong_all, total_all = [], 0
    for name in ("m3_language_cues", "m5_fresh", "m7_fresh"):
        wrong, total = accepted_in(name)
        wrong_all += wrong
        total_all += total
    print(f"        untouched Banking sets: {len(wrong_all)}/{total_all} accepted as College: {wrong_all}")
    check("untouched Banking sets: at most 1% accepted as College", len(wrong_all) <= total_all * 0.01,
          f"{len(wrong_all)}/{total_all}")


def test_other_domain_gate():
    check("a Banking service named in Kannada is out of scope", banking_sentence("ಸಾಲಕ್ಕೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು", frozenset()))
    check("an education loan is out of scope for CampusGuide",
          detect("I need an education loan")["kind"] == OUT_OF_SCOPE)
    check("an electricity bill is out of scope", detect("I want to pay my electricity bill")["kind"] == OUT_OF_SCOPE)
    r = detect("Can I pay the hostel fee by UPI?")
    check("paying a College fee by UPI is still a College question", r["is_intent"], str(r.get("kind")))
    check("a bare amount is not a fee question", not detect("5 हज़ार रुपये")["is_intent"])


# =========================================================
# 3. AMBIGUITY AND CLARIFICATION
# =========================================================

def test_ambiguous_queries_ask_instead_of_guessing():
    same = ("tell me about the thing",)
    profile = IntentProfile(
        domain="t",
        intents=(IntentSpec("alpha", "g", frozenset({"fees"}), examples=same, keywords=("alphaword",)),
                 IntentSpec("beta", "g", frozenset({"hostel"}), examples=same),
                 IntentSpec("general", "g", frozenset({"overview"}), examples=same)),
        anchors={OUT_OF_SCOPE: ("what is the weather today",)},
        margin=0.0, ambiguity_gap=0.02, general_intents=frozenset({"general"}),
    )
    d = ProfileIntentDetector(profile, model=model())
    r = d.detect("tell me about the thing")
    check("two equally likely intents -> AMBIGUOUS", r["kind"] == AMBIGUOUS, r["kind"])
    check("the options are the two specific intents", sorted(r["alternatives"]) == ["alpha", "beta"], str(r["alternatives"]))
    check("a general intent is never offered as an option", "general" not in r["alternatives"])
    r = d.detect("tell me about the thing alphaword")
    check("naming one of them by keyword resolves it", r["kind"] == "INTENT" and r["intent"] == "alpha", str(r))

    rt, llm = runtime()
    rt.intent_detector = SimpleNamespace(detect=lambda text: {
        "kind": AMBIGUOUS, "is_intent": False, "intent": "hostel_information",
        "alternatives": ["hostel_information", "fee_information"], "related": []})
    result, _, _ = ask(rt, "something vague")
    check("the runtime asks which was meant", result.outcome == CLARIFY
          and result.reply == R.CLARIFY.format(topic="the hostel", topic2="fees"), result.reply)
    check("clarifying asks no model and retrieves nothing", not llm.prompts)
    result, _, _ = ask(rt, "something vague", language="kn")
    check("the clarification is rendered in Kannada", "ಹಾಸ್ಟೆಲ್" in result.reply and "ಶುಲ್ಕ" in result.reply, result.reply)


# =========================================================
# 4. INTENT-AWARE RAG THROUGH THE RUNTIME
# =========================================================

def test_answers_come_from_the_intents_category_and_institution():
    rt, llm = runtime()
    result, _, _ = ask(rt, "How much is the tuition fee?")
    check("fee question answered", result.outcome == ANSWERED and result.intent == "fee_information", result.outcome)
    check("answer is the model's, marked as generated", isinstance(result.canonical_reply, GeneratedText))
    check("answer grounded in A's fee document", "ALPHA-FEE" in result.reply)
    check("sources attribute exactly the fee document", [s["id"] for s in result.sources] == ["a-fees"],
          str(result.sources))
    ev = evidence_of(llm.prompts[-1])
    check("the model saw only fees evidence of institution A",
          "ALPHA-FEE" in ev and "BETA" not in ev and "ALPHA-HOSTEL" not in ev and "ALPHA-CAL" not in ev)
    check("source attribution says unverified synthetic fixture",
          result.sources[0]["verified"] is False and result.sources[0]["document_type"] == "synthetic_fixture")

    result, _, _ = ask(rt, "How much is the tuition fee?", institution=B)
    check("the same question for institution B uses B's document",
          "BETA-FEE" in result.reply and [s["id"] for s in result.sources] == ["b-fees"])
    check("B's prompt held nothing of A", "ALPHA" not in evidence_of(llm.prompts[-1]))

    for prompt in llm.prompts:
        check("no Banking article ever reaches a College prompt",
              not any(word in prompt for word in ("withdrawal slip", "cheque book", "passbook", "savings account")))


def test_near_topic_question_is_not_answered_from_a_neighbouring_category():
    with tempfile.TemporaryDirectory() as logs:
        rt, llm = runtime(kb=fixture_kb(log_dir=logs))
        result, _, _ = ask(rt, "When are the semester examinations?")
        check("Phase 3 near-topic case: examinations -> no verified information",
              result.outcome == NO_VERIFIED_INFORMATION and result.intent == "examination_information",
              f"{result.outcome} {result.intent}")
        check("the reply names the topic and points to the office",
              result.reply == f"{R.NO_VERIFIED_INFO.format(topic='examinations')} {R.CONTACT_OFFICE}", result.reply)
        check("the calendar document was NOT used, and the model was not asked", not llm.prompts and not result.sources)

        result, _, _ = ask(rt, "ಪರೀಕ್ಷೆ ಯಾವಾಗ", language="kn")
        check("the same in Kannada", result.outcome == NO_VERIFIED_INFORMATION and "ಪರೀಕ್ಷೆಗಳು" in result.reply,
              result.reply)

        log = (Path(logs) / "college.jsonl").read_text(encoding="utf-8").splitlines()
        check("unanswered questions are logged with their category",
              any(json.loads(line)["category"] == "examinations" for line in log))


def test_evidence_that_lacks_the_answer_is_not_padded_by_the_model():
    with tempfile.TemporaryDirectory() as logs:
        invented = FakeLLM(script=lambda p: "The hostel fee is 4000 rupees per year.")
        rt, _ = runtime(llm=invented, kb=fixture_kb(log_dir=logs))
        result, _, _ = ask(rt, "What are the hostel fees?")
        check("hostel-fee question searched only the hostel category",
              "ALPHA-HOSTEL" in evidence_of(invented.prompts[-1]) and "ALPHA-FEE" not in evidence_of(invented.prompts[-1]))
        check("an invented amount is rejected -> no verified information",
              result.outcome == NO_VERIFIED_INFORMATION and "4000" not in result.reply, result.reply)
        records = [json.loads(line) for line in (Path(logs) / "college.jsonl").read_text(encoding="utf-8").splitlines()]
        check("the rejection is logged as an ungrounded number", records[-1]["reason"] == UNGROUNDED_NUMBER, str(records[-1]))

    declining = FakeLLM(script=lambda p: "NO_ANSWER")
    rt, _ = runtime(llm=declining)
    result, _, _ = ask(rt, "Is there a hostel for girls?")
    check("a model that declines -> no verified information", result.outcome == NO_VERIFIED_INFORMATION)

    failing = FakeLLM(script=lambda p: RuntimeError("provider down"))
    rt, _ = runtime(llm=failing)
    result, conv, _ = ask(rt, "Is there a hostel for girls?")
    check("a model failure -> no verified information, never a crash", result.outcome == NO_VERIFIED_INFORMATION)
    check("the conversation is still usable after a model failure", conv.session_state.name != "EXITED")


def test_no_retrieval_and_no_model_for_non_questions():
    rt, llm = runtime()
    calls = []
    original = rt.knowledge.retrieve
    rt.knowledge.retrieve = lambda *a, **k: calls.append(a) or original(*a, **k)

    result, _, _ = ask(rt, "I want to deposit money")
    check("a Banking request is out of scope in CampusGuide", result.outcome == OUTCOME_OUT_OF_SCOPE
          and result.reply == R.OUT_OF_SCOPE)
    # Phase 5 changed what these two do (Phase 4 answered "not available in
    # the assistant yet"); what is asserted here is unchanged: neither is
    # answered from documents or by the model. Their workflows are tested in
    # debugging/test_college_workflows.py.
    result, _, _ = ask(rt, "What is my admission status?")
    check("admission status is a backend action, not an answer",
          result.outcome == "action_required" and result.intent == "admission_status" and result.action
          and not result.sources)
    result, _, _ = ask(rt, "Take me to the admission office")
    check("navigation is a workflow, not an answer (no verified campus map in production)",
          result.outcome == NO_VERIFIED_INFORMATION and result.intent == "campus_navigation"
          and result.reply.startswith(R.NO_CAMPUS_MAP), f"{result.outcome} {result.intent}")
    check("none of these retrieved anything or asked the model", not calls and not llm.prompts)


def test_verified_only_enforcement():
    rt, llm = runtime(kb=fixture_kb(include_unverified=False))
    result, _, _ = ask(rt, "How much is the tuition fee?")
    check("with verified-only retrieval, unverified fixtures are never used",
          result.outcome == NO_VERIFIED_INFORMATION and not llm.prompts)

    production = build_college_runtime(answerer=GroundedAnswerer(R.PERSONA, client=FakeLLM()), model=model())
    production.intent_detector = detector()
    check("the production College runtime is verified-only", production.knowledge.include_unverified is False)
    result, _, _ = ask(production, "How much is the tuition fee?", institution="nmamit")
    check("the production College runtime has nothing verified yet -> no verified information",
          result.outcome == NO_VERIFIED_INFORMATION and result.reply.startswith("I don't have verified information"))


def test_answer_language_follows_the_session():
    rt, llm = runtime(llm=FakeLLM(script=lambda p: "ಶುಲ್ಕ 11111 test rupees."))
    result, _, loc = ask(rt, "ಶುಲ್ಕ ಎಷ್ಟು", language="kn")
    check("Kannada session asks the model for Kannada script",
          "Kannada" in llm.systems[-1] and "Kannada script" in llm.prompts[-1])
    check("prompt keeps numbers, codes and names as written",
          "course codes" in llm.prompts[-1] and "exactly as" in llm.prompts[-1])
    check("generated answer is passed through and marked Kannada",
          result.outcome == ANSWERED and result.canonical_reply.language == "kn" and result.reply.startswith("ಶುಲ್ಕ"))

    prompt = build_prompt("q", [{"source": "s", "title": "t", "content": "c"}], "en")
    check("the prompt forbids facts not in the evidence",
          "ONLY the EVIDENCE" in prompt and "NO_ANSWER" in prompt and "Never state a fee" in prompt)


def test_tulu_is_not_claimed():
    rt, llm = runtime()
    result, _, _ = ask(rt, "When are the semester examinations?", language="tcy")
    check("a Tulu (tcy) session is served without error", result.outcome == NO_VERIFIED_INFORMATION)
    check("and answered in English, not presented as Tulu",
          result.reply == f"{R.NO_VERIFIED_INFO.format(topic='examinations')} {R.CONTACT_OFFICE}")


# =========================================================
# 5. CONTROL WORDS AND SESSION BEHAVIOUR
# =========================================================

def test_control_words_and_exit():
    rt, llm = runtime()
    conv, loc = conversation(), CatalogLocalizer("en", R.COLLEGE_CATALOG)

    def say(text, institution=A):
        return rt.run_turn(conv, text, loc, context={"institution_id": institution} if institution else {})

    check("help", say("help").reply == R.HELP)
    check("thanks", say("thank you").reply == R.THANKS)
    check("acknowledgement", say("ok").reply == R.ACKNOWLEDGED)
    check("workflow controls say there is no task", say("pause").reply == R.NO_TASK)
    check("empty turn", say("   ").reply == R.DID_NOT_CATCH)
    check("missing institution is asked for, nothing retrieved", say("fees?", institution=None).reply == R.NO_INSTITUTION)

    answer = say("How much is the tuition fee?")
    check("repeat replays the last reply", say("repeat").reply == answer.reply)
    loc.set_language("kn")
    again = say("repeat")
    # The answer was written in English; shown in a Kannada session it is
    # MARKED as English (the shared localizer's M7 rule), never passed off.
    check("repeating an English answer in a Kannada session marks it as English",
          answer.reply in again.reply and again.reply.startswith("(") and KANNADA.search(again.reply), again.reply)
    say("help")
    check("repeat after a fixed reply re-renders it in the new language", "ಪ್ರವೇಶ" in say("ಮತ್ತೆ ಹೇಳಿ").reply)

    bye = say("bye")
    check("exit ends the conversation with the CampusGuide farewell", bye.ended and "CampusGuide" in bye.reply)
    after = say("How much is the tuition fee?")
    check("every turn after exit gets the farewell", after.ended and not after.intent)
    check("history keeps canonical English", all(not KANNADA.search(str(h["message"])) or isinstance(h["message"], GeneratedText)
                                                  for h in conv.history if h["speaker"] == "Assistant"))


# =========================================================
# 6. RUNTIME REGISTRATION AND INITIALISATION
# =========================================================

def test_runtime_is_registered_and_built_once():
    saved = (dict(engine_module._domain_factories), dict(engine_module._domain_runtimes), engine_module._runtime)
    try:
        engine_module.unregister_domain_runtime("college")
        check("unregistered college is unavailable", engine_module.domain_runtime_status("college") == "unavailable")
        register_builtin_domain_runtimes()
        check("registration builds nothing", engine_module.domain_runtime_status("college") == "registered")

        banking_before = engine_module._runtime
        started = time.perf_counter()
        built = engine_module.get_domain_runtime("college")
        print(f"        College runtime built in {time.perf_counter() - started:.1f} s (encoder already loaded)")
        check("the registered factory builds a DomainKnowledgeRuntime", isinstance(built, DomainKnowledgeRuntime))
        check("built once, then reused", engine_module.get_domain_runtime("college") is built)
        check("status is ready", engine_module.domain_runtime_status("college") == "ready")
        check("building College does not build or replace the Banking runtime", engine_module._runtime is banking_before)
        check("College shares the engine's one sentence encoder", built.intent_detector.model is get_embedding_model())
        check("College reads its own workflow folder, not Banking's",
              built.dialogue.workflow_loader.workflow_folder == COLLEGE.workflows_dir)
        check("College knowledge is verified-only", built.knowledge.include_unverified is False)
        check("College is not given the Banking intent tables",
              not any(t in [x for _, x in built.intent_detector._banking] for t in BANKING_INTENT_EXAMPLES["deposit money"]))

        shared = object()
        rt = DomainKnowledgeRuntime(domain="college", profile=COLLEGE_INTENT_PROFILE, detector=detector(),
                                    knowledge=fixture_kb(), answerer=GroundedAnswerer(R.PERSONA, client=FakeLLM()),
                                    replies=built.replies, stt_provider=lambda: shared)
        check("speech recognition is borrowed, not loaded again", rt.stt is shared and rt.stt is shared)

        attempts = []

        def broken():
            attempts.append(1)
            raise ValueError("manifest invalid")

        engine_module.register_domain_runtime("college", broken)
        try:
            engine_module.get_domain_runtime("college")
            refused = False
        except engine_module.DomainRuntimeUnavailable:
            refused = True
        check("a College runtime that fails to build is 'unavailable'", refused)
        try:
            engine_module.get_domain_runtime("college")
        except engine_module.DomainRuntimeUnavailable:
            pass
        check("a failed build is retried, not cached", len(attempts) == 2)
    finally:
        engine_module._domain_factories.clear()
        engine_module._domain_factories.update(saved[0])
        engine_module._domain_runtimes.clear()
        engine_module._domain_runtimes.update(saved[1])
        engine_module._runtime = saved[2]


# =========================================================
# 7. THE SERVICE: SESSIONS, DOMAINS, NO FALLBACK
# =========================================================

class FakeBanking:
    def __init__(self):
        self.turns = []
        self.dialogue = SimpleNamespace(workflow_loader=engine_module.WorkflowLoader() if hasattr(engine_module, "WorkflowLoader") else None)
        from app.workflow.loader import WorkflowLoader
        self.dialogue = SimpleNamespace(workflow_loader=WorkflowLoader())

    def run_turn(self, conversation, text, localizer=None):
        self.turns.append(text)
        return TurnResult(reply=f"banking:{text}", canonical_reply=f"banking:{text}")

    @staticmethod
    def has_exited(conversation):
        return False


class Service:
    def __init__(self, college_factory=None):
        self.college_factory = college_factory

    def __enter__(self):
        self.saved = (main.get_runtime, main.INTERNAL_TOKEN, main.COLLEGE_TOKEN, main.ENGINE_ENV,
                      dict(engine_module._domain_factories), dict(engine_module._domain_runtimes))
        self.banking = FakeBanking()
        main.get_runtime = lambda: self.banking
        main.INTERNAL_TOKEN, main.COLLEGE_TOKEN, main.ENGINE_ENV = BANK_TOKEN, COLLEGE_TOKEN, "development"
        engine_module.unregister_domain_runtime("college")
        self.llm = FakeLLM()
        engine_module.register_domain_runtime("college", self.college_factory or (lambda: runtime(llm=self.llm)[0]))
        main.registry.clear()
        self.client = TestClient(main.app)
        return self

    def __exit__(self, *exc):
        main.get_runtime, main.INTERNAL_TOKEN, main.COLLEGE_TOKEN, main.ENGINE_ENV = self.saved[:4]
        engine_module._domain_factories.clear()
        engine_module._domain_factories.update(self.saved[4])
        engine_module._domain_runtimes.clear()
        engine_module._domain_runtimes.update(self.saved[5])
        main.registry.clear()

    def college(self, text, session="C1", institution=A, language="en", **extra):
        return self.client.post("/turn", headers={"X-Internal-Token": COLLEGE_TOKEN}, json={
            "session_id": session, "language": language, "text": text,
            "context": {"institution_id": institution, **extra}})

    def bank(self, text, session="B1"):
        return self.client.post("/turn", headers={"X-Internal-Token": BANK_TOKEN},
                                json={"session_id": session, "language": "en", "text": text})


def test_service_routes_college_turns_to_the_college_runtime():
    with Service() as svc:
        r = svc.college("How much is the tuition fee?")
        body = r.json()
        check("college turn served", r.status_code == 200, r.text)
        check("response carries domain, intent and outcome",
              body["domain"] == "college" and body["intent"] == "fee_information" and body["outcome"] == ANSWERED, str(body))
        check("response carries source attribution, never content",
              body["sources"] and body["sources"][0]["id"] == "a-fees" and "content" not in body["sources"][0])
        check("the Banking runtime was not used", not svc.banking.turns)

        r = svc.bank("deposit")
        body = r.json()
        check("banking turn still served by Banking", r.status_code == 200 and body["reply"] == "banking:deposit")
        check("banking response has no College fields", body["intent"] is None and body["sources"] is None
              and body["outcome"] is None)

        r = svc.college("How much is the tuition fee?", session="C2", institution=B)
        check("the session's institution reaches retrieval", "BETA-FEE" in r.json()["reply"], r.text)

        r = svc.college("ಪರೀಕ್ಷೆ ಯಾವಾಗ", session="C3", language="kn")
        check("a Kannada College session is answered in Kannada", "ಪರೀಕ್ಷೆ" in r.json()["reply"], r.text)


def test_service_college_sessions_are_isolated():
    with Service() as svc:
        svc.college("How much is the tuition fee?", session="S-A")
        r = svc.college("repeat", session="S-B")
        check("another College session has nothing to repeat", r.json()["reply"] == R.NOTHING_TO_REPEAT, r.text)
        r = svc.college("repeat", session="S-A")
        check("the first session repeats its own answer", "ALPHA-FEE" in r.json()["reply"], r.text)

        svc.bank("deposit", session="SAME")
        svc.college("help", session="SAME")
        bank_entry = main.registry.peek("SAME", domain="banking")
        college_entry = main.registry.peek("SAME", domain="college")
        check("same id: separate Banking and College conversations",
              bank_entry.conversation is not college_entry.conversation)
        check("separate localizers: Banking's shared, College's catalog",
              type(bank_entry.localizer).__name__ == "ResponseLocalizer"
              and isinstance(college_entry.localizer, CatalogLocalizer))
        check("no Banking text in the College history",
              all("banking:" not in str(h["message"]) for h in college_entry.conversation.history))

        r = svc.college("fees?", session="S-A", institution=B)
        check("a College session cannot switch institution", r.status_code == 409, r.text)

        errors = []

        def worker(i):
            try:
                inst = A if i % 2 else B
                body = svc.college("How much is the tuition fee?", session=f"P{i}", institution=inst).json()
                if ("ALPHA-FEE" if inst == A else "BETA-FEE") not in body["reply"]:
                    errors.append((i, body["reply"]))
            except Exception as error:  # noqa: BLE001
                errors.append((i, repr(error)))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        check("12 concurrent College sessions, two institutions, no crossover", not errors, str(errors[:2]))


def test_service_never_falls_back_to_banking():
    def broken():
        raise RuntimeError("cannot build")

    with Service(college_factory=broken) as svc:
        r = svc.college("How much is the tuition fee?")
        check("a College runtime that cannot be built -> 503", r.status_code == 503
              and r.json()["error"] == "domain_unavailable", r.text)
        check("and the Banking runtime was not asked instead", not svc.banking.turns)
        check("Banking keeps working meanwhile", svc.bank("deposit").status_code == 200)
        check("no College session was left behind", main.registry.peek("C1", domain="college") is None)


def main_():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    print()
    print("=" * 60)
    print("COLLEGE INTENTS AND RUNTIME TESTS (Phase 4)")
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
    _LOGS.cleanup()
    return 1 if FAILED_CHECKS else 0


if __name__ == "__main__":
    sys.exit(main_())
