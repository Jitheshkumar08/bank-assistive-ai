import re
from typing import NamedTuple

from app.dialogue import multilingual_phrases
from app.dialogue.indic_numbers import extract_amount
from app.workflow.loader import WorkflowLoader
from app.dialogue.llm.dialogue_understanding import (
    DialogueUnderstanding,
    QUESTION_UNAVAILABLE_MESSAGE,
    coerce_step_number,
)
from app.dialogue.side_question_context import (
    accepts_recent_context,
    next_context,
)
from app.dialogue.completion_semantics import (
    resolve_step_completion,
)
from app.dialogue.workflow_conflict import (
    CHOICE_CANCEL,
    CHOICE_CONTINUE,
    CHOICE_PAUSE,
    CONFLICT_CONTROL_CHOICES,
    WorkflowConflict,
    conflict_question,
    display_name,
    resolve_conflict_answer,
    same_workflow,
)
from app.conversation.state import WorkflowState


# =========================================================
# TIER-1 DETERMINISTIC CONTROL COMMANDS (SESSION EXIT +
# WORKFLOW CONTROL)
#
# These are short, near-exact control phrases that are handled
# WITHOUT calling the LLM and WITHOUT ever reaching intent
# detection. Session-exit and workflow-control phrases are
# classified together, through ONE normalization path, so the
# two checks can never drift apart again -- that drift (a
# separate, weaker exit-word check living in the pipeline) is
# exactly what let real Whisper output like "Exit." (with a
# trailing period) slip past the old exit check and reach
# IntentDetector.
#
# Only short utterances are matched here. Anything longer or
# more specific (e.g. "repeat step 3", "cancel my loan
# application") intentionally falls through to the existing LLM
# understanding path, unchanged, so richer natural-language
# handling keeps working exactly as before.
#
# NOTE: these phrases are English-only. Kannada/Hindi control
# phrasing is not matched here and falls through to the LLM
# path, same as today -- this is a known limitation, not a
# regression.
# =========================================================

# Phrases that unambiguously mean "end the assistant session".
# Deliberately narrow and exact-match only -- "don't exit" or
# "I don't want to exit" must NOT match this.
SESSION_EXIT_PHRASES = {
    "exit", "quit", "goodbye", "bye",
    "end session", "close assistant", "exit assistant"
}

WORKFLOW_CONTROL_PHRASES = {
    "pause": {
        "pause", "hold on", "hold up", "wait",
        "hang on", "give me a moment", "give me a minute"
    },
    "resume": {
        "resume", "continue", "carry on",
        "let's continue", "lets continue"
    },
    "cancel": {
        "cancel", "stop", "never mind", "nevermind", "forget it"
    },
    "repeat": {
        "repeat", "again", "say that again",
        "come again", "pardon", "say again"
    },
    "next": {
        "next", "what next", "what's next", "whats next"
    },
}

# =========================================================
# STANDALONE CONVERSATIONAL ACKNOWLEDGEMENTS
#
# The closings and receipts a customer says when they are NOT
# asking for a banking service: "thank you" at the end of a
# visit, "okay" after an explanation.
#
# These belong in this tier for the same reason "bye" does.
# IntentDetector is a total function -- argmax over five banking
# labels with no abstention -- so ANY utterance that reaches it
# becomes a banking request. A live session started a loan
# workflow from "Thank you." at confidence 0.212 for exactly
# this reason. The fix is to stop the utterance before intent
# detection, not to threshold the score: measured cosine scores
# put "Good bye friend" at 0.321 and the legitimate request
# "I want to take a load" at 0.325, so no global cut-off
# separates them.
#
# Matching is exact-phrase against the whole normalized
# utterance, through the same normalize_command_text() path as
# everything else in this tier, and is deliberately NOT substring
# matching: "thank you but I want to withdraw money" and
# "thanks, what is a cheque book?" are real banking turns and
# fall through to the normal question / intent routing untouched.
#
# The split into two classes exists ONLY to choose the opening
# phrase of the reply ("You're welcome." vs "Okay."). Both are
# handled by one state-aware handler and behave identically with
# respect to workflow state.
#
# Deliberately EXCLUDED: "yes" and "done". Either can be evidence
# that the current instruction was carried out, and that
# judgement belongs to dialogue understanding against the current
# instruction -- never to a flat phrase list.
#
# English-only, like the rest of this tier. Kannada/Hindi
# acknowledgements are NOT matched here and still reach intent
# detection; that is a known limitation, not a regression.
# =========================================================

ACKNOWLEDGEMENT_PHRASES = {
    "thanks": {
        "thank you", "thanks", "thankyou", "thank u",
        "thank you very much", "thanks very much",
        "thanks a lot", "many thanks"
    },
    "acknowledgement": {
        "okay", "ok", "o.k", "alright", "all right",
        "got it", "understood"
    },
}

# The phrase each acknowledgement class opens its reply with.
# ---------------------------------------------------------
# Kannada / Hindi phrases (Phase 3.2B-12)
#
# The three tables above were English-only, which is why
# "ಧನ್ಯವಾದಗಳು" reached IntentDetector and started a withdrawal
# workflow. The Kannada/Hindi phrasings live in one data module
# and are merged in here, so matching, ordering and the
# exact-phrase rule are IDENTICAL for every language -- there is
# no second matcher and no language-specific code path.
# ---------------------------------------------------------

SESSION_EXIT_PHRASES = SESSION_EXIT_PHRASES | multilingual_phrases.SESSION_EXIT_PHRASES

WORKFLOW_CONTROL_PHRASES = multilingual_phrases.merge_phrase_sets(
    WORKFLOW_CONTROL_PHRASES, multilingual_phrases.WORKFLOW_CONTROL_PHRASES
)

ACKNOWLEDGEMENT_PHRASES = multilingual_phrases.merge_phrase_sets(
    ACKNOWLEDGEMENT_PHRASES, multilingual_phrases.ACKNOWLEDGEMENT_PHRASES
)

ACKNOWLEDGEMENT_OPENERS = {
    "thanks": "You're welcome.",
    "acknowledgement": "Okay.",
}

# Control phrases are at most this many words -- anything longer
# is left to the LLM rather than risk swallowing richer phrasing.
MAX_CONTROL_PHRASE_WORDS = 4


# =========================================================
# POLITE CONTROL WRAPPERS  (Phase 3.2B-1)
#
# Real customers do not say "pause". They say "can you pause
# for a moment", "please repeat that", "could you continue".
# Every one of those missed the exact-phrase table above and
# fell through to the LLM, where a pause is only as reliable as
# the model's classification of that turn -- which is exactly
# the tier this file exists to keep control commands OUT of.
#
# The fix is a SECOND-CHANCE pass, not a looser table:
#
#   1. The exact-phrase match runs FIRST and is unchanged, so
#      every phrase that classified before classifies
#      identically now, including "never mind" -> cancel.
#   2. Only if that finds nothing is the politeness wrapper
#      stripped, and the REMAINDER must still be an exact
#      member of a control phrase set.
#
# So the widening is strictly "wrapper + known phrase", never
# fuzzy matching. "cancel my loan application tomorrow" and
# "can you repeat what you said about the loan rate?" still
# reach the LLM untouched: nothing is left over that exactly
# equals a control phrase.
#
# DELIBERATELY LIMITED TO pause / resume / repeat.
#
# "cancel" and "next" keep exact matching only. Cancel destroys
# a request in progress and next is the one control that can be
# confused with a request for direction; widening the surface on
# which either fires would fail in the UNSAFE direction. Those
# two continue to reach the LLM, which weighs the whole
# sentence, exactly as they do today.
#
# English-only, like the rest of this tier.
# =========================================================

POLITELY_WRAPPABLE_COMMANDS = ("pause", "resume", "repeat")

# Longest-first, so "can you please" is consumed before the
# shorter "can you" can strand a trailing "please".
POLITE_PREFIXES = tuple(sorted(
    (
        "can you please", "could you please", "would you please",
        "will you please", "can you", "could you", "would you",
        "will you", "please", "kindly", "just",
    ),
    key=len,
    reverse=True,
))

# Conversational lead-ins. A customer answering "let me know
# when you're ready to continue" says "Okay, please continue" --
# the filler is part of the wrapper, not of the command.
#
# These are safe to strip ONLY because the remainder must still
# exactly match a pause/resume/repeat phrase:
#
#   "okay"      -> stripped only before another word, and pass 1
#                  classifies it as an acknowledgement first
#   "yes"       -> alone, stays with the LLM as it does today
#   "yes next"  -> "next" is not politely wrappable, so this
#                  still reaches the LLM (understanding rule 56)
#   "okay cancel" -> likewise, cancel is not wrappable
CONVERSATIONAL_LEAD_INS = (
    "okay", "ok", "alright", "all right",
    "yes", "yeah", "yep", "so", "now", "then",
)

# Trailing softeners, durations and bare objects ("repeat that",
# "pause it", "pause for some time").
#
# The duration forms were added after a live voice smoke test:
# "Can you pause for some time?" reduced to "pause for some
# time", which is not a control phrase, so the whole utterance
# fell through to IntentDetector and started a workflow. A
# customer naming HOW LONG they want to pause is still asking to
# pause.
POLITE_SUFFIXES = tuple(sorted(
    (
        "for a moment", "for a minute", "for a second",
        "for a bit", "a moment", "a minute", "a second",
        "for some time", "for a while", "for a few minutes",
        "some time", "a while", "a few minutes", "a bit",
        "for now",
        "for me", "please", "that", "this", "it",
    ),
    key=len,
    reverse=True,
))

# One table for the stripping loop, longest-first.
STRIPPABLE_PREFIXES = tuple(sorted(
    POLITE_PREFIXES + CONVERSATIONAL_LEAD_INS,
    key=len,
    reverse=True,
))

# A politely wrapped command is longer than a bare one, but not
# unbounded -- past this the utterance is a sentence, not a
# command, and belongs to the LLM.
MAX_POLITE_PHRASE_WORDS = 8

# "would you repeat it please" needs prefix + two suffixes.
POLITENESS_STRIP_PASSES = 3


# =========================================================
# NEGATION PROTECTION  (Phase 3.2B-1)
#
# Exact-phrase matching is negation-proof by construction:
# "don't pause" simply is not the string "pause". Politeness
# stripping is the first thing in this tier that removes words
# before matching, so it is the first thing that could turn a
# REFUSAL into a COMMAND -- and a control command is precisely
# the wrong thing to get backwards, since "no, don't cancel"
# executing as "cancel" destroys the customer's request.
#
# This guard runs on the FULL utterance, before any stripping,
# and rejects the whole second-chance path when a negation is
# present. The utterance then falls through to the LLM, which
# reads the negation in context -- the same place it goes today.
#
# It guards the NEW path only. The exact-match path above is
# untouched, so "never mind" -> cancel still works even though
# "never" is a negation token: it is matched exactly, before
# this guard is ever consulted.
#
# Known limitation: a corrective "no, repeat that" is rejected
# here too and handed to the LLM (understanding rule 46 covers
# it). Refusing a genuine command costs one clarifying turn;
# executing a refused one costs the customer their request.
# =========================================================

NEGATION_TOKENS = {
    "not", "no", "nope", "dont", "don't", "doesnt", "doesn't",
    "didnt", "didn't", "cant", "can't", "cannot", "wont",
    "won't", "shouldnt", "shouldn't", "never", "without",
}

# Keeps apostrophes, so "don't" survives as one token. The
# module-level _WORD_PATTERN ([a-z]+) would split it into "don"
# and "t" and match neither.
_NEGATION_WORD_PATTERN = re.compile(r"[a-z']+")


def contains_negation(text):
    """
    True when `text` contains a word that negates a command.
    """

    if not text:
        return False

    # Whisper emits a curly apostrophe; fold it so "don’t" and
    # "don't" are the same token.
    normalized = text.lower().replace("’", "'")

    return any(
        word in NEGATION_TOKENS
        for word in _NEGATION_WORD_PATTERN.findall(normalized)
    )


def strip_politeness(text):
    """
    Removes leading politeness ("can you please ...") and
    trailing softeners ("... for a moment", "... please") from an
    already-normalized utterance.

    Returns the remainder, which the caller must still match
    EXACTLY against a control phrase set -- this function decides
    nothing on its own.
    """

    if not text:
        return ""

    # Commas are wrapper punctuation here ("can you please,
    # repeat that"), not meaning.
    result = " ".join(text.replace(",", " ").split())

    for _ in range(POLITENESS_STRIP_PASSES):

        before = result

        for prefix in STRIPPABLE_PREFIXES:

            # The trailing space matters: a bare "please" is not
            # a command with the politeness removed, it is just
            # the word "please".
            if result.startswith(prefix + " "):
                result = result[len(prefix):].strip()
                break

        for suffix in POLITE_SUFFIXES:

            if result.endswith(" " + suffix):
                result = result[: -len(suffix)].strip()
                break

        result = result.strip(" ,.!?;:")

        if result == before:
            break

    return result


def classify_polite_control(normalized):
    """
    Second-chance classification for a politely wrapped
    pause / resume / repeat.

    Returns "pause", "resume", "repeat", or None. Called only
    after exact-phrase matching has already failed.
    """

    if not normalized:
        return None

    if len(normalized.split()) > MAX_POLITE_PHRASE_WORDS:
        return None

    if contains_negation(normalized):
        return None

    stripped = strip_politeness(normalized)

    # Nothing was actually wrapped -- exact matching already had
    # its turn on this exact string and declined.
    if not stripped or stripped == normalized:
        return None

    if len(stripped.split()) > MAX_CONTROL_PHRASE_WORDS:
        return None

    for command in POLITELY_WRAPPABLE_COMMANDS:

        if stripped in WORKFLOW_CONTROL_PHRASES[command]:
            return command

    return None


# =========================================================
# EXPLICIT STEP REFERENCES  (Phase 3.2B-2)
#
# "Step 4", "step four", "repeat step 4", "the fourth step",
# "tell me step 4 of the deposit process".
#
# WHY THIS IS IN THE DETERMINISTIC TIER, BEFORE INTENT
# DETECTION:
#
# A bare step reference had no gate at all. In a resting state
# the pipeline's route is classify_command() -> question
# pre-filter -> IntentDetector, and "Step 4" matched neither of
# the first two. IntentDetector is a total function -- argmax
# over five banking labels, no abstention, no threshold -- so it
# answered "withdraw money" at confidence 0.104 and a COMPLETED
# deposit session STARTED A WITHDRAWAL WORKFLOW. Asking to hear
# a step is a read-only request; it must never be able to enrol
# the customer in a banking procedure.
#
# The question-shaped variants ("Tell me step 4") escaped intent
# detection but were answered from the RAG knowledge base, which
# GUESSES at step content. A step is data we hold exactly, so it
# is read from the workflow definition, never generated.
#
# MATCHING IS STRUCTURAL, NOT KEYWORD-BASED. The whole utterance
# -- after politeness and request wrappers are removed -- must BE
# a step reference. So "I stepped outside", "step carefully",
# "next step in my life" and a bare "step" never match, and
# neither does "I have completed step 4", which stays a
# completion statement (see STEP_REFERENCE_VETO_TOKENS).
# =========================================================

STEP_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}

STEP_ORDINAL_WORDS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
}

# Ways of ASKING for a step, stripped before matching. Read-only
# verbs only: "go to step 4" and "skip to step 4" are NOT here,
# because those ask to MOVE, and moving a banking workflow is
# never a side effect of a phrase table.
STEP_REQUEST_LEAD_INS = tuple(sorted(
    (
        "can you repeat", "could you repeat", "can you tell me",
        "could you tell me", "can you read", "could you read",
        "please tell me", "please repeat", "please read",
        "tell me about", "tell me", "remind me of", "remind me",
        "read out", "read me", "read back", "read",
        "what is", "what's", "whats", "what was", "what about",
        "how about", "i want", "i need", "i would like",
        "repeat", "say", "describe", "explain", "show me",
        "give me", "go over", "about",
        "the", "my",
    ),
    key=len,
    reverse=True,
))

# Evidence that the customer is REPORTING work, not asking to
# hear a step. Completion semantics outrank step references, and
# this tier runs before the LLM, so a completion report reaching
# here would be silently downgraded to a read-only reply and the
# workflow would never advance. "I have completed step 4" must
# reach dialogue understanding untouched.
STEP_REFERENCE_VETO_TOKENS = frozenset({
    "completed", "complete", "finished", "finish", "done",
    "filled", "fill", "entered", "enter", "signed", "sign",
    "submitted", "submit", "took", "taken", "wrote", "written",
    "did", "collected", "paid", "already",
})

# The remainder must BE one of these, in full.
_STEP_REFERENCE_PATTERNS = (
    # "step 4", "step four", "steps 4 of the deposit process"
    re.compile(
        r"^steps?\s+(?P<number>[a-z0-9]+)"
        r"(?:\s+of\s+(?P<workflow>.+))?$"
    ),
    # "4th step", "fourth step", "4 step of deposit"
    re.compile(
        r"^(?P<number>[a-z0-9]+)\s+steps?"
        r"(?:\s+of\s+(?P<workflow>.+))?$"
    ),
)

_ORDINAL_SUFFIX_PATTERN = re.compile(r"(?:st|nd|rd|th)$")

# Utterances longer than this are sentences, not step requests,
# even after the wrappers come off.
MAX_STEP_REFERENCE_WORDS = 12


class StepReference(NamedTuple):
    """
    A recognised explicit step reference.

    `workflow_phrase` is the workflow the customer NAMED, exactly
    as they said it, or None when they named none (meaning "the
    workflow I am on"). Resolving that phrase to a definition is
    WorkflowLoader's job, not this recognizer's -- nothing here
    knows any workflow name.

    A NamedTuple so it is immutable and hashable: it travels the
    same route as the string control classifications, including
    through `command in ACKNOWLEDGEMENT_PHRASES`.
    """

    step_number: int
    workflow_phrase: str = None


def _resolve_step_token(token):
    """
    "4" / "four" / "fourth" / "4th" -> 4. Anything else -> None.
    """

    if not token:
        return None

    if token in STEP_NUMBER_WORDS:
        return STEP_NUMBER_WORDS[token]

    # Ordinal WORDS are checked before suffix stripping, so
    # "first" is not mangled into "fir".
    if token in STEP_ORDINAL_WORDS:
        return STEP_ORDINAL_WORDS[token]

    if token.isdigit():
        return int(token)

    stripped = _ORDINAL_SUFFIX_PATTERN.sub("", token)

    if stripped.isdigit():
        return int(stripped)

    return None


def strip_step_request_lead_ins(text):
    """
    Removes the ways of asking ("tell me", "what is", "the")
    from the front of an utterance. Decides nothing on its own.
    """

    result = text

    for _ in range(POLITENESS_STRIP_PASSES):

        before = result

        for lead_in in STEP_REQUEST_LEAD_INS:

            if result.startswith(lead_in + " "):
                result = result[len(lead_in):].strip()
                break

        result = result.strip(" ,.!?;:")

        if result == before:
            break

    return result


def classify_step_reference(normalized):
    """
    Recognises an explicit step reference in an already-normalized
    utterance.

    Returns a StepReference, or None. None means "not a step
    reference", and the caller must continue with its normal
    routing rather than guess.
    """

    if not normalized:
        return None

    if len(normalized.split()) > MAX_STEP_REFERENCE_WORDS:
        return None

    # "don't repeat step 4" is a refusal, not a request. Same
    # reasoning as the polite control path.
    if contains_negation(normalized):
        return None

    words = set(_WORD_PATTERN.findall(normalized))

    # Completion outranks step reference, always.
    if words & STEP_REFERENCE_VETO_TOKENS:
        return None

    # Politeness first, then the request wrapper, then politeness
    # again -- "can you tell me the fourth step please" needs all
    # three.
    candidate = strip_politeness(normalized)
    candidate = strip_step_request_lead_ins(candidate)
    candidate = strip_politeness(candidate)
    candidate = strip_step_request_lead_ins(candidate)

    if not candidate:
        return None

    for pattern in _STEP_REFERENCE_PATTERNS:

        match = pattern.match(candidate)

        if match is None:
            continue

        step_number = _resolve_step_token(match.group("number"))

        # The number is the real gate: "next step", "the step",
        # "step carefully" all reach here and all fail it.
        if step_number is None:
            continue

        workflow_phrase = match.group("workflow")

        if workflow_phrase is not None:

            workflow_phrase = workflow_phrase.strip(" ,.!?;:")

            if not workflow_phrase:
                workflow_phrase = None

        return StepReference(
            step_number=step_number,
            workflow_phrase=workflow_phrase
        )

    return None


def normalize_command_text(text):
    """
    Normalizes raw STT/typed text for exact-phrase control
    matching: lowercases, trims whitespace, and strips the
    trailing sentence punctuation Whisper commonly adds
    ("Exit." / "EXIT!" / "exit..." -> "exit"). This is the
    single normalization path used by BOTH session-exit and
    workflow-control classification below.
    """

    if not text:
        return ""

    normalized = text.strip().lower()
    normalized = normalized.rstrip(" .!?,;:")

    return normalized


def classify_command(text):
    """
    Deterministically classifies a short user utterance as a
    session-exit command, a workflow-control command, a
    standalone conversational acknowledgement, or none of these.

    Returns one of:
        "session_exit", "pause", "resume", "cancel", "repeat",
        "next", "thanks", "acknowledgement", or None (caller
        should proceed with normal knowledge routing / intent
        detection / dialogue understanding).

    Matching is exact-phrase against a normalized utterance,
    never substring matching -- so "don't exit" or "cancel my
    appointment tomorrow" are never misclassified.

    A politely wrapped pause / resume / repeat ("can you please
    repeat that") is recognised by a SECOND pass that runs only
    after exact matching has failed, and that still requires an
    exact phrase once the wrapper is removed. See
    classify_polite_control().
    """

    normalized = normalize_command_text(text)

    if not normalized:
        return None

    if normalized in SESSION_EXIT_PHRASES:
        return "session_exit"

    # ---------------------------------------------
    # Pass 1 -- exact phrase, unchanged.
    # ---------------------------------------------

    if len(normalized.split()) <= MAX_CONTROL_PHRASE_WORDS:

        for action, phrases in WORKFLOW_CONTROL_PHRASES.items():

            if normalized in phrases:
                return action

        # Acknowledgements are matched last, so a phrase that is
        # also a workflow control keeps its control meaning. The
        # two vocabularies are disjoint today; this ordering keeps
        # the precedence unambiguous if either one grows.

        for classification, phrases in ACKNOWLEDGEMENT_PHRASES.items():

            if normalized in phrases:
                return classification

    # ---------------------------------------------
    # Pass 2 -- politely wrapped pause / resume / repeat.
    #
    # Runs after pass 1 so no existing classification can change,
    # and returns None for everything it does not recognise,
    # which lands the utterance on the LLM path exactly as before.
    # ---------------------------------------------

    polite = classify_polite_control(normalized)

    if polite is not None:
        return polite

    # ---------------------------------------------
    # Pass 3 -- realistic Indic ASR variants (3.2B-13).
    #
    # Runs LAST, so it can only classify utterances every earlier
    # pass already declined. See multilingual_phrases for why
    # both rules are safe: the stem rule needs the whole
    # utterance to be one word, and the fragment rule retries the
    # exact tables after dropping single-character debris.
    # ---------------------------------------------

    by_stem = multilingual_phrases.classify_by_stem(normalized)

    if by_stem is not None:
        return by_stem

    without_fragments = multilingual_phrases.strip_trailing_fragments(normalized)

    if without_fragments is not None and without_fragments != normalized:
        return classify_command(without_fragments)

    return None


# =========================================================
# DETERMINISTIC PRE-INTENT ROUTING  (Phase 3.2B-2)
#
# The two deterministic stages, composed in order:
#
#   1. classify_command()        -- session exit, workflow
#                                   control, acknowledgement
#   2. classify_step_reference() -- explicit step reference
#
# Kept as SEPARATE functions on purpose. classify_command() is
# the control/acknowledgement classifier and returns a string or
# None; that is its documented contract and "repeat step 3" is
# correctly NOT a control command under it -- stripping a
# politeness wrapper must never leave a control phrase behind
# that was not there. A step reference is a different kind of
# thing, carrying a payload (which step, and optionally which
# workflow), so it is recognised by its own function and
# composed here.
#
# Control runs FIRST, so a bare "repeat" stays the `repeat`
# control and only a reference that actually names a step
# ("repeat step 4") becomes a StepReference.
# =========================================================

def classify_turn(text):
    """
    Deterministic pre-intent classification of one user turn.

    Returns a control/acknowledgement class name (str), a
    StepReference, or None when neither stage recognises the
    utterance and normal routing should continue.
    """

    command = classify_command(text)

    if command is not None:
        return command

    return classify_step_reference(normalize_command_text(text))


# =========================================================
# KNOWLEDGE / GENERAL QUESTION PRE-FILTER
#
# Cheap, English-focused heuristic used ONLY to decide whether
# it's worth asking the LLM to classify an utterance as a
# general question BEFORE committing to intent detection. This
# is a pre-filter, not the actual decision -- the LLM's own
# `type` classification (see DialogueManager.
# answer_general_question) makes the real call.
#
# Deliberately conservative: an utterance that doesn't look
# like a question here is sent straight to intent detection,
# exactly as before Phase 2's corrective patch. This means it
# can NEVER cause a genuine banking request (English, Kannada,
# or Hindi) to be misrouted away from intent detection -- it
# can only add a new path for utterances that already look like
# questions, which is exactly the reported bug.
# =========================================================

QUESTION_LEAD_WORDS = {
    "what", "why", "how", "who", "when", "where", "which",
    "is", "are", "was", "were", "can", "could", "would",
    "should", "do", "does", "did", "will", "explain", "tell",
    "define",
    # Imperative side questions, in the same spirit as the
    # "explain" / "tell" / "define" already here.
    #
    # Added in Phase 3.2B-3 after its own tests found that
    # "Spell 20000 rupees." -- the project's single most common
    # side question -- is not question-SHAPED: no leading
    # interrogative and no "?". In a resting state that meant
    # neither this pre-filter nor the control pre-filter caught
    # it, so it reached IntentDetector and started a workflow,
    # exactly like the §16.9 and §17.1 defects.
    #
    # Widening this table can only add a candidate for the LLM's
    # own `type` classification; it never routes anything by
    # itself, so a false positive costs one round-trip and cannot
    # misroute a banking request.
    "spell", "pronounce",
}

# Strong interrogatives, recognised ANYWHERE in the utterance.
#
# Deliberately a small subset of QUESTION_LEAD_WORDS. The
# auxiliaries ("is", "do", "can", "should", ...) are excluded on
# purpose: they occur harmlessly inside ordinary declarative
# banking requests ("the money that is in my account"), so
# matching them mid-sentence would divert real service requests
# away from intent detection. A WH-word appearing anywhere is a
# far stronger signal and does not have that failure mode.
#
# This exists because the first-word test alone misses questions
# that are phrased with a leading clause and no question mark --
# e.g. "For admission letter what really I should ask in the
# college like what type of letter is that", which was being
# routed into the loan workflow.
#
# Widening this can only add candidates for the LLM's own
# question classification (see answer_general_question). It
# never decides anything by itself, and utterances with no
# English WH-word -- including every Kannada and Hindi banking
# request -- reach intent detection exactly as before.

STRONG_QUESTION_WORDS = {
    "what", "why", "how", "who", "when", "where", "which",
}

_WORD_PATTERN = re.compile(r"[a-z]+")


def looks_like_a_question(text):

    if not text:
        return False

    normalized = text.strip().lower()

    if normalized.endswith("?"):
        return True

    first_word = normalized.split(" ", 1)[0].strip(" .,!?")

    if first_word in QUESTION_LEAD_WORDS:
        return True

    # A strong interrogative anywhere in the sentence.
    return any(
        word in STRONG_QUESTION_WORDS
        for word in _WORD_PATTERN.findall(normalized)
    )


# =========================================================
# CURRENT-STEP RESTATEMENT
#
# One phrasing, shared by every path that must keep the user
# on the step they are already on:
#
#   - "next" / "what's next" (deterministic control path)
#   - action == "next_step" (LLM path)
#   - acknowledgements, including statements of intent such as
#     "I'll fill it" or "I need to fill this"
#
# The workflow engine is deterministic: a required banking
# instruction is never skipped just because the customer said
# "next" or "okay". Restating the instruction and explicitly
# inviting a completion signal is what makes that behaviour
# audible to the customer instead of feeling like the assistant
# ignored them.
#
# Advancing still happens in exactly one place -- the
# step-completion branch of generate_response() -- and
# only on evidence that the step is done.
# =========================================================


def restate_current_step(instruction):

    if not instruction:
        return "There's nothing active right now."

    return f"{instruction} Let me know when you've completed it."


# =========================================================
# NATURAL-LANGUAGE CONTROL RESOLUTION  (Phase 3.2B-1)
#
# The understanding schema has a `control` TYPE but no pause or
# resume ACTION -- the action enum stops at next_step, complete,
# repeat, cancel, explain, provide_information, none. So when the
# model correctly recognised "I need to step away for a bit" as
# control, it had no way to say WHICH control, and the turn
# arrived at generate_response() as type=control / action=none.
# Nothing handled that combination, so it fell to the default
# branch and re-stated the current step. The customer asked to
# pause and the assistant carried on.
#
# This recovers the specific command from the customer's own
# words. Unlike classify_command() it scans for a keyword
# ANYWHERE in the utterance rather than matching the whole
# string -- which is safe here, and ONLY here, because it runs
# after the LLM has already judged the whole message to be a
# control message. The keyword only has to pick pause from
# resume; it is not deciding whether this is a control turn.
#
# Word-boundary matched (" continue " not "continue"), so
# "discontinued" cannot read as a resume.
#
# PAUSE IS LISTED FIRST AND WINS when both families appear
# ("pause, I'll continue later"). Pausing a workflow loses
# nothing -- state, step and entities all survive, and one word
# resumes it. Resuming one the customer wanted paused carries
# them into a banking step they had stepped away from.
# =========================================================

CONTROL_INTENT_KEYWORDS = (
    (
        "pause",
        (
            "pause", "paused", "hold on", "hold up", "hang on",
            "wait", "give me a moment", "give me a minute",
            "one moment", "one minute", "just a moment",
            "just a minute", "step away", "take a break",
        ),
    ),
    (
        "resume",
        (
            "resume", "continue", "carry on", "go on",
            "proceed", "keep going", "pick up where",
        ),
    ),
)


# =========================================================
# CONTROL PRE-FILTER  (resting states)
#
# Cheap, English-focused heuristic used ONLY to decide whether
# it is worth asking the LLM to classify an utterance BEFORE
# committing to intent detection. It is the control-command twin
# of looks_like_a_question(), and like that function it is a
# PRE-FILTER, NOT A DECISION: it can only add a new candidate
# for the LLM's own `type` classification, never route anything
# by itself.
#
# It exists because of a live voice smoke test. In the COMPLETED
# state the pipeline's only gates before IntentDetector are the
# deterministic phrase tables and answer_general_question(), and
# that second gate consults the LLM only for utterances shaped
# like a question. "pause for some time" is not shaped like a
# question -- no leading interrogative, no "?" -- so the LLM was
# never asked, and the utterance reached IntentDetector, which is
# a total function with no abstention and duly returned
# "withdraw money" at confidence 0.112. A withdrawal workflow
# started because the customer asked for a pause.
#
# Because the LLM makes the real call, a false positive here
# costs one round-trip and CANNOT misroute anything: "I want to
# continue my loan application" is classified by the model, and
# if the model says workflow_action it proceeds to intent
# detection exactly as before.
#
# Deliberately WIDER than the phrase tables (which must stay
# exact) and wider than resolve_control_command() (which must
# only ever separate pause from resume). Covers the repeat
# family too.
# =========================================================

CONTROL_PREFILTER_KEYWORDS = (
    # pause family
    "pause", "paused", "pausing",
    "hold on", "hold off", "hold up", "hang on",
    "wait", "step away", "take a break",
    "one moment", "one minute", "a moment", "a minute",
    "some time", "a while",
    # resume family
    "resume", "continue", "carry on", "proceed",
    "keep going", "pick up where",
    # repeat family
    "repeat", "again", "say that", "come again", "pardon",
)


def looks_like_a_control_utterance(text):
    """
    True when `text` is worth asking the LLM to classify as a
    control message. Decides nothing on its own.
    """

    normalized = normalize_command_text(text)

    if not normalized:
        return False

    padded = " " + " ".join(normalized.replace(",", " ").split()) + " "

    return any(
        f" {keyword} " in padded
        for keyword in CONTROL_PREFILTER_KEYWORDS
    )


def resolve_control_command(text):
    """
    Recovers "pause" or "resume" from an utterance the LLM has
    already classified as type = control.

    Returns "pause", "resume", or None. None means "not a
    pause/resume", and the caller must fall through to its normal
    routing rather than guess.
    """

    normalized = normalize_command_text(text)

    if not normalized:
        return None

    # A negated control is not a control. Same reasoning as the
    # politeness path: see NEGATION PROTECTION above.
    if contains_negation(normalized):
        return None

    padded = " " + " ".join(normalized.replace(",", " ").split()) + " "

    for command, keywords in CONTROL_INTENT_KEYWORDS:

        for keyword in keywords:

            if f" {keyword} " in padded:
                return command

    return None


class DialogueManager:

    def __init__(self, intent_detector=None):
        self.workflow_loader = WorkflowLoader()
        self.dialogue_understanding = DialogueUnderstanding()

        # =============================================
        # THE EXISTING INTENT DETECTOR, INJECTED
        # (Phase 3.2B-14)
        #
        # Used for ONE question: is this turn a request for a
        # DIFFERENT banking service than the one in progress? The
        # detector is the engine's only intent classifier and
        # stays that way -- there is deliberately no second
        # classifier here, and this class never asks it to decide
        # a workflow transition. It answers "which service",
        # nothing more.
        #
        # INJECTED rather than constructed, for two reasons. It
        # loads a sentence-transformer model, and the routing
        # layer already owns one; building a second would double
        # the start-up cost and the memory for no benefit. And it
        # is OPTIONAL: when no detector is supplied, conflict
        # detection is simply off and every other path in this
        # file behaves exactly as it did before this phase.
        # =============================================
        self.intent_detector = intent_detector

        print("Dialogue Manager Ready ✅")

    # =====================================================
    # TIER-1 CONTROL COMMAND DETECTION
    # (called by the pipeline BEFORE intent detection)
    #
    # Returns "session_exit", a workflow-control action name,
    # an acknowledgement class name, or None.
    # =====================================================

    def detect_control(self, user_input):

        # Composes BOTH deterministic stages -- control and step
        # reference -- so the pipeline gets one pre-intent
        # decision from one call. The result may be a class name
        # (str) or a StepReference; handle_control_command()
        # dispatches on the type, and the pipeline forwards it
        # opaquely, so no pipeline change was needed.

        return classify_turn(user_input)

    # =====================================================
    # TIER-1 CONTROL COMMAND HANDLING
    # =====================================================

    def handle_control_command(self, conversation, command):

        # An explicit step reference is dispatched FIRST. It is a
        # READ-ONLY request in every workflow state, so it must
        # not meet the has_workflow guard below (which answers
        # "there is nothing to pause") nor any state transition.
        #
        # classify_command() returns a StepReference rather than a
        # string for these, and VoiceAssistantPipeline._respond()
        # forwards whatever it gets straight to this method, so
        # the reference arrives here WITH the conversation --
        # which is what makes reading a step possible in the
        # resting states, where generate_response() is not called
        # at all. No pipeline change was needed.

        if isinstance(command, StepReference):

            return self._handle_step_reference(conversation, command)

        # ---------------------------------------------
        # AN OUTSTANDING WORKFLOW CONFLICT  (Phase 3.2B-14)
        #
        # The assistant has asked which of three named options the
        # customer wants, and this turn is a control word. While a
        # conflict is pending, a control word IS the answer:
        # "cancel", "pause" and "resume"/"continue" are the words
        # the question itself used, in every language the
        # deterministic tier already knows, so the existing
        # Kannada and Hindi control vocabulary resolves a conflict
        # with no new phrase table.
        #
        # Dispatched AFTER the step reference above, which is
        # read-only in every state and must keep working while the
        # question is outstanding, and BEFORE everything below,
        # because a pending question outranks the status of the
        # workflow it is about.
        #
        # A control word that names no option -- `repeat`, `next`,
        # an acknowledgement -- asks the question again and
        # changes nothing. That is the required behaviour for
        # repeat, and it is also the only safe reading of "okay":
        # it is not one of the three options.
        #
        # `session_exit` never arrives here. The pipeline ends the
        # session on it before any of this runs, which is exactly
        # what should happen to an exit during a conflict.
        # ---------------------------------------------

        pending_conflict = self._pending_conflict(conversation)

        if pending_conflict is not None:

            choice = CONFLICT_CONTROL_CHOICES.get(command)

            if choice is not None:

                return self._resolve_workflow_conflict(
                    conversation,
                    pending_conflict,
                    choice
                )

            return self._ask_conflict_question(
                conversation,
                pending_conflict
            )

        # Acknowledgements are dispatched BEFORE the has_workflow
        # guard below. That guard answers "there is nothing to
        # pause / cancel / repeat", which is the wrong reply to
        # "thank you" -- an acknowledgement has a meaningful and
        # distinct response in every workflow state, including
        # COMPLETED, CANCELLED and NONE.

        if command in ACKNOWLEDGEMENT_PHRASES:

            return self._handle_acknowledgement(
                conversation,
                command
            )

        has_workflow = (
            conversation.current_intent is not None
            and conversation.workflow_state in (
                WorkflowState.ACTIVE,
                WorkflowState.SUSPENDED
            )
        )

        if not has_workflow:
            return self._handle_control_without_workflow(
                conversation,
                command
            )

        workflow_state = conversation.workflow_state

        current_instruction = self._resolve_current_instruction(
            conversation
        )

        # ---------------------------------------------
        # PAUSE / RESUME -- THE DIALOGUE CONTRACT
        #
        # This is the ONE implementation of pause and resume.
        # The LLM control path (generate_response branch 8B)
        # routes back into this method rather than repeating the
        # transitions, so the two entry points cannot drift.
        #
        # The state half of the contract is already enforced by
        # ConversationManager: suspend_workflow() acts only on
        # ACTIVE, resume_workflow() only on SUSPENDED, and
        # neither touches current_step or entities. So a pause
        # NEVER loses the customer's place and a resume ALWAYS
        # returns them to the exact step they left.
        #
        # What was missing is the SPOKEN half. Pausing an
        # already-paused request replied "Okay, I've paused this
        # request", reporting a transition that did not happen,
        # and resuming an already-active one replied with a bare
        # instruction indistinguishable from a repeat. Both left
        # the customer unable to tell what state they were in --
        # which, for a customer who stepped away mid-withdrawal,
        # is the whole question.
        #
        # Each command now reports what ACTUALLY happened:
        #
        #   pause  + ACTIVE    -> suspends, confirms the pause
        #   pause  + SUSPENDED -> no change, says already paused
        #   resume + SUSPENDED -> resumes, states the step
        #   resume + ACTIVE    -> no change, says still active
        #                         AND states the step, so the
        #                         reply is still actionable
        # ---------------------------------------------

        if command == "pause":

            if workflow_state == WorkflowState.SUSPENDED:

                return (
                    "That request is already paused. "
                    "Say resume when you'd like to continue."
                )

            conversation.suspend_workflow()

            return (
                "Okay, I've paused this request. "
                "Let me know when you're ready to continue."
            )

        if command == "resume":

            was_suspended = (
                workflow_state == WorkflowState.SUSPENDED
            )

            conversation.resume_workflow()

            if current_instruction is None:
                return "Let's continue."

            if was_suspended:
                return f"Continuing. {current_instruction}"

            return (
                "That request is already active. "
                f"{current_instruction}"
            )

        # ---------------------------------------------
        # CANCEL
        # ---------------------------------------------

        if command == "cancel":

            conversation.cancel_workflow()

            return (
                "Okay, I've cancelled that request. "
                "Let me know if you'd like help with "
                "something else."
            )

        # ---------------------------------------------
        # REPEAT
        # (never resumes a suspended workflow by itself --
        # it only recalls the instruction)
        # ---------------------------------------------

        if command == "repeat":

            if current_instruction is None:
                return "There's nothing to repeat right now."

            return current_instruction

        # ---------------------------------------------
        # NEXT
        # (restates the current instruction, never skips
        # ahead; while suspended, this implicitly resumes
        # since the user is asking what to do)
        # ---------------------------------------------

        if command == "next":

            if current_instruction is None:
                return "There's nothing active right now."

            if workflow_state == WorkflowState.SUSPENDED:
                conversation.resume_workflow()
                return f"Continuing. {current_instruction}"

            return restate_current_step(current_instruction)

        return "Okay."

    # =====================================================
    # CONTROL WITH NOTHING CONTROLLABLE
    #
    # Reached whenever a control command arrives and the
    # conversation is NOT ACTIVE or SUSPENDED -- i.e. NONE,
    # COMPLETED or CANCELLED.
    #
    # This method NEVER mutates state. It cannot start, resume,
    # cancel or advance anything, which is the property that
    # makes routing a control utterance here safe in a resting
    # state: the worst it can do is say the wrong sentence.
    #
    # COMPLETED and CANCELLED are reported by name. They are not
    # "nothing happened" -- the customer is trying to control a
    # request that already finished, and naming its status is
    # what explains why the control did nothing. The wording
    # matches _handle_acknowledgement() and generate_response()'s
    # resting-state branch, so the assistant reports the same
    # status the same way however the turn was routed.
    # =====================================================

    def _handle_control_without_workflow(self, conversation, command):

        workflow_state = conversation.workflow_state

        # ---------------------------------------------
        # REPEAT IN A RESTING STATE  (Phase 3.2B-13)
        #
        # Repeat is READ-ONLY: it asks to hear something again,
        # and in a resting state there is no workflow step to
        # read. There may still be a real replay target -- the
        # last thing the assistant actually said -- and replaying
        # that is what the customer asked for.
        #
        # Live failure: after cancelling, "ಮತ್ತೆ ಹೇಳಿ" answered
        # "That request was cancelled. There's no active
        # request..." because every command in this branch got
        # the status message and `repeat` never reached its own
        # case below.
        #
        # The target is never fabricated: with nothing in history
        # the original wording is returned unchanged, and no
        # state is touched in either case.
        # ---------------------------------------------

        if command == "repeat":

            previous = self._last_assistant_message(conversation)

            if previous:
                return previous

        if workflow_state in (
            WorkflowState.COMPLETED,
            WorkflowState.CANCELLED
        ):

            status_message = (
                "Your request is already completed."
                if workflow_state == WorkflowState.COMPLETED
                else "That request was cancelled."
            )

            return (
                f"{status_message} There's no active request to "
                "control right now. Let me know if you'd like "
                "help with anything else."
            )

        # NONE -- wording unchanged.

        if command == "cancel":
            return "There's nothing active to cancel right now."

        if command == "pause":
            return "There's nothing active to pause right now."

        if command == "repeat":
            return "There's nothing to repeat right now."

        # "resume" or "next" with no workflow loaded
        return (
            "There's no active request right now. "
            "What banking service would you like help with?"
        )

    @staticmethod
    def _last_assistant_message(conversation):
        """
        The most recent thing the assistant said, or None.

        The replay target for `repeat` when no workflow step is
        available. Reads history only -- it cannot fabricate a
        target, and it changes nothing.
        """

        history = getattr(conversation, "history", None) or []

        for entry in reversed(history):

            if not isinstance(entry, dict):
                continue

            if entry.get("speaker") != "Assistant":
                continue

            message = (entry.get("message") or "").strip()

            if message:
                return message

        return None

    # =====================================================
    # ACKNOWLEDGEMENT HANDLING (STATE-AWARE)
    #
    # An acknowledgement is a conversational receipt. It is never
    # a banking request, and never evidence about the workflow.
    #
    # This method therefore NEVER mutates conversation state: it
    # does not advance current_step, does not mark a step
    # complete, does not resume a suspended workflow, and does not
    # start or cancel anything. It only chooses what to say.
    #
    # The reply is state-aware because "thank you" means something
    # different depending on where the customer is:
    #
    #   ACTIVE     -> they are mid-task; restate the step they are
    #                 on, so a side interaction (a spelling
    #                 question, an explanation) cannot lose the
    #                 workflow context.
    #   SUSPENDED  -> stay paused. An acknowledgement is NOT a
    #                 resume -- only an explicit "resume" /
    #                 "continue" control command resumes -- so the
    #                 reply says how to continue instead.
    #   COMPLETED  -> the request is done; offer further help.
    #   CANCELLED  -> the same, against the cancelled request.
    #   NONE       -> a plain conversational reply.
    # =====================================================

    def _handle_acknowledgement(self, conversation, command):

        opener = ACKNOWLEDGEMENT_OPENERS.get(command, "Okay.")

        workflow_state = conversation.workflow_state

        # ---------------------------------------------
        # ACTIVE -- keep the customer on their step
        # ---------------------------------------------

        if workflow_state == WorkflowState.ACTIVE:

            current_instruction = self._resolve_current_instruction(
                conversation
            )

            if current_instruction is not None:

                return (
                    f"{opener} "
                    + restate_current_step(current_instruction)
                )

            # Defensive only: ACTIVE with no resolvable
            # instruction. Fall through to the generic reply below
            # rather than inventing a step.

        # ---------------------------------------------
        # SUSPENDED -- acknowledge WITHOUT resuming
        # ---------------------------------------------

        elif workflow_state == WorkflowState.SUSPENDED:

            return (
                f"{opener} That request is still paused. "
                "Say resume when you'd like to continue."
            )

        # ---------------------------------------------
        # COMPLETED / CANCELLED -- resting states.
        #
        # The status wording matches generate_response()'s
        # resting-state branch, so the assistant reports the same
        # status the same way however the turn was routed.
        # ---------------------------------------------

        elif workflow_state == WorkflowState.COMPLETED:

            return (
                f"{opener} Your request is already completed. "
                "Let me know if you'd like help with anything else."
            )

        elif workflow_state == WorkflowState.CANCELLED:

            return (
                f"{opener} That request was cancelled. "
                "Let me know if you'd like help with anything else."
            )

        # ---------------------------------------------
        # NONE, or the defensive fall-through from ACTIVE
        # ---------------------------------------------

        return (
            f"{opener} Let me know if you'd like help with "
            "anything else."
        )

    # =====================================================
    # EXPLICIT STEP REFERENCE HANDLER  (Phase 3.2B-2)
    #
    # Reading out a banking instruction the system already holds.
    #
    # This method NEVER mutates conversation state -- not
    # workflow_state, not current_step, not current_intent, not
    # current_workflow, not entities. It cannot start, resume,
    # pause, cancel, complete or advance anything, in any state.
    # That is the whole property that makes it safe to run this
    # before intent detection.
    #
    # The step text comes from the workflow DEFINITION, never
    # from the LLM: a step is data we hold exactly, so guessing
    # at it would be strictly worse than reading it.
    # =====================================================

    def _handle_step_reference(self, conversation, reference):

        step_number = coerce_step_number(reference.step_number)

        if step_number is None:

            # Defensive: classify_step_reference() only ever
            # produces an int. A malformed value must not crash a
            # turn, so it degrades to the safe reply.
            return (
                "I couldn't tell which step you meant. "
                "You can say, for example, step 2."
            )

        # -------------------------------------------------
        # 1. WHICH workflow
        #
        # A named workflow WINS over the current one. Naming
        # another workflow is informational -- it never switches,
        # starts or otherwise touches the request in progress.
        # -------------------------------------------------

        is_cross_workflow = reference.workflow_phrase is not None

        if is_cross_workflow:

            workflow_name = self.workflow_loader.resolve_workflow_name(
                reference.workflow_phrase
            )

            if workflow_name is None:

                return (
                    "I don't have a guided procedure for that "
                    "service, so I can't read out its steps. "
                    + self._step_reference_state_note(conversation)
                ).strip()

        else:

            workflow_name = conversation.current_workflow

            if workflow_name is None:

                return (
                    "There's no active request to refer to right "
                    "now. Let me know which banking service you'd "
                    "like help with."
                )

        # A named workflow that happens to be the current one is
        # not a cross-workflow read.
        if workflow_name == conversation.current_workflow:
            is_cross_workflow = False

        # -------------------------------------------------
        # 2. LOAD it
        # -------------------------------------------------

        workflow = self.workflow_loader.load_workflow(workflow_name)

        if workflow is None:

            return (
                "Sorry, I can no longer access the steps for that "
                "request. Let me know which banking service you'd "
                "like help with."
            )

        steps = workflow["steps"]

        # -------------------------------------------------
        # 3. RANGE
        #
        # Reported with the real number of steps rather than a
        # bare refusal, and without touching anything.
        # -------------------------------------------------

        if not 1 <= step_number <= len(steps):

            return (
                f"That request only has {len(steps)} steps, so "
                f"there's no step {step_number}. "
                + self._step_reference_state_note(conversation)
            ).strip()

        instruction = steps[step_number - 1]["instruction"]

        # -------------------------------------------------
        # 4. READ IT OUT
        # -------------------------------------------------

        if is_cross_workflow:

            answer = (
                f"Step {step_number} of the {workflow_name} "
                f"process is: {instruction}"
            )

        else:

            answer = f"Step {step_number}: {instruction}"

        return (
            answer + " " + self._step_reference_state_note(conversation)
        ).strip()

    def _step_reference_state_note(self, conversation):
        """
        The sentence that keeps a read-only step answer honest
        about where the customer actually is.

        A step read does not resume a paused request, restart a
        completed one, or move an active one, so the reply says
        so instead of leaving the customer to infer it.
        """

        workflow_state = conversation.workflow_state

        if workflow_state == WorkflowState.SUSPENDED:
            return (
                "That request is still paused. Say resume when "
                "you'd like to continue."
            )

        if workflow_state == WorkflowState.COMPLETED:
            return "Your request is already completed."

        if workflow_state == WorkflowState.CANCELLED:
            return "That request was cancelled."

        if workflow_state == WorkflowState.ACTIVE:

            current_instruction = self._resolve_current_instruction(
                conversation
            )

            if current_instruction is not None:
                return f"You're still on: {current_instruction}"

        return ""

    def _resolve_current_instruction(self, conversation):

        workflow = self.workflow_loader.load_workflow(
            conversation.current_workflow
        )

        if workflow is None:
            return None

        steps = workflow["steps"]

        if 1 <= conversation.current_step <= len(steps):
            return steps[conversation.current_step - 1]["instruction"]

        return None

    # =====================================================
    # ACTIVE-WORKFLOW INTERRUPTION  (Phase 3.2B-14)
    #
    # THE DEFECT
    #
    # Once a workflow was ACTIVE, the routing layer sent every
    # turn to generate_response(), which understands an utterance
    # only as an action WITHIN the current request. Intent
    # detection was never consulted again for the rest of the
    # session. So a genuine new service request --
    #
    #     deposit ACTIVE, customer says "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು"
    #
    # -- came back type=workflow_action / action=none /
    # step_completed=false, fell to the default branch, and the
    # deposit step was restated. The customer asked to withdraw
    # and heard "Please take a deposit slip." again.
    #
    # THE SHAPE OF THE FIX
    #
    # Exactly one new question is asked of exactly one existing
    # component: "is this a request for a DIFFERENT banking
    # service?" IntentDetector answers it, as the engine's only
    # intent classifier. Nothing here classifies intent, and
    # nothing in IntentDetector knows about workflow state.
    #
    # DETECTION IS ONLY EVER ALLOWED TO ASK A QUESTION. It starts
    # nothing, cancels nothing, suspends nothing and advances
    # nothing. The transitions live in _resolve_workflow_conflict,
    # which runs only after the customer has picked one of the
    # three options by name.
    #
    # WHERE IT RUNS, AND WHY THAT IS THE SAFE PLACE
    #
    # generate_response() branches 7-13 handle every turn the
    # engine positively understood as belonging to the current
    # request: cancel, repeat, natural-language control, step
    # completion, acknowledgement, question/help, next-step and
    # information. All of them keep absolute priority -- the
    # conflict check runs only on a turn that NONE of them
    # claimed, which is exactly where the live failure landed.
    #
    # That ordering is what satisfies the hard requirement that a
    # side question must not interrupt a workflow: "what is an
    # education loan?" during a withdrawal is claimed by the
    # question branch and never reaches this code at all.
    # =====================================================

    @staticmethod
    def _pending_conflict(conversation):
        """
        The unresolved WorkflowConflict on `conversation`, or None.

        getattr, not attribute access: a ConversationManager built
        before this phase -- including the ones the debugging
        suites construct directly -- simply has no such attribute,
        and the correct reading of that is "no conflict".
        """

        return getattr(conversation, "workflow_conflict", None)

    def _ask_conflict_question(self, conversation, conflict):
        """
        The clarification, phrased for the state the interrupted
        request is actually in. Changes nothing.
        """

        return conflict_question(
            conflict,
            paused=(
                conversation.workflow_state == WorkflowState.SUSPENDED
            )
        )

    def _detect_workflow_conflict(self, conversation, user_input):
        """
        Recognises a request for a DIFFERENT banking service while
        one is already in progress.

        Returns a WorkflowConflict, or None. None means "not a
        conflict", and the caller must continue with its existing
        routing rather than guess. This method NEVER mutates
        conversation state.
        """

        # ---------------------------------------------
        # No detector -> the feature is simply off, and every
        # caller behaves exactly as it did before this phase.
        # ---------------------------------------------

        detector = getattr(self, "intent_detector", None)

        if detector is None or not user_input:
            return None

        # ---------------------------------------------
        # There must be a request to interrupt. COMPLETED,
        # CANCELLED and NONE are resting states: the routing layer
        # already sends a fresh intent through the normal
        # detection path there, so a conflict is impossible and
        # this must not invent one.
        # ---------------------------------------------

        current = (
            conversation.current_intent
            or conversation.current_workflow
        )

        if not current:
            return None

        if conversation.workflow_state not in (
            WorkflowState.ACTIVE,
            WorkflowState.SUSPENDED
        ):
            return None

        # ---------------------------------------------
        # EXISTING PRE-FILTERS KEEP THEIR TURNS
        #
        # Each of these already owns a class of utterance, and a
        # conflict must not be able to take one away:
        #
        #   looks_like_a_question       -- "how much can I
        #       deposit?" during a withdrawal is a question about
        #       banking, and the question path answers it. Measured:
        #       IntentDetector scores it as a BANKING_INTENT at
        #       margin +0.206, so without this guard a question
        #       would raise a clarification.
        #
        #   looks_like_a_control_utterance -- the control family,
        #       which branch 8B and the deterministic tier own.
        #
        #   contains_negation -- "I don't want to withdraw" is a
        #       refusal, not a request. Same reasoning as the
        #       NEGATION PROTECTION block at the top of this file:
        #       reading a refusal as a request is the expensive
        #       direction.
        #
        # All three are the engine's existing functions, used for
        # the purpose they were written for. No new semantics.
        # ---------------------------------------------

        if looks_like_a_question(user_input):
            return None

        if looks_like_a_control_utterance(user_input):
            return None

        if contains_negation(user_input):
            return None

        # ---------------------------------------------
        # THE ONE QUESTION FOR THE DETECTOR
        #
        # `is_banking_intent` must be explicitly true. Absent
        # counts as false here -- deliberately the opposite of the
        # routing layer's `.get("is_banking_intent", True)`,
        # because an answer that does not carry the abstention
        # signal is not evidence strong enough to interrupt a
        # banking request in progress.
        # ---------------------------------------------

        result = detector.detect_intent(user_input) or {}

        if result.get("is_banking_intent") is not True:
            return None

        requested = result.get("intent")

        if not requested:
            return None

        # The same service is not a conflict: the customer is
        # talking about the request they are already on, and the
        # existing workflow handling continues untouched.

        if same_workflow(requested, current):
            return None

        return WorkflowConflict(
            current_workflow=current,
            requested_workflow=requested
        )

    def _conflict_choice_from_text(self, user_input):
        """
        Which of the three options a free-text answer selects, or
        None when it selects none of them.

        The negation guard is applied HERE rather than inside
        resolve_conflict_answer() so the resolver stays a pure
        function of its vocabulary, and so the guard is the same
        contains_negation() the rest of this file uses.
        """

        if not user_input:
            return None

        if contains_negation(user_input):
            return None

        return resolve_conflict_answer(user_input)

    def _resolve_workflow_conflict(self, conversation, conflict, choice):
        """
        Carries out the option the customer picked.

        `choice` is CHOICE_CANCEL, CHOICE_PAUSE, CHOICE_CONTINUE,
        or None. None is not a failure -- it is "that did not
        answer the question" -- and it asks the question again
        WITHOUT touching a single piece of state, which is the
        documented default for anything unclear.

        Every transition here goes through the ConversationManager
        method that already owns it (cancel_workflow,
        suspend_workflow, resume_workflow, and start_workflow ->
        load_workflow for activation). There is no second workflow
        engine and at no point are two workflows ACTIVE.
        """

        current = conflict.current_workflow
        requested = conflict.requested_workflow

        current_name = display_name(current)
        requested_name = display_name(requested)

        # ---------------------------------------------
        # NOT AN ANSWER -- ask again, change nothing.
        # ---------------------------------------------

        if choice is None:
            return self._ask_conflict_question(conversation, conflict)

        # ---------------------------------------------
        # C. CONTINUE THE CURRENT REQUEST
        #
        # The conflict is resolved by DISCARDING the new request,
        # which is the customer's call to make. current_step is
        # not touched, so they are exactly where they were.
        #
        # resume_workflow() is a no-op unless the request was
        # SUSPENDED; when it was, the customer saying "continue"
        # is the explicit resume the engine already requires.
        # ---------------------------------------------

        if choice == CHOICE_CONTINUE:

            conversation.clear_workflow_conflict()
            conversation.resume_workflow()

            current_instruction = self._resolve_current_instruction(
                conversation
            )

            if current_instruction is None:
                return f"Okay, we'll carry on with the {current_name}."

            return (
                f"Okay, let's continue with the {current_name}. "
                + restate_current_step(current_instruction)
            )

        # ---------------------------------------------
        # THE NEW REQUEST MUST ACTUALLY EXIST
        #
        # Checked BEFORE anything is cancelled or suspended, so a
        # service with no guided procedure can never cost the
        # customer the request they already had. The wording
        # mirrors start_workflow()'s own honest message.
        #
        # Detection checks this too, so this is normally
        # unreachable; it is here because the two sides of a
        # transition must not depend on each other's ordering.
        # ---------------------------------------------

        if not self.workflow_loader.has_workflow(requested):

            conversation.clear_workflow_conflict()

            current_instruction = self._resolve_current_instruction(
                conversation
            )

            message = (
                "I don't have a guided procedure for "
                f"{requested_name} yet, so I've left your "
                f"{current_name} exactly as it was."
            )

            if current_instruction is None:
                return message

            return f"{message} {current_instruction}"

        # ---------------------------------------------
        # A. CANCEL THE CURRENT REQUEST, START THE NEW ONE
        # ---------------------------------------------

        if choice == CHOICE_CANCEL:

            conversation.cancel_workflow()

            opener = f"Okay, I've cancelled the {current_name}."

        # ---------------------------------------------
        # B. PAUSE THE CURRENT REQUEST, START THE NEW ONE
        #
        # The snapshot is taken AFTER suspend_workflow() so it
        # records a request that is genuinely SUSPENDED, and
        # BEFORE start_workflow() reuses the one workflow slot.
        # Step and entities are both captured, so the paused
        # request stays recoverable exactly where it was.
        # ---------------------------------------------

        else:

            conversation.suspend_workflow()
            conversation.stash_paused_workflow()

            opener = (
                f"Okay, I've paused the {current_name} and you can "
                "come back to it later."
            )

        conversation.clear_workflow_conflict()

        started, response = self.start_workflow(conversation, requested)

        if not started:

            # start_workflow() modified nothing on failure, so the
            # interrupted request is still exactly as this method
            # left it -- cancelled, or paused and snapshotted.
            return f"{opener} {response}"

        return f"{opener} Let's start the {requested_name}. {response}"

    # =====================================================
    # WORKFLOW ACTIVATION
    #
    # The single entry point for starting a banking workflow.
    # A workflow becomes ACTIVE only after its definition has
    # actually been loaded, so a detected intent with no JSON
    # definition (e.g. "check account balance", "open new
    # account") can never move the conversation into ACTIVE and
    # wedge the session.
    # =====================================================

    def start_workflow(self, conversation, intent):
        """
        Attempts to activate the workflow for `intent`.

        Returns (started, response).

        On failure NO conversation state is modified at all: an
        existing valid workflow is preserved untouched, and a
        conversation with no workflow stays in its current
        resting state, so the user can keep asking questions and
        can still start a different, valid service afterwards.
        """

        workflow = self.workflow_loader.load_workflow(intent)

        if workflow is None:

            return False, (
                "I understood your request, but I don't have a "
                "guided procedure for that service yet. You can "
                "still ask me questions about it, or tell me "
                "another banking service you'd like help with."
            )

        conversation.set_intent(intent)
        conversation.load_workflow(intent)

        return True, workflow["steps"][0]["instruction"]

    # =====================================================
    # MAIN DIALOGUE RESPONSE (LLM-assisted path)
    # =====================================================

    def generate_response(self, conversation, user_input=None):

        # =================================================
        # 0. AN OUTSTANDING WORKFLOW CONFLICT  (Phase 3.2B-14)
        #
        # The assistant asked which of three named options the
        # customer wants and is waiting for the answer, so this
        # turn is that answer and nothing else. It is resolved
        # BEFORE any workflow handling, because until it is
        # resolved the workflow in the slot is not what the
        # customer is talking about.
        #
        # The deterministic control words ("cancel", "pause",
        # "continue", and their Kannada and Hindi equivalents)
        # never arrive here -- the routing layer hands those to
        # handle_control_command(), which resolves the conflict
        # through the same _resolve_workflow_conflict(). One
        # implementation, two entry points, exactly like the
        # pause/resume contract above.
        #
        # An answer that selects no option -- including an empty
        # turn -- asks the question again and changes nothing.
        # =================================================

        pending_conflict = self._pending_conflict(conversation)

        if pending_conflict is not None:

            return self._resolve_workflow_conflict(
                conversation,
                pending_conflict,
                self._conflict_choice_from_text(user_input)
            )

        # =================================================
        # 1. CHECK WHETHER THERE IS AN ACTIVE WORKFLOW
        # =================================================

        if conversation.current_workflow is None:

            if user_input:

                response = self.answer_general_question(
                    user_input,
                    conversation
                )

                if response is not None:
                    return response

            return (
                "What banking service would you like help with?"
            )

        workflow = self.workflow_loader.load_workflow(
            conversation.current_workflow
        )

        if workflow is None:

            # Defensive only. start_workflow() refuses to activate
            # a workflow whose definition is missing, so reaching
            # here means the definition disappeared mid-session.
            # Release the workflow slot rather than leaving the
            # conversation ACTIVE with nothing to execute, which
            # would wedge the session permanently.

            conversation.release_workflow()

            return (
                "Sorry, I can no longer access the steps for that "
                "request. Let me know which banking service you'd "
                "like help with."
            )

        steps = workflow["steps"]

        # =================================================
        # 2. WORKFLOW COMPLETED OR CANCELLED
        #
        # Resting states. The assistant session stays fully
        # alive; side questions are still answered; nothing
        # here can advance or reactivate the workflow --
        # starting something new requires a fresh intent,
        # detected by the pipeline before this method is
        # ever called with a resting workflow_state.
        # =================================================

        if conversation.workflow_state in (
            WorkflowState.COMPLETED,
            WorkflowState.CANCELLED
        ):

            status_message = (
                "Your request is already completed."
                if conversation.workflow_state == WorkflowState.COMPLETED
                else "That request was cancelled."
            )

            if not user_input:
                return (
                    f"{status_message} "
                    "Would you like help with anything else?"
                )

            understanding = self.dialogue_understanding.understand(
                user_text=user_input,
                current_workflow=conversation.current_intent,
                current_step=conversation.current_step,
                current_instruction=""
            )

            print("AI Understanding:", understanding)

            # =============================================
            # UNDERSTANDING FAILURE GUARD  (Phase 3.2B-13)
            #
            # `understanding_failed` means the model did not
            # answer at all -- a 400, a timeout, or a reply that
            # was not valid JSON. It is NOT the same as the model
            # saying "I don't know what this is".
            #
            # Live failure this prevents: a Kannada withdrawal
            # request 400'd with "max completion tokens reached
            # before generating a valid document", and the turn
            # fell through to the branches below, which restated
            # the ACTIVE DEPOSIT step as though the customer had
            # agreed to carry on with it. The customer had asked
            # for something else entirely and was never told the
            # request had not been understood.
            #
            # So: change nothing, advance nothing, complete
            # nothing, switch to no other intent -- say plainly
            # that it was not understood and leave the workflow
            # exactly where it was. The next turn is unaffected.
            # =============================================

            if understanding.get("understanding_failed"):

                return (
                    "Sorry, I didn't catch that. "
                    f"{status_message} "
                    "Would you like help with anything else?"
                )

            message_type = understanding.get("type", "unknown")

            if message_type in {"help", "question"}:

                return self.dialogue_understanding.answer_question(
                    question=user_input,
                    workflow_context=(
                        status_message
                        + " Workflow: "
                        + conversation.current_intent
                    ),
                    current_instruction=""
                )

            return (
                f"{status_message} "
                "Would you like help with anything else?"
            )

        # =================================================
        # 3. START WORKFLOW
        # =================================================

        if conversation.current_step == 0:

            conversation.current_step = 1

            return steps[0]["instruction"]

        # =================================================
        # 4. GET CURRENT INSTRUCTION
        # =================================================

        current_step = conversation.current_step

        if current_step > len(steps):

            conversation.complete_workflow()

            return "Workflow Completed."

        current_instruction = steps[
            current_step - 1
        ]["instruction"]

        # =================================================
        # 5. NO USER INPUT
        #
        # This covers the user silently performing the task
        # (e.g. filling in a form). workflow_state and
        # current_step are NOT touched here, regardless of
        # whether the workflow is ACTIVE or SUSPENDED.
        # =================================================

        if not user_input:

            return current_instruction

        # =================================================
        # 6. UNDERSTAND USER MESSAGE
        # =================================================

        understanding = self.dialogue_understanding.understand(
            user_text=user_input,
            current_workflow=conversation.current_intent,
            current_step=current_step,
            current_instruction=current_instruction
        )

        # =================================================
        # UNDERSTANDING FAILURE GUARD  (Phase 3.2B-13)
        #
        # The model did not answer (400 / timeout / unparseable
        # JSON), so this turn carries NO information. Everything
        # below -- completion, cancel, repeat, next, entity
        # capture, step advance -- would be acting on a blank
        # classification.
        #
        # Live failure: a Kannada withdrawal request 400'd with
        # "max completion tokens reached before generating a
        # valid document" while a DEPOSIT workflow was active,
        # and the turn quietly restated the deposit step. The
        # customer's actual request vanished without a word.
        #
        # Restating the current step is still the right thing to
        # SAY (it keeps the customer oriented), but it must be
        # preceded by an honest admission, and no state may move.
        # =================================================

        if understanding.get("understanding_failed"):

            if current_instruction:
                return f"Sorry, I didn't catch that. {current_instruction}"

            return "Sorry, I didn't catch that. Could you say that again?"

        print(
            "AI Understanding:",
            understanding
        )

        message_type = understanding.get(
            "type",
            "unknown"
        )

        action = understanding.get(
            "action",
            "none"
        )

        entities = understanding.get(
            "entities",
            {}
        )

        # ---------------------------------------------
        # Kannada / Hindi spoken amounts (Phase 3.2B-12)
        #
        # The understanding prompt extracts amounts from English
        # and from digits. A Kannada amount spoken as WORDS
        # ("ಐದು ಸಾವಿರ ರೂಪಾಯಿ") came back as None, so a deposit
        # turn carried no amount at all.
        #
        # This only FILLS A GAP: an amount the model already
        # extracted is never overwritten, and the parser returns
        # None rather than guess, so the existing "tell me the
        # amount" path still runs when nothing is certain.
        # ---------------------------------------------

        if isinstance(entities, dict) and entities.get("amount") is None:

            spoken_amount = extract_amount(user_input)

            if spoken_amount is not None:
                entities = dict(entities)
                entities["amount"] = spoken_amount

        # =================================================
        # 7. CANCEL
        # =================================================

        if action == "cancel":

            conversation.cancel_workflow()

            return (
                "Okay, I've cancelled that request. "
                "Let me know if you'd like help with "
                "something else."
            )

        # =================================================
        # 8. REPEAT
        # (does not resume a suspended workflow by itself)
        # =================================================

        # A turn can be classified as repeat AND as a question
        # ("can you repeat what you said about the loan rate?").
        # Asking about information outranks re-stating the current
        # workflow instruction, so those fall through to the
        # help/question branch below. A plain "repeat" -- which the
        # pipeline's deterministic control path already handles
        # before the LLM is ever consulted -- still repeats.

        if (
            action == "repeat"
            and message_type not in {"help", "question"}
        ):

            # Coerced, never trusted raw: the comparison below is
            # `1 <= step_number <= len(steps)`, which raises
            # TypeError on the "3" / 3.0 / True the schema does
            # not actually guarantee against. See
            # coerce_step_number(). An unusable value becomes
            # None and repeats the CURRENT step.
            step_number = coerce_step_number(
                entities.get("step_number")
            )

            # ---------------------------------------------
            # A step of ANOTHER workflow (Phase 3.2B-2)
            #
            # Delegated to the one step-reference handler, which
            # resolves the spoken name through WorkflowLoader and
            # reads that workflow's own definition. Purely
            # informational: the current request is not switched,
            # started, resumed or advanced.
            #
            # Checked BEFORE the same-workflow branch below so an
            # explicitly named workflow always wins over the
            # current one.
            # ---------------------------------------------

            target_workflow = understanding.get("target_workflow")

            if step_number is not None and target_workflow:

                return self._handle_step_reference(
                    conversation,
                    StepReference(
                        step_number=step_number,
                        workflow_phrase=target_workflow
                    )
                )

            # ---------------------------------------------
            # Specific step of the CURRENT workflow
            #
            # Wording deliberately unchanged: this reply has been
            # the bare instruction since the remediation phase and
            # is asserted as such. The deterministic step-
            # reference path (detect_control -> StepReference)
            # adds the state-aware phrasing instead, because it
            # also serves the resting states, where there is no
            # "current step" to be confused with.
            # ---------------------------------------------

            if step_number is not None:

                if 1 <= step_number <= len(steps):

                    return steps[
                        step_number - 1
                    ]["instruction"]

                return (
                    "That step is not available "
                    "in the current workflow."
                )

            # ---------------------------------------------
            # No specific step -> repeat current step
            # ---------------------------------------------

            return current_instruction

        # =================================================
        # 8B. NATURAL-LANGUAGE CONTROL  (type == "control")
        #
        # The deterministic tier (classify_command) handles bare
        # and politely wrapped control commands before the LLM is
        # ever called. Anything reaching here is a control the
        # phrase tables could not name -- "I need to step away
        # for a bit", "let's pick up where we left off" -- which
        # the LLM classified as type = control.
        #
        # The schema's action enum has no pause/resume, so the
        # specific command is recovered from the customer's own
        # words by resolve_control_command(), and the transition
        # is then performed by handle_control_command(): ONE
        # contract, one implementation, reached from both the
        # deterministic and the LLM path.
        #
        # cancel (branch 7), repeat (branch 8) and next_step
        # (branch 12) already have authoritative action branches,
        # so this handles ONLY pause and resume and otherwise
        # falls through untouched.
        #
        # PLACED BEFORE STEP COMPLETION, matching cancel and
        # repeat above. A message that both reports completion
        # and asks to pause honours the pause and lets the
        # completion go, so the customer resumes onto the step
        # they just did. That is this file's established safe
        # direction -- "the worst outcome of a false negative is
        # repeating a step" -- and the alternative is worse: the
        # customer asked to stop and the assistant would move
        # them forward instead.
        # =================================================

        if message_type == "control":

            control_command = resolve_control_command(user_input)

            if control_command is not None:

                return self.handle_control_command(
                    conversation,
                    control_command
                )

        # =================================================
        # 9. EXPLICIT STEP COMPLETION
        #
        # THE ONE PLACE A WORKFLOW STEP EVER ADVANCES.
        #
        # `step_completed` is the schema's dedicated completion
        # signal, independent of type/action, so a single message
        # can report a finished step AND carry a question or a
        # request for direction without either being discarded.
        # Before it existed the scalar `action` forced a choice:
        #
        #   "I filled my account number. What should I do next?"
        #       -> action = next_step, completion thrown away,
        #          and the finished step was re-stated forever.
        #
        #   "I signed the slip. Where do I submit it?"
        #       -> either the question or the completion was lost,
        #          depending on which the model picked.
        #
        # This branch sits BEFORE acknowledgement, question and
        # next_step so completion is never shadowed by whatever
        # else the same sentence contained. It sits AFTER cancel
        # and repeat, which stay authoritative: those fail towards
        # NOT advancing, which is the safe direction for a banking
        # instruction.
        #
        # `action == "complete"` is honoured here too, so an older
        # or partial reply that sets only the action still behaves
        # exactly as it did before.
        #
        # current_step is incremented exactly ONCE per turn, on
        # this path only. There is deliberately no second
        # increment anywhere in this method.
        #
        # DETERMINISTIC COMPLETION RESOLUTION  (Phase 3.2B-4)
        #
        # Completion used to be one LLM field, and it was the only
        # workflow-affecting signal in this file without a
        # deterministic component -- exit, pause, resume, cancel,
        # repeat, next and step references all have one, and even
        # step_number is coerced rather than trusted.
        #
        # resolve_step_completion() reads the customer's own words
        # against the CURRENT INSTRUCTION and returns three values:
        #
        #   True  -- a clause reports THIS step as carried out
        #   False -- every clause is a question, a help request, a
        #            refusal or an intention
        #   None  -- unreadable structurally; the LLM decides,
        #            exactly as it did before this phase
        #
        # The None case is what makes this a correction rather than
        # a replacement. It covers a completion that names
        # something other than the current step ("I completed step
        # 3"), a bare "done", and every non-English utterance, all
        # of which reach dialogue understanding untouched.
        #
        # Entity extraction is NOT involved. entities still come
        # from the model, and are still persisted below, so
        # "I have entered 5000 rupees" can now resolve to
        # step_completed = True here while amount = 5000 arrives
        # from the LLM -- the two signals are finally independent.
        #
        # Placement is unchanged: still AFTER cancel (7), repeat
        # (8) and control (8B), so control priority is preserved by
        # position, and the advancement body below is untouched.
        # =================================================

        resolved_completion = resolve_step_completion(
            user_input,
            current_instruction
        )

        if resolved_completion is None:

            step_completed = (
                understanding.get("step_completed") is True
                or action == "complete"
            )

        else:

            step_completed = resolved_completion

        if step_completed:

            # If the workflow is SUSPENDED, completing a step is a
            # clear engagement signal -- implicitly resume first.
            if conversation.workflow_state == WorkflowState.SUSPENDED:
                conversation.resume_workflow()

            # A completion turn (e.g. "I entered 2000.") can carry
            # an extracted entity even though it isn't classified
            # as message_type == "information" -- persist it here
            # too, so amounts given alongside a completion are
            # never dropped.
            conversation.add_entities(entities)

            conversation.current_step += 1

            # ---------------------------------------------
            # Workflow finished
            # ---------------------------------------------

            if conversation.current_step > len(steps):

                conversation.complete_workflow()

                return "Workflow Completed."

            next_instruction = steps[
                conversation.current_step - 1
            ]["instruction"]

            # ---------------------------------------------
            # Compound message: the customer finished the step
            # AND asked something. Answer the question against
            # the step they are on NOW, then state that step, so
            # both signals are honoured in one reply and the
            # workflow keeps moving.
            # ---------------------------------------------

            if message_type in {"help", "question"}:

                answer = self.handle_question(
                    conversation,
                    workflow,
                    next_instruction,
                    user_input,
                    entities
                )

                return f"{answer} {next_instruction}"

            # ---------------------------------------------
            # Plain completion, or completion plus a request for
            # direction ("...what should I do next?"). Either way
            # the next instruction IS the answer.
            # ---------------------------------------------

            return next_instruction

        # =================================================
        # 10. ACKNOWLEDGEMENT
        # (does not resume a suspended workflow by itself)
        #
        # This branch also covers statements of INTENT about the
        # current step -- "I need to fill this", "I'll fill it",
        # "let me do it". Dialogue understanding classifies those
        # as acknowledgement with action = none and
        # step_completed = false, so they read as engagement with
        # the current step rather than as an unrelated request,
        # and the step is NOT marked complete. Only an actual
        # completion statement ("I filled it") advances the
        # workflow, through branch 9 above.
        # =================================================

        if message_type == "acknowledgement":

            return (
                "Okay. "
                + restate_current_step(current_instruction)
            )

        # =================================================
        # 11. GENERAL BANKING QUESTION / HELP
        #
        # IMPORTANT:
        #
        # Questions must be handled BEFORE next_step, and must
        # never advance or resume the workflow -- ACTIVE stays
        # ACTIVE, SUSPENDED stays SUSPENDED, current_step is
        # untouched either way.
        #
        # =================================================

        if message_type in {
            "help",
            "question"
        }:

            return self.handle_question(
                conversation,
                workflow,
                current_instruction,
                user_input,
                entities
            )

        # =================================================
        # 12. NEXT STEP REQUEST
        #
        # "What should I do next?" and a bare "next" both land
        # here, and neither advances the workflow. The current
        # step IS what the customer has to do next until they
        # give evidence that it is done, so the instruction is
        # restated together with an explicit invitation to
        # confirm completion.
        #
        # "Yes, next." therefore cannot skip a required banking
        # instruction: it is a request for direction, not
        # evidence of completion.
        #
        # If the workflow is SUSPENDED, the user asking what to
        # do next is treated as an implicit resume.
        # =================================================

        if action == "next_step":

            if conversation.workflow_state == WorkflowState.SUSPENDED:

                conversation.resume_workflow()

                return f"Continuing. {current_instruction}"

            return restate_current_step(current_instruction)

        # =================================================
        # 13. INFORMATION PROVIDED BY USER
        #
        # Providing requested information is also an
        # engagement signal -- implicitly resume if suspended.
        # =================================================

        if (
            message_type == "information"
            or action == "provide_information"
        ):

            if conversation.workflow_state == WorkflowState.SUSPENDED:
                conversation.resume_workflow()

            return self.handle_information(
                conversation,
                current_instruction,
                entities
            )

        # =================================================
        # 13B. A NEW BANKING REQUEST DURING THIS ONE
        #      (Phase 3.2B-14)
        #
        # Nothing above claimed this turn. It is not a completion,
        # not a question, not a control, not information, not an
        # acknowledgement and not a request for direction -- so
        # before restating the current step as though the customer
        # had said nothing, ask whether they have just asked for a
        # different banking service.
        #
        # This placement is the whole safety argument. Branches
        # 7-13 keep every turn they already handled, so no existing
        # behaviour changes; only the turns that previously fell to
        # branch 14 or 15 -- the two branches that restate the step
        # with no reason of their own -- reach this check.
        #
        # PLACED BEFORE branch 14 on purpose. `unknown` is the
        # model saying it could not classify the turn, and restating
        # the deposit step on the strength of that is the same
        # silent carry-on this phase exists to remove. A second
        # opinion from the engine's own intent detector is worth
        # more than "Take your time" -- and if the detector
        # abstains too, branch 14 still answers, unchanged.
        #
        # THE ONLY OUTCOME IS A QUESTION. No workflow starts,
        # stops, pauses or advances on this branch.
        # =================================================

        detected_conflict = self._detect_workflow_conflict(
            conversation,
            user_input
        )

        if detected_conflict is not None:

            # A service with no guided procedure is not a choice
            # between two workflows, so there is nothing to ask.
            # Say so plainly and leave the current request exactly
            # where it is -- which is the same honesty
            # start_workflow() already applies in a resting state.

            if not self.workflow_loader.has_workflow(
                detected_conflict.requested_workflow
            ):

                return (
                    "I understood you'd like help with "
                    f"{display_name(detected_conflict.requested_workflow)}"
                    ", but I don't have a guided procedure for that "
                    "yet. Your "
                    f"{display_name(detected_conflict.current_workflow)}"
                    f" is still in progress. {current_instruction}"
                )

            conversation.remember_workflow_conflict(detected_conflict)

            return self._ask_conflict_question(
                conversation,
                detected_conflict
            )

        # =================================================
        # 14. UNCERTAIN / UNKNOWN
        # (workflow_state, ACTIVE or SUSPENDED, is left as-is)
        # =================================================

        if message_type in {
            "uncertain",
            "unknown"
        }:

            return (
                f"Okay. {current_instruction} "
                "Take your time and let me know "
                "when you are ready."
            )

        # =================================================
        # 15. DEFAULT
        # =================================================

        return current_instruction

    # =====================================================
    # GENERAL QUESTION / HELP HANDLER
    # =====================================================

    def handle_question(
        self,
        conversation,
        workflow,
        current_instruction,
        user_input,
        entities
    ):

        """
        Handles general banking questions and help requests.

        Questions do NOT modify the workflow state.

        The question is passed to the knowledge retrieval
        system through DialogueUnderstanding.answer_question().

        BOUNDED SIDE-QUESTION CONTEXT (Phase 3.2B-3)
        --------------------------------------------
        The single remembered exchange is read from the
        conversation before answering and replaced afterwards.

        Neither read nor write touches workflow state: this
        method still does not change workflow_state,
        current_step, current_intent, current_workflow or
        entities, in any state. The remembered exchange is
        session context, not workflow state.
        """

        workflow_context = self.build_workflow_context(
            workflow,
            conversation.current_step
        )

        # Read the one remembered exchange, if any. Passed through
        # unconditionally: answer_question() itself decides whether
        # this question actually contains a reference to resolve,
        # and ignores it otherwise.
        recent_context = getattr(
            conversation,
            "recent_side_question",
            None
        )

        response = self._ask_question_answerer(
            question=user_input,
            workflow_context=workflow_context,
            current_instruction=current_instruction,
            recent_context=recent_context
        )

        self._remember_side_question(
            conversation,
            user_input,
            response
        )

        return response

    # =====================================================
    # CALLING THE QUESTION ANSWERER  (Phase 3.2B-3)
    #
    # `recent_context` is an OPTIONAL parameter on
    # DialogueUnderstanding.answer_question(). The question
    # answerer is an INJECTED collaborator, and an implementation
    # written before this phase has the three-argument signature.
    # Passing an argument it does not accept would raise TypeError
    # and kill the turn.
    #
    # So the keyword is included only when there is context to
    # send AND the collaborator accepts it. Everything else -- no
    # remembered exchange, or an older answerer -- takes the
    # original three-argument call and behaves exactly as before.
    #
    # Deliberately NOT a try/except TypeError retry: a TypeError
    # raised INSIDE answer_question for an unrelated reason would
    # be silently swallowed and the call repeated, doubling an LLM
    # request and hiding a real bug.
    # =====================================================

    def _ask_question_answerer(
        self,
        question,
        workflow_context,
        current_instruction,
        recent_context=None
    ):

        optional = {}

        if recent_context is not None and self._answerer_takes_context():
            optional["recent_context"] = recent_context

        return self.dialogue_understanding.answer_question(
            question=question,
            workflow_context=workflow_context,
            current_instruction=current_instruction,
            **optional
        )

    def _answerer_takes_context(self):
        """
        Whether the injected answer_question() accepts
        `recent_context`. Inspected once per DialogueManager and
        cached -- the collaborator does not change mid-session.
        """

        cached = getattr(self, "_accepts_recent_context", None)

        if cached is None:

            cached = accepts_recent_context(
                self.dialogue_understanding.answer_question
            )

            self._accepts_recent_context = cached

        return cached

    # =====================================================
    # REMEMBERING ONE SIDE-QUESTION EXCHANGE  (Phase 3.2B-3)
    # =====================================================

    def _remember_side_question(self, conversation, question, answer):
        """
        Stores this exchange as THE recent side-question context,
        replacing whatever was there.

        One slot, so nothing accumulates -- see
        side_question_context.next_context() for how a subject is
        carried forward across a chain of references.

        A failed answer is NOT remembered: quoting
        "Sorry, I'm having trouble looking that up right now" back
        as the referent for the next "it" would be worse than
        having no context at all.
        """

        if not question or not answer:
            return

        if answer == QUESTION_UNAVAILABLE_MESSAGE:
            return

        if not hasattr(conversation, "remember_side_question"):
            return

        conversation.remember_side_question(
            next_context(
                getattr(conversation, "recent_side_question", None),
                question,
                answer
            )
        )

    # =====================================================
    # KNOWLEDGE / GENERAL QUESTION ROUTING
    # (called by the pipeline BEFORE intent detection, and by
    # generate_response() as a defensive fallback when no
    # intent is set at all)
    # =====================================================

    def answer_general_question(self, user_input, conversation=None):

        """
        Determines whether `user_input` is a general or banking
        knowledge question -- rather than a request to start a
        specific banking workflow -- and if so, answers it using
        the existing RAG + LLM question-answering path.

        ALSO the last gate before intent detection, and therefore
        responsible for making sure a CONTROL utterance is never
        handed to IntentDetector. See the control guard below.

        `conversation` is optional so the existing pipeline call
        site keeps working unchanged; when it is supplied the
        control guard can answer with the workflow's actual
        status instead of a generic reply.

        Returns the answer string if this was a question, or
        None if the caller should proceed with normal intent
        detection.

        This is NOT a confidence-score decision. A cheap
        English-focused heuristic (looks_like_a_question) first
        decides whether it's even worth asking the LLM; if it
        is, the LLM's own `type` classification (question/help
        vs. workflow_action/information/...) makes the real
        call. Declarative statements -- in any language,
        including Kannada/Hindi banking requests -- never reach
        this classification at all, so this can never reject a
        legitimate banking request the way a numeric confidence
        threshold on IntentDetector would.
        """

        # Two independent reasons to consult the LLM: the
        # utterance looks like a question, or it looks like a
        # control command. Neither decides anything -- both only
        # buy the utterance a classification.
        if not (
            looks_like_a_question(user_input)
            or looks_like_a_control_utterance(user_input)
        ):
            return None

        understanding = self.dialogue_understanding.understand(
            user_text=user_input,
            current_workflow=None,
            current_step=None,
            current_instruction=""
        )

        print("AI Understanding (pre-intent):", understanding)

        message_type = understanding.get("type", "unknown")

        # =============================================
        # CONTROL GUARD
        #
        # A control utterance must NEVER reach IntentDetector.
        #
        # Returning None here means "caller, proceed with intent
        # detection", and IntentDetector is a total function --
        # argmax over five banking labels, no abstention, no
        # threshold -- so EVERY utterance that reaches it becomes
        # a banking request. This method previously discarded
        # every classification that was not help/question, which
        # silently included type = "control". A live smoke test
        # in the COMPLETED state produced exactly that:
        #
        #   "Can you pause for some time?"
        #     -> type=control, action=none
        #     -> discarded, returned None
        #     -> Intent: check account balance | 0.087
        #
        #   "pause for some time"
        #     -> Intent: withdraw money | 0.112
        #     -> Workflow state changed to: active
        #
        # A request to PAUSE started a withdrawal. The action
        # enum has no pause/resume value, so action = "none" is
        # the CORRECT reply for a pause here -- it must never be
        # read as "no meaning found, go and detect an intent".
        #
        # This branch is reached only in a resting state (NONE,
        # COMPLETED, CANCELLED): the pipeline sends ACTIVE and
        # SUSPENDED turns to generate_response() instead, where
        # branch 8B handles control against the live workflow. So
        # there is nothing here to pause, resume or repeat, and
        # the only correct outcome is to say so and change
        # nothing.
        # =============================================

        if message_type == "control":

            return self._handle_resting_state_control(
                user_input,
                conversation
            )

        if message_type not in {"help", "question"}:
            return None

        # The remembered exchange is available only when a
        # conversation was supplied (the generate_response() call
        # site). The pipeline's resting-state call site passes
        # none, so resting-state questions behave exactly as
        # before -- see the known limitations in the docs.
        recent_context = getattr(
            conversation,
            "recent_side_question",
            None
        )

        answer = self._ask_question_answerer(
            question=user_input,
            workflow_context=(
                "No banking workflow is currently active. "
                "Answer general banking questions helpfully."
            ),
            current_instruction="",
            recent_context=recent_context
        )

        if conversation is not None:

            self._remember_side_question(
                conversation,
                user_input,
                answer
            )

        return answer

    # =====================================================
    # NON-BANKING REQUESTS  (Phase 3.2B-12)
    #
    # The terminus for everything IntentDetector abstained on.
    # Reached only from the routing layer, only in a resting
    # state, and it NEVER starts a workflow or mutates
    # conversation state -- that is the whole point of it.
    #
    # Each branch delegates to the handler that already owns
    # that kind of turn, so there is no second implementation of
    # question answering or acknowledgement wording.
    # =====================================================

    def handle_non_banking_request(self, category, user_input,
                                   conversation=None):
        """
        Answers an utterance that is not a banking service request.

        `category` comes from IntentDetector: KNOWLEDGE_QUESTION,
        ACKNOWLEDGEMENT, CONTROL, UNSUPPORTED or OUT_OF_DOMAIN.
        Returns the reply string. Starts no workflow in any case.
        """

        if category == "ACKNOWLEDGEMENT":

            if conversation is not None:
                return self._handle_acknowledgement(
                    conversation,
                    "acknowledgement"
                )

            return "Okay. Let me know which banking service you'd like help with."

        if category == "CONTROL":

            # Controls are normally caught by the deterministic
            # tier long before this. Arriving here means nothing
            # is active to control, which is what this says.
            return self._handle_resting_state_control(
                user_input,
                conversation
            )

        if category == "KNOWLEDGE_QUESTION":

            # The existing RAG + LLM path answers it, and answers
            # "I don't have that information" through its own
            # graceful message when the knowledge base does not
            # cover it. No banking data is invented here.
            # recent_context must be a RecentSideQuestion or None --
            # NOT "". format_recent_context()/retrieval_query() only
            # guard against None, so an empty string reached
            # `recent.subject` and raised
            #   AttributeError: 'str' object has no attribute 'subject'
            # on a live Kannada turn. Reading the remembered exchange
            # off the conversation is also what the other two call
            # sites do, so this path now behaves like them.
            return self._ask_question_answerer(
                question=user_input,
                workflow_context=(
                    "No banking workflow is currently active. "
                    "Answer general banking questions helpfully."
                ),
                current_instruction="",
                recent_context=getattr(
                    conversation,
                    "recent_side_question",
                    None
                )
            )

        # UNSUPPORTED / OUT_OF_DOMAIN.
        #
        # Deliberately one fixed, non-judgemental sentence rather
        # than a lecture or a keyword-specific refusal: the
        # assistant simply does not act on it and offers what it
        # can do. Saying less here is also what keeps this from
        # becoming a blacklist with opinions attached.
        return (
            "I can't help with that. I can help you deposit money, "
            "withdraw money, check your balance, apply for a loan "
            "or open an account. Which would you like?"
        )

    # =====================================================
    # RESTING-STATE CONTROL  (the control guard's handler)
    #
    # A control utterance arriving with no ACTIVE or SUSPENDED
    # workflow. Nothing can be paused, resumed or repeated, so
    # this NEVER mutates state -- it only chooses what to say,
    # and its whole job is to be a safe terminus that stops the
    # utterance short of IntentDetector.
    # =====================================================

    def _handle_resting_state_control(self, user_input, conversation):

        # With the conversation in hand, reuse the ONE
        # implementation of the control contract, so a control
        # utterance recognised by the LLM gets the same reply as
        # the same command recognised deterministically.
        #
        # handle_control_command() routes a resting state to
        # _handle_control_without_workflow(), which reports
        # COMPLETED / CANCELLED by name and mutates nothing.

        if conversation is not None:

            command = resolve_control_command(user_input) or "pause"

            return self.handle_control_command(conversation, command)

        # No conversation supplied (the pipeline's call site).
        # Nothing is active in ANY resting state, so this is true
        # in all of them.

        return (
            "There's no active request to control right now. "
            "Let me know which banking service you'd like "
            "help with."
        )

    # =====================================================
    # INFORMATION HANDLER
    # =====================================================

    def handle_information(
        self,
        conversation,
        current_instruction,
        entities
    ):

        """
        Handles information explicitly provided by the user.

        Information does not automatically advance the
        workflow unless the LLM explicitly determines that
        the current step has been completed. Extracted
        entities are persisted on the conversation so they
        survive a pause/resume cycle.

        HONESTY (Phase 3.2B-1): "I've noted that" is said ONLY
        when something was actually recorded. This branch is
        reached on the LLM's classification of the message as
        information, which is independent of whether it managed
        to EXTRACT anything -- a muffled account number, a
        half-heard amount, or an entity set that is present but
        entirely null all land here. Previously every one of
        those was answered "I've noted that", so the assistant
        issued a receipt for a value it did not hold.

        In a banking workflow that is the expensive kind of
        wrong: the customer believes their account number is
        recorded, stops repeating it, and the session carries an
        empty entity store. Saying plainly that it was not caught
        costs one turn and keeps the customer's model of the
        conversation true.
        """

        useful_entities = {}

        if entities:

            useful_entities = {
                key: value
                for key, value in entities.items()
                if value is not None
            }

        if useful_entities:

            conversation.add_entities(useful_entities)

            print(
                "Information received:",
                useful_entities
            )

            return (
                "I've noted that. "
                + current_instruction
            )

        # Classified as information, but nothing was extracted.
        # The step is NOT advanced and NOT modified -- only the
        # wording changes, so the customer is asked again for the
        # value instead of being told it was stored.

        print("Information received: nothing extractable")

        return (
            "Sorry, I didn't catch that. "
            + current_instruction
        )

    # =====================================================
    # BUILD WORKFLOW CONTEXT
    # =====================================================

    def build_workflow_context(
        self,
        workflow,
        current_step=None
    ):

        """
        Converts the active workflow into context that can
        be supplied to the banking question-answering LLM.

        When `current_step` is supplied, that step is marked, so
        a question about "this" or "here" -- e.g. "where should I
        fill my account number?" -- can be answered against the
        step the customer is actually on instead of against the
        workflow as an undifferentiated list.

        `current_step` is optional so existing callers that pass
        only the workflow keep working unchanged.
        """

        context = []

        for index, step in enumerate(
            workflow["steps"],
            start=1
        ):

            marker = (
                " (current step)"
                if current_step is not None and index == current_step
                else ""
            )

            context.append(
                f"Step {index}{marker}: "
                f"{step['instruction']}"
            )

        return "\n".join(context)
