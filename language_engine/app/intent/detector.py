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
from app.knowledge.embedding_model import get_embedding_model

from .intents import INTENTS

#: Result categories. BANKING_INTENT is the only one that may start a workflow.
BANKING_INTENT = "BANKING_INTENT"
OUT_OF_DOMAIN = "OUT_OF_DOMAIN"

#: How far a banking intent must beat the best non-banking anchor. See the
#: module docstring for the measurement this comes from.
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

        best_intent = max(per_intent, key=per_intent.get)
        best_intent_score = per_intent[best_intent]

        best_anchor = max(per_anchor, key=per_anchor.get)
        best_anchor_score = per_anchor[best_anchor]

        margin = best_intent_score - best_anchor_score
        is_banking = margin >= BANKING_MARGIN

        if is_banking:
            category = BANKING_INTENT
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
        }
