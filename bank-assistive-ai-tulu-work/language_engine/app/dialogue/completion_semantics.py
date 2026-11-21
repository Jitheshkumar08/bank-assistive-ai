import re
from types import MappingProxyType


# =========================================================
# DETERMINISTIC COMPLETION SEMANTICS  (Phase 3.2B-4)
#
# WHY THIS MODULE EXISTS
#
# Completion was the ONE workflow-affecting signal in the engine
# with no deterministic component. Session exit, pause, resume,
# cancel, repeat and next all have phrase tables ahead of the LLM
# (classify_command / classify_polite_control); explicit step
# references have their own recognizer (classify_step_reference);
# a control the tables could not name is recovered from the
# customer's own words AFTER the LLM classifies the turn
# (resolve_control_command); even a step NUMBER is coerced rather
# than trusted (coerce_step_number).
#
# Step completion -- the only signal that can ADVANCE a banking
# instruction -- was one boolean field from one model call:
#
#     step_completed = (
#         understanding.get("step_completed") is True
#         or action == "complete"
#     )
#
# Nothing there read the customer's words and nothing read the
# current instruction.
#
# THE OBSERVED FAILURE
#
# The understanding prompt declares step_completed "independent of
# type and action" (rule 64), but type, action, entities and
# step_completed are emitted together, in ONE structured object,
# in ONE pass. Independence is a claim in prose, not a property of
# the mechanism. Two rule families pull against each other for one
# specific sentence shape -- a completion report that also names a
# value or a field:
#
#     extraction (rules 33-37, and rule 28 explicitly:
#       '"I entered 20000" -> information or workflow_action')
#     completion (rules 64-73)
#
# The extraction rules win whenever a number or a field name is
# present, the model commits to type = information, and then emits
# the internally consistent-looking step_completed = false. Live:
#
#     "I have filled in my account number."  -> not completed
#     "I have entered 5000 rupees."          -> not completed
#     "The amount is entered."               -> not completed
#     "I completed the account number."      -> not completed
#
# Every one of those fell to the information branch, where the
# customer who had just reported finished work was answered
# "Sorry, I didn't catch that." and asked to do it again.
#
# WHAT THIS MODULE IS
#
# A deterministic, CURRENT-STEP-AWARE resolver that turns the
# trusted boolean into a THREE-VALUED resolution:
#
#     True   -- confirmed: a clause reports THE CURRENT
#               INSTRUCTION as already carried out
#     False  -- vetoed: the message only asks or intends; no
#               clause reports anything as done
#     None   -- undecided: defer to the LLM, exactly as before
#
# None is the important value. It is what keeps this module a
# correction to the existing semantics rather than a replacement
# for them: anything this file cannot read structurally is handed
# back to dialogue understanding untouched.
#
# WHAT THIS MODULE IS NOT
#
# It is NOT a list of sentences customers say. The gates below key
# on GRAMMATICAL FORM -- verb tense, clause mood, negation scope,
# and token overlap with the active instruction. The only
# vocabularies are closed grammatical classes: past-tense verb
# forms, intention markers, interrogatives, request verbs,
# pronouns and function words. "I have filled in my account
# number" is not matched because it is in a table; it is matched
# because `filled` is a past form, the clause is declarative and
# first-person, and `account number` overlaps the active
# instruction.
#
# ENGLISH ONLY, like every other deterministic tier in this
# engine. Kannada and Hindi completion reports resolve to None and
# continue to depend entirely on the LLM -- a known limitation,
# not a regression.
#
# This module imports nothing from app.dialogue.manager, which
# imports it. The small amount of vocabulary that overlaps
# manager.py (negation tokens, interrogative lead words) is
# duplicated on purpose to keep the dependency one-directional;
# each copy serves a different decision and neither may drift into
# deciding the other's question.
# =========================================================


# ---------------------------------------------------------
# Clause kinds
# ---------------------------------------------------------

# A clause that reports work as already carried out.
REPORT = "report"

# A clause that cannot be a completion report: a question, a
# request for help/spelling, a negated statement, or a statement
# of intention. These are what a veto is built from.
NOT_A_REPORT = "not_a_report"

# Anything else -- a plain statement with no completion verb
# ("twenty thousand"), or a clause carrying conflicting evidence.
# Contributes to neither confirmation nor veto.
UNDECIDED = "undecided"


# ---------------------------------------------------------
# GATE 1 VOCABULARY -- REPORTED-DONE VERB FORMS
#
# Past-tense and past-participle forms ONLY. The bare infinitives
# (fill, enter, sign, submit, complete, take) and the progressives
# (filling, entering, signing) are deliberately ABSENT, and that
# single omission is what separates
#
#     "I filled it"          -> a report
#     "I need to fill this"  -> an intention
#     "I'll fill this"       -> an intention
#     "I am filling it"      -> an intention
#
# without a phrase table. It is a closed grammatical class, not a
# catalogue of customer sentences.
#
# "made" is deliberately excluded: "I made it" is at least as
# likely to mean "I arrived" as "I finished".
# ---------------------------------------------------------

COMPLETION_VERBS = frozenset({
    "filled", "entered", "completed", "finished", "done",
    "signed", "submitted", "took", "taken", "wrote", "written",
    "gave", "given", "collected", "paid", "did", "put", "kept",
    "handed",
})

# Completion verbs that name NO PARTICULAR ACTION. "I completed
# it" and "I finished it" report that something is done without
# saying what was done, so they cannot be checked against the
# instruction's verb and must be checked against its object
# instead. Every other completion verb is specific and must agree
# with the instruction's own verb -- see refers_to_current_step().
GENERIC_COMPLETION_VERBS = frozenset({
    "completed", "finished", "done", "did",
})

# Irregular past forms, so a completion verb can be compared with
# the instruction's imperative. The regular forms need no entry:
# `fill`/`filled`, `enter`/`entered`, `sign`/`signed` and
# `submit`/`submitted` all resolve by prefix.
#
# A closed grammatical table, not a phrase list. Wrapped read-only
# for the same reason every other vocabulary here is a frozenset:
# nothing in this module holds state, so a caller cannot teach it
# a verb at runtime and change how a banking step completes.
IRREGULAR_LEMMAS = MappingProxyType({
    "took": "take",
    "taken": "take",
    "wrote": "write",
    "written": "write",
    "gave": "give",
    "given": "give",
    "did": "do",
    "done": "do",
    "paid": "pay",
    "kept": "keep",
    "put": "put",
    "handed": "hand",
})


# ---------------------------------------------------------
# GATE 2 VOCABULARY -- WHAT CANNOT BE A REPORT
# ---------------------------------------------------------

# Interrogative and auxiliary lead words.
#
# NOTE: have / has / had are deliberately NOT here even though
# they front real questions ("Have you filled it?"). A perfect-
# tense report whose subject Whisper dropped -- "have filled the
# account number" -- would then be read as a question and vetoed.
# Genuine questions of that shape almost always carry the "?" that
# is checked first, so excluding them costs nothing and removes a
# whole class of false veto.
INTERROGATIVE_LEAD_WORDS = frozenset({
    "what", "why", "how", "who", "whom", "whose", "when",
    "where", "which",
    "is", "are", "was", "were", "am",
    "can", "could", "would", "should", "shall",
    "do", "does", "did", "may", "might",
})

# Verbs that front a REQUEST FOR LANGUAGE HELP rather than a
# statement -- "Spell it letter by letter.", "Explain this.",
# "Read it back."
#
# These exist because the single most common side question in this
# project ("Spell 20000 rupees.") is not question-SHAPED: no
# leading interrogative and no "?". Without this, such a request
# would be UNDECIDED and its outcome would depend on the model.
# With it, the veto is deterministic.
REQUEST_LEAD_VERBS = frozenset({
    "spell", "pronounce", "explain", "tell", "show", "read",
    "say", "repeat", "describe", "define", "teach", "guide",
    "translate", "help",
})

# Multi-word markers of INTENTION -- something the customer is
# about to do, not something they have done.
INTENTION_PHRASES = (
    "going to", "gonna", "need to", "needs to", "needed to",
    "have to", "has to", "had to", "want to", "wants to",
    "wanna", "would like to", "about to", "trying to", "try to",
    "planning to", "plan to", "supposed to", "gotta",
    "let me", "lemme",
    "shall i", "should i", "can i", "may i",
)

# Single-word intention markers. The contracted futures are listed
# with and without the apostrophe because Whisper emits both.
INTENTION_WORDS = frozenset({
    "will", "shall", "must",
    "i'll", "ill", "we'll", "well", "you'll", "youll",
    "he'll", "she'll", "they'll",
})

# "I am filling it", "it is being written".
PROGRESSIVE_PATTERN = re.compile(
    r"\b(?:am|is|are|was|were)\s+(?:currently\s+|just\s+|still\s+)?"
    r"[a-z]+ing\b"
)

NEGATION_TOKENS = frozenset({
    "not", "no", "nope", "dont", "don't", "doesnt", "doesn't",
    "didnt", "didn't", "cant", "can't", "cannot", "wont",
    "won't", "shouldnt", "shouldn't", "havent", "haven't",
    "hasnt", "hasn't", "hadnt", "hadn't", "never", "without",
    "neither", "nor", "yet",
})

# How far from a completion verb a negation still governs it.
#
# Scoped rather than clause-wide on purpose. A clause-wide test
# reads "I filled it, I don't know what's next" as a refusal and
# vetoes a genuine completion. Within two tokens covers the forms
# that actually negate the verb -- "haven't filled", "did not
# fill", "not yet entered" -- and leaves an unrelated negation
# elsewhere in the sentence alone.
NEGATION_SCOPE = 2


# A report needs a reporter. Either the customer says they did it,
# or the sentence is passive ("The amount is entered.").
#
# This requirement is what keeps a bare "done" -- with no subject
# and no auxiliary -- UNDECIDED rather than confirmed. manager.py
# states the rule this preserves: "yes" and "done" are deliberately
# excluded from the deterministic acknowledgement table because
# "either can be evidence that the current instruction was carried
# out, and that judgement belongs to dialogue understanding against
# the current instruction -- never to a flat phrase list." The same
# reasoning applies here, so a bare "done" still reaches the LLM.
FIRST_PERSON_MARKERS = frozenset({
    "i", "i've", "ive", "i'm", "im", "i'd", "id",
    "we", "we've", "weve", "my", "our", "me",
})

PASSIVE_AUXILIARIES = frozenset({
    "is", "are", "was", "were", "been", "be", "got", "gets",
})

# Adverbs allowed to sit between the auxiliary and the participle:
# "the amount is already entered".
PASSIVE_ADVERBS = frozenset({
    "already", "now", "just", "all", "fully", "properly",
})


# ---------------------------------------------------------
# GATE 3 VOCABULARY -- WHAT THE REPORT IS ABOUT
# ---------------------------------------------------------

# Bare references. A report whose object is one of these -- or
# which has no object left at all -- is about the step the
# customer is on, by construction: there is nothing else for "it"
# to mean mid-instruction.
#
# DELIBERATELY PRONOMINAL ONLY. "form" and "slip" are NOT here,
# and must not be: "I signed the slip" has to be checked against
# the ACTIVE instruction, or it would complete the amount step of
# a withdrawal just as readily as the signing step. Treating a
# real banking noun as an anaphor would silently destroy the
# current-step authority this module exists to enforce.
ANAPHORIC_OBJECTS = frozenset({
    "it", "this", "that", "these", "those", "them", "they",
    "one", "ones", "everything", "step", "here", "there",
    "thing", "things", "same",
})

# Function words carrying no identifying information when matching
# a clause against an instruction.
#
# Tuned for INSTRUCTIONS (articles, prepositions, auxiliaries,
# politeness), which is why this is not WorkflowLoader's
# MATCH_STOPWORDS -- that set is tuned for workflow NAMES and
# drops "form", "step" and "request", all of which are meaningful
# inside an instruction. Keeping the two separate leaves
# app/workflow/loader.py untouched by this phase.
STOPWORDS = frozenset({
    "i", "i've", "ive", "i'm", "im", "my", "mine", "me",
    "we", "we've", "our", "us", "you", "your", "yours",
    "he", "she", "they", "their", "them", "it", "its",
    "the", "a", "an", "some", "any", "all", "this", "that",
    "is", "are", "was", "were", "be", "been", "being", "am",
    "have", "has", "had", "do", "does",
    "in", "into", "on", "onto", "at", "to", "for", "of", "with",
    "from", "by", "and", "or", "but", "so", "then", "than",
    "now", "up", "out", "over", "down", "off", "as", "about",
    "please", "kindly", "just", "yes", "yeah", "yep", "ok",
    "okay", "alright", "already", "also", "too", "actually",
    "here", "there", "again", "very", "well",
})

# A clause token matches an instruction token when one is a prefix
# of the other and the overlap is at least this long. It is what
# lets `filled` match `fill`, `entered` match `enter` and `signed`
# match `sign` without a stemmer. Kept at 4 so short words must
# match exactly -- the same threshold, and the same reasoning, as
# WorkflowLoader.MIN_PREFIX_MATCH.
MIN_PREFIX_MATCH = 4


_WORD_PATTERN = re.compile(r"[a-z0-9']+")

# Sentence-sized pieces, keeping the terminator so a clause can be
# asked whether it ended in "?".
_SENTENCE_PATTERN = re.compile(r"[^.?!;]+[.?!;]*")

# Connectives that join two independent clauses.
_CONNECTIVE_PATTERN = re.compile(r"\s+(?:but|and then|then i)\s+")


def _normalize(text):
    """Lowercases and folds the curly apostrophe Whisper emits."""

    if not text:
        return ""

    return str(text).strip().lower().replace("’", "'")


def _words(text):
    return _WORD_PATTERN.findall(text)


# =========================================================
# GATE 0 -- CLAUSE SPLITTING
#
# Completion and a request routinely arrive in ONE message:
#
#     "I entered the amount. Where should I submit the slip?"
#
# That sentence ends in a question mark, and branch 9 of
# DialogueManager already advances on it -- it is an asserted
# regression test. Any whole-utterance question test would read it
# as a question and destroy that behaviour.
#
# So every gate below runs PER CLAUSE, and a confirmation in one
# clause outranks a request in another. This is the same
# precedence branch 9 already implements for compound messages.
# =========================================================

def split_clauses(text):
    """
    Splits an utterance into independent clauses, each keeping its
    own terminating punctuation.
    """

    normalized = _normalize(text)

    if not normalized:
        return []

    clauses = []

    for sentence in _SENTENCE_PATTERN.findall(normalized):

        sentence = sentence.strip()

        if not sentence:
            continue

        for part in _CONNECTIVE_PATTERN.split(sentence):

            part = part.strip(" ,")

            if part:
                clauses.append(part)

    return clauses


# =========================================================
# GATE 1 / GATE 2 -- WHAT KIND OF CLAUSE IS THIS?
# =========================================================

def _is_interrogative(clause):

    if clause.rstrip().endswith("?"):
        return True

    words = _words(clause)

    if not words:
        return False

    return words[0] in INTERROGATIVE_LEAD_WORDS


def _is_request(clause):
    """A request for language help -- spelling, wording, reading."""

    words = _words(clause)

    if not words:
        return False

    return words[0] in REQUEST_LEAD_VERBS


def _has_intention_marker(clause, words):

    for phrase in INTENTION_PHRASES:

        if phrase in clause:
            return True

    if any(word in INTENTION_WORDS for word in words):
        return True

    return bool(PROGRESSIVE_PATTERN.search(clause))


def _completion_verb_positions(words):

    return [
        index
        for index, word in enumerate(words)
        if word in COMPLETION_VERBS
    ]


def _negation_governs_completion(words, verb_positions):
    """
    True when a negation sits close enough to a completion verb to
    reverse it. See NEGATION_SCOPE for why this is scoped rather
    than clause-wide.
    """

    for index, word in enumerate(words):

        if word not in NEGATION_TOKENS:
            continue

        for position in verb_positions:

            if abs(position - index) <= NEGATION_SCOPE:
                return True

    return False


def _has_reporter(clause, words, verb_positions):
    """
    True when the clause actually attributes the completed action:
    the customer says they did it, or the sentence is passive.
    """

    if any(word in FIRST_PERSON_MARKERS for word in words):
        return True

    # Passive: "<aux> [adverb] <completed verb>".
    for position in verb_positions:

        if position >= 1 and words[position - 1] in PASSIVE_AUXILIARIES:
            return True

        if (
            position >= 2
            and words[position - 1] in PASSIVE_ADVERBS
            and words[position - 2] in PASSIVE_AUXILIARIES
        ):
            return True

    return False


def classify_clause(clause):
    """
    Classifies ONE clause as REPORT, NOT_A_REPORT or UNDECIDED.

    Decides nothing about the workflow on its own -- whether a
    REPORT refers to the ACTIVE step is Gate 3's question, and it
    is asked separately.
    """

    words = _words(clause)

    if not words:
        return UNDECIDED

    # ---- Gate 2: a question is never a report, even when it
    # ---- contains a number or names the current field.

    if _is_interrogative(clause) or _is_request(clause):
        return NOT_A_REPORT

    verb_positions = _completion_verb_positions(words)

    # ---- Gate 1: no reported-done verb form.

    if not verb_positions:

        # An intention or a refusal about the current step. Both
        # are evidence the step is NOT done, so both may veto.
        if (
            _has_intention_marker(clause, words)
            or any(word in NEGATION_TOKENS for word in words)
        ):
            return NOT_A_REPORT

        # A plain statement with no completion verb -- a bare
        # value ("twenty thousand"), a fragment ("it is uhh").
        # Neither confirms nor vetoes.
        return UNDECIDED

    # ---- Gate 2, continued: the verb is present but reversed.

    if _negation_governs_completion(words, verb_positions):
        return NOT_A_REPORT

    # Conflicting evidence: a completion verb AND an intention
    # marker ("I had to fill it before I filled it"). Never guess
    # in either direction -- hand the whole turn to the LLM.
    if _has_intention_marker(clause, words):
        return UNDECIDED

    # No reporter: a bare "done" or "finished". Deliberately left
    # to dialogue understanding; see FIRST_PERSON_MARKERS.
    if not _has_reporter(clause, words, verb_positions):
        return UNDECIDED

    return REPORT


# =========================================================
# GATE 3 -- DOES THE REPORT REFER TO THE CURRENT STEP?
#
# THE CURRENT INSTRUCTION IS THE AUTHORITY.
#
# A completion report is only a completion of THIS step when it is
# about THIS step. "I have entered 5000 rupees" completes "Enter
# the withdrawal amount." It must not complete "Fill in your
# account number." -- the customer is ahead of themselves, and
# advancing would skip a required banking instruction.
#
# An instruction is an imperative, so its shape is known: the
# first identifying token is its VERB and the last is its OBJECT
# HEAD.
#
#     "Fill in your account number."   -> fill   ... number
#     "Enter the withdrawal amount."   -> enter  ... amount
#     "Sign the withdrawal slip."      -> sign   ... slip
#
# Three ways a report qualifies:
#
#   1. Its object is bare or pronominal ("I filled it", "I did
#      that", "I completed this step"). There is nothing else
#      "it" can mean while an instruction is on the table.
#
#   2. Its completion verb agrees with the instruction's verb:
#      `entered` against `enter`, `signed` against `sign`, `took`
#      against `take`. That is direct evidence the customer did
#      the thing they were asked to do.
#
#   3. Its completion verb is GENERIC ("I completed the account
#      number") and so says nothing about the action -- so the
#      OBJECT HEAD must match instead.
#
# WHY NOT PLAIN TOKEN OVERLAP. The first implementation accepted
# any overlapping token, and "I signed the withdrawal slip"
# completed the AMOUNT step, because `withdrawal` appears in four
# of the five withdrawal instructions. A workflow's own qualifier
# word carries no step-identifying information -- it is the
# instruction-level equivalent of the "money" that
# WorkflowLoader.MATCH_STOPWORDS already refuses to match names
# on. Anchoring to the verb and the object head ignores such
# middle modifiers without needing to know which words they are,
# so nothing here is workflow-specific.
#
# A report that qualifies under NONE of the three resolves to
# None, NOT to False. "I completed step 3" names a step number
# rather than the instruction's own words, and has advanced the
# workflow through the LLM since Phase 3.2B-2. Vetoing it here
# would break that; deferring leaves it exactly as it was.
# =========================================================

def _ordered_content_tokens(text):

    return [
        word
        for word in _words(text)
        if word not in STOPWORDS
    ]


def _content_tokens(text):

    return set(_ordered_content_tokens(text))


def _tokens_match(left, right):

    if left == right:
        return True

    shorter, longer = sorted((left, right), key=len)

    if len(shorter) < MIN_PREFIX_MATCH:
        return False

    return longer.startswith(shorter)


def _object_is_bare(words):
    """
    True when nothing identifying is left once the subject, the
    completion verb and any pronoun are removed.
    """

    for word in words:

        if word in STOPWORDS:
            continue

        if word in COMPLETION_VERBS:
            continue

        if word in ANAPHORIC_OBJECTS:
            continue

        return False

    return True


def _verb_matches(completion_verb, instruction_verb):
    """
    True when a past form names the same action as an
    instruction's imperative.
    """

    if _tokens_match(completion_verb, instruction_verb):
        return True

    lemma = IRREGULAR_LEMMAS.get(completion_verb)

    if lemma is None:
        return False

    return lemma == instruction_verb or _tokens_match(
        lemma,
        instruction_verb
    )


def refers_to_current_step(clause, instruction):
    """
    True when a REPORT clause is about the active instruction.

    `instruction` is the current step's text. Only its verb and
    its object head are consulted; see the block comment above for
    why an arbitrary shared token is not enough.
    """

    words = _words(clause)

    # 1. A bare or pronominal object can only mean this step.
    if _object_is_bare(words):
        return True

    instruction_words = _ordered_content_tokens(_normalize(instruction))

    if not instruction_words:
        return False

    instruction_verb = instruction_words[0]
    instruction_head = instruction_words[-1]

    completion_verbs = [
        word
        for word in words
        if word in COMPLETION_VERBS
    ]

    # 2. The action itself matches the instruction's verb.
    for verb in completion_verbs:

        if _verb_matches(verb, instruction_verb):
            return True

    # 3. A generic completion says nothing about the action, so
    #    the object head has to carry it.
    if any(
        verb in GENERIC_COMPLETION_VERBS
        for verb in completion_verbs
    ):

        return any(
            _tokens_match(clause_token, instruction_head)
            for clause_token in _content_tokens(clause)
        )

    return False


# =========================================================
# THE RESOLVER
# =========================================================

def resolve_step_completion(text, current_instruction):
    """
    Resolves whether `text` reports the CURRENT INSTRUCTION as
    carried out.

    Returns:

        True   -- confirmed. A clause reports the active step done.
        False  -- vetoed. Every clause is a question, a request for
                  help, a refusal or an intention, so nothing in
                  the message reports work as finished.
        None   -- undecided. The caller must fall back to the LLM's
                  own step_completed / action, unchanged.

    None is returned for anything structurally unreadable,
    including a completion report that names something OTHER than
    the current step. This resolver narrows the question; it never
    answers one it cannot read.
    """

    if not text or not str(text).strip():
        return None

    # With no active instruction there is no step to complete and
    # nothing for Gate 3 to be authoritative about.
    if not current_instruction or not str(current_instruction).strip():
        return None

    clauses = split_clauses(text)

    if not clauses:
        return None

    instruction = _normalize(current_instruction)

    saw_report = False
    saw_undecided = False

    for clause in clauses:

        kind = classify_clause(clause)

        if kind == REPORT:

            saw_report = True

            # Gate 0's precedence: one confirming clause outranks
            # every request in the same message, so compound
            # "completion + question" turns keep working.
            if refers_to_current_step(clause, instruction):
                return True

        elif kind == UNDECIDED:

            saw_undecided = True

    # Something was reported done, but not this step. Defer.
    if saw_report or saw_undecided:
        return None

    # Every clause was a question, a help request, a refusal or an
    # intention. Nothing here reports finished work.
    return False
