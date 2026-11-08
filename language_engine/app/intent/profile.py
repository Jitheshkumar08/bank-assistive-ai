"""Intent detection for any domain, from a declarative profile (domain integration, Phase 4).

Banking's IntentDetector (detector.py) is unchanged and still serves Banking.
This module lets another domain use the SAME detection approach with its own
data instead of Banking's:

  1. Every intent carries example phrasings (English, Kannada, ...). An
     utterance is scored against every example; an intent takes its BEST
     example score. (IntentDetector.score_all, inherited, not re-written.)
  2. Abstention is CONTRASTIVE: non-intent anchors (acknowledgements, control
     words, unsafe requests, and out-of-scope text such as the other domain's
     requests) are scored alongside. An intent is returned only when it beats
     every anchor by `margin` when the sentence names it by keyword, or by the
     higher `margin_without_evidence` when only the embeddings support it.
     An optional `out_of_scope_gate` marks sentences of another domain.
  3. LEXICAL NARROWING (Banking's M4 idea): when the sentence names topics
     unambiguously, the choice is restricted to the intents those words name.
     Narrowing can only restrict, never widen -- a sentence the embeddings do
     not call an intent never becomes one here.
  4. AMBIGUITY: when the two best intents are within `ambiguity_gap` of each
     other and lead to different knowledge, the result is AMBIGUOUS with both
     as options, and the caller asks which was meant instead of guessing.

The profile is plain data. Nothing here knows any domain's topics, and no
response text lives in a profile's intent definitions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, FrozenSet, Optional, Tuple

from app.dialogue.text_normalization import fold_word, word_tokens
from app.intent.detector import IntentDetector
from app.knowledge.embedding_model import get_embedding_model

#: Result kinds.
INTENT = "INTENT"
AMBIGUOUS = "AMBIGUOUS"
OUT_OF_SCOPE = "OUT_OF_SCOPE"


@dataclass(frozen=True)
class IntentSpec:
    """One intent: what it is about, never what to say."""

    name: str
    group: str
    #: Knowledge categories this intent is answered from. Empty for an
    #: intent handled by a workflow rather than by retrieval.
    categories: FrozenSet[str] = frozenset()
    #: "knowledge" (retrieval-grounded answer) or "workflow:<id>".
    handler: str = "knowledge"
    examples: Tuple[str, ...] = ()
    #: Words that, written in the sentence, name this intent unambiguously
    #: (matched as word prefixes, after case and script folding).
    keywords: Tuple[str, ...] = ()


@dataclass(frozen=True)
class IntentProfile:
    domain: str
    intents: Tuple[IntentSpec, ...]
    #: Anchor category -> example phrasings. Must include OUT_OF_SCOPE.
    anchors: Dict[str, Tuple[str, ...]]
    margin: float
    ambiguity_gap: float
    #: The margin required when the sentence does NOT name the intent by
    #: keyword. Higher than `margin`: an embedding-only match is weaker
    #: evidence (a bare amount, "5 हज़ार रुपये", sits near "fees").
    margin_without_evidence: float = 0.0
    #: (text, evidence) -> True when the sentence belongs to another domain
    #: and must be out of scope whatever the embeddings say.
    out_of_scope_gate: Optional[Callable[[str, FrozenSet[str]], bool]] = field(default=None, compare=False)
    #: Intents that only say "something about this domain" -- never offered
    #: as one side of an ambiguity, and chosen only when nothing more
    #: specific is.
    general_intents: FrozenSet[str] = frozenset()
    notes: str = field(default="", compare=False)

    def __post_init__(self) -> None:
        names = [spec.name for spec in self.intents]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate intent names in profile.")
        if OUT_OF_SCOPE not in self.anchors:
            raise ValueError("A profile needs OUT_OF_SCOPE anchors to abstain.")
        for spec in self.intents:
            if not spec.examples:
                raise ValueError(f"Intent {spec.name!r} has no examples.")
            if spec.handler == "knowledge" and not spec.categories:
                raise ValueError(f"Knowledge intent {spec.name!r} names no categories.")
        if not self.general_intents <= set(names):
            raise ValueError("general_intents must be intents of the profile.")

    def spec(self, name: str) -> IntentSpec:
        for spec in self.intents:
            if spec.name == name:
                return spec
        raise KeyError(name)


def _fold_phrase(text: str) -> str:
    return " ".join(fold_word(w) for w in word_tokens(text))


def _keyword_index(profile: IntentProfile):
    """(single words [(folded, intent)] longest first, phrases [(folded, intent)])."""
    words, phrases = [], []
    for spec in profile.intents:
        for keyword in spec.keywords:
            folded = _fold_phrase(keyword)
            (phrases if " " in folded else words).append((folded, spec.name))
    return sorted(words, key=lambda pair: -len(pair[0])), phrases


class ProfileIntentDetector(IntentDetector):
    """
    IntentDetector's scoring over a profile's examples and anchors.

    Constructed without IntentDetector.__init__ (which loads Banking's
    tables); every attribute score_all() reads is set here from the profile.
    The encoder is the shared one (get_embedding_model is cached), so a second
    domain costs only the encoding of its own examples.
    """

    def __init__(self, profile: IntentProfile, model=None) -> None:
        self.profile = profile
        self.model = model or get_embedding_model()

        # The attribute names score_all() reads. "_banking" is historical:
        # here it holds this profile's intent examples.
        self._banking = [(spec.name, text) for spec in profile.intents for text in spec.examples]
        self._banking_embeddings = self.model.encode([t for _, t in self._banking])
        self._anchors = [(category, text) for category, texts in profile.anchors.items() for text in texts]
        self._anchor_embeddings = self.model.encode([t for _, t in self._anchors])
        self._words, self._phrases = _keyword_index(profile)

    def evidence(self, text: str) -> FrozenSet[str]:
        """
        Intents the sentence names by keyword.

        A single-word keyword matches a word that starts with it (so
        inflected Kannada forms match: ಶುಲ್ಕಕ್ಕೆ, ದಾಖಲೆಗಳು). A phrase keyword
        matches the same words in sequence, the last one by prefix.
        """
        tokens = [fold_word(w) for w in word_tokens(text or "")]
        found = set()
        for token in tokens:
            for keyword, intent in self._words:
                if token.startswith(keyword):
                    found.add(intent)
                    break
        for phrase, intent in self._phrases:
            parts = phrase.split(" ")
            for start in range(len(tokens) - len(parts) + 1):
                window = tokens[start:start + len(parts)]
                if window[:-1] == parts[:-1] and window[-1].startswith(parts[-1]):
                    found.add(intent)
                    break
        return frozenset(found)

    def detect(self, text: str) -> dict:
        profile = self.profile
        per_intent, per_anchor = self.score_all(text or "")

        best_anchor = max(per_anchor, key=per_anchor.get)
        best_anchor_score = per_anchor[best_anchor]

        evidence = self.evidence(text)
        candidates = [i for i in per_intent if i in evidence] or list(per_intent)
        ranked = sorted(candidates, key=per_intent.get, reverse=True)

        # A general intent is chosen only when nothing specific is close.
        specific = [i for i in ranked if i not in profile.general_intents]
        best = ranked[0]
        if best in profile.general_intents and specific and \
                per_intent[best] - per_intent[specific[0]] < profile.ambiguity_gap:
            best = specific[0]

        margin = per_intent[best] - best_anchor_score

        result = {
            "intent": best,
            "confidence": round(per_intent[best], 3),
            "margin": round(margin, 3),
            "anchor_category": best_anchor,
            "anchor_confidence": round(best_anchor_score, 3),
            "evidence": sorted(evidence),
            "alternatives": [],
            "related": [],
            "scores": {k: round(v, 3) for k, v in sorted(per_intent.items())},
        }

        if profile.out_of_scope_gate is not None and profile.out_of_scope_gate(text or "", evidence):
            result.update(kind=OUT_OF_SCOPE, is_intent=False, gate="other_domain")
            return result

        # A sentence that names the intent by keyword needs `margin`; one
        # that does not needs `margin_without_evidence`. So an intent that
        # LOSES to the anchors is accepted only when named ("ನನ್ನ ಬ್ಯಾಲೆನ್ಸ್
        # ಚೆಕ್ ಮಾಡಬೇಕು" -> admission_status at -0.028 is not), and an
        # embedding-only match must be clear.
        required = profile.margin if best in evidence else max(profile.margin, profile.margin_without_evidence)

        if margin < required:
            # Not a request this domain serves; the winning anchor says what
            # it is instead (an acknowledgement, a control word, out of scope).
            result.update(kind=best_anchor, is_intent=False)
            return result

        # Topics the sentence names besides the chosen one ("hostel FEES"):
        # reported for diagnostics, and not a reason to ask. Callers must
        # not widen retrieval with them (see service/domain_runtime.py).
        result["related"] = sorted(i for i in evidence if i != best)

        # Ambiguity: nothing named, the runner-up is close, is specific, and
        # leads somewhere else. Then the embeddings cannot tell; ask.
        others = [i for i in specific if i != best]
        if others and not evidence:
            second = others[0]
            close = per_intent[best] - per_intent[second] < profile.ambiguity_gap
            different = profile.spec(best).categories != profile.spec(second).categories \
                or profile.spec(best).handler != profile.spec(second).handler
            if close and different:
                result.update(kind=AMBIGUOUS, is_intent=False, alternatives=[best, second])
                return result

        result.update(kind=INTENT, is_intent=True)
        return result
