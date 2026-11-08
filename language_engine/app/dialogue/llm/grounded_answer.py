"""Answers written ONLY from retrieved evidence, and checked against it (Phase 4).

Banking's knowledge answers (DialogueUnderstanding.answer_question) are
unchanged. A domain whose answers must never invent facts -- College fees,
dates, eligibility rules, policies -- uses this instead. Three guards, in
order:

1. NO EVIDENCE, NO MODEL CALL. The caller only gets here when retrieval said
   the question is answerable from the institution's verified documents in
   the asked category (domain_retrieval.py). Otherwise it answers with its
   fixed "no verified information" reply and the LLM is never asked.

2. THE MODEL MAY DECLINE. The prompt allows the evidence as the ONLY source
   and requires the exact token NO_ANSWER when the evidence does not answer
   the question. This is what catches a near-topic question: retrieval found
   the right category, the documents in it do not contain the answer.

3. EVERY NUMBER MUST BE IN THE EVIDENCE. Fees, dates, deadlines, ranks and
   percentages are numbers. An answer containing a number (Western, Kannada
   or Devanagari digits; thousands separators ignored) that does not occur
   in the evidence is rejected as ungrounded. A model that "rounds", adds a
   year or recalls a fee from elsewhere is caught here, deterministically.

The validation result says which guard fired, so the caller can log it as an
unanswered question. Numbers written out in words cannot be checked this way
(a documented limitation).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence

from app.dialogue.llm.answer_language import ANSWER_LANGUAGES, answer_language

#: The same model and settings as the Banking answer path
#: (dialogue_understanding.py), so both domains behave alike.
ANSWER_MODEL = "openai/gpt-oss-20b"
ANSWER_MAX_COMPLETION_TOKENS = 1024

NO_ANSWER = "NO_ANSWER"

#: Answers longer than this are not answers to a student's question.
MAX_ANSWER_CHARS = 1200

GROUNDED = "grounded"
DECLINED = "model_declined"
UNGROUNDED_NUMBER = "ungrounded_number"
EMPTY = "empty_answer"
FAILED = "answer_failed"

_DIGIT_MAP = str.maketrans("೦೧೨೩೪೫೬೭೮೯०१२३४५६७८९", "01234567890123456789")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def numbers_in(text: str, *, parts: bool = True) -> set:
    """
    Every number in `text`, digits normalised, thousands separators dropped
    (11,111 == 11111). With `parts`, the pieces of a separated number are
    included too ("1,50,000" also yields "1", "50", "000"), which is what the
    EVIDENCE side wants; an ANSWER's numbers are compared whole.
    """
    folded = (text or "").translate(_DIGIT_MAP)
    out = set()
    for match in _NUMBER.findall(folded):
        out.add(match.replace(",", ""))
        if parts:
            out.update(part for part in re.split(r"[.,]", match) if part)
    return out


@dataclass
class GroundedAnswer:
    text: Optional[str]
    status: str
    unsupported_numbers: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == GROUNDED


def validate_answer(answer: Optional[str], evidence: Sequence[str]) -> GroundedAnswer:
    """Applies guards 2 and 3 to a model answer. Pure; no model needed."""
    text = (answer or "").strip()

    if not text:
        return GroundedAnswer(None, EMPTY)
    if NO_ANSWER in text.upper().replace(" ", "_"):
        return GroundedAnswer(None, DECLINED)

    allowed = set()
    for passage in evidence:
        allowed |= numbers_in(passage)

    unsupported = sorted(n for n in numbers_in(text, parts=False) if n not in allowed)
    if unsupported:
        return GroundedAnswer(None, UNGROUNDED_NUMBER, unsupported)

    return GroundedAnswer(text[:MAX_ANSWER_CHARS], GROUNDED)


def language_rules(language: str) -> str:
    code = answer_language(language)
    name, script = ANSWER_LANGUAGES[code]
    if code == "en":
        return "Answer in English."
    return (
        f"Answer in {name}, written in {script}. Keep digits, amounts, dates, course codes, "
        "names of people, buildings and offices, and the institution's own terms exactly as they "
        "appear in the evidence."
    )


def build_prompt(question: str, passages: Sequence[dict], language: str) -> str:
    evidence = "\n\n".join(
        f"[{index}] {p.get('title') or p.get('source')}\n{p['content']}"
        for index, p in enumerate(passages, start=1)
    )
    return f"""
Answer the student's question using ONLY the EVIDENCE below.

RULES
1. The evidence is the only source. Do not use outside knowledge about any
   college, university, exam or government scheme.
2. Never state a fee, amount, date, deadline, eligibility rule, seat number,
   percentage or policy unless it is written in the evidence. Copy numbers
   exactly as written.
3. If the evidence does not answer the question, reply with exactly
   {NO_ANSWER} and nothing else.
4. Be brief: two or three sentences.
5. {language_rules(language)}

EVIDENCE
{evidence}

QUESTION
{question}
""".strip()


def _default_client():
    from groq import Groq

    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GROQ_API_KEY environment variable is not set.")
    return Groq(api_key=key)


class GroundedAnswerer:
    """Asks the model for an evidence-only answer and validates it."""

    def __init__(self, persona: str, client=None, client_factory: Callable = _default_client) -> None:
        self.persona = persona
        self._client = client
        self._client_factory = client_factory

    @property
    def client(self):
        if self._client is None:
            self._client = self._client_factory()
        return self._client

    def answer(self, question: str, passages: Sequence[dict], language: str) -> GroundedAnswer:
        if not passages:
            return GroundedAnswer(None, DECLINED)

        code = answer_language(language)
        name, script = ANSWER_LANGUAGES[code]

        try:
            response = self.client.chat.completions.create(
                model=ANSWER_MODEL,
                messages=[
                    {"role": "system", "content": f"{self.persona} Always answer in {name} ({script})."},
                    {"role": "user", "content": build_prompt(question, passages, language)},
                ],
                temperature=0,
                max_completion_tokens=ANSWER_MAX_COMPLETION_TOKENS,
            )
            content = response.choices[0].message.content
        except Exception as error:  # noqa: BLE001 - one safe failure for every provider error
            print(f"[LLM] Grounded answer failed ({type(error).__name__})")
            return GroundedAnswer(None, FAILED)

        return validate_answer(content, [p["content"] for p in passages])
