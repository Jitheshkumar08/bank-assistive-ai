"""
M7 -- KNOWLEDGE-ANSWER LOCALISATION

Regression tests for:

  app/knowledge/retriever.py           section chunks, article scoring
  app/knowledge/query_preparation.py   the knowledge-base glossary
  app/dialogue/llm/answer_language.py  the answer-language instruction
  dialogue_understanding.answer_question  the prompt that reaches the LLM
  manager / voice_pipeline             the session language reaching it,
                                       and the knowledge-answer + step reply

WHAT THESE TESTS DO NOT SHOW

The LLM is replaced by a client that RECORDS what it is sent. These tests
prove the right instruction, knowledge and question reach the model. They do
not, and cannot, prove the model answers in Kannada or Hindi -- that needs
the live LLM, which no offline suite calls.

Offline: the local embedding model is loaded for the retrieval tests (no
network); no Groq, no network.

Run from language_engine/:

    python -m debugging.test_m7_knowledge
"""

import contextlib
import io
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from app.conversation.manager import ConversationManager
from app.dialogue.llm.answer_language import (
    answer_language, answer_language_rules, answer_language_system_note,
)
from app.dialogue.llm.dialogue_understanding import DialogueUnderstanding, QUESTION_UNAVAILABLE_MESSAGE
from app.dialogue.localization import (
    FALLBACK, GENERATED, MIXED, GeneratedText, UNTRANSLATED_MARKER, compose, localize_detailed,
)
from app.dialogue.localization_catalog import INSTRUCTIONS
from app.dialogue.manager import DialogueManager, mark_generated, strip_instruction
from app.dialogue.text_normalization import routing_text
from app.knowledge.loader import KnowledgeLoader
from app.knowledge.query_preparation import GLOSSARY, knowledge_terms, retrieval_queries
from app.knowledge.retriever import META_SECTIONS, chunk_document


PASSED = []
FAILED = []

ROOT = Path(__file__).resolve().parent.parent
DOCUMENTS = KnowledgeLoader().load_documents()


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


_MODEL = None
_RETRIEVERS = {}


def model():
    global _MODEL
    if _MODEL is None:
        with contextlib.redirect_stdout(io.StringIO()):
            from app.knowledge.embedding_model import get_embedding_model
            _MODEL = get_embedding_model()
    return _MODEL


def retriever(scoring="mean", expand=True):
    key = (scoring, expand)
    if key not in _RETRIEVERS:
        from app.knowledge.retriever import KnowledgeRetriever
        with contextlib.redirect_stdout(io.StringIO()):
            _RETRIEVERS[key] = KnowledgeRetriever(model=model(), scoring=scoring, expand_queries=expand)
    return _RETRIEVERS[key]


# =========================================================
# 1  CHUNKING
# =========================================================

def test_every_section_is_chunked_and_fits_the_model():
    tokenizer = model().tokenizer
    longest, missing = 0, []
    for doc in DOCUMENTS:
        chunks = chunk_document(doc["source"], doc["content"])
        headings = [l.lstrip("#").strip() for l in doc["content"].splitlines() if l.startswith("## ")]
        for heading in headings:
            if not any(c["heading"] == heading for c in chunks):
                missing.append(f"{doc['source']}: {heading}")
        for chunk in chunks:
            longest = max(longest, len(tokenizer(chunk["text"])["input_ids"]))
            if not chunk["text"].startswith(chunk["title"]):
                missing.append(f"{doc['source']}: chunk without its title")
    check("every '## ' section of every article becomes a chunk", not missing, "; ".join(missing))
    check(f"no chunk exceeds the model's 128-token window (longest {longest})", longest <= 128)


def test_meta_sections_are_not_indexed():
    indexed = {c["heading"] for c in retriever().chunks}
    check("'Questions' sections are left out of the index", not (indexed & META_SECTIONS))


# =========================================================
# 2  QUERY PREPARATION
# =========================================================

def test_glossary_terms_come_from_the_knowledge_base():
    corpus = " ".join(d["content"].lower() for d in DOCUMENTS)
    absent = [term for term in GLOSSARY if term not in corpus]
    check("every glossary term appears in the knowledge base", not absent, f"{absent}")


def test_knowledge_terms():
    for text, expected in (
        ("ಸಾಲ ಪಡೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು", ["loan", "documents"]),
        ("ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು", ["deposit", "slip"]),
        ("जमा पर्ची क्या होती है", ["deposit", "slip"]),
        ("ಖಾತೆ ಪುಸ್ತಕದಲ್ಲಿ ಏನು ಇರುತ್ತದೆ", ["passbook", "account"]),
        ("बचत खाते की ब्याज दर", ["savings", "account", "interest"]),
        ("loan ke liye kya documents chahiye", []),            # English words already
    ):
        got = knowledge_terms(text)
        check(f"{text!r} -> {expected}", got == expected, f"got {got}")


def test_ambiguous_words_are_not_glossed():
    for text in ("ಹಣ ತೆಗೆಯಬೇಕು", "ಖಾತೆ ತೆಗೆಯಬೇಕು", "ಬ್ಯಾಲೆನ್ಸ್ ಚೆಕ್", "ಸಾಲಿನಲ್ಲಿ ನಿಲ್ಲಬೇಕು"):
        terms = knowledge_terms(text)
        check(f"no withdraw / cheque / queue reading in {text!r}",
              "withdrawal" not in terms and "cheque" not in terms and "loan" not in terms, f"{terms}")


def test_the_original_question_is_kept():
    q = "ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು"
    queries = retrieval_queries(q)
    check("the question itself is searched first, unchanged", queries[0] == q)
    check("English terms are an extra query", queries[1:] == ["deposit slip"], f"{queries}")
    check("an English question is searched once", retrieval_queries("what is a deposit slip") == ["what is a deposit slip"])


# =========================================================
# 3  RETRIEVAL
# =========================================================

def test_search_contract():
    results = retriever().search("what is a deposit slip", top_k=2)
    content = {d["source"]: d["content"] for d in DOCUMENTS}
    check("two results", len(results) == 2)
    check("best first", results[0]["score"] >= results[1]["score"])
    check("whole articles are returned, not fragments",
          all(r["content"] == content[r["source"]] for r in results))
    check("the expected article is first", results[0]["source"] == "deposit_slip.md", results[0]["source"])
    check("keys kept and added", all({"source", "content", "score", "section", "query"} <= set(r) for r in results))
    check("deterministic", retriever().search("what is a deposit slip", top_k=2) == results)


LATE_SECTION_PROBE = (
    ("what is a secured loan", "loan_basics.md"), ("what is the tenure of a loan", "loan_basics.md"),
    ("how are loan instalments paid", "loan_basics.md"), ("what are the common types of loans", "loan_basics.md"),
    ("is there an initial deposit when opening an account", "account_opening_requirements.md"),
    ("what happens after my account is opened", "account_opening_requirements.md"),
    ("how do I keep my cheque book safe", "cheque_book.md"), ("how do I request a cheque book", "cheque_book.md"),
    ("how is a passbook different from a statement", "passbook.md"),
    ("what electronic transfer systems are there", "bank_transfer.md"),
    ("does the bank give debit cards", "banking_services.md"),
    ("does the bank keep records of my transactions", "banking_services.md"),
    ("what other identifiers are related to an account number", "account_number.md"),
    ("ಸಾಲದ ಕಂತು ಹೇಗೆ ಪಾವತಿಸುವುದು", "loan_basics.md"), ("ऋण की अवधि क्या होती है", "loan_basics.md"),
    ("ಖಾತೆ ತೆರೆಯುವಾಗ ಆರಂಭಿಕ ಠೇವಣಿ ಬೇಕೇ", "account_opening_requirements.md"),
)


def test_late_sections_are_found():
    def top1(r):
        return sum(1 for q, src in LATE_SECTION_PROBE if r.search(routing_text(q), 1)[0]["source"] == src)

    whole, mean = top1(retriever("whole")), top1(retriever("mean"))
    check(f"late-section questions: mean scoring {mean}/16 beats whole-article {whole}/16", mean > whole)
    check("at least 14 of 16 late-section questions find their article", mean >= 14, f"{mean}")


def test_dev_retrieval_does_not_regress():
    dev = [f for name in ("multilingual_v1", "m3_language_cues", "m4_heldout", "m5_fresh")
           for f in json.loads((ROOT / "evaluation" / "fixtures" / f"{name}.json").read_text(encoding="utf-8"))["fixtures"]
           if f["category"] == "knowledge_question" and f["expected"]["sources"]]
    top1 = sum(1 for f in dev if retriever().search(routing_text(f["text"]), 1)[0]["source"] in f["expected"]["sources"])
    # 60 / 71 before M7 (whole articles, no glossary); 67 / 71 measured with M7.
    check(f"dev top-1 {top1}/{len(dev)} is at least 67", top1 >= 67)


# =========================================================
# 4  THE ANSWER-LANGUAGE INSTRUCTION
# =========================================================

def test_instruction_text():
    kn, hi, en = answer_language_rules("kn"), answer_language_rules("hi"), answer_language_rules("en")
    check("Kannada: language and script named", "Answer in Kannada, written in Kannada script" in kn)
    check("Kannada: not English, not transliterated", "do not answer in English" in kn and "Latin alphabet" in kn)
    check("Kannada: the fallback is in Kannada too", "say so in Kannada" in kn)
    check("Hindi: Devanagari named", "Answer in Hindi, written in Devanagari script" in hi)
    check("English: a plain instruction", en.endswith("Answer in English."))
    for raw, code in (("kn", "kn"), ("KN-IN", "kn"), ("hi", "hi"), (None, "en"), ("fr", "en"), ("", "en")):
        check(f"answer_language({raw!r}) == {code!r}", answer_language(raw) == code)
    check("system note repeats the language", answer_language_system_note("kn") == "Always answer in Kannada (Kannada script).")


class RecordingClient:
    """Stands in for Groq. Records the request; returns a fixed answer."""

    def __init__(self, answer="ANSWER", fail=False):
        self.requests, self.answer, self.fail = [], answer, fail
        self.chat = self
        self.completions = self

    def create(self, **request):
        self.requests.append(request)
        if self.fail:
            raise RuntimeError("network down")
        message = type("M", (), {"content": self.answer})()
        choice = type("C", (), {"message": message, "finish_reason": "stop"})()
        return type("R", (), {"choices": [choice]})()


class FixedRetriever:
    def __init__(self, results):
        self.results, self.queries = results, []

    def search(self, query, top_k=2):
        self.queries.append(query)
        return list(self.results)


def understanding(answer="ANSWER", results=None, fail=False):
    u = DialogueUnderstanding.__new__(DialogueUnderstanding)
    u.client = RecordingClient(answer, fail)
    u.knowledge_retriever = FixedRetriever(results if results is not None else
                                           [{"source": "deposit_slip.md", "content": "DEPOSIT SLIP ARTICLE", "score": 0.7}])
    return u


def test_prompt_reaches_the_model():
    for language, needle in (("kn", "Answer in Kannada, written in Kannada script"),
                             ("hi", "Answer in Hindi, written in Devanagari script"),
                             (None, "Answer in English.")):
        u = understanding()
        answer = u.answer_question("ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು", "No workflow.", "", response_language=language)
        request = u.client.requests[-1]
        system, prompt = request["messages"][0]["content"], request["messages"][1]["content"]
        check(f"[{language}] the language rule is in the prompt", needle in prompt)
        check(f"[{language}] the system message names the language",
              answer_language_system_note(language) in system)
        check(f"[{language}] the customer's question is in the prompt as asked", "ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು" in prompt)
        check(f"[{language}] the retrieved article is in the prompt", "DEPOSIT SLIP ARTICLE" in prompt)
        check(f"[{language}] the no-invention rules are still there",
              "Never state bank-specific or branch-specific facts" in prompt
              and "Never invent a form layout" in prompt)
        check(f"[{language}] the do-not-repeat-the-step rule is there",
              "Do not repeat the CURRENT STEP instruction" in prompt)
        check(f"[{language}] the model's answer is returned", answer == "ANSWER")


def test_retrieval_query_is_the_question():
    u = understanding()
    u.answer_question("ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು", "No workflow.", "", response_language="kn")
    check("retrieval is asked with the question itself (the glossary is applied inside search)",
          u.knowledge_retriever.queries == ["ಠೇವಣಿ ಚೀಟಿ ಎಂದರೇನು"])


def test_safe_fallbacks_are_unchanged():
    u = understanding(fail=True)
    check("an LLM failure gives the fixed unavailable message",
          u.answer_question("q", "c", "", response_language="kn") == QUESTION_UNAVAILABLE_MESSAGE)
    check("that message has a Kannada rendering (M6)",
          localize_detailed(QUESTION_UNAVAILABLE_MESSAGE, "kn")[1] == "translated")

    u = understanding(results=[])
    u.answer_question("gold rate today", "c", "", response_language="kn")
    prompt = u.client.requests[-1]["messages"][1]["content"]
    check("with nothing retrieved, the 'say you do not have that information' rule is in the prompt",
          "say that you do not have that" in prompt)


# =========================================================
# 5  THE SESSION LANGUAGE REACHES THE ANSWERER
# =========================================================

class LanguageAwareAnswerer:
    def __init__(self, answer="ANSWER"):
        self.calls, self.answer = [], answer

    def answer_question(self, question, workflow_context, current_instruction,
                        recent_context=None, response_language=None):
        self.calls.append(response_language)
        return self.answer

    def understand(self, **kwargs):
        return {"type": "question", "action": "explain", "step_completed": False, "entities": {}}


class OldAnswerer:
    """The pre-M7 three/four-argument signature."""

    def __init__(self):
        self.calls = 0

    def answer_question(self, question, workflow_context, current_instruction, recent_context=None):
        self.calls += 1
        return "OLD"


def dialogue_with(answerer):
    from app.workflow.loader import WorkflowLoader
    d = DialogueManager.__new__(DialogueManager)
    d.dialogue_understanding = answerer
    d.workflow_loader = WorkflowLoader()
    d.intent_detector = None
    return d


def test_language_reaches_the_answerer():
    a = LanguageAwareAnswerer()
    d = dialogue_with(a)
    conversation = ConversationManager()
    conversation.language = "kn"

    reply = d.handle_question(conversation, d.workflow_loader.load_workflow("deposit money"), "", "q", {})
    check("handle_question asks in the conversation's language", a.calls[-1] == "kn")
    check("the answer is marked as LLM text, with its language",
          isinstance(reply, GeneratedText) and reply.language == "kn")

    d.answer_general_question("what is a cheque book?", language="hi")
    check("the resting-state question path asks in the passed language", a.calls[-1] == "hi")

    d.handle_non_banking_request("KNOWLEDGE_QUESTION", "q", conversation)
    check("a knowledge question routed by the detector asks in the session language", a.calls[-1] == "kn")


def test_older_answerers_still_work():
    old = OldAnswerer()
    d = dialogue_with(old)
    conversation = ConversationManager()
    conversation.language = "kn"
    reply = d.handle_question(conversation, d.workflow_loader.load_workflow("deposit money"), "", "q", {})
    check("an answerer without response_language is called as before", old.calls == 1 and reply == "OLD")


def test_pipeline_passes_the_session_language():
    from debugging.test_service_turn import make_runtime, fresh_conversation

    class Detector:
        def detect_intent(self, text):
            return {"intent": "deposit money", "confidence": 0.1, "category": "KNOWLEDGE_QUESTION",
                    "is_banking_intent": False, "margin": -0.2, "evidence": []}

    a = LanguageAwareAnswerer("ಚೆಕ್ ಬುಕ್ ಎಂದರೆ ಚೆಕ್‌ಗಳ ಪುಸ್ತಕ.")
    runtime = make_runtime(Detector(), a)
    conversation = fresh_conversation("kn")
    from app.dialogue.localization import ResponseLocalizer
    result = runtime.run_turn(conversation, "what is a cheque book?", ResponseLocalizer("kn"))
    check("a resting-state question is answered in the session language", a.calls == ["kn"], f"{a.calls}")
    check("the LLM answer reaches the customer unchanged", result.reply == a.answer, result.reply)
    check("history keeps the answer as written",
          conversation.history[-1]["message"] == a.answer)


# =========================================================
# 6  KNOWLEDGE ANSWER + WORKFLOW STEP
# =========================================================

def test_combined_reply_says_the_step_once():
    step = "Sign the withdrawal slip."
    for language, rendered_step in (("kn", INSTRUCTIONS[step]["kn"]), ("hi", INSTRUCTIONS[step]["hi"])):
        # The model obeyed: no copy of the step.
        clean = GeneratedText("ಉತ್ತರ." if language == "kn" else "उत्तर.", language=language)
        reply, status = localize_detailed(compose(strip_instruction(clean, step), step), language)
        check(f"[{language}] answer kept, step rendered once", status == MIXED
              and reply.startswith(str(clean)) and reply.count(rendered_step) == 1, reply)

        # The model disobeyed: it repeated the step, in the session language.
        noisy = GeneratedText(f"{clean} {rendered_step}", language=language)
        reply, _ = localize_detailed(compose(strip_instruction(noisy, step), step), language)
        check(f"[{language}] a repeated step (session language) is removed from the answer",
              reply.count(rendered_step) == 1, reply)

    noisy_en = GeneratedText(f"Sign at the bottom. {step}", language="en")
    stripped = strip_instruction(noisy_en, step)
    check("a repeated step in English is removed", step not in stripped and "Sign at the bottom." in stripped)
    check("stripping keeps the LLM marking and language",
          isinstance(stripped, GeneratedText) and stripped.language == "en")
    check("an answer without the step is returned untouched",
          strip_instruction(clean, step) is clean)


def test_generated_language_markers():
    check("an answer asked for in Kannada passes through in a Kannada session",
          localize_detailed(GeneratedText("ಉತ್ತರ", language="kn"), "kn") == ("ಉತ್ತರ", GENERATED))
    rendered, status = localize_detailed(GeneratedText("An answer.", language="en"), "kn")
    check("an answer asked for in English, replayed in Kannada, is marked as English",
          status == FALLBACK and rendered == f"{UNTRANSLATED_MARKER['kn']} An answer.", rendered)
    check("mark_generated records the language", mark_generated("x", "hi").language == "hi")
    check("the fixed unavailable message is not marked as LLM text",
          type(mark_generated(QUESTION_UNAVAILABLE_MESSAGE, "kn")) is str)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M7 KNOWLEDGE-ANSWER TESTS")
    print("=" * 60)

    for test in tests:
        print(f"\n{test.__name__}")
        test()

    print()
    print("=" * 60)
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    print("=" * 60)

    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
