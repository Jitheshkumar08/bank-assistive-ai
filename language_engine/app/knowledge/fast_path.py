"""Answers that are decided before any LLM call.

Two steps, in this order, used by DialogueManager before it asks the model
to classify a turn:

  screen(text)            the request policy. A harmful request, a prompt
                          injection or a request to transact is answered
                          with the domain's fixed reply and goes no further
                          -- not to the classifier, not to retrieval, not to
                          the answer model.
  lookup(text, language)  exact structured knowledge: a spelling from the
                          approved terminology, or an approved FAQ answered
                          from its article section.

WHAT IS ANSWERED IN WHICH LANGUAGE

  - Policy replies are fixed sentences with authored Kannada and Hindi
    renderings (localization_catalog), so they are returned for every
    session language and rendered at the output boundary like any other
    fixed reply.
  - A spelling is answered in every language: in English as a sentence,
    otherwise as the language-neutral "withdrawal: W-I-T-H-D-R-A-W-A-L".
    A clarification ("cheque or check?") is English text, so it is given
    only in English sessions; other sessions take the normal path.
  - FAQ answers are English article text, so they are given only in
    English sessions. A Kannada or Hindi session goes through the answer
    model, which writes in the customer's language from the same article.

Anything not decided here returns None, and the turn proceeds exactly as
it did before this module existed.
"""

from dataclasses import dataclass

from app.domains import load_domain
from app.knowledge.structured import FAQ, SPELLING, SPELLING_CLARIFY, StructuredKnowledge
from app.knowledge.loader import KnowledgeLoader, is_current
from app.observability.latency import stage
from app.policy.request_policy import RequestPolicy

ENGLISH = (None, "", "en")


@dataclass(frozen=True)
class FastAnswer:
    #: A policy category (harmful, prompt_injection, requires_authorization)
    #: or a structured kind (spelling, spelling_clarify, faq).
    kind: str
    reply: str
    #: True when `reply` reads the same in every language (a spelling).
    language_neutral: bool = False
    #: True for a fixed sentence the output boundary renders from the catalog.
    fixed: bool = False
    sources: tuple = ()
    record_id: str = None


class FastPathAnswerer:

    def __init__(self, domain=None, documents=None):
        self.domain = domain or load_domain()
        self.policy = RequestPolicy(self.domain.policy)
        self.structured = StructuredKnowledge(
            faq=self.domain.faq(),
            terminology=self.domain.terminology(),
            documents=documents,
            loader=KnowledgeLoader(self.domain.knowledge_collection),
        )
        for problem in self.structured.problems:
            print(f"[KNOWLEDGE] FAQ record skipped: {problem}")

    def refresh(self, documents=None):
        """Rebuilds the FAQ answers from the (changed) articles."""
        self.structured.rebuild(documents)

    def screen(self, text):
        decision = self.policy.assess(text)
        if decision is None:
            return None
        return FastAnswer(decision.category, self.domain.reply(decision.reply_key), fixed=True)

    def lookup(self, text, language=None):
        english = language in ENGLISH

        with stage("exact_lookup"):
            spelling = self.structured.lookup_spelling(text)
            if spelling is not None:
                if spelling.kind == SPELLING:
                    return FastAnswer(SPELLING, spelling.reply if english else spelling.neutral_reply,
                                      language_neutral=not english, sources=spelling.sources)
                if spelling.kind == SPELLING_CLARIFY and english:
                    return FastAnswer(SPELLING_CLARIFY, spelling.reply)
                return None

            if english:
                faq = self.structured.lookup_faq(text)
                if faq is not None and all(is_current(m) for m in faq.metadata):
                    return FastAnswer(FAQ, faq.reply, sources=faq.sources, record_id=faq.record_id)

        return None
