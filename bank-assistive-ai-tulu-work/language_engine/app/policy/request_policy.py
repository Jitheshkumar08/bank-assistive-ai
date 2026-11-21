"""Deterministic request policy: what must not reach answering at all.

Kept apart from retrieval, answering and workflows on purpose. It reads the
customer's words, decides one of a few categories, and returns -- it never
retrieves, never calls a model and never touches conversation state.

  harmful                 asks how to commit a crime against a bank or a
                          person: hacking, stealing, forging, laundering.
                          Answered with a brief refusal and what the
                          assistant can do instead.
  prompt_injection        tries to change the assistant's instructions or
                          extract them. Answered with the same redirect;
                          the words never reach the LLM.
  requires_authorization  asks the assistant itself to carry out a
                          transaction or read private records. The assistant
                          has no such integration, so it says so.

WHAT IT DOES NOT DO

It catches only clear, explicitly phrased cases, in English. Everything
else is left to the layers that already exist: the intent detector's
UNSUPPORTED anchor (multilingual, "I want to rob the bank"), and the answer
prompt's rules. A pattern here costs a false refusal when it is wrong, so
each one needs an explicit intent ("how do I hack", "help me steal") and
past-tense reports of a crime ("someone hacked my account, what do I do?")
deliberately do not match.

Generic patterns are in this file; a domain adds its own in domain.json
(policy.harmful_patterns, policy.authorization_actions,
policy.private_records).
"""

import re
from dataclasses import dataclass

HARMFUL = "harmful"
PROMPT_INJECTION = "prompt_injection"
REQUIRES_AUTHORIZATION = "requires_authorization"

# "how do I ...", "help me ...", "I want to ..." -- up to three words, then the verb.
_INTENT = (
    r"(?:how\s+(?:do|can|could|would|should|might)\s+(?:i|we|you|one|someone|somebody)|how\s+to|"
    r"help\s+me|teach\s+me|show\s+me\s+how\s+to|tell\s+me\s+how\s+to|i\s+want\s+to|i\s+wanna|"
    r"i\s+need\s+to|i(?:'m|\s+am)\s+going\s+to|let\s+me|ways?\s+to|best\s+way\s+to|easiest\s+way\s+to|"
    r"is\s+it\s+possible\s+to|can\s+you|could\s+you)"
    r"\s+(?:\w+\s+){0,3}?"
)
_HARMFUL_VERBS = r"(?:hack|steal|rob|forge|counterfeit|launder|scam|defraud|cheat|phish|break\s+into|crack)\b"

GENERIC_HARMFUL = (
    _INTENT + _HARMFUL_VERBS,
    r"\b(?:make|print|create|produce)\s+(?:fake|counterfeit|forged)\s+(?:money|notes?|currency|cash|documents?|ids?)\b",
    r"\b(?:access|use|get\s+into|log\s*in(?:to)?|empty|withdraw\s+from|take\s+money\s+from)\s+(?:\w+\s+){0,2}?"
    r"(?:someone(?:\s+else)?'?s|somebody(?:\s+else)?'?s|another\s+person'?s|other\s+people'?s)\s+"
    r"(?:account|card|pin|password|otp|money)",
    r"\b(?:get|find|guess|crack)\s+(?:\w+\s+){0,2}?(?:pin|password|otp)\s+(?:of|for)\s+(?:someone|somebody|another|other)",
)

GENERIC_INJECTION = (
    r"\b(?:ignore|disregard|forget|override|bypass)\b(?:\s+\w+){0,4}?\s+"
    r"(?:instructions?|rules?|prompts?|guidelines?|polic(?:y|ies)|restrictions?|programming)\b",
    r"\b(?:system|developer|hidden|initial|original)\s+(?:prompt|message|instructions?)\b",
    r"\b(?:reveal|show|print|repeat|output|leak)\b(?:\s+\w+){0,3}?\s+(?:your|the)\s+(?:prompt|instructions|system\s+message)\b",
    r"\bwhat\s+(?:are|is)\s+your\s+(?:instructions|prompt|system\s+message|rules)\b",
    r"\byou\s+are\s+(?:now|no\s+longer)\b",
    r"\b(?:jailbreak|developer\s+mode|dan\s+mode|god\s+mode)\b",
    r"\bpretend\s+(?:to\s+be|you\s+are|that\s+you)\b",
    r"\bact\s+as\s+(?:an?\s+)?(?:unrestricted|unfiltered|different|new)\b",
)


@dataclass(frozen=True)
class PolicyDecision:
    category: str
    #: Key of the domain reply to give (domain.json "replies").
    reply_key: str
    pattern: str


def _compile(patterns):
    return tuple(re.compile(p, re.IGNORECASE) for p in patterns)


class RequestPolicy:

    def __init__(self, domain_policy=None):
        domain_policy = domain_policy or {}
        self._harmful = _compile(GENERIC_HARMFUL + tuple(domain_policy.get("harmful_patterns", ())))
        self._injection = _compile(GENERIC_INJECTION + tuple(domain_policy.get("injection_patterns", ())))

        actions = domain_policy.get("authorization_actions", ())
        records = domain_policy.get("private_records", ())
        authorization = []
        if actions:
            verbs = "|".join(re.escape(a) for a in actions)
            # The object must be money or an account: "can you send me the
            # form" and "can you move to the next step" are not transactions.
            authorization.append(
                rf"\b(?:can|could|will|would)\s+you\s+(?:please\s+)?(?:{verbs})\s+(?:\S+\s+){{0,4}}?"
                rf"(?:money|rupees?|rs\.?|₹|amount|funds|payment|account|card|cheque|loan|\d)"
            )
        if records:
            nouns = "|".join(re.escape(r) for r in records)
            authorization.append(
                rf"\b(?:show|tell|give|read|send)\s+(?:me\s+)?my\s+(?:last\s+\w+\s+|recent\s+)?(?:{nouns})\b"
                rf"|\bwhat\s+(?:is|are)\s+my\s+(?:{nouns})\b"
            )
        self._authorization = _compile(authorization)

    @staticmethod
    def _first(patterns, text):
        for pattern in patterns:
            if pattern.search(text):
                return pattern.pattern
        return None

    def assess(self, text):
        """A PolicyDecision, or None when the request may be answered normally."""
        if not text or not text.strip():
            return None
        text = " ".join(text.split())

        pattern = self._first(self._injection, text)
        if pattern:
            return PolicyDecision(PROMPT_INJECTION, "redirect", pattern)

        pattern = self._first(self._harmful, text)
        if pattern:
            return PolicyDecision(HARMFUL, "refusal", pattern)

        pattern = self._first(self._authorization, text)
        if pattern:
            return PolicyDecision(REQUIRES_AUTHORIZATION, "no_access", pattern)

        return None


# ---------------------------------------------------------------------------
# Output side: an answer must never claim an action the assistant cannot take.
# ---------------------------------------------------------------------------

_ACTION_CLAIMS = _compile((
    r"\b(?:i|we)(?:'ve|\s+have)?\s+(?:now\s+|successfully\s+|already\s+)?"
    r"(?:transferred|sent|moved|deposited|withdrawn|withdrew|debited|credited|blocked|unblocked|"
    r"closed|approved|sanctioned|processed|paid)\b",
    r"\b(?:i|we)(?:'ve|\s+have)?\s+(?:checked|looked\s+up|accessed|verified|pulled\s+up|opened)\s+"
    r"(?:your|the\s+customer'?s)\s+(?:account|balance|records?|transactions?|details|statement)\b",
    r"\byour\s+(?:current\s+|available\s+|account\s+)?balance\s+is\s+(?:rs\.?|₹|inr|\d)",
))


def claims_unauthorized_action(answer):
    """Whether an (English) answer claims to have done something only a real integration could."""
    return any(pattern.search(answer or "") for pattern in _ACTION_CLAIMS)
