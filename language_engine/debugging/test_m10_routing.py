"""
M10 -- ROUTING SAFETY

Regression tests for the M10 start rule (app/intent/detector.py), its cues
(app/intent/routing_safety.py), service phrasing (app/intent/
service_keywords.py), the routing layer's withheld-start refusal rule
(app/pipeline/voice_pipeline.py) and the M10 development fixtures.

WHAT IS SIMULATED

Detector verdicts come from the real embedding model, read from the local
cache. The pipeline checks use a stand-in detector so the real
VoiceAssistantPipeline._respond runs with known verdicts. Everything is
text: nothing here says anything about speech recognition.

Offline: M0 network guard, no LLM, no audio.

Run from language_engine/:

    python -m debugging.test_m10_routing
"""

import glob
import hashlib
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.dialogue.manager import DialogueManager
from app.dialogue.multilingual_phrases import word_tokens
from app.dialogue.text_normalization import routing_text
from app.intent.detector import AMBIGUOUS_SERVICE, BANKING_MARGIN, UNSUPPORTED_OPERATION
from app.intent.intents import INTENTS
from app.intent.routing_safety import information_question_cues, unsupported_operation_cues
from app.intent.service_keywords import service_evidence
from app.pipeline.voice_pipeline import VoiceAssistantPipeline
from app.workflow.loader import WorkflowLoader
from evaluation import harness as h


PASSED = []
FAILED = []

DEPOSIT, WITHDRAW, BALANCE, LOAN, OPEN = INTENTS
ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "evaluation" / "fixtures"
DEV = FIXTURES / "m10_dev.json"

#: The dev fixtures were written before the M10 change; edits must be deliberate.
#: Re-pinned once, deliberately: the five "pending" rows became "approved:Dn"
#: when the team approved D1, D3 and D5 (reports/m10_policy_decisions.md).
#: Only that field and the description changed; no label did.
DEV_FROZEN = "ea00aca83e39f9c3304f7097be7b4b2d58e1794463793686d472e99c72678c06"

_DETECTOR = None


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def detector():
    global _DETECTOR
    if _DETECTOR is None:
        from app.intent.detector import IntentDetector
        _DETECTOR = IntentDetector()
    return _DETECTOR


def verdict(text):
    return detector().detect_intent(routing_text(text))


# =========================================================
# CUES
# =========================================================

def test_information_questions():
    for text in ("how do I fill in a deposit slip", "ಒಂದು ದಿನದಲ್ಲಿ ಗರಿಷ್ಠ ಎಷ್ಟು ಹಣ ತೆಗೆಯಬಹುದು",
                 "लोन पर ब्याज कितना लगता है", "which documents are required for opening a savings account",
                 "पैसे जमा करने की प्रक्रिया क्या है", "paise nikalne ki limit kitni hai"):
        check(f"question about a service: {text!r}", information_question_cues(text))
    for text in ("how much money do I have in my account", "I want to deposit five thousand rupees",
                 "what is my balance", "ನನ್ನ ಖಾತೆಯಲ್ಲಿ ಇನ್ನೂ ಎಷ್ಟು ದುಡ್ಡು ಉಳಿದಿದೆ", "I need to recharge my phone",
                 "deposit the school fee"):
        check(f"not a question about a service: {text!r}", not information_question_cues(text),
              str(information_question_cues(text)))


def test_unsupported_operations():
    for text in ("send two thousand rupees to my brother", "ನನ್ನ ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್ ಬ್ಲಾಕ್ ಮಾಡಿ",
                 "गूगल पे से पैसे भेजने हैं", "मोबाइल रिचार्ज करना है", "ನನಗೆ ಆರೋಗ್ಯ ವಿಮೆ ಬೇಕು",
                 "phonepe inda duddu kalisbeku", "ಫೋನ್‌ಪೇ ಮೂಲಕ ಹಣ ಟ್ರಾನ್ಸ್‌ಫರ್ ಮಾಡಬೇಕು"):
        check(f"unsupported: {text!r}", unsupported_operation_cues(text))
    for text in ("I want to pay in two thousand rupees cash", "ಎಟಿಎಂ ಕಾರ್ಡ್ ಕೆಲಸ ಮಾಡ್ತಿಲ್ಲ ಕೌಂಟರಲ್ಲೇ ಹಣ ತೆಗೆಯಬೇಕು",
                 "मुझे अपने खाते में दो हज़ार रुपये जमा करवाने हैं", "I'd like to apply for a home loan",
                 "ಉಳಿತಾಯ ಖಾತೆಗೆ ಸ್ವಲ್ಪ ದುಡ್ಡು ಹಾಕ್ಬೇಕು", "मुझे बचत खाता खुलवाना है"):
        check(f"supported, no unsupported cue: {text!r}", not unsupported_operation_cues(text),
              str(unsupported_operation_cues(text)))


def test_service_phrasing():
    for text, expected in (
        ("how much money do I have in my account", {BALANCE}),
        ("मेरे खाते में अभी कितना पैसा बचा है", {BALANCE}),
        ("ನನ್ನ ಖಾತೆಯಲ್ಲಿ ಇನ್ನೂ ಎಷ್ಟು ದುಡ್ಡು ಉಳಿದಿದೆ", {BALANCE}),
        ("क्या मेरे खाते में दस हज़ार रुपये हैं", {BALANCE}),
        ("ಉಳಿತಾಯ ಖಾತೆಗೆ ಸ್ವಲ್ಪ ದುಡ್ಡು ಹಾಕ್ಬೇಕು", {DEPOSIT}),
        ("I want to put some cash into my savings account", {DEPOSIT}),
        ("I want to pay in two thousand rupees cash", {DEPOSIT}),
        ("khate mein do hazaar daalne hain", {DEPOSIT}),
        ("I want to take some cash out of my account", {WITHDRAW}),
        ("ನನ್ನ ಖಾತೆಯಿಂದ ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಬಿಡಿಸಿಕೊಳ್ಳಬೇಕು", {WITHDRAW}),
        ("मकान बनवाने के लिए कर्ज़ लेना है", {LOAN}),
    ):
        got = set(service_evidence(routing_text(text)))
        check(f"{text!r} -> {sorted(expected)}", got == expected, f"got {sorted(got)}")


def test_phrasing_needs_money():
    for text in ("ನಾನು ಲೋನ್‌ಗೆ ಅರ್ಜಿ ಹಾಕಬೇಕು", "ನನಗೆ ಮನೆ ಕಟ್ಟೋಕೆ ಸಾಲ ಬೇಕು", "take out a loan"):
        got = service_evidence(routing_text(text))
        check(f"no deposit/withdrawal without money: {text!r}", DEPOSIT not in got and WITHDRAW not in got,
              f"got {sorted(got)}")
    check("बचत (savings) is not 'remaining'",
          service_evidence("मुझे बचत खाता खुलवाना है") == {OPEN})
    check("the balance frame yields to a named service",
          service_evidence("how much money can I withdraw") == {WITHDRAW})


# =========================================================
# THE START RULE
# =========================================================

def test_no_service_named_asks():
    for text in ("ನನಗೆ ಐದು ಸಾವಿರ ರೂಪಾಯಿ", "I need some money urgently", "ಅಕೌಂಟ್ ಕೆಲಸ ಒಂದಿದೆ"):
        v = verdict(text)
        check(f"no start without a named service: {text!r}", not v["is_banking_intent"], str(v["category"]))
        if v["withheld_start"]:
            check(f"  withheld as a question to the customer: {text!r}",
                  v["category"] == AMBIGUOUS_SERVICE and v["abstain_reason"] == "no_service_named")


def test_unsupported_is_declined():
    for text in ("send two thousand rupees to my brother", "ನನ್ನ ತಮ್ಮನಿಗೆ ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಕಳಿಸಬೇಕು",
                 "मेरे भाई के खाते में तीन हज़ार रुपये भेज दो", "please block my debit card"):
        v = verdict(text)
        check(f"declined, not started: {text!r}",
              not v["is_banking_intent"] and v["category"] == UNSUPPORTED_OPERATION, str(v["category"]))


def test_supported_and_unsupported_asks():
    # Policy D5: a supported service and an unsupported operation -> ask.
    v = verdict("deposit five thousand and pay my electricity bill")
    check("supported + unsupported is asked, not started",
          not v["is_banking_intent"] and v["category"] == AMBIGUOUS_SERVICE
          and v["abstain_reason"] == "unsupported_and_supported", str(v))
    # Policy D1 (approved after the interim M10 rule asked here): a wallet
    # top-up is declined even though it uses a deposit verb.
    v = verdict("पेटीएम वॉलेट में अपने खाते से पाँच सौ रुपये डालने हैं")
    check("wallet top-up naming a deposit verb is declined (D1)",
          not v["is_banking_intent"] and v["category"] == UNSUPPORTED_OPERATION, str(v))


def test_question_about_a_service_is_answered():
    for text in ("ಒಂದು ದಿನದಲ್ಲಿ ಗರಿಷ್ಠ ಎಷ್ಟು ಹಣ ತೆಗೆಯಬಹುದು", "loan eligibility conditions please"):
        v = verdict(text)
        check(f"not started: {text!r}", not v["is_banking_intent"])
        if v["withheld_start"]:
            check(f"  answered as a question: {text!r}", v["category"] == "KNOWLEDGE_QUESTION")


def test_named_requests_still_start():
    for text, intent in (("I need to withdraw three thousand rupees", WITHDRAW),
                         ("ಹಣ ಜಮಾ ಮಾಡೋಕೆ ಬಂದಿದೀನಿ", DEPOSIT),
                         ("मेरे खाते में अभी कितना पैसा बचा है", BALANCE),
                         ("मुझे नया खाता खुलवाना है", OPEN),
                         ("I'd like to apply for a home loan", LOAN)):
        v = verdict(text)
        check(f"starts {intent}: {text!r}", v["is_banking_intent"] and v["intent"] == intent,
              f"{v['category']} {v['intent']} margin {v['margin']}")


def test_the_rule_never_creates_a_start():
    # Over every fixture text: a start after M10 implies the unchanged margin
    # test passed AND a service was established. Margin and threshold are the
    # pre-M10 ones, so nothing that could not start before can start now.
    texts = []
    for path in sorted(glob.glob(str(FIXTURES / "*.json"))):
        texts += [f["text"] for f in json.load(open(path, encoding="utf-8"))["fixtures"]]
    bad = []
    for text in texts:
        v = verdict(text)
        if v["is_banking_intent"] and not (v["margin"] >= BANKING_MARGIN and v["evidence"]
                                           and v["intent"] in v["evidence"]):
            bad.append(text)
    check(f"no start without the margin and a named service ({len(texts)} fixture texts)", not bad, str(bad[:5]))


def test_contract_keys():
    v = verdict("I need to withdraw three thousand rupees")
    check("historical keys kept", {"intent", "confidence", "category", "is_banking_intent", "margin",
                                   "evidence"} <= set(v))
    check("M10 keys added", v["withheld_start"] is False and v["abstain_reason"] is None)


# =========================================================
# ROUTING LAYER (stand-in detector, real _respond)
# =========================================================

class StandInDetector:
    def __init__(self, result):
        self.result = result

    def detect_intent(self, text):
        return dict(self.result)


class _Host:
    def __init__(self, result):
        self.conversation = ConversationManager()
        self.dialogue = DialogueManager.__new__(DialogueManager)
        self.dialogue.intent_detector = StandInDetector(result)
        self.dialogue.workflow_loader = WorkflowLoader()
        self.intent_detector = self.dialogue.intent_detector


def withheld(category, reason):
    return {"intent": WITHDRAW, "confidence": 0.9, "category": category, "is_banking_intent": False,
            "margin": 0.2, "withheld_start": True, "abstain_reason": reason}


def test_withheld_negated_sentence_is_still_a_refusal():
    host = _Host(withheld(AMBIGUOUS_SERVICE, "no_service_named"))
    refusal_reply = DialogueManager.handle_refused_request(host.dialogue, host.conversation)
    reply = VoiceAssistantPipeline._respond(host, None, "I don't want it")
    check("negated + withheld -> the refusal reply", reply == refusal_reply, reply)
    check("  nothing started", host.conversation.workflow_state == WorkflowState.NONE)


def test_withheld_unsupported_is_declined_and_starts_nothing():
    host = _Host(withheld(UNSUPPORTED_OPERATION, "unsupported_operation"))
    reply = VoiceAssistantPipeline._respond(host, None, "send money to my brother")
    check("unsupported -> the existing decline sentence", reply.startswith("I can't help with that."), reply)
    check("  nothing started", host.conversation.workflow_state == WorkflowState.NONE
          and host.conversation.current_workflow is None)


def test_withheld_ambiguous_asks_which_service():
    host = _Host(withheld(AMBIGUOUS_SERVICE, "no_service_named"))
    reply = VoiceAssistantPipeline._respond(host, None, "five thousand rupees")
    check("ambiguous -> the existing which-service sentence",
          reply == "Okay. Let me know which banking service you'd like help with.", reply)
    check("  nothing started", host.conversation.workflow_state == WorkflowState.NONE)


def test_a_named_start_is_unchanged():
    host = _Host({"intent": DEPOSIT, "confidence": 0.9, "category": "BANKING_INTENT", "is_banking_intent": True,
                  "margin": 0.2, "withheld_start": False, "abstain_reason": None})
    VoiceAssistantPipeline._respond(host, None, "I want to deposit money")
    check("a banking verdict still starts its workflow",
          host.conversation.workflow_state == WorkflowState.ACTIVE and host.conversation.current_workflow == DEPOSIT)


def test_a_negated_non_withheld_abstention_is_unchanged():
    # Not withheld by M10 (a pre-M10 abstention): the abstention reply, as before.
    host = _Host({"intent": DEPOSIT, "confidence": 0.3, "category": "UNSUPPORTED", "is_banking_intent": False,
                  "margin": -0.2, "withheld_start": False, "abstain_reason": None})
    reply = VoiceAssistantPipeline._respond(host, None, "I don't want to rob the bank")
    check("pre-M10 abstention keeps its reply", reply.startswith("I can't help with that."), reply)


# =========================================================
# DEVELOPMENT FIXTURES
# =========================================================

def test_dev_fixture_is_valid():
    document, _ = h.load_fixtures(DEV)
    fixtures = document["fixtures"]
    check("dev fixtures validate against the harness schema", len(fixtures) > 100, str(len(fixtures)))
    check("every row says it is author-labelled",
          all(f["label_status"].startswith("author-labelled") for f in fixtures))
    check("policy is settled or an approved decision",
          all(f["policy"] == "settled" or f["policy"] in ("approved:D1", "approved:D3", "approved:D5")
              for f in fixtures))
    check("no row is still pending a decision", not any(f["policy"] == "pending" for f in fixtures))
    check("every m10_expect is a known decision",
          all(f["m10_expect"].split(":")[0] in ("start", "clarify", "decline", "question", "refusal", "amount",
                                               "control") for f in fixtures))
    check("approved-decision rows are only the families those decisions cover",
          all(f["family"] in ("unsupported", "mixed") for f in fixtures if f["policy"] != "settled"))


def test_dev_fixture_is_frozen():
    digest = hashlib.sha256(DEV.read_bytes()).hexdigest()
    check("dev fixture unchanged since the M10 baseline", digest == DEV_FROZEN, digest)


def test_dev_does_not_copy_held_out_text():
    dev = json.loads(DEV.read_text(encoding="utf-8"))["fixtures"]
    others = []
    for path in sorted(glob.glob(str(FIXTURES / "*.json"))):
        if Path(path).name != DEV.name:
            others += [f["text"] for f in json.load(open(path, encoding="utf-8"))["fixtures"]]
    for item in json.loads((FIXTURES / "asr" / "m9_asr_forms.json").read_text(encoding="utf-8"))["items"]:
        others += [f["text"] for f in item["forms"]]
    spike = ROOT / "debugging" / "spike"
    for manifest in ("indicvoices_banking_manifest.json", "indicvoices_general_manifest.json"):
        others += [u["reference_transcript"]
                   for u in json.loads((spike / manifest).read_text(encoding="utf-8"))["utterances"]]
    from app.intent.intent_examples import all_anchor_examples, all_banking_examples
    others += [t for _, t in all_banking_examples() + all_anchor_examples()]

    pool = [set(word_tokens(o)) for o in others]
    close = []
    for f in dev:
        a = set(word_tokens(f["text"]))
        for b in pool:
            if a and b and len(a & b) / len(a | b) >= 0.7:
                close.append(f["id"])
                break
    check(f"no dev sentence within 0.7 token overlap of {len(others)} held-out texts and model examples",
          not close, str(close))


def test_dev_settled_rows_never_start_wrongly():
    from evaluation.m10_routing_eval import evaluate
    engine = h.build_engine(with_retrieval=False)
    rows = evaluate(engine, json.loads(DEV.read_text(encoding="utf-8"))["fixtures"])
    false_starts = [r["id"] for r in rows if r["outcome"] in ("false_start", "wrong_service")]
    check("no settled or pending dev row starts a workflow it should not", not false_starts, str(false_starts))



def main():
    sys.stdout.reconfigure(encoding="utf-8")
    h.install_network_guard()
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M10 ROUTING SAFETY TESTS")
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
