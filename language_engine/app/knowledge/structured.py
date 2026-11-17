"""Exact answers that need no retrieval ranking and no LLM.

Two kinds, both read from a domain's data files (app/domains/<name>/):

FAQ (faq.json)
    An index of approved questions into knowledge-article SECTIONS. A
    record has no answer text of its own -- the answer is the section text,
    read from the article when the index is built -- so an FAQ answer can
    never contain a fact the knowledge base lacks, always carries its
    source and article version, and changes when the article does.
    Matching is exact after normalisation (case, punctuation, articles,
    polite lead-ins): "Can you tell me what a deposit slip is?" is not an
    exact form, and goes to retrieval like any other question.

TERMINOLOGY (terminology.json)
    Approved spellings. "How do you spell withdrawal?" is answered from the
    table; a word that sounds like two entries ("check" / "cheque") gets a
    clarifying question; a word not in the table is not answered here.

Both lookups are pure functions of the text and the loaded data, so their
results are memoised; rebuild() (after the articles change) clears that.
"""

import re
from dataclasses import dataclass, field
from functools import lru_cache

from app.dialogue.text_normalization import word_tokens
from app.knowledge.loader import KnowledgeLoader

# ---------------------------------------------------------------------------
# Normalisation for exact matching
# ---------------------------------------------------------------------------

_LEAD_INS = (
    "can you please tell me", "could you please tell me", "can you tell me", "could you tell me",
    "please tell me", "tell me", "can you explain", "could you explain", "please explain", "explain",
    "i want to know", "i would like to know", "i'd like to know", "do you know", "please",
)
_ARTICLES = {"a", "an", "the"}
_CONTRACTIONS = {"what's": "what is", "whats": "what is", "what're": "what are"}


def normalize_question(text):
    """A matching key: lower case, no punctuation or articles, no polite lead-in."""
    text = " ".join((text or "").lower().replace("’", "'").split())
    for short, long in _CONTRACTIONS.items():
        text = re.sub(rf"\b{re.escape(short)}(?=\s|$)", long, text)
    text = re.sub(r"[^\w\s'-]", " ", text)
    text = " ".join(text.split())
    changed = True
    while changed:
        changed = False
        for lead in _LEAD_INS:
            if text.startswith(lead + " "):
                text = text[len(lead) + 1:]
                changed = True
    if text.endswith(" please"):
        text = text[: -len(" please")]
    return " ".join(w for w in text.replace("-", " ").split() if w not in _ARTICLES)


def article_sections(content):
    """{heading: body text} for one markdown article (title excluded)."""
    sections, heading, lines = {}, None, []

    def flush():
        if heading is not None:
            sections[heading] = " ".join(" ".join(lines).split())

    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            continue
        if stripped.startswith("#"):
            flush()
            heading, lines = stripped.lstrip("#").strip(), []
        elif stripped and heading is not None:
            lines.append(stripped)
    flush()
    return sections


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

FAQ = "faq"
SPELLING = "spelling"
SPELLING_CLARIFY = "spelling_clarify"


@dataclass(frozen=True)
class StructuredAnswer:
    kind: str
    reply: str
    #: The same answer without English framing, safe to show in any session
    #: language (spelling only), or None.
    neutral_reply: str = None
    sources: tuple = ()
    record_id: str = None
    versions: tuple = field(default=())
    #: The source articles' metadata, so a caller can check freshness at
    #: lookup time (loader.is_current) -- an FAQ is never answered from an
    #: article that has expired since the index was built.
    metadata: tuple = field(default=())


# ---------------------------------------------------------------------------
# Spelling
# ---------------------------------------------------------------------------

#: Words that make a sentence a spelling request, in any session language.
SPELL_CUES = {
    "spell", "spelling", "spelled", "spelt", "spellings",
    "ಸ್ಪೆಲ್ಲಿಂಗ್", "ಸ್ಪೆಲ್", "ಕಾಗುಣಿತ",
    "स्पेलिंग", "स्पेल", "वर्तनी",
}

#: Words that frame a spelling request but are not the word asked about.
_FRAME = {
    "how", "do", "does", "did", "you", "i", "we", "to", "is", "are", "of", "word", "what", "whats",
    "please", "can", "could", "would", "will", "tell", "me", "give", "say", "out", "letter", "letters",
    "by", "for", "the", "a", "an", "correct", "right", "exact", "proper", "this", "in", "english",
    # romanised Hindi / Kannada framing
    "ki", "ka", "ke", "kya", "hai", "batao", "bataiye", "bataye", "kaise", "hoti", "hota", "kar", "karo",
    "heli", "enu", "hege",
    # Kannada / Hindi framing
    "ಹೇಳಿ", "ಏನು", "ಹೇಗೆ", "ಇಂಗ್ಲಿಷ್", "ಪದದ", "ಪದ",
    "क्या", "है", "बताओ", "बताइए", "बताइये", "की", "का", "के", "कैसे", "होती", "होता", "शब्द", "अंग्रेज़ी", "अंग्रेजी",
}

#: A bare reference: the existing side-question context resolves these.
_REFERENCES = {"it", "that", "them", "those", "these", "same", "again"}


def spelling_target(text):
    """
    The word or phrase a spelling request asks about, or None.

    None when the text is not a spelling request, refers back ("spell it
    again" -- the side-question context handles that), or asks about a
    number ("spell 20000 rupees" -- the answering path handles amounts).
    """
    tokens = [t.strip("\"'“”‘’") for t in word_tokens(text)]
    if not any(t in SPELL_CUES for t in tokens):
        return None
    rest = [t for t in tokens if t and t not in SPELL_CUES and t not in _FRAME]
    if not rest or any(t in _REFERENCES for t in rest):
        return None
    if any(ch.isdigit() for t in rest for ch in t):
        return None
    return " ".join(rest)


def spell_out(term):
    """'deposit slip' -> 'D-E-P-O-S-I-T, S-L-I-P'"""
    return ", ".join("-".join(word.upper()) for word in term.split())


# ---------------------------------------------------------------------------
# The index
# ---------------------------------------------------------------------------

class StructuredKnowledge:

    def __init__(self, faq=None, terminology=None, documents=None, loader=None):
        self._faq_data = faq or {}
        self._terminology_data = terminology or {}
        self._loader = loader or KnowledgeLoader()
        self.problems = []
        self.rebuild(documents)

    def rebuild(self, documents=None):
        """(Re)builds both indexes; call after the articles change."""
        documents = documents if documents is not None else self._loader.load_documents()
        articles = {d["source"]: d for d in documents}
        self.problems = []

        self._faq = {}
        self.records = {}
        for record in self._faq_data.get("records", []):
            article = articles.get(record.get("source"))
            if article is None:
                self.problems.append(f"{record.get('id')}: article {record.get('source')!r} is not indexed")
                continue
            sections = article_sections(article["content"])
            missing = [s for s in record.get("sections", []) if not sections.get(s)]
            if missing or not record.get("sections"):
                self.problems.append(f"{record.get('id')}: missing section(s) {missing or '(none named)'}")
                continue
            answer = " ".join(sections[s] for s in record["sections"])
            version = (article.get("metadata") or {}).get("version")
            built = StructuredAnswer(FAQ, answer, sources=(record["source"],), record_id=record["id"],
                                     versions=((record["source"], version),),
                                     metadata=(dict(article.get("metadata") or {}),))
            self.records[record["id"]] = built
            for question in record.get("questions", []):
                self._faq[normalize_question(question)] = built

        self._terms = {}
        for entry in self._terminology_data.get("terms", []):
            term = entry["term"]
            for form in [term] + list(entry.get("heard_as", [])):
                self._terms[" ".join(word_tokens(form))] = entry
        self._ambiguous = {
            " ".join(word_tokens(word)): entry
            for word, entry in self._terminology_data.get("ambiguous", {}).items()
        }

        self.lookup_faq.cache_clear()
        self.lookup_spelling.cache_clear()

    @lru_cache(maxsize=1024)
    def lookup_faq(self, text):
        return self._faq.get(normalize_question(text))

    @lru_cache(maxsize=1024)
    def lookup_spelling(self, text):
        target = spelling_target(text)
        if target is None:
            return None

        ambiguous = self._ambiguous.get(target)
        if ambiguous:
            return StructuredAnswer(SPELLING_CLARIFY, ambiguous["question"])

        entry = self._terms.get(target)
        if entry is None:
            return None

        term = entry["term"]
        letters = spell_out(term)
        shown = term if entry.get("acronym") else term[0].upper() + term[1:]
        reply = f"{shown} is spelled {letters}."
        neutral = f"{term}: {letters}"
        alternate = entry.get("alternate")
        if alternate:
            reply += f" It is also written {alternate}, {spell_out(alternate)}."
            neutral += f" / {alternate}: {spell_out(alternate)}"
        return StructuredAnswer(SPELLING, reply, neutral_reply=neutral, sources=("terminology",))
