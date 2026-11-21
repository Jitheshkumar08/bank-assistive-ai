"""Checks on an LLM answer before it reaches the customer.

The answer prompt forbids inventing bank-specific figures and claiming
actions the assistant cannot take. Prompts are instructions, not
guarantees, so two of those rules are also checked deterministically on
the output:

  UNGROUNDED FIGURE   a money amount or percentage (₹500, Rs 1,000, 7.5%,
                      2000 rupees), a time of day (10 am, 4:30 pm) or a
                      duration (2 hours, 7 working days) whose number
                      appears nowhere in the evidence, the question or the
                      workflow context. That is an invented fee, rate,
                      limit, timing or processing time. The answer is
                      replaced with the domain's "missing_figure" reply.
                      (Times and durations: Phase 3A. The knowledge articles
                      say all of these depend on the bank, and contain no
                      figures at all.)
  ACTION CLAIM        "I have transferred...", "your balance is ₹..." --
                      the assistant has no account integration. Replaced
                      with the domain's "no_access" reply.

Replacement, not repair: a sentence-level edit could leave a half-claim in
place. Both checks are narrow on purpose -- a plain number ("step 2", "6
digits") is not a figure, and an answer in Kannada or Hindi is checked for
figures (digits are language-neutral) but not for English action phrases.
"""

import re
import unicodedata
from dataclasses import dataclass

from app.policy.request_policy import claims_unauthorized_action

_NUMBER = r"\d[\d,]*(?:\.\d+)?"
_FIGURES = re.compile(
    rf"(?:₹|rs\.?|inr|rupees?)\s*({_NUMBER})"
    rf"|({_NUMBER})\s*(?:%|percent|per\s+cent|rupees?|rs\b|inr\b|/-|lakh|lakhs|crore|crores)",
    re.IGNORECASE,
)
#: Phase 3A. A clock time or a duration. "12 months" is a duration too: a
#: tenure or a period the articles never state.
_TIMES = re.compile(
    rf"\b(\d{{1,2}})(?:[:.]\d{{2}})?\s*(?:a\.?m\b\.?|p\.?m\b\.?|o'?clock\b)"
    rf"|\b({_NUMBER})\s*(?:(?:-|to)\s*\d+\s*)?(?:working\s+|business\s+|banking\s+)?"
    rf"(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b",
    re.IGNORECASE,
)

UNGROUNDED_FIGURE = "ungrounded_figure"
ACTION_CLAIM = "action_claim"


@dataclass(frozen=True)
class Validation:
    ok: bool
    answer: str
    issue: str = None
    detail: str = None


def _ascii_digits(text):
    """Kannada/Devanagari digits -> ASCII, so ೫೦೦ and 500 compare equal."""
    return "".join(str(unicodedata.digit(ch)) if ch.isdigit() and not ch.isascii() else ch
                   for ch in text or "")


def _numbers(text):
    return {n.replace(",", "") for n in re.findall(_NUMBER, _ascii_digits(text))}


def figures(answer):
    """The numbers in `answer` written as money, percentages, times or durations."""
    found = []
    text = _ascii_digits(answer)
    for pattern in (_FIGURES, _TIMES):
        for match in pattern.finditer(text):
            number = (match.group(1) or match.group(2) or "").replace(",", "")
            if number:
                found.append(number)
    return found


def validate_answer(answer, *, evidence="", question="", context="", replies=None):
    replies = replies or {}

    if claims_unauthorized_action(answer):
        return Validation(False, replies.get("no_access", answer), ACTION_CLAIM)

    allowed = _numbers(evidence) | _numbers(question) | _numbers(context)
    invented = [n for n in figures(answer) if n not in allowed]
    if invented:
        return Validation(False, replies.get("missing_figure", answer), UNGROUNDED_FIGURE,
                          ", ".join(invented))

    return Validation(True, answer)
