"""
PHASE 3.2B-15 -- MULTILINGUAL INTENT & KNOWLEDGE-ROUTING AUDIT

THIS FILE CHANGES NOTHING. It measures.

WHY IT EXISTS

The live Kannada session after Phase 3.2B-14 produced two misclassifications:

    "ನನಗೆ ಖಾತೆ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ"
        -> open new account | 0.942 | BANKING_INTENT

    "ನನಗೆ ಲೋನ್ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನು"
        -> open new account | 0.896 | BANKING_INTENT

Both are requests for INFORMATION ABOUT a service, not requests to USE one,
and the second names an education loan while being labelled "open new account".

THE SEMANTIC TEST THIS AUDIT APPLIES

    SERVICE REQUEST    -- the customer is asking to DO the thing, here, now.
                          "I want a loan", "ನನಗೆ ಲೋನ್ ಬೇಕು"
    KNOWLEDGE QUESTION -- the customer is asking ABOUT the thing.
                          "What is an education loan?",
                          "What documents does an education loan need?"

The presence of a word like "information" / "ಮಾಹಿತಿ" / "जानकारी" is EVIDENCE,
not the test. Every expectation below is set from what the sentence asks for,
and the reasoning is recorded next to it.

TWO KINDS OF RESULT

    check()    -- an invariant that MUST hold today. A failure here means this
                  audit broke something or the engine regressed. These decide
                  the exit code.

    observe()  -- a measurement of current behaviour against the semantics
                  above. A miss is a FINDING: it is the defect this audit
                  exists to locate, and it does NOT fail the run.

Offline: no microphone, no ASR, no network, no LLM. The embedding model is
local, exactly as the Phase 3.2B-12 and 3.2B-14 suites use it.

Run from language_engine/:
    python -m debugging.test_phase32b15_audit
"""
import sys
import unicodedata

from app.conversation.manager import ConversationManager
from app.conversation.state import WorkflowState
from app.dialogue.manager import (
    CONTROL_PREFILTER_KEYWORDS,
    QUESTION_LEAD_WORDS,
    STRONG_QUESTION_WORDS,
    DialogueManager,
    classify_turn,
    looks_like_a_control_utterance,
    looks_like_a_question,
)
from app.dialogue.term_normalizer import normalize_banking_terms
from app.intent.detector import (
    BANKING_INTENT,
    BANKING_MARGIN,
    OUT_OF_DOMAIN,
    IntentDetector,
)
from app.intent.intent_examples import (
    BANKING_INTENT_EXAMPLES,
    NON_BANKING_ANCHORS,
)
from app.intent.intents import INTENTS
from app.workflow.loader import WorkflowLoader


failures = []
findings = []
checks = [0]
observations = [0]


def check(name, ok, detail=""):
    """An invariant that must hold today. Decides the exit code."""
    checks[0] += 1
    if not ok:
        failures.append(f"{name}  [{detail}]" if detail else name)
    print(("  PASS     " if ok else "  FAIL     ")
          + name + (f"  [{detail}]" if detail else ""))


def observe(name, ok, detail=""):
    """A measurement. A miss is a finding, not a failure."""
    observations[0] += 1
    if not ok:
        findings.append(f"{name}  [{detail}]" if detail else name)
    print(("  OK       " if ok else "  FINDING  ")
          + name + (f"  [{detail}]" if detail else ""))


def section(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def sub(title):
    print()
    print(f"--- {title}")


def script_of(text):
    """Which script an utterance is written in."""
    for character in text:
        if character.isalpha():
            name = unicodedata.name(character, "")
            if name.startswith("KANNADA"):
                return "kn"
            if name.startswith("DEVANAGARI"):
                return "hi"
    return "en"


# =========================================================
# THE EXPECTED SEMANTIC CATEGORY
#
# SERVICE  -- should be BANKING_INTENT, with the named label
# KNOW     -- should route to knowledge answering, not to a workflow
# CONTROL  -- a control command
# ACK      -- an acknowledgement
# OOD      -- out of domain / must not be served
# =========================================================

SERVICE = "SERVICE"
KNOW = "KNOWLEDGE"
CONTROL = "CONTROL"
ACK = "ACKNOWLEDGEMENT"
OOD = "OOD"


# =========================================================
# THE ROUTE AN UTTERANCE ACTUALLY TAKES IN A RESTING STATE
#
# Reproduces VoiceAssistantPipeline._respond()'s resting-state order exactly,
# without calling anything that needs the network:
#
#   1. normalize_banking_terms()
#   2. DialogueManager.detect_control()  -> classify_turn()
#   3. answer_general_question()'s own gate:
#        looks_like_a_question() or looks_like_a_control_utterance()
#      -- if either is true the LLM is asked to classify the turn, and the
#         LLM's answer is the real decision (it can rescue a question).
#   4. otherwise: straight to IntentDetector, with nothing left to rescue it.
# =========================================================

ROUTE_CONTROL = "CONTROL-TIER"
ROUTE_LLM_GATE = "LLM-GATE"
ROUTE_INTENT = "INTENT-DETECTOR"


def route_of(text):
    """Which of the three resting-state routes `text` takes."""

    normalized = normalize_banking_terms(text)

    if classify_turn(normalized) is not None:
        return ROUTE_CONTROL

    if looks_like_a_question(normalized) or looks_like_a_control_utterance(normalized):
        return ROUTE_LLM_GATE

    return ROUTE_INTENT


def measure(detector, text):
    """Everything this audit reports about one utterance."""

    result = detector.detect_intent(text)
    per_intent, per_anchor = detector.score_all(text)

    best_anchor = max(per_anchor, key=per_anchor.get)

    return {
        "text": text,
        "intent": result["intent"],
        "category": result["category"],
        "confidence": result["confidence"],
        "banking_best": max(per_intent.values()),
        "anchor_best": per_anchor[best_anchor],
        "anchor_name": best_anchor,
        "margin": result["margin"],
        "is_banking": result["is_banking_intent"],
        "route": route_of(text),
        "question_prefilter": looks_like_a_question(normalize_banking_terms(text)),
    }


def row(m, expected, note=""):
    print(
        f"  {m['route']:<16} {m['category']:<18} "
        f"{m['intent']:<22} b={m['banking_best']:.3f} "
        f"a={m['anchor_best']:.3f}({m['anchor_name'][:4]}) "
        f"m={m['margin']:+.3f}  exp={expected:<10} {note}"
    )
    print(f"      {m['text']}")


def audit_set(detector, title, cases):
    """Measure a list of (utterance, expected, reason) and report each."""

    sub(title)

    results = []

    for text, expected, reason in cases:

        m = measure(detector, text)
        results.append((m, expected, reason))

        row(m, expected, f"| {reason}")

        if expected == SERVICE:
            ok = m["category"] == BANKING_INTENT
        elif expected == KNOW:
            # A knowledge question is handled correctly if EITHER the
            # detector abstains to the knowledge anchor, OR the question
            # pre-filter caught it first so the LLM gets to classify it.
            ok = (
                m["route"] == ROUTE_LLM_GATE
                or m["category"] == "KNOWLEDGE_QUESTION"
            )
        elif expected == CONTROL:
            ok = m["route"] == ROUTE_CONTROL or m["category"] == "CONTROL"
        elif expected == ACK:
            ok = m["route"] == ROUTE_CONTROL or m["category"] == "ACKNOWLEDGEMENT"
        else:  # OOD
            ok = m["category"] in {"UNSUPPORTED", "KNOWLEDGE_QUESTION", OUT_OF_DOMAIN}

        observe(f"{expected:<10} {text[:56]}", ok,
                f"{m['category']} / {m['intent']} / {m['route']}")

    return results


# =========================================================
# 1  ARCHITECTURE INVENTORY
# =========================================================

def audit_architecture():
    section("1  INTENT ARCHITECTURE INVENTORY")

    sub("Banking intent labels (app/intent/intents.py)")
    for label in INTENTS:
        has_json = WorkflowLoader().has_workflow(label)
        print(f"  {label:24} guided workflow on disk: {has_json}")

    check("the five documented labels are what the module exposes",
          INTENTS == [
              "deposit money", "withdraw money", "check account balance",
              "apply for loan", "open new account"
          ], str(INTENTS))

    sub("Prototype counts per label, per language")
    totals = {"en": 0, "kn": 0, "hi": 0}
    print(f"  {'label':24} {'total':>5} {'en':>4} {'kn':>4} {'hi':>4}")
    for label, examples in BANKING_INTENT_EXAMPLES.items():
        counts = {"en": 0, "kn": 0, "hi": 0}
        for example in examples:
            counts[script_of(example)] += 1
        for key in counts:
            totals[key] += counts[key]
        print(f"  {label:24} {len(examples):5} "
              f"{counts['en']:4} {counts['kn']:4} {counts['hi']:4}")
    banking_totals = dict(totals)
    print(f"  {'TOTAL':24} "
          f"{sum(len(v) for v in BANKING_INTENT_EXAMPLES.values()):5} "
          f"{totals['en']:4} {totals['kn']:4} {totals['hi']:4}")

    sub("Anchor counts per category, per language")
    totals = {"en": 0, "kn": 0, "hi": 0}
    per_category = {}
    print(f"  {'category':20} {'total':>5} {'en':>4} {'kn':>4} {'hi':>4}")
    for category, examples in NON_BANKING_ANCHORS.items():
        counts = {"en": 0, "kn": 0, "hi": 0}
        for example in examples:
            counts[script_of(example)] += 1
        per_category[category] = dict(counts)
        for key in counts:
            totals[key] += counts[key]
        print(f"  {category:20} {len(examples):5} "
              f"{counts['en']:4} {counts['kn']:4} {counts['hi']:4}")
    print(f"  {'TOTAL':20} "
          f"{sum(len(v) for v in NON_BANKING_ANCHORS.values()):5} "
          f"{totals['en']:4} {totals['kn']:4} {totals['hi']:4}")

    sub("Balance: banking prototypes vs knowledge anchors, per language")
    knowledge = per_category["KNOWLEDGE_QUESTION"]
    for language in ("en", "kn", "hi"):
        ratio = (
            banking_totals[language] / knowledge[language]
            if knowledge[language] else float("inf")
        )
        print(f"  {language}: {banking_totals[language]:3} banking prototypes vs "
              f"{knowledge[language]:3} knowledge anchors   ratio {ratio:.1f} : 1")

        observe(
            f"{language}: a knowledge question has same-language competition "
            f"(ratio <= 4:1)",
            ratio <= 4.0,
            f"{banking_totals[language]}:{knowledge[language]} = {ratio:.1f}:1"
        )

    sub("Scoring and abstention")
    print(f"  BANKING_MARGIN                = {BANKING_MARGIN}")
    print("  per-example scoring            = cosine(utterance, every example);")
    print("                                   an intent takes its BEST example score")
    print("  abstention                     = contrastive:")
    print("                                   margin = best_banking - best_anchor")
    print("                                   is_banking_intent = margin >= BANKING_MARGIN")
    print("  anchor categories              = "
          + ", ".join(NON_BANKING_ANCHORS))

    check("the margin threshold is still the documented 0.05",
          BANKING_MARGIN == 0.05, str(BANKING_MARGIN))
    check("open new account still has no guided workflow on disk",
          not WorkflowLoader().has_workflow("open new account"))
    check("check account balance still has no guided workflow on disk",
          not WorkflowLoader().has_workflow("check account balance"))


# =========================================================
# 2  THE TWO LIVE FAILURES
# =========================================================

def audit_live_failures(detector):
    section("2  THE TWO LIVE MISCLASSIFICATIONS, REPRODUCED")

    cases = [
        ("ನನಗೆ ಖಾತೆ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ", KNOW,
         "asks to BE GIVEN information about opening an account"),
        ("ನನಗೆ ಲೋನ್ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನು", KNOW,
         "same, about an education loan"),
    ]

    results = audit_set(detector, "The exact live utterances", cases)

    sub("Per-intent score breakdown for the live utterances")
    for m, _expected, _reason in results:
        per_intent, per_anchor = detector.score_all(m["text"])
        print(f"  {m['text']}")
        print("    banking:", ", ".join(
            f"{k}={v:.3f}" for k, v in sorted(
                per_intent.items(), key=lambda kv: -kv[1])))
        print("    anchors:", ", ".join(
            f"{k}={v:.3f}" for k, v in sorted(
                per_anchor.items(), key=lambda kv: -kv[1])))

    sub("Is the LABEL itself right, independent of the category?")
    loan = results[1][0]
    observe("the education-loan utterance is at least labelled 'apply for loan'",
            loan["intent"] == "apply for loan",
            f"labelled {loan['intent']}")


def nearest_prototypes(detector, text, count=3):
    """The individual EXAMPLES that decided this utterance's label.

    score_all() reports only the best score per label, which hides WHICH
    phrasing won. That is the one thing needed to tell a missing prototype
    apart from an encoder that is not reading the content at all.
    """
    from sklearn.metrics.pairwise import cosine_similarity

    embedding = detector.model.encode([text])

    banking = sorted(
        zip(detector._banking,
            cosine_similarity(embedding, detector._banking_embeddings)[0]),
        key=lambda pair: -pair[1]
    )[:count]

    anchors = sorted(
        zip(detector._anchors,
            cosine_similarity(embedding, detector._anchor_embeddings)[0]),
        key=lambda pair: -pair[1]
    )[:2]

    return banking, anchors


def audit_nearest_prototypes(detector):
    section("2B  WHICH PROTOTYPE ACTUALLY WON, AND WHY")

    print("  score_all() reports the best score PER LABEL. This reports the best")
    print("  score per EXAMPLE, which is what says whether the encoder matched the")
    print("  CONTENT of the sentence or only its shape.")

    cases = [
        ("ನನಗೆ ಖಾತೆ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ", "live failure 1"),
        ("ನನಗೆ ಲೋನ್ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನು",
         "live failure 2 -- names a LOAN twice"),
        ("ನನಗೆ ಖಾತೆ ತೆಗೆಯಬೇಕು", "service request, wrong service"),
        ("ನನಗೆ ಸಾಲ ಬೇಕು", "an EXACT prototype, for reference"),
        ("ನನಗೆ ಲೋನ್ ಬೇಕು", "same sentence, English loanword for 'loan'"),
        ("ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಸಾಲ ಬೇಕು",
         "the exact prototype plus ONE modifier, native word"),
        ("ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಬೇಕು", "same, loanword"),
        ("नया खाता कैसे खोलें", "Hindi 'how to open an account'"),
    ]

    for text, note in cases:
        banking, anchors = nearest_prototypes(detector, text)
        print()
        print(f"  {text}     ({note})")
        for (label, example), score in banking:
            print(f"     {score:.3f}  [{label:22}] {example}")
        for (category, example), score in anchors:
            print(f"     {score:.3f}  <{category:22}> {example}")

    sub("Do both live failures share ONE winning prototype?")
    first = nearest_prototypes(detector, cases[0][0])[0][0]
    second = nearest_prototypes(detector, cases[1][0])[0][0]
    print(f"  live failure 1 won by: {first[0][1]}  ({first[1]:.3f})")
    print(f"  live failure 2 won by: {second[0][1]}  ({second[1]:.3f})")
    observe("the two live failures are NOT decided by the same single prototype",
            first[0][1] != second[0][1],
            f"both decided by {first[0][1]!r}")

    sub("Is Kannada similarity compositional? (one modifier inserted)")
    bare = detector.detect_intent("ನನಗೆ ಸಾಲ ಬೇಕು")
    modified = detector.detect_intent("ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಸಾಲ ಬೇಕು")
    print(f"  'ನನಗೆ ಸಾಲ ಬೇಕು'                 -> {bare['intent']} "
          f"({bare['confidence']})")
    print(f"  'ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಸಾಲ ಬೇಕು'      -> {modified['intent']} "
          f"({modified['confidence']})")
    observe("inserting one adjective keeps the Kannada label stable",
            bare["intent"] == modified["intent"],
            f"{bare['intent']} -> {modified['intent']}")

    sub("Does the native word and the English loanword behave the same?")
    for native, loanword, gloss in (
        ("ನನಗೆ ಸಾಲ ಬೇಕು", "ನನಗೆ ಲೋನ್ ಬೇಕು", "I need a loan"),
        ("ಸಾಲ ಪಡೆಯಬೇಕು", "ಲೋನ್ ಪಡೆಯಬೇಕು", "I must get a loan"),
    ):
        a = detector.detect_intent(native)
        b = detector.detect_intent(loanword)
        print(f"  {gloss:20} native={a['intent']:16} ({a['margin']:+.3f})  "
              f"loanword={b['intent']:16} ({b['margin']:+.3f})")
        observe(f"{gloss!r}: the loanword form classifies like the native form",
                a["intent"] == b["intent"] and b["is_banking_intent"],
                f"native {a['intent']} vs loanword {b['intent']}, "
                f"loanword banking={b['is_banking_intent']}")

    sub("Does ತೆಗೆ ('take/open') collide between accounts and cash?")
    account = detector.detect_intent("ನನಗೆ ಖಾತೆ ತೆಗೆಯಬೇಕು")
    cash = detector.detect_intent("ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು")
    print(f"  'ನನಗೆ ಖಾತೆ ತೆಗೆಯಬೇಕು' (open an account) -> {account['intent']}")
    print(f"  'ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು'  (withdraw cash)    -> {cash['intent']}")
    observe("the shared verb ತೆಗೆ does not collapse the two services",
            account["intent"] != cash["intent"],
            f"both -> {account['intent']}")


# =========================================================
# 3  KANNADA
# =========================================================

KANNADA_ACCOUNT = [
    ("ನನಗೆ ಖಾತೆ ತೆಗೆಯಬೇಕು", SERVICE,
     "'I need to open an account' -- asks to DO it"),
    ("ನಾನು ಹೊಸ ಖಾತೆ ತೆರೆಯಬೇಕು", SERVICE,
     "'I must open a new account'"),
    ("ಹೊಸ ಖಾತೆ ತೆರೆಯಲು ಸಹಾಯ ಬೇಕು", SERVICE,
     "'I need help to open a new account' -- asks for the service"),
    ("ನನಗೆ ಖಾತೆ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಬೇಕು", KNOW,
     "'I want information ABOUT opening an account'"),
    ("ಖಾತೆ ತೆರೆಯುವುದು ಹೇಗೆ?", KNOW,
     "'How does one open an account?' -- a how question"),
    ("ಖಾತೆ ತೆರೆಯುವುದು ಹೇಗೆ", KNOW,
     "same, WITHOUT the question mark -- as ASR actually emits it"),
    ("ಖಾತೆ ತೆರೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು", KNOW,
     "'What documents are needed to open an account?'"),
    ("ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು", KNOW,
     "'What is a savings account?' -- a definition question"),
]

KANNADA_LOAN = [
    ("ನನಗೆ ಲೋನ್ ಬೇಕು", SERVICE, "'I need a loan'"),
    ("ನಾನು ಲೋನ್‌ಗೆ ಅರ್ಜಿ ಹಾಕಬೇಕು", SERVICE, "'I must apply for a loan'"),
    ("ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಬೇಕು", SERVICE, "'I need an education loan'"),
    ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಬಗ್ಗೆ ಮಾಹಿತಿ ಬೇಕು", KNOW,
     "'I want information ABOUT an education loan'"),
    ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು?", KNOW, "'What IS an education loan?'"),
    ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು", KNOW, "same, without the question mark"),
    ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಪಡೆಯಲು ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು?", KNOW,
     "'What documents are needed to GET an education loan?' -- about, not a request"),
    ("ಲೋನ್ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ?", KNOW,
     "'Can you give information about taking a loan?'"),
]

KANNADA_SERVICES = [
    ("ನನಗೆ ಹಣ ಜಮಾ ಮಾಡಬೇಕು", SERVICE, "deposit"),
    ("ಖಾತೆಗೆ ಹಣ ಹಾಕಬೇಕು", SERVICE, "deposit"),
    ("ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು", SERVICE, "withdrawal"),
    ("ಖಾತೆಯಿಂದ ಹಣ ತೆಗೆಯಬೇಕು", SERVICE, "withdrawal"),
    ("ನನ್ನ ಖಾತೆಯ ಬ್ಯಾಲೆನ್ಸ್ ಎಷ್ಟು", SERVICE, "balance"),
    ("ಸಾಲ ಪಡೆಯಬೇಕು", SERVICE, "loan"),
    ("ಹೊಸ ಖಾತೆ ತೆರೆಯಬೇಕು", SERVICE, "account opening"),
]

KANNADA_KNOWLEDGE = [
    ("ಉಳಿತಾಯ ಖಾತೆ ಎಂದರೇನು", KNOW, "what is a savings account"),
    ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು", KNOW, "what is an education loan"),
    ("ಸಾಲಕ್ಕೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು", KNOW, "what documents for a loan"),
    ("ಹಣ ಜಮಾ ಮಾಡುವುದು ಹೇಗೆ", KNOW, "how does a deposit work"),
    ("ಬ್ಯಾಲೆನ್ಸ್ ಪರಿಶೀಲಿಸುವುದು ಹೇಗೆ", KNOW, "how can I check my balance"),
    ("ಬ್ಯಾಂಕ್ ಏಕೆ ಬಡ್ಡಿ ವಿಧಿಸುತ್ತದೆ", KNOW, "why do banks charge interest"),
]


def audit_kannada(detector):
    section("3  KANNADA")
    audit_set(detector, "Account opening -- service vs information", KANNADA_ACCOUNT)
    audit_set(detector, "Loan -- service vs information", KANNADA_LOAN)
    audit_set(detector, "Plain service requests (must stay BANKING_INTENT)",
              KANNADA_SERVICES)
    audit_set(detector, "Knowledge questions", KANNADA_KNOWLEDGE)


# =========================================================
# 4  HINDI
# =========================================================

HINDI_SERVICES = [
    ("मुझे पैसे जमा करने हैं", SERVICE, "deposit"),
    ("मुझे पैसे निकालने हैं", SERVICE, "withdrawal"),
    ("मेरा बैलेंस कितना है", SERVICE, "balance"),
    ("मुझे लोन चाहिए", SERVICE, "loan"),
    ("मुझे शिक्षा ऋण चाहिए", SERVICE, "'I need an education loan'"),
    ("मुझे नया खाता खोलना है", SERVICE, "account opening"),
]

HINDI_KNOWLEDGE = [
    ("शिक्षा ऋण के बारे में जानकारी चाहिए", KNOW,
     "'I want information ABOUT an education loan'"),
    ("बचत खाता क्या है?", KNOW, "'What is a savings account?'"),
    ("बचत खाता क्या है", KNOW, "same, without the question mark"),
    ("नया खाता कैसे खोलें?", KNOW, "'How does one open a new account?'"),
    ("नया खाता कैसे खोलें", KNOW, "same, without the question mark"),
    ("शिक्षा ऋण क्या है", KNOW, "'What is an education loan?'"),
    ("लोन के लिए कौन से दस्तावेज़ चाहिए", KNOW,
     "'Which documents are needed for a loan?'"),
    ("बैलेंस कैसे चेक करें", KNOW, "'How does one check the balance?'"),
]


def audit_hindi(detector):
    section("4  HINDI")
    audit_set(detector, "Plain service requests", HINDI_SERVICES)
    audit_set(detector, "Knowledge questions", HINDI_KNOWLEDGE)


# =========================================================
# 5  ENGLISH GOLDEN SET  (hard checks -- must not regress)
# =========================================================

ENGLISH_SERVICES = [
    ("I want to deposit money.", "deposit money"),
    ("I want to withdraw money.", "withdraw money"),
    ("I want to check my balance.", "check account balance"),
    ("I want to apply for a loan.", "apply for loan"),
    ("I want to open a new account.", "open new account"),
]

ENGLISH_KNOWLEDGE = [
    ("What is a savings account?", KNOW, "definition"),
    ("What is an education loan?", KNOW, "definition"),
    ("How do I open a bank account?", KNOW, "how question"),
    ("What documents do I need for a loan?", KNOW, "requirements question"),
    ("How can I check my balance?", KNOW, "how question"),
]

ENGLISH_OOD = [
    ("Tell me a joke.", OOD, "not banking"),
    ("What is the capital of France?", OOD, "general knowledge"),
    ("I want to hack the bank.", OOD, "must be refused"),
    ("How can I steal money?", OOD, "must be refused"),
    ("Sing me a song.", OOD, "not banking"),
]


def audit_english(detector):
    section("5  ENGLISH GOLDEN SET")

    sub("Service requests must stay BANKING_INTENT with the right label")
    for text, expected_label in ENGLISH_SERVICES:
        m = measure(detector, text)
        row(m, SERVICE, f"| expect {expected_label}")
        check(f"'{text}' is a banking intent",
              m["category"] == BANKING_INTENT, m["category"])
        check(f"'{text}' is labelled {expected_label}",
              m["intent"] == expected_label, m["intent"])

    sub("Knowledge questions must not start a workflow")
    for text, expected, reason in ENGLISH_KNOWLEDGE:
        m = measure(detector, text)
        row(m, expected, f"| {reason}")
        check(f"'{text}' reaches the LLM question gate or abstains",
              m["route"] == ROUTE_LLM_GATE
              or m["category"] == "KNOWLEDGE_QUESTION",
              f"{m['route']} / {m['category']}")

    sub("Out of domain must never become a banking request")
    for text, expected, reason in ENGLISH_OOD:
        m = measure(detector, text)
        row(m, expected, f"| {reason}")
        check(f"'{text}' is not a banking intent",
              not m["is_banking"], f"{m['category']} / {m['margin']:+.3f}")

    # -----------------------------------------------------------------
    # HOW MUCH OF ENGLISH CORRECTNESS IS THE PRE-FILTER, NOT THE DETECTOR?
    #
    # Every English knowledge question above routes to the LLM gate, so the
    # detector's own answer never decides anything. This measures what the
    # detector would have said on its own -- which is what Kannada and Hindi
    # get today, because nothing catches them first.
    # -----------------------------------------------------------------
    sub("English knowledge questions, judged by the DETECTOR ALONE")
    rescued = 0
    for text, _expected, reason in ENGLISH_KNOWLEDGE:
        m = measure(detector, text)
        detector_alone = "BANKING_INTENT" if m["is_banking"] else m["category"]
        caught = m["route"] == ROUTE_LLM_GATE
        if m["is_banking"] and caught:
            rescued += 1
        print(f"  pre-filter={m['route']:<16} detector alone={detector_alone:<20} "
              f"m={m['margin']:+.3f}   {text}")

    print(f"  -> {rescued} of {len(ENGLISH_KNOWLEDGE)} English knowledge questions "
          "would become a BANKING_INTENT")
    print("     if the question pre-filter did not catch them first.")
    observe("the English detector alone separates knowledge from service",
            rescued == 0,
            f"{rescued}/{len(ENGLISH_KNOWLEDGE)} depend entirely on the pre-filter")


# =========================================================
# 6  CONTROL, ACKNOWLEDGEMENT, OOD -- ALL THREE LANGUAGES
# =========================================================

CONTROL_CASES = [
    ("pause", CONTROL, "en"), ("resume", CONTROL, "en"),
    ("cancel", CONTROL, "en"), ("repeat", CONTROL, "en"),
    ("exit", CONTROL, "en"),
    ("ವಿರಾಮ", CONTROL, "kn"), ("ಮುಂದುವರಿಸಿ", CONTROL, "kn"),
    ("ನಿಲ್ಲಿಸು", CONTROL, "kn"), ("ಮತ್ತೆ ಹೇಳಿ", CONTROL, "kn"),
    ("ಹೊರಗೆ", CONTROL, "kn"),
    ("रुको", CONTROL, "hi"), ("जारी रखो", CONTROL, "hi"),
    ("रद्द करो", CONTROL, "hi"), ("फिर से बताइए", CONTROL, "hi"),
    ("बाहर", CONTROL, "hi"),
]

ACK_CASES = [
    ("thank you", ACK, "en"), ("thanks", ACK, "en"),
    ("ಧನ್ಯವಾದಗಳು", ACK, "kn"), ("ಧನ್ಯವಾದ", ACK, "kn"),
    ("धन्यवाद", ACK, "hi"), ("शुक्रिया", ACK, "hi"),
]

OOD_CASES = [
    ("ಒಂದು ಜೋಕ್ ಹೇಳಿ", OOD, "kn joke"),
    ("मुझे एक चुटकुला सुनाओ", OOD, "hi joke"),
    ("ನಾನು ಬ್ಯಾಂಕ್ ದೋಚಬೇಕು", OOD, "kn robbery"),
    ("मुझे बैंक लूटना है", OOD, "hi robbery"),
    ("ಇಂದು ಹವಾಮಾನ ಹೇಗಿದೆ", OOD, "kn weather"),
    ("आज मौसम कैसा है", OOD, "hi weather"),
]


def audit_control_and_ood(detector):
    section("6  CONTROL / ACKNOWLEDGEMENT / OUT-OF-DOMAIN")

    sub("Control commands must be caught by the deterministic tier")
    for text, expected, language in CONTROL_CASES:
        route = route_of(text)
        classification = classify_turn(normalize_banking_terms(text))
        check(f"[{language}] control {text!r} never reaches the detector",
              route == ROUTE_CONTROL, f"{route} / {classification}")

    sub("Acknowledgements must be caught by the deterministic tier")
    for text, expected, language in ACK_CASES:
        route = route_of(text)
        check(f"[{language}] acknowledgement {text!r} never reaches the detector",
              route == ROUTE_CONTROL, route)

    audit_set(detector, "Out of domain, Kannada and Hindi", OOD_CASES)


# =========================================================
# 7  QUESTION PRE-FILTER AUDIT
# =========================================================

KANNADA_QUESTION_MARKERS = [
    ("ಬಗ್ಗೆ ಮಾಹಿತಿ", "about / information"),
    ("ಹೇಗೆ", "how"),
    ("ಏನು", "what"),
    ("ಎಂದರೇನು", "what is"),
    ("ಯಾವುದು", "which"),
    ("ಯಾವ ದಾಖಲೆಗಳು", "which documents"),
    ("ಕೊಡಬಹುದೇ", "could you give"),
    ("ಎಷ್ಟು", "how much"),
    ("ಏಕೆ", "why"),
]

HINDI_QUESTION_MARKERS = [
    ("के बारे में जानकारी", "information about"),
    ("कैसे", "how"),
    ("क्या", "what"),
    ("कौन से दस्तावेज़", "which documents"),
    ("कितना", "how much"),
    ("क्यों", "why"),
]


def audit_question_prefilter():
    section("7  QUESTION PRE-FILTER AUDIT  (looks_like_a_question)")

    sub("What the pre-filter actually tests")
    print("  1. the text ends with '?'")
    print("  2. the FIRST word is in QUESTION_LEAD_WORDS "
          f"({len(QUESTION_LEAD_WORDS)} English words)")
    print("  3. a STRONG_QUESTION_WORD appears anywhere, matched by "
          "re.compile(r'[a-z]+')")
    print(f"     STRONG_QUESTION_WORDS = {sorted(STRONG_QUESTION_WORDS)}")
    print(f"  control pre-filter keywords: {len(CONTROL_PREFILTER_KEYWORDS)}, "
          "all ASCII")

    check("every question lead word is ASCII",
          all(word.isascii() for word in QUESTION_LEAD_WORDS))
    check("every strong question word is ASCII",
          all(word.isascii() for word in STRONG_QUESTION_WORDS))
    check("every control pre-filter keyword is ASCII",
          all(word.isascii() for word in CONTROL_PREFILTER_KEYWORDS))

    sub("Kannada question markers, alone -- is any of them recognised?")
    for marker, gloss in KANNADA_QUESTION_MARKERS:
        caught = looks_like_a_question(marker)
        observe(f"[kn] {marker!r} ({gloss}) is recognised as a question",
                caught, "not recognised")

    sub("Hindi question markers, alone -- is any of them recognised?")
    for marker, gloss in HINDI_QUESTION_MARKERS:
        caught = looks_like_a_question(marker)
        observe(f"[hi] {marker!r} ({gloss}) is recognised as a question",
                caught, "not recognised")

    sub("The '?' dependency: the SAME sentence with and without punctuation")
    pairs = [
        ("ಖಾತೆ ತೆರೆಯುವುದು ಹೇಗೆ", "kn 'how to open an account'"),
        ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು", "kn 'what is an education loan'"),
        ("ಲೋನ್ ತೆಗೆಯುವ ಬಗ್ಗೆ ಮಾಹಿತಿ ಕೊಡಬಹುದೇ", "kn 'can you give loan info'"),
        ("बचत खाता क्या है", "hi 'what is a savings account'"),
        ("नया खाता कैसे खोलें", "hi 'how to open a new account'"),
    ]
    for base, gloss in pairs:
        with_mark = looks_like_a_question(base + "?")
        without = looks_like_a_question(base)
        print(f"  {gloss:44} with '?' = {with_mark!s:5}  without = {without!s:5}")
        check(f"{gloss}: a trailing '?' is recognised", with_mark)
        observe(f"{gloss}: recognised WITHOUT a '?' (as ASR emits it)",
                without, "reaches IntentDetector with nothing to rescue it")

    sub("English questions, for contrast")
    for text in ("What is an education loan?", "What is an education loan",
                 "How do I open a bank account", "Tell me about loans",
                 "Spell twenty thousand rupees"):
        check(f"[en] {text!r} is recognised as a question",
              looks_like_a_question(text), "not recognised")


# =========================================================
# 8  ACTIVE-WORKFLOW INTERACTION  (Phase 3.2B-14 safety)
# =========================================================

def entities():
    return {"amount": None, "account_number": None, "name": None,
            "phone_number": None, "step_number": None}


class StubUnderstanding:
    """Understanding client whose classification the test chooses.

    The default is the live failure's own classification -- workflow_action /
    none -- which is the turn Phase 3.2B-14 had to stop mishandling.
    """

    def __init__(self, message_type="workflow_action", action="none"):
        self.message_type = message_type
        self.action = action
        self.questions = []

    def understand(self, user_text, current_workflow=None,
                   current_step=None, current_instruction=None):
        return {
            "type": self.message_type,
            "action": self.action,
            "step_completed": False,
            "target_workflow": None,
            "entities": entities(),
        }

    def answer_question(self, question, workflow_context,
                        current_instruction, recent_context=None):
        self.questions.append(question)
        return "ANSWERED-FROM-KNOWLEDGE-BASE"


def make_dialogue(detector, understanding):
    manager = object.__new__(DialogueManager)
    manager.workflow_loader = WorkflowLoader()
    manager.dialogue_understanding = understanding
    manager.intent_detector = detector
    return manager


def active_withdrawal():
    conversation = ConversationManager()
    conversation.start_conversation()
    conversation.set_intent("withdraw money")
    conversation.load_workflow("withdraw money")
    conversation.current_step = 2
    return conversation


def audit_active_workflow(detector):
    section("8  ACTIVE-WORKFLOW INTERACTION  (Phase 3.2B-14 must stay safe)")

    sub("A knowledge question during an active withdrawal")
    for text, language in (
        ("What is an education loan?", "en"),
        ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು", "kn"),
        ("शिक्षा ऋण क्या है", "hi"),
    ):
        understanding = StubUnderstanding("question", "explain")
        conversation = active_withdrawal()
        dialogue = make_dialogue(detector, understanding)

        reply = dialogue.generate_response(conversation, text)

        check(f"[{language}] a knowledge question is answered, not routed to a workflow",
              reply == "ANSWERED-FROM-KNOWLEDGE-BASE", reply[:60])
        check(f"[{language}] the withdrawal is preserved",
              conversation.workflow_state == WorkflowState.ACTIVE
              and conversation.current_workflow == "withdraw money"
              and conversation.current_step == 2,
              f"{conversation.workflow_state} / {conversation.current_step}")
        check(f"[{language}] no conflict was raised",
              conversation.workflow_conflict is None)

    sub("A service request for a DIFFERENT product during an active withdrawal")
    for text, language, expect_conflict in (
        ("I want to apply for an education loan.", "en", True),
        ("ನನಗೆ ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಬೇಕು", "kn", True),
        ("मुझे शिक्षा ऋण चाहिए", "hi", True),
    ):
        understanding = StubUnderstanding()          # workflow_action / none
        conversation = active_withdrawal()
        dialogue = make_dialogue(detector, understanding)

        reply = dialogue.generate_response(conversation, text)
        conflict = conversation.workflow_conflict

        observe(f"[{language}] {text[:40]!r} raises a workflow conflict",
                (conflict is not None) == expect_conflict,
                f"conflict={conflict} reply={reply[:50]!r}")

        check(f"[{language}] nothing was switched automatically",
              conversation.current_workflow == "withdraw money"
              and conversation.workflow_state == WorkflowState.ACTIVE
              and conversation.current_step == 2,
              f"{conversation.current_workflow} / {conversation.workflow_state}")

    sub("A KNOWLEDGE question that understanding mislabels as workflow_action")
    for text, language in (
        ("What is an education loan?", "en"),
        ("ವಿದ್ಯಾಭ್ಯಾಸದ ಲೋನ್ ಎಂದರೇನು", "kn"),
        ("शिक्षा ऋण क्या है", "hi"),
    ):
        understanding = StubUnderstanding()          # workflow_action / none
        conversation = active_withdrawal()
        dialogue = make_dialogue(detector, understanding)

        reply = dialogue.generate_response(conversation, text)
        conflict = conversation.workflow_conflict

        observe(f"[{language}] a mislabelled knowledge question raises NO conflict",
                conflict is None,
                f"conflict={conflict}")

        check(f"[{language}] a mislabelled knowledge question switches nothing",
              conversation.current_workflow == "withdraw money"
              and conversation.workflow_state == WorkflowState.ACTIVE
              and conversation.current_step == 2,
              str(conversation.workflow_state))
        print(f"      [{language}] reply: {reply[:70]}")


# =========================================================
# 9  SUMMARY
# =========================================================

def audit_summary(detector):
    section("9  MARGIN DISTRIBUTION SUMMARY")

    groups = {
        "kn SERVICE": [t for t, e, _ in KANNADA_SERVICES + KANNADA_ACCOUNT
                       + KANNADA_LOAN if e == SERVICE],
        "kn KNOWLEDGE": [t for t, e, _ in KANNADA_KNOWLEDGE + KANNADA_ACCOUNT
                         + KANNADA_LOAN if e == KNOW],
        "hi SERVICE": [t for t, e, _ in HINDI_SERVICES if e == SERVICE],
        "hi KNOWLEDGE": [t for t, e, _ in HINDI_KNOWLEDGE if e == KNOW],
        "en SERVICE": [t for t, _ in ENGLISH_SERVICES],
        "en KNOWLEDGE": [t for t, e, _ in ENGLISH_KNOWLEDGE],
    }

    print(f"  {'group':16} {'n':>3} {'min margin':>11} {'max margin':>11} "
          f"{'banking?':>9}")

    for name, texts in groups.items():
        margins = []
        banking = 0
        for text in texts:
            m = measure(detector, text)
            margins.append(m["margin"])
            banking += 1 if m["is_banking"] else 0
        print(f"  {name:16} {len(texts):3} {min(margins):+11.3f} "
              f"{max(margins):+11.3f} {banking:5}/{len(texts):<3}")

    sub("The separation question: does the margin separate service from knowledge?")
    for language, service_key, knowledge_key in (
        ("en", "en SERVICE", "en KNOWLEDGE"),
        ("kn", "kn SERVICE", "kn KNOWLEDGE"),
        ("hi", "hi SERVICE", "hi KNOWLEDGE"),
    ):
        lowest_service = min(
            measure(detector, t)["margin"] for t in groups[service_key])
        highest_knowledge = max(
            measure(detector, t)["margin"] for t in groups[knowledge_key])
        gap = lowest_service - highest_knowledge
        print(f"  {language}: lowest SERVICE margin {lowest_service:+.3f}, "
              f"highest KNOWLEDGE margin {highest_knowledge:+.3f}, "
              f"gap {gap:+.3f}")
        observe(f"{language}: the two classes are separable by the margin "
                f"(gap > 0)",
                gap > 0, f"gap {gap:+.3f}")


# =========================================================
# MAIN
# =========================================================

def main():
    print("PHASE 3.2B-15 -- MULTILINGUAL INTENT & KNOWLEDGE-ROUTING AUDIT")
    print("PRODUCTION CHANGES: NONE. This file measures only.")

    audit_architecture()
    audit_question_prefilter()

    detector = IntentDetector()

    audit_live_failures(detector)
    audit_nearest_prototypes(detector)
    audit_kannada(detector)
    audit_hindi(detector)
    audit_english(detector)
    audit_control_and_ood(detector)
    audit_active_workflow(detector)
    audit_summary(detector)

    section("AUDIT RESULT")
    print(f"  invariant checks : {checks[0]:4}, {len(failures)} failed")
    print(f"  observations     : {observations[0]:4}, {len(findings)} findings")

    if failures:
        print()
        print("  INVARIANT FAILURES (these mean something is broken):")
        for failure in failures:
            print("   -", failure)

    if findings:
        print()
        print("  FINDINGS (current behaviour vs. expected semantics):")
        for finding in findings:
            print("   -", finding)

    print()
    if failures:
        print("  Phase 3.2B-15 audit: INVARIANTS BROKEN.")
        return 1

    print("  Phase 3.2B-15 audit: all invariants hold; "
          f"{len(findings)} findings recorded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
