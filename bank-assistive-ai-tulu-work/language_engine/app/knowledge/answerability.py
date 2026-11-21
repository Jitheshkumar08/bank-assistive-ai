"""Can this question be answered from the knowledge base at all? (Phase 3A)

Run inside DialogueUnderstanding.answer_question, after retrieval and before
the answer model is called -- so only for turns already classified as
questions, never for a workflow request. Three outcomes are decided here
without the model; everything else goes to the model exactly as before.

  ACCOUNT_SPECIFIC  the state of the customer's own account, cheque, loan or
                    application ("Has my cheque cleared?"). The assistant
                    has no account access. Reply: the domain's "no_access".
  DYNAMIC           a current bank- or branch-specific VALUE: a rate, fee,
                    charge, limit, minimum balance, timing or branch code
                    ("What is the interest rate on a home loan?"). Every
                    article says these depend on the bank, and none states
                    one. Reply: "dynamic_information". Only when the
                    evidence contains no figure: a future article that
                    states a verified figure (time_sensitive, verified --
                    see loader.py) goes to the model.
  CLARIFY           a procedural question that names no service, while
                    nothing in the workflow context names one either
                    ("What documents do I need?" at rest). Reply:
                    "clarify_service", which asks which service.

WHY RULES AND NOT A SCORE

The evaluation (evaluation/reports/knowledge_p2_after.md, and again in
knowledge_p3_retrieval.md) found no retrieval-score threshold that separates
answerable from unanswerable questions: the best dev value keeps 95% of
answerable questions and still accepts 40% of unanswerable ones. These
three categories are recognisable from the QUESTION'S FORM instead, and the
patterns were written from the dev split of
evaluation/fixtures/knowledge/knowledge_p3_answer_policy.json only.

LIMITS

The account and clarification patterns are English. The dynamic patterns
also cover a few Kannada, Hindi and romanised-Hindi "how much / what time"
forms, authored by the development assistant and NOT reviewed by a fluent
speaker; anything they miss goes to the model, whose prompt rules 4 and 22
still apply. A concept question ("What is an interest rate?", "What does
minimum balance mean?") is deliberately not DYNAMIC.
"""

import re
from dataclasses import dataclass

from app.dialogue.text_normalization import word_tokens
from app.knowledge.query_preparation import retrieval_queries

ACCOUNT_SPECIFIC = "account_specific"
DYNAMIC = "dynamic"
CLARIFY = "clarify"

REPLY_KEYS = {
    ACCOUNT_SPECIFIC: "no_access",
    DYNAMIC: "dynamic_information",
    CLARIFY: "clarify_service",
}


@dataclass(frozen=True)
class Answerability:
    category: str
    reply_key: str
    reason: str = None


def _compile(patterns):
    return [re.compile(p, re.IGNORECASE) for p in patterns or []]


class AnswerabilityPolicy:
    """
    `config` is the domain's "answerability" section (domain.json):

      account_patterns   regexes for questions about the customer's own state
      dynamic_patterns   regexes for requests for a current value
      concept_patterns   regexes that make a question conceptual (never DYNAMIC)
      generic_words      procedural words that need a service to make sense
      ignore_words       words that do not name a service ("bank", "banking")

    `subject_words` are the words that DO name a service or topic: built by
    the caller from the knowledge manifest's services and topics and the
    terminology table, so a new article's topics count automatically.
    """

    def __init__(self, config=None, subject_words=()):
        config = config or {}
        self.account = _compile(config.get("account_patterns"))
        self.dynamic = _compile(config.get("dynamic_patterns"))
        self.concept = _compile(config.get("concept_patterns"))
        self.generic = set(config.get("generic_words", []))
        ignore = set(config.get("ignore_words", []))
        self.subjects = {w for w in subject_words if w not in ignore and w not in self.generic}

    def names_subject(self, *texts):
        return any(word in self.subjects for text in texts for word in word_tokens(text or ""))

    def assess(self, question, *, evidence_has_figures=False, context_texts=(), has_recent_context=False):
        text = " ".join((question or "").split())
        if not text:
            return None

        for pattern in self.account:
            if pattern.search(text):
                return Answerability(ACCOUNT_SPECIFIC, REPLY_KEYS[ACCOUNT_SPECIFIC], pattern.pattern)

        if not evidence_has_figures and not any(p.search(text) for p in self.concept):
            for pattern in self.dynamic:
                if pattern.search(text):
                    return Answerability(DYNAMIC, REPLY_KEYS[DYNAMIC], pattern.pattern)

        # Underspecified: a procedural word, and no service named anywhere --
        # not in the question, not in the workflow context or current step.
        # A remembered side question may supply the subject, so not then.
        # The question is read through the same Kannada / Hindi / romanised
        # term expansion retrieval uses ("naye khate ke liye ..." names an
        # account), so a service named in another language counts.
        if not has_recent_context:
            words = set(word_tokens(text))
            if words & self.generic and not self.names_subject(*retrieval_queries(text), *context_texts):
                return Answerability(CLARIFY, REPLY_KEYS[CLARIFY], "no service named")

        return None


def for_domain(domain, documents=()):
    """The policy for a domain, with subject words from its articles and terminology."""
    return AnswerabilityPolicy(domain.answerability, subject_words(documents, domain.terminology()))


def subject_words(documents=(), terminology=None, extra=()):
    """Words naming a service or topic, from article metadata and terminology."""
    words = set()
    phrases = list(extra)
    for document in documents or []:
        metadata = document.get("metadata") or {}
        phrases += list(metadata.get("services", [])) + list(metadata.get("topics", []))
    for entry in (terminology or {}).get("terms", []):
        phrases.append(entry.get("term", ""))
        phrases += list(entry.get("heard_as", []))
        if entry.get("alternate"):
            phrases.append(entry["alternate"])
    for phrase in phrases:
        words.update(w for w in word_tokens(phrase) if len(w) > 2)
    return words
