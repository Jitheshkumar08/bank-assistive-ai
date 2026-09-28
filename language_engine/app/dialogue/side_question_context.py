"""
Bounded recent side-question context (Phase 3.2B-3).

THE GAP THIS CLOSES

A customer mid-workflow asks a side question and then follows it
up with a pronoun:

    "Spell 20000 rupees."      -> "Twenty thousand rupees."
    "Spell it letter by letter."

The follow-up reached the question-answering layer as the bare
string "Spell it letter by letter." Nothing downstream knew what
"it" was, and the RAG query was that same useless string, so
retrieval returned unrelated banking documents.

WHAT THIS IS NOT

This is NOT conversational memory. There is no history list, no
vector store, no database, no user profile, no semantic memory
and no general coreference model. Exactly ONE exchange is
retained -- a single slot that the next relevant side question
overwrites. Nothing accumulates.

The bound is structural, not a policy: RecentSideQuestion is one
immutable value held in one attribute. There is no container that
could grow.

WHERE IT LIVES

Nothing in this module holds state. There is deliberately NO
module-level mutable context here: a module global would be
shared by every conversation in the process and would leak one
customer's session into another's. The single slot lives on
ConversationManager -- the object that IS the session -- because
DialogueManager takes `conversation` as a parameter in every
method and is otherwise conversation-agnostic.

This module is pure functions plus one NamedTuple, and imports
nothing from the dialogue manager, so it can be used from either
side without a circular import.
"""

import inspect
import re
from typing import NamedTuple


# =========================================================
# COLLABORATOR CAPABILITY CHECK
#
# `recent_context` is an optional parameter on
# DialogueUnderstanding.answer_question(). That object is
# INJECTED, so an implementation written before this phase has the
# three-argument signature and would raise TypeError if handed the
# new keyword. Callers use this to find out before calling.
# =========================================================

def accepts_recent_context(answer_question):
    """
    True when `answer_question` accepts a `recent_context`
    keyword argument (explicitly, or via **kwargs).

    Returns False when the signature cannot be read, which is the
    safe direction: the caller then makes the original
    three-argument call.
    """

    try:
        signature = inspect.signature(answer_question)
    except (TypeError, ValueError):
        return False

    for parameter in signature.parameters.values():

        if parameter.kind is inspect.Parameter.VAR_KEYWORD:
            return True

        if parameter.name == "recent_context":
            return True

    return False


# =========================================================
# THE CONTEXT VALUE
# =========================================================

class RecentSideQuestion(NamedTuple):
    """
    One remembered side-question exchange.

    Three fields, which is the minimum that makes a follow-up
    answerable:

        question -- what the customer asked, verbatim
        answer   -- what the assistant replied, verbatim
        subject  -- the referent extracted from `question`
                    ("20000 rupees", "a cheque book"), or None
                    when the question named no subject of its own

    Immutable on purpose: a remembered exchange is a record of
    what was said and must never be edited in place.
    """

    question: str
    answer: str
    subject: str = None


# =========================================================
# CONTEXTUAL REFERENCE DETECTION
#
# Deliberately a small, closed vocabulary. This decides only
# whether the recent exchange is worth PASSING to the question
# answerer -- it never rewrites the customer's words and never
# decides what the answer is.
#
# Over-detection is therefore cheap: the context is additive, and
# the answering prompt is told that the customer's own explicit
# words and the CURRENT STEP both outrank it.
# =========================================================

REFERENCE_WORDS = frozenset({
    "it", "this", "that", "these", "those", "them",
})

REFERENCE_PHRASES = (
    "the amount", "this amount", "that amount",
    "the number", "this number", "that number",
    "the word", "this word", "that word",
    "the spelling", "this spelling", "that spelling",
    "the same", "same thing",
)

_WORD_PATTERN = re.compile(r"[a-z']+")


def _normalize(text):
    """Lowercase, comma-free, single-spaced."""

    if not text:
        return ""

    return " ".join(str(text).lower().replace(",", " ").split())


def refers_to_recent_context(text):
    """
    True when `text` contains a simple reference that a preceding
    side question could resolve ("it", "this", "the amount").

    Decides nothing on its own.
    """

    normalized = _normalize(text)

    if not normalized:
        return False

    words = set(_WORD_PATTERN.findall(normalized))

    if words & REFERENCE_WORDS:
        return True

    padded = f" {normalized} "

    return any(
        f" {phrase} " in padded
        for phrase in REFERENCE_PHRASES
    )


# =========================================================
# SUBJECT EXTRACTION
#
# "Spell 20000 rupees."        -> "20000 rupees"
# "What is an account number?"  -> "an account number"
# "Spell it letter by letter."  -> None  (only a reference)
#
# Wrapper stripping only. There is no parser here, and a question
# whose subject cannot be read off this way yields None -- which
# means "carry the previous subject forward", never "guess".
# =========================================================

SUBJECT_LEAD_INS = tuple(sorted(
    (
        "what do you mean by", "what does it mean by",
        "how do you pronounce", "how do i pronounce",
        "how do you write", "how do i write",
        "how do you say", "how do i say",
        "can you spell out", "could you spell out",
        "can you spell", "could you spell", "please spell",
        "can you explain", "could you explain",
        "tell me about", "what is the meaning of",
        "meaning of", "what does", "what is", "what's", "whats",
        "spell out", "spell", "explain", "define", "describe",
        "read out", "say",
    ),
    key=len,
    reverse=True,
))

SUBJECT_TAILS = tuple(sorted(
    (
        "letter by letter", "one letter at a time",
        "in words", "in english", "in kannada", "in hindi",
        "for me", "please", "again", "exactly", "properly",
        "mean", "means", "meaning",
    ),
    key=len,
    reverse=True,
))

STRIP_PASSES = 3


def extract_subject(question):
    """
    Reads the subject off a side question, or returns None.
    """

    result = _normalize(question).strip(" .!?;:")

    if not result:
        return None

    for _ in range(STRIP_PASSES):

        before = result

        for lead_in in SUBJECT_LEAD_INS:

            if result.startswith(lead_in + " "):
                result = result[len(lead_in):].strip()
                break

        for tail in SUBJECT_TAILS:

            if result.endswith(" " + tail):
                result = result[: -len(tail)].strip()
                break

        result = result.strip(" ,.!?;:")

        if result == before:
            break

    if not result:
        return None

    # A remainder made only of reference words is not a subject --
    # "this" in "What does this mean?" is the thing we are trying
    # to resolve, not the answer to it.
    words = _WORD_PATTERN.findall(result)

    if words and all(word in REFERENCE_WORDS for word in words):
        return None

    # Nor is a bare reference PHRASE. "explain the amount" points
    # at whatever amount was already being discussed; storing
    # "the amount" as the subject would freeze a vague referent
    # in place instead of carrying the real one forward.
    if result in REFERENCE_PHRASES:
        return None

    # Digits survive the check above (findall only matches
    # letters), so "20000" is a valid subject.
    if not result.strip():
        return None

    return result


# =========================================================
# CARRYING THE SLOT FORWARD
# =========================================================

def next_context(previous, question, answer):
    """
    Builds the exchange to store, given the one currently stored.

    The slot holds AT MOST ONE exchange, so this returns a
    replacement, never an accumulation.

    The subject is carried forward when the new question has none
    of its own AND is itself a reference. That is what keeps a
    chain answerable --

        "Spell 20000 rupees."       subject = "20000 rupees"
        "Spell it letter by letter."  subject carried forward
        "Spell it again."             subject carried forward

    -- while still storing only the latest exchange. A new
    question that names its own subject replaces the subject
    outright, so the context follows the customer's topic.
    """

    subject = extract_subject(question)

    if subject is None and is_remembered_exchange(previous):

        if refers_to_recent_context(question):
            subject = previous.subject

    return RecentSideQuestion(
        question=str(question),
        answer=str(answer),
        subject=subject,
    )


# =========================================================
# HANDING THE CONTEXT TO THE ANSWERING LAYER
# =========================================================

# A remembered answer is only ever quoted back to resolve a
# reference, so there is no reason to carry a long one.
MAX_REMEMBERED_ANSWER_CHARS = 400


def is_remembered_exchange(recent):
    """
    True when `recent` is a usable remembered exchange.

    The slot is documented as RecentSideQuestion-or-None, and a caller that
    passed "" instead of None crashed the whole question path with
    `AttributeError: 'str' object has no attribute 'subject'` (Phase 3.2B-13).
    That caller is fixed; this predicate makes the shape a precondition these
    functions CHECK rather than assume, so a future mismatch degrades to "no
    remembered context" instead of taking down an answer.

    It is a type check, not an exception handler: anything that is not shaped
    like the record simply is not one.
    """

    return (recent is not None
            and hasattr(recent, "question")
            and hasattr(recent, "answer")
            and hasattr(recent, "subject"))


def format_recent_context(recent):
    """
    Renders the single remembered exchange for the answering
    prompt, or "" when there is nothing to render.
    """

    if not is_remembered_exchange(recent):
        return ""

    question = str(recent.question).strip()
    answer = str(recent.answer).strip()

    if not question and not answer:
        return ""

    if len(answer) > MAX_REMEMBERED_ANSWER_CHARS:
        answer = answer[:MAX_REMEMBERED_ANSWER_CHARS].rstrip() + "..."

    lines = [
        f"Customer asked: {question}",
        f"You answered: {answer}",
    ]

    if recent.subject:
        lines.append(f"That question was about: {recent.subject}")

    return "\n".join(lines)


def retrieval_query(question, recent):
    """
    The string to search the knowledge base with.

    RAG is NOT bypassed or replaced -- it is given the referent it
    would otherwise be missing. "Spell it letter by letter"
    retrieves nothing useful on its own; searched together with
    "20000 rupees" it at least retrieves against the real subject.

    Returns `question` unchanged whenever there is no reference to
    resolve or no subject to resolve it to, so existing retrieval
    behaviour is untouched in every other case.
    """

    if not question:
        return question

    if not is_remembered_exchange(recent) or not recent.subject:
        return question

    if not refers_to_recent_context(question):
        return question

    subject = str(recent.subject).strip()

    if not subject or subject.lower() in _normalize(question):
        return question

    return f"{question} {subject}"
