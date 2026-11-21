"""Tulu input understanding: verified-utterance matching and English pivot.

APPROACH (why not a trained classifier)

There are 34 customer utterances: 12 deposit, 7 withdrawal, 15 conversation
control (control phrases: native-speaker verification not stated). That is
far too little to train or fine-tune an intent model, and the project's
existing classifier is English/Kannada/Hindi. So Tulu input is understood in
evidence-based layers and handed to the EXISTING engine as an English pivot
sentence -- the same intent detector, dialogue manager and workflows serve
Tulu. Nothing here contains workflow steps.

  1. Closed-set match. The input's phonetic key is compared with every
     verified customer utterance from BOTH datasets.
       - best score >= MATCH_THRESHOLD, and no utterance with a DIFFERENT
         meaning within AMBIGUITY_MARGIN of it  -> accepted;
       - a different-meaning utterance within the margin -> REJECTED as
         ambiguous (e.g. could be deposit or withdrawal).
     A START utterance ("I want to withdraw money") carries an intent.
     A CONTROL utterance ("Kuda panoli ya" = say that again) carries a
     canonical control (REPEAT_STEP ...) and NEVER a service intent; its
     pivot is the engine's own deterministic control word ("repeat").
     A PROGRESS utterance ("I have taken the slip") carries none: its pivot
     is workflow-neutral and the engine applies it to the active workflow.
  2. Verified verb cue (Tulu text only). With no utterance match, the
     service verbs seen only in the verified START utterances decide:
     padare/padodu (+ loanword "deposit") -> deposit;
     deppere (+ loanwords "withdraw"/"withdrawal") -> withdraw.
     Verbs of both services in one input -> REJECTED as ambiguous.
  3. Tulu text close to a verified phrase (>= LOW_CONFIDENCE_FLOOR) but not
     close enough -> REJECTED as low confidence: the customer is asked to
     say or type it again (never guessed, never sent to the LLM).
  4. Otherwise the text is passed to the engine unchanged and flagged
     'unverified_passthrough' (not accepted as Tulu). English loanwords in
     it ("loan") may still be recognised by the existing detector; any reply
     is then in English because no verified Tulu exists for it.

This is a mapping/matching system over verified data, not a neural Tulu NLU
model, and only the verified phrase set is supported with confidence.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from typing import Optional

from app.tulu.data.dataset import CONTROL, GROUPS, INTENTS, START, customer_utterances
from app.tulu.normalization.text import classify_text, matching_key, normalize_display, to_roman

#: Fixed before evaluation (not tuned on the test recordings).
MATCH_THRESHOLD = 0.80
AMBIGUITY_MARGIN = 0.05
#: Tulu input this close to a verified phrase, but below MATCH_THRESHOLD and
#: with no verb cue, is NOT sent to the engine: the customer is asked to say
#: or type it again (fixed before evaluation).
LOW_CONFIDENCE_FLOOR = 0.65

#: Service verbs from the verified START utterances (matching keys).
#: deposit:  D01a "padare", D01c "padodu", D01b loanword "deposit"
#: withdraw: W01a-c "deppere"
_SERVICE_CUE_WORDS = {
    "deposit": ("padare", "padodu", "deposit"),
    "withdraw": ("deppere", "withdraw", "withdrawal"),
}
#: The same words as matching keys (the folding turns "withdraw" into "vitdrav").
SERVICE_CUES = {intent: {matching_key(w) for w in words} for intent, words in _SERVICE_CUE_WORDS.items()}


def service_verbs(text: str) -> list[str]:
    """Which services' verified verbs occur in `text`."""
    tokens = set(matching_key(to_roman(text)).split())
    return [intent for intent, cues in SERVICE_CUES.items() if tokens & cues]

VERIFIED_MATCH = "verified_match"
KEYWORD_CUE = "verified_keyword_cue"
AMBIGUOUS = "rejected_ambiguous"
LOW_CONFIDENCE = "rejected_low_confidence"
PASSTHROUGH = "unverified_passthrough"


@dataclass
class TuluUnderstanding:
    input_text: str
    language: dict
    method: str
    pivot_en: Optional[str]
    accepted: bool = False
    role: Optional[str] = None
    intent: Optional[str] = None          # engine canonical, e.g. "withdraw money"
    intent_id: Optional[str] = None       # short canonical, e.g. "withdraw"
    control: Optional[str] = None         # canonical control, e.g. "REPEAT_STEP"
    group: Optional[str] = None
    source_dataset: Optional[str] = None
    matched_id: Optional[str] = None
    matched_text: Optional[str] = None
    score: float = 0.0
    candidates: list = field(default_factory=list)
    reason: Optional[str] = None

    def as_dict(self):
        return asdict(self)


def similarity(a_key: str, b_key: str) -> float:
    """Character-level similarity of two matching keys, 0..1."""
    if not a_key or not b_key:
        return 0.0
    return SequenceMatcher(None, a_key, b_key).ratio()


def rank(text: str, bank: Optional[list] = None) -> list[tuple[float, dict]]:
    """Verified utterances ordered by similarity to `text` (any script)."""
    key = matching_key(to_roman(text))
    bank = customer_utterances() if bank is None else bank
    scored = [(similarity(key, matching_key(u["tulu_romanized"])), u) for u in bank]
    return sorted(scored, key=lambda pair: pair[0], reverse=True)


def _meaning(utt: dict) -> str:
    """Two utterances mean the same thing when they produce the same pivot."""
    return GROUPS[utt["group"]]["pivot_en"]


def _from_group(group: str, **kwargs) -> dict:
    info = GROUPS[group]
    intent_id = info.get("intent")
    return dict(role=info["role"], pivot_en=info["pivot_en"], intent_id=intent_id,
                intent=INTENTS.get(intent_id) if intent_id else None, control=info.get("control"),
                group=group, **kwargs)


def understand(text: str, bank: Optional[list] = None,
               threshold: float = MATCH_THRESHOLD,
               margin: float = AMBIGUITY_MARGIN) -> TuluUnderstanding:
    display = normalize_display(text)
    language = classify_text(display)
    ranked = rank(display, bank)
    candidates = [{"id": u["id"], "group": u["group"], "score": round(s, 3)} for s, u in ranked[:3]]
    best_score = round(ranked[0][0], 3) if ranked else 0.0
    base = dict(input_text=display, language=language, score=best_score, candidates=candidates)

    verbs = service_verbs(display)

    if ranked and ranked[0][0] >= threshold:
        score, utt = ranked[0]
        rival = next(((s, u) for s, u in ranked[1:] if _meaning(u) != _meaning(utt)), None)
        if rival and rival[0] >= score - margin:
            return TuluUnderstanding(method=AMBIGUOUS, pivot_en=None, **base,
                                     reason=f"{utt['id']} ({score:.3f}) and {rival[1]['id']} "
                                            f"({rival[0]:.3f}) mean different things")
        matched_intent = GROUPS[utt["group"]].get("intent")
        if GROUPS[utt["group"]]["role"] == CONTROL and verbs:
            # A control phrase never carries a service: a service verb in the
            # input means it is not (only) a control statement.
            return TuluUnderstanding(method=AMBIGUOUS, pivot_en=None, **base,
                                     reason=f"matched control {utt['id']} but the input contains the verb of {verbs}")
        if matched_intent and any(v != matched_intent for v in verbs):
            # e.g. "Yank duddu deppere undu?" is close to deposit D01a in
            # spelling but uses the WITHDRAWAL verb: never accept that.
            return TuluUnderstanding(method=AMBIGUOUS, pivot_en=None, **base,
                                     reason=f"matched {utt['id']} ({matched_intent}) but the input "
                                            f"contains the verb of {verbs}")
        return TuluUnderstanding(method=VERIFIED_MATCH, accepted=True,
                                 source_dataset=utt["dataset"], matched_id=utt["id"],
                                 matched_text=utt["tulu_romanized"],
                                 **_from_group(utt["group"]), **base)

    if language["label"].startswith("tcy"):
        hits = verbs
        if len(hits) > 1:
            return TuluUnderstanding(method=AMBIGUOUS, pivot_en=None, **base,
                                     reason=f"verbs of more than one service: {hits}")
        if hits:
            start_group = next(g for g, info in GROUPS.items()
                               if info["role"] == START and info.get("intent") == hits[0])
            return TuluUnderstanding(method=KEYWORD_CUE, accepted=True, **_from_group(start_group), **base)

    if language["label"].startswith("tcy") and best_score >= LOW_CONFIDENCE_FLOOR:
        return TuluUnderstanding(method=LOW_CONFIDENCE, pivot_en=None, **base,
                                 reason=f"closest verified phrase {candidates[0]['id']} scored {best_score} "
                                        f"(< {threshold})")

    return TuluUnderstanding(method=PASSTHROUGH, pivot_en=display, **base,
                             reason="no verified Tulu phrase or cue matched")
