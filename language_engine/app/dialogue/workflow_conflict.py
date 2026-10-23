"""Active-workflow interruption (Phase 3.2B-14).

THE LIVE FAILURE THIS ADDRESSES

    "ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು"   -> deposit workflow ACTIVE
    assistant                -> "Please take a deposit slip."
    "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು"     -> a withdrawal request, transcribed correctly
    assistant                -> "Please take a deposit slip."

The ASR was right and intent detection would have been right too, but it was
never consulted: once a workflow is ACTIVE the routing layer sends every turn
to workflow-action understanding, which can only answer questions ABOUT the
deposit. The withdrawal request came back type=workflow_action, action=none,
step_completed=false, fell to the default branch, and the deposit step was
repeated as though the customer had said nothing.

WHAT A CONFLICT IS, AND WHAT IT IS NOT

A conflict is: a workflow is in progress AND the customer clearly asked for a
DIFFERENT banking service. It is NOT a different SUBJECT -- "what is an
education loan?" during a withdrawal is a side question, the existing question
path owns it, and the withdrawal is preserved untouched.

THE ONE SAFETY RULE

A conflict NEVER switches anything by itself. Both workflows are left exactly
as they were and the customer is asked which they want. Silently switching
would abandon a banking request in progress; silently continuing would discard
the request the customer just made. The only safe third option is to ask, so
asking is the only thing detection does.

This module is PURE DATA AND STRING WORK. It holds no state, imports nothing
from the dialogue manager, and cannot start, cancel, suspend or advance
anything -- DialogueManager performs every transition, through the
ConversationManager methods that already own them.
"""
from typing import NamedTuple, Optional


class WorkflowConflict(NamedTuple):
    """A banking request in progress, and the different one just asked for.

    Both fields are CANONICAL workflow identities -- the same strings as
    INTENTS and as conversation.current_intent -- so WorkflowLoader can resolve
    either one without a second spelling ever entering the system.

    `requested_workflow` is None for a CANCEL CONFIRMATION: the customer asked
    to cancel the request in progress, and nothing else, and is being asked to
    confirm before anything is lost. It is the same pending question, held in
    the same slot and answered through the same routing -- there is no second
    pending-question mechanism. See cancel_confirmation_question().

    A NamedTuple so it is immutable: a stored conflict cannot be edited into a
    different question than the one the customer was actually asked.
    """

    current_workflow: str
    requested_workflow: Optional[str]


def is_cancel_confirmation(conflict):
    """Whether a pending question is a cancel confirmation."""

    return conflict is not None and conflict.requested_workflow is None


def cancel_confirmation(current_workflow):
    """The pending question asked before cancelling `current_workflow`."""

    return WorkflowConflict(current_workflow, None)


# =========================================================
# SPOKEN NAMES
#
# The canonical identities read badly in a sentence ("You currently have a
# deposit money in progress"). These are the names the assistant SAYS.
# Authored data, exactly like localization.FIXED_RESPONSES, and keyed on the
# canonical identity so the workflow JSON stays the single source of truth for
# everything else.
#
# An unknown identity falls back to itself rather than to a guess: a clumsy
# sentence is recoverable, a wrong workflow name is not.
# =========================================================

WORKFLOW_DISPLAY_NAMES = {
    "deposit money": "deposit",
    "withdraw money": "withdrawal",
    "apply for loan": "loan application",
    "check account balance": "balance check",
    "open new account": "account opening",
}


def display_name(workflow_name):
    """The name the assistant says out loud for a canonical workflow."""

    normalized = " ".join(str(workflow_name or "").lower().split())

    if not normalized:
        return "request"

    return WORKFLOW_DISPLAY_NAMES.get(normalized, normalized)


def same_workflow(left, right):
    """Whether two canonical workflow identities name the same request."""

    return (
        " ".join(str(left or "").lower().split())
        == " ".join(str(right or "").lower().split())
    )


# =========================================================
# THE CLARIFICATION QUESTION
#
# Three options, named in order of how much they cost the customer: cancel
# (loses the request), pause (keeps it), continue (changes nothing).
#
# The wording is what the ANSWER RESOLVER below is built against: every option
# is named by a word that resolver recognises, so the customer can answer with
# any word the assistant just used.
# =========================================================

def conflict_question(conflict, paused=False):
    """The clarification the assistant asks when a conflict is detected."""

    current = display_name(conflict.current_workflow)
    requested = display_name(conflict.requested_workflow)

    if paused:

        # Offering to "pause" something already paused would be nonsense, so
        # the middle option says what would actually happen to it.
        return (
            f"Your {current} is currently paused. "
            f"Would you like to cancel the {current} and start a {requested}, "
            f"keep the {current} paused and start a {requested}, "
            f"or continue with the {current}?"
        )

    return (
        f"You currently have a {current} in progress. "
        f"Would you like to cancel the {current} and start a {requested}, "
        f"pause the {current} and start a {requested}, "
        f"or continue with the {current}?"
    )


# =========================================================
# CANCEL CONFIRMATION
#
# Cancelling is the one control that cannot be undone: a cancelled request
# cannot be resumed. With hands-free listening, one incidental "stop" -- said
# to someone else at the counter -- is a complete turn. So a cancel is asked
# about first, and only a second, explicit cancel carries it out.
#
# Two answers are named, by words the resolver below and the control tier both
# recognise: "cancel" confirms, "continue" keeps the request exactly as it is.
# =========================================================

def cancel_confirmation_question(conflict, paused=False):
    """The question asked before a request in progress is cancelled."""

    current = display_name(conflict.current_workflow)
    question = (
        f"Do you want to cancel the {current}? "
        "Say cancel to confirm, or continue to keep it."
    )

    if paused:
        return f"Your {current} is currently paused. {question}"

    return question


# =========================================================
# THE THREE ANSWERS
# =========================================================

CHOICE_CANCEL = "cancel"
CHOICE_PAUSE = "pause"
CHOICE_CONTINUE = "continue"

#: A deterministic control command, said while a conflict is pending, is an
#: answer to it. "resume" selects the third option, which is exactly what that
#: word means in the question the customer was just asked.
#:
#: `repeat` and `next` are deliberately ABSENT. Neither names an option --
#: "say that again" and "what now?" are both requests to hear the question
#: again, and that is what the caller does with an unmapped command.
CONFLICT_CONTROL_CHOICES = {
    "cancel": CHOICE_CANCEL,
    "pause": CHOICE_PAUSE,
    "resume": CHOICE_CONTINUE,
}


# =========================================================
# FREE-TEXT ANSWERS
#
# "Cancel it and withdraw", "pause the deposit and start withdrawal",
# "continue with the deposit" -- longer than a control phrase, so
# classify_command() correctly declines them and they arrive as ordinary text.
#
# WHY KEYWORD MATCHING IS SAFE *HERE*
#
# Everywhere else in this engine a keyword scan would be too loose, and the
# phrase tables are exact for that reason. This scan runs ONLY while a conflict
# is pending -- that is, only on the turn immediately after the assistant asked
# a CLOSED question and named all three options. The scan is not deciding
# whether this is an answer; it is reading which of three named options the
# answer picked. That is the same argument resolve_control_command() makes for
# scanning a turn the LLM has already judged to be control.
#
# Matching is WHOLE-TOKEN for English, so "account holder" cannot read as
# "hold". Indic forms are matched by STEM, because Kannada and Hindi inflect
# the verb ("ನಿಲ್ಲಿಸು" / "ನಿಲ್ಲಿಸಿ") -- the same rule, and the same safety
# argument, as multilingual_phrases.KANNADA_CONTROL_STEMS.
#
# Negation is NOT handled here. The caller applies the engine's existing
# contains_negation() guard before asking, so "don't cancel it" never reaches
# this function -- see DialogueManager._conflict_choice_from_text().
# =========================================================

CHOICE_WORDS = {
    CHOICE_CANCEL: frozenset({
        "cancel", "cancels", "cancelled", "canceled",
        "cancelling", "canceling", "scrap", "abandon",
        "stop", "forget", "drop",
        # Romanised G4 -- AWAITING NATIVE-SPEAKER REVIEW. Romanised रद्द /
        # ರದ್ದು, matched as WHOLE tokens only (this set is never a prefix
        # scan), so "raddi" (scrap paper) can never select cancel.
        "radd", "raddu",
    }),
    CHOICE_PAUSE: frozenset({
        "pause", "pauses", "paused", "pausing",
        "hold", "suspend", "postpone", "park", "later",
    }),
    CHOICE_CONTINUE: frozenset({
        "continue", "continues", "continuing", "carry",
        "keep", "stay", "resume", "proceed", "finish",
    }),
}

#: Indic stems, matched against whole tokens by prefix. Each stem must be
#: unambiguous: no stem here may begin a word that means something else.
INDIC_CHOICE_STEMS = (
    # Kannada
    ("ರದ್ದು", CHOICE_CANCEL),
    ("ನಿಲ್ಲಿಸ", CHOICE_CANCEL),
    ("ಸಾಕು", CHOICE_CANCEL),
    ("ವಿರಾಮ", CHOICE_PAUSE),
    ("ತಡೆಯ", CHOICE_PAUSE),
    ("ಮುಂದುವ", CHOICE_CONTINUE),
    # Hindi
    ("रद्द", CHOICE_CANCEL),
    ("कैंसिल", CHOICE_CANCEL),
    ("रुक", CHOICE_PAUSE),
    ("विराम", CHOICE_PAUSE),
    ("ठहर", CHOICE_PAUSE),
    ("जारी", CHOICE_CONTINUE),
)

_PUNCTUATION = ",.!?;:\"'()-"


def _tokens(text):
    """Lowercased whitespace tokens with surrounding punctuation removed."""

    cleaned = str(text or "").lower()

    for character in _PUNCTUATION:
        cleaned = cleaned.replace(character, " ")

    return [token for token in cleaned.split() if token]


def resolve_conflict_answer(text):
    """Which option a free-text answer selects.

    Returns CHOICE_CANCEL, CHOICE_PAUSE, CHOICE_CONTINUE, or None.

    None means "this did not select an option", and the caller must ASK AGAIN
    rather than guess -- no workflow moves on a None. That covers an answer
    naming nothing ("what is a withdrawal slip?") and an answer naming two
    contradictory options ("cancel it, no, pause it").

    CANCEL and PAUSE outrank CONTINUE when both appear, because "continue" is
    also an ordinary connective in an answer that picks another option --
    "cancel the deposit and continue with the withdrawal" selects cancel. Only
    an answer where CONTINUE is the ONLY option named keeps the current
    request. CANCEL together with PAUSE names two genuinely different outcomes
    for the same request, so that pair resolves to None and is asked again.
    """

    tokens = _tokens(text)

    if not tokens:
        return None

    found = set()

    for choice, words in CHOICE_WORDS.items():

        if any(token in words for token in tokens):
            found.add(choice)

    for stem, choice in INDIC_CHOICE_STEMS:

        if any(token.startswith(stem) for token in tokens):
            found.add(choice)

    if not found:
        return None

    if CHOICE_CANCEL in found and CHOICE_PAUSE in found:
        return None

    if CHOICE_CANCEL in found:
        return CHOICE_CANCEL

    if CHOICE_PAUSE in found:
        return CHOICE_PAUSE

    return CHOICE_CONTINUE
