"""Banking intent detection with abstention (Phase 3.2B-12).

WHAT CHANGED AND WHY

This detector used to be a total function: argmax over five ENGLISH label
strings, no abstention. Two consequences were observed live:

  - Kannada requests were mislabelled. "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು" (deposit) scored
    0.459 as "withdraw money", because the only prototypes were English and
    cross-lingual alignment for Kannada is weak (measured 0.50-0.66 between an
    English prototype and its Kannada equivalent).
  - Anything at all became a banking request. "Thank you." started a loan
    workflow at 0.212; "ಸಾಕು" (enough) scored 0.243 as "withdraw money"; "I want
    to hack the site" had nowhere to go but a banking label.

Both are fixed here without training anything:

  1. Each intent carries example phrasings in English, Kannada and Hindi
     (app/intent/intent_examples.py). An utterance is scored against every
     example and an intent takes its BEST example score. Measured: Kannada
     requests now match their own intent at 0.85-1.00 instead of 0.46.

  2. Abstention is CONTRASTIVE, not a hand-picked cut-off. Non-banking anchors
     (knowledge questions, small talk, acknowledgements, control words, unsafe
     requests) are scored alongside the intents. A banking intent is only
     returned when it beats every anchor by a margin.

WHY NOT A PLAIN THRESHOLD

An absolute cut-off does not separate these classes -- the existing code
comments record that "Good bye friend" scored 0.321 while the genuine request
"I want to take a load" scored 0.325. The contrastive margin does separate
them. Measured over the Phase 3.2B-12 fixtures:

    lowest  margin on a true banking request : +0.149
    highest margin on a non-banking utterance: -0.136
    separation gap                           : +0.285

BANKING_MARGIN sits at 0.05: comfortably below every true request and above
every non-banking one, with headroom on both sides. It is a documented
consequence of that measurement, not a guess, and test_phase32b12 re-measures
the gap so the margin cannot silently stop separating the classes.

CONTRACT

detect_intent() still returns {"intent", "confidence"} with `intent` being one
of INTENTS, so every existing caller and test keeps working. The added keys
("category", "is_banking_intent", "anchor_category", "margin", "scores") are
additive. Callers that must not start a workflow on a non-request should read
`is_banking_intent`.
"""
from sklearn.metrics.pairwise import cosine_similarity

from app.intent.intent_examples import (
    ACKNOWLEDGEMENT,
    CONTROL,
    KNOWLEDGE_QUESTION,
    UNSUPPORTED,
    all_anchor_examples,
    all_banking_examples,
)
from app.intent.routing_safety import (
    declined_regardless_cues,
    information_question_cues,
    troubleshooting_cues,
    unsupported_operation_cues,
)
from app.intent.service_keywords import service_evidence
from app.knowledge.embedding_model import get_embedding_model

from .intents import INTENTS

#: Result categories. BANKING_INTENT is the only one that may start a workflow.
BANKING_INTENT = "BANKING_INTENT"
OUT_OF_DOMAIN = "OUT_OF_DOMAIN"

#: M4: the embeddings call this a banking request, but not for any service
#: the sentence actually names (see service_keywords). Nothing starts; the
#: customer is asked which service they want.
AMBIGUOUS_SERVICE = "AMBIGUOUS_SERVICE"

#: M10: a banking operation the assistant does not offer (a transfer, UPI, a
#: bill, a wallet, a card, insurance). Nothing starts; the customer is told
#: what the assistant can do. Distinct from UNSUPPORTED, the anchor for
#: requests it must not serve ("rob the bank"); both get the same reply.
UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION"

#: How far a banking intent must beat the best non-banking anchor. See the
#: module docstring for the measurement this comes from.
#:
#: Re-measured in M4 on the M0 + M3 evaluation sets, and deliberately left
#: at 0.05. No margin separates knowledge QUESTIONS from requests for this
#: model: a correctly labelled request scored as low as -0.068
#: ("paise jama karne hai") while questions scored up to +0.423 ("बैलेंस
#: कैसे चेक करें"). Raising it to 0.11 would lose 10 dev requests and still
#: pass 23 dev questions. Questions are kept away from this decision by the
#: deterministic cue gate (multilingual_questions, M3), not by this number.
BANKING_MARGIN = 0.05


class IntentDetector:

    def __init__(self):
        print("Loading multilingual model... (first time will take time)")

        self.model = get_embedding_model()

        # Label prototypes: every example of every intent, encoded once.
        self._banking = all_banking_examples()
        self._banking_embeddings = self.model.encode([t for _, t in self._banking])

        # Non-banking anchors, encoded once. These are what make abstention
        # possible; without them argmax has no way to say "none of these".
        self._anchors = all_anchor_examples()
        self._anchor_embeddings = self.model.encode([t for _, t in self._anchors])

        # Kept so callers that used the old attribute keep working.
        self.intent_embeddings = self.model.encode(INTENTS)

        print("Model loaded successfully ✅")

    # ------------------------------------------------------------------ scoring

    def score_all(self, text):
        """Best score per banking label and per anchor category."""
        embedding = self.model.encode([text])

        banking_scores = cosine_similarity(embedding, self._banking_embeddings)[0]
        anchor_scores = cosine_similarity(embedding, self._anchor_embeddings)[0]

        per_intent = {}
        for (label, _), score in zip(self._banking, banking_scores):
            value = float(score)
            if value > per_intent.get(label, -1.0):
                per_intent[label] = value

        per_anchor = {}
        for (category, _), score in zip(self._anchors, anchor_scores):
            value = float(score)
            if value > per_anchor.get(category, -1.0):
                per_anchor[category] = value

        return per_intent, per_anchor

    def detect_intent(self, text: str):
        """Classify `text`.

        Returns a mapping whose "intent"/"confidence" keys keep the historical
        contract. Read "is_banking_intent" before starting a workflow: it is
        False for questions, acknowledgements, control words and anything
        out of domain, and in that case "intent" is only the nearest label, not
        a decision.
        """
        per_intent, per_anchor = self.score_all(text or "")

        best_anchor = max(per_anchor, key=per_anchor.get)
        best_anchor_score = per_anchor[best_anchor]

        # ---------------------------------------------------------
        # LEXICAL NARROWING  (M4)
        #
        # When the sentence names services unambiguously, choose only
        # among those. The margin test below is unchanged and applied
        # to the narrowed choice, whose score can never exceed the
        # unrestricted best: this can turn a banking verdict into an
        # abstention or into a different, NAMED service -- never turn
        # a non-banking utterance into a banking one.
        # ---------------------------------------------------------
        evidence = service_evidence(text or "")
        candidates = [i for i in per_intent if i in evidence] or list(per_intent)

        best_intent = max(candidates, key=per_intent.get)
        best_intent_score = per_intent[best_intent]

        margin = best_intent_score - best_anchor_score
        is_banking = margin >= BANKING_MARGIN

        unrestricted_best = max(per_intent.values())
        lost_to_narrowing = (
            not is_banking
            and unrestricted_best - best_anchor_score >= BANKING_MARGIN
        )

        # ---------------------------------------------------------
        # THE M10 START RULE
        #
        # A banking verdict starts a workflow only when the sentence
        # establishes which supported service it wants. Measured in
        # M10 on the real-speech banking clips: 118 of 130 out-of-scope
        # requests that started a workflow named no service, and for
        # Kannada the embeddings separate the five services by a
        # median 0.011. Asking costs a turn; a wrong procedure costs
        # more. In order:
        #
        #   1. a question ABOUT a service (how, limits, documents,
        #      charges, why, when) is answered, never started;
        #   2. an operation the assistant does not offer (transfer,
        #      UPI, bills, wallets, cards, insurance) is declined --
        #      or, when the sentence also names a supported service,
        #      the customer is asked which they mean;
        #   3. no named service and no service phrasing: ask.
        #
        # Approved policy (evaluation/reports/m10_policy_decisions.md)
        # comes first and declines even beside a supported service:
        #   D7  an app or balance that is not showing is a complaint
        #       (abstain_reason "troubleshooting": not a refusal either);
        #   D1/D6  a wallet (top-up is not a deposit, its balance is not
        #       a bank balance); D3  repaying a loan through a payment app
        #       (never a loan application).
        #
        # Evidence includes service PHRASING, not only service nouns
        # (service_keywords, M10). The margin, the scores and
        # BANKING_MARGIN are unchanged; this can only withhold a
        # start, never create one. `withheld_start` tells the routing
        # layer that the pre-M10 verdict was a start, so its refusal
        # gate still answers a negated sentence as a refusal.
        # ---------------------------------------------------------
        withheld = None
        abstain_reason = None
        if is_banking:
            if troubleshooting_cues(text or ""):
                withheld = (UNSUPPORTED_OPERATION, "troubleshooting")
            elif declined_regardless_cues(text or ""):
                withheld = (UNSUPPORTED_OPERATION, "unsupported_operation")
            elif information_question_cues(text or ""):
                withheld = (KNOWLEDGE_QUESTION, "question_about_service")
            elif unsupported_operation_cues(text or ""):
                withheld = ((AMBIGUOUS_SERVICE, "unsupported_and_supported") if evidence
                            else (UNSUPPORTED_OPERATION, "unsupported_operation"))
            elif not evidence:
                withheld = (AMBIGUOUS_SERVICE, "no_service_named")

        if withheld:
            category, abstain_reason = withheld
            is_banking = False
        elif is_banking:
            category = BANKING_INTENT
        elif lost_to_narrowing:
            # A banking request, but the embeddings preferred a service
            # the sentence does not name. Asking beats guessing -- unless
            # an approved policy says what it is (M10: D7, D1/D3/D6, D2).
            # Not a withheld start: nothing started here before M10.
            if troubleshooting_cues(text or ""):
                category, abstain_reason = UNSUPPORTED_OPERATION, "troubleshooting"
            elif declined_regardless_cues(text or ""):
                category, abstain_reason = UNSUPPORTED_OPERATION, "unsupported_operation"
            elif information_question_cues(text or ""):
                category, abstain_reason = KNOWLEDGE_QUESTION, "question_about_service"
            else:
                category = AMBIGUOUS_SERVICE
        elif best_anchor in (KNOWLEDGE_QUESTION, ACKNOWLEDGEMENT) and troubleshooting_cues(text or ""):
            # D7 below the margin: still a complaint, not a question.
            category = UNSUPPORTED_OPERATION
            abstain_reason = "troubleshooting"
        elif (best_anchor in (KNOWLEDGE_QUESTION, ACKNOWLEDGEMENT)
              and (declined_regardless_cues(text or "")
                   or (unsupported_operation_cues(text or "") and not information_question_cues(text or "")))):
            # M10: "please block my debit card" loses to the knowledge
            # anchor, which would send a request to the question answerer.
            # It names an operation the assistant does not offer: say so.
            # Nothing started before and nothing starts now.
            category = UNSUPPORTED_OPERATION
            abstain_reason = "unsupported_operation"
        elif best_anchor in (KNOWLEDGE_QUESTION, ACKNOWLEDGEMENT, CONTROL, UNSUPPORTED):
            # The winning anchor names what this actually is, so the caller can
            # route it without asking a second classifier.
            category = best_anchor
        else:  # pragma: no cover - every anchor category is listed above
            category = OUT_OF_DOMAIN

        return {
            # --- historical contract ---
            "intent": best_intent,
            "confidence": round(best_intent_score, 3),
            # --- added in 3.2B-12 ---
            "category": category,
            "is_banking_intent": is_banking,
            "anchor_category": best_anchor,
            "anchor_confidence": round(best_anchor_score, 3),
            "margin": round(margin, 3),
            "scores": {k: round(v, 3) for k, v in sorted(per_intent.items())},
            "anchor_scores": {k: round(v, 3) for k, v in sorted(per_anchor.items())},
            # --- added in M4 ---
            "evidence": sorted(evidence),
            # --- added in M10 ---
            "withheld_start": withheld is not None,
            "abstain_reason": abstain_reason,
        }
