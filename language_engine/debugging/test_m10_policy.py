"""
M10 -- APPROVED BANKING-POLICY DECISIONS D1-D8

One block of checks per decision approved by the team (see
evaluation/reports/m10_policy_decisions.md), in English, Kannada, Hindi and
code-mixed forms.

WHAT IS CHECKED

The DETERMINISTIC routing decision: the one production makes when the turn
reaches the detector. For a sentence that production first hands to the LLM
(it looks like a question), the check is on what happens if the LLM hands
the turn back -- so no check passes merely because the LLM is not called
here. The LLM's own answers are not tested (no live LLM).

Offline: M0 network guard, embedding model from the local cache, no LLM.

Run from language_engine/:

    python -m debugging.test_m10_policy
"""

import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from evaluation import harness as h
from evaluation.m10_routing_eval import decide


PASSED = []
FAILED = []

_ENGINE = None

START = "start:"
DEPOSIT, WITHDRAW, BALANCE, LOAN = "deposit money", "withdraw money", "check account balance", "apply for loan"


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def engine():
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = h.build_engine(with_retrieval=False)
    return _ENGINE


def effective(text):
    """The routing decision, or for an LLM-gated turn the decision if the LLM hands it back."""
    got = decide(engine(), text)
    if got["decision"] == "llm_gate":
        return got["if_handed_back"], True
    return got["decision"], False


def expect(text, allowed, label):
    decision, gated = effective(text)
    check(f"{label}: {text!r}", decision in allowed,
          f"got {decision}{' (if the LLM hands it back)' if gated else ''}")


# =========================================================
# D1  wallet top-up is unsupported, never a cash deposit
# =========================================================

def test_d1_wallet_top_up_is_declined():
    for text in ("add one thousand rupees to my Paytm wallet from my bank account",
                 "पेटीएम वॉलेट में अपने खाते से पाँच सौ रुपये डालने हैं",
                 "ನನ್ನ ಫೋನ್‌ಪೇ ವ್ಯಾಲೆಟ್ಗೆ ಎರಡು ಸಾವಿರ ರೂಪಾಯಿ ಹಾಕಬೇಕು",
                 "wallet ಗೆ ಬ್ಯಾಂಕ್ ಖಾತೆಯಿಂದ ಹಣ ಹಾಕಬೇಕು",
                 "मेरे wallet में पैसे डालने हैं"):
        expect(text, {"decline"}, "D1 declined")


# =========================================================
# D2  capability questions are answered, not started
# =========================================================

def test_d2_capability_questions_are_answered():
    for text in ("what is the maximum amount I can withdraw in one day",
                 "ಕೌಂಟರಲ್ಲಿ ಗರಿಷ್ಠ ಎಷ್ಟು ಹಣ ಡ್ರಾ ಮಾಡಬಹುದು",
                 "मैं एक दिन में अधिकतम कितने पैसे निकाल सकता हूँ",
                 "cash withdrawal की limit कितनी है",
                 "minimum balance for a savings account",
                 # abstains in the M4 narrowing branch (named service below the margin)
                 "मैं अपने बचत खाते से अधिकतम कितनी राशि निकाल सकती हूँ"):
        expect(text, {"answer"}, "D2 answered, not started")


# =========================================================
# D3  loan repayment through a payment app: unsupported, never an application
# =========================================================

def test_d3_loan_repayment_is_declined():
    for text in ("can I pay my home loan EMI through Google Pay",
                 "ಫೋನ್‌ಪೇ ಮೂಲಕ ನನ್ನ ಸಾಲದ ಕಂತು ಕಟ್ಟಬಹುದಾ",
                 "क्या मैं पेटीएम से अपने लोन की किस्त भर सकता हूँ",
                 "personal loan का EMI paytm से भरना है",
                 "how can I repay my car loan using PhonePe",
                 # payment apps named by brand or spelled out
                 "ಪೇ ಟಿ ಎಮ್ ಮೂಲಕ ನನ್ನ ವಾಹನ ಸಾಲದ ಮರುಪಾವತಿ ಮಾಡಬಹುದಾ",
                 "क्या एयरटेल मनी से मेरे होम लोन की किस्त भरी जा सकती है",
                 "can I repay my gold loan with PayZapp"):
        expect(text, {"decline"}, "D3 declined")


def test_d3_repayment_is_never_a_loan_application():
    for text in ("I want to repay my loan", "ನನ್ನ ಸಾಲ ಮರುಪಾವತಿ ಮಾಡಬೇಕು", "मुझे लोन की किस्त जमा करनी है"):
        decision, _ = effective(text)
        check(f"D3 never starts a loan application: {text!r}", decision != START + LOAN, decision)


# =========================================================
# D4  "is there enough money?" is balance-related; no live balance claimed
# =========================================================

def test_d4_enough_money_is_balance_related():
    for text in ("is there enough money in my account for an eight thousand rupee purchase",
                 "ನನ್ನ ಖಾತೆಯಲ್ಲಿ ಹತ್ತು ಸಾವಿರಕ್ಕೆ ಸಾಕಷ್ಟು ಹಣ ಇದೆಯಾ",
                 "क्या मेरे खाते में बीस हज़ार के लिए पर्याप्त पैसे हैं",
                 "मेरे account में enough balance है क्या"):
        decision, gated = effective(text)
        check(f"D4 balance-related, never another service: {text!r}",
              decision in (START + BALANCE, "clarify", "answer"), decision)


def test_d4_no_live_balance_is_claimed():
    # The balance service has no workflow definition and no integration: the
    # assistant says so, and its reply contains no amount.
    from app.conversation.manager import ConversationManager
    from app.dialogue.manager import DialogueManager
    from app.workflow.loader import WorkflowLoader
    dialogue = DialogueManager.__new__(DialogueManager)
    dialogue.workflow_loader = WorkflowLoader()
    conversation = ConversationManager()
    started, reply = dialogue.start_workflow(conversation, BALANCE)
    check("D4 balance starts no procedure", started is False and conversation.current_workflow is None)
    check("D4 the reply states no amount and claims no access",
          not any(ch.isdigit() for ch in reply) and "don't have a guided procedure" in reply, reply)


# =========================================================
# D5  supported + unsupported in one sentence: ask which
# =========================================================

def test_d5_mixed_requests_ask():
    for text in ("transfer some money and check my balance",
                 "मेरा बैलेंस बताओ और भाई को पैसे भेज दो",
                 "ಬ್ಯಾಲೆನ್ಸ್ ನೋಡಿ ಆಮೇಲೆ ತಮ್ಮನಿಗೆ ಹಣ ಕಳಿಸಿ",
                 "deposit five thousand and pay my electricity bill"):
        expect(text, {"clarify"}, "D5 asks which request")


# =========================================================
# D6  wallet balance is unsupported, never a bank balance
# =========================================================

def test_d6_wallet_balance_is_declined():
    for text in ("check my wallet balance",
                 "what is my Paytm wallet balance",
                 "ನನ್ನ ವ್ಯಾಲೆಟ್ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು",
                 "मेरे वॉलेट में कितने पैसे हैं",
                 "मेरा phonepe wallet balance बताओ"):
        expect(text, {"decline"}, "D6 declined")


# =========================================================
# D7  an app not showing the balance is a complaint, not an enquiry
# =========================================================

def test_d7_app_not_showing_balance_is_a_complaint():
    for text in ("the app is not showing my balance",
                 "ನನ್ನ ಫೋನ್‌ಪೇ ಆ್ಯಪ್ ಬ್ಯಾಲೆನ್ಸ್ ತೋರಿಸ್ತಿಲ್ಲ",
                 "मेरे ऐप में बैलेंस नहीं दिख रहा है",
                 "app में balance show नहीं हो रहा"):
        expect(text, {"decline"}, "D7 treated as a complaint (decline reply), not a balance enquiry")


def test_d7_the_routing_layer_answers_a_complaint_not_a_refusal():
    # Real _respond with a stand-in detector: a negated complaint gets the
    # decline sentence, while a negated withheld request keeps the refusal.
    from app.conversation.manager import ConversationManager
    from app.conversation.state import WorkflowState
    from app.dialogue.manager import DialogueManager
    from app.pipeline.voice_pipeline import VoiceAssistantPipeline
    from app.workflow.loader import WorkflowLoader

    class StandIn:
        def __init__(self, reason):
            self.reason = reason

        def detect_intent(self, text):
            return {"intent": BALANCE, "confidence": 0.9, "category": "UNSUPPORTED_OPERATION",
                    "is_banking_intent": False, "margin": 0.2, "withheld_start": True, "abstain_reason": self.reason}

    class Host:
        def __init__(self, reason):
            self.conversation = ConversationManager()
            self.dialogue = DialogueManager.__new__(DialogueManager)
            self.dialogue.workflow_loader = WorkflowLoader()
            self.dialogue.intent_detector = self.intent_detector = StandIn(reason)

    host = Host("troubleshooting")
    reply = VoiceAssistantPipeline._respond(host, None, "the app is not showing my balance")
    check("D7 complaint -> the decline sentence, not the refusal reply", reply.startswith("I can't help with that."), reply)
    check("D7 nothing started", host.conversation.workflow_state == WorkflowState.NONE)

    host = Host("unsupported_operation")
    refusal = DialogueManager.handle_refused_request(host.dialogue, host.conversation)
    check("a negated withheld request still gets the refusal reply",
          VoiceAssistantPipeline._respond(host, None, "I don't want to send money") == refusal)


# =========================================================
# D8  an education-loan application is a loan request
# =========================================================

def test_d8_education_loan_application_starts_the_loan_workflow():
    for text in ("I want to apply for an education loan",
                 "ಮಗನ ಓದಿಗೆ ಶಿಕ್ಷಣ ಸಾಲಕ್ಕೆ ಅರ್ಜಿ ಹಾಕಬೇಕು",
                 "मुझे पढ़ाई के लिए एजुकेशन लोन चाहिए",
                 "education loan ಗೆ apply ಮಾಡಬೇಕು"):
        expect(text, {START + LOAN}, "D8 starts the loan workflow")


def test_d8_education_loan_question_is_not_an_application():
    expect("education loan eligibility rules", {"answer"}, "D8/D2 a question about it is answered")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    h.install_network_guard()
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M10 APPROVED POLICY TESTS (D1-D8)")
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
