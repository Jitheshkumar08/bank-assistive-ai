"""
M6 -- LOCALISED WORKFLOW AND SYSTEM REPLIES

Regression tests for app/dialogue/localization.py and localization_catalog.py.

  1. Coverage: every workflow step, and every fixed sentence the engine's
     source can compose, renders completely in Kannada and in Hindi. The
     inventory is read from the source code itself, so a new sentence added
     without a rendering fails here.
  2. Script: Kannada renderings are in Kannada script, Hindi in Devanagari,
     with no stray Latin text.
  3. The fallback policy: unknown fixed text is marked, never silently
     English; LLM text is passed through; English and unsupported languages
     are unchanged.
  4. Behaviour: the same scripted conversation in English, Kannada and Hindi
     leaves IDENTICAL workflow state, steps, entities and history -- only the
     rendered replies differ. Language switches mid-workflow, repeat and the
     conflict question follow the session language.

Offline: no model, no Groq, no network.

Run from language_engine/:

    python -m debugging.test_m6_localization
"""

import ast
import io
import json
import re
import sys
from pathlib import Path

from app.conversation.state import WorkflowState
from app.dialogue.localization import (
    FALLBACK, GENERATED, MIXED, TRANSLATED, UNSUPPORTED_LANGUAGE,
    ComposedReply, GeneratedText, ResponseLocalizer, compose, localize, localize_detailed,
)
from app.dialogue.localization_catalog import (
    INSTRUCTIONS, REVIEW_STATUS, SENTENCES, UNTRANSLATED_MARKER, WORKFLOW_NAMES,
)
from app.dialogue.manager import classify_turn
from app.dialogue.workflow_conflict import (
    WorkflowConflict, conflict_question, display_name, resolve_conflict_answer,
)
from app.intent.intents import INTENTS


PASSED = []
FAILED = []

ROOT = Path(__file__).resolve().parent.parent
LANGUAGES = ("kn", "hi")


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{(' -- ' + detail) if detail else ''}")


def kannada(text):
    return any("ಀ" <= c <= "೿" for c in text)


def devanagari(text):
    return any("ऀ" <= c <= "ॿ" for c in text)


def latin(text):
    return any("a" <= c.lower() <= "z" for c in re.sub(r"\{\w+\}", "", text))


# =========================================================
# 1  COVERAGE
# =========================================================

def workflow_instructions():
    out = []
    for path in sorted((ROOT / "app" / "workflow" / "workflows").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        out += [(data["workflow"], s["step"], s["instruction"]) for s in data["steps"]]
    return out


def test_every_workflow_step_is_covered():
    steps = workflow_instructions()
    check(f"{len(steps)} workflow steps found", len(steps) == 12)
    for workflow, number, instruction in steps:
        for language in LANGUAGES:
            rendered, status = localize_detailed(instruction, language)
            check(f"{workflow} step {number} renders in {language}",
                  status == TRANSLATED and rendered == INSTRUCTIONS[instruction][language], rendered)


def test_every_workflow_name_is_covered():
    for intent in INTENTS:
        for name in (intent, display_name(intent)):
            check(f"workflow name {name!r} has kn and hi",
                  name in WORKFLOW_NAMES and all(WORKFLOW_NAMES[name].get(l) for l in LANGUAGES))


#: Sentences in the source that are not customer replies, or not ones that
#: pass through the localizer -- each with the reason.
NOT_RENDERED_HERE = {
    "No banking workflow is currently active. Answer general banking questions helpfully.":
        "LLM prompt context, never shown to the customer",
    "The recording was empty.": "API error detail returned to NestJS, not a turn reply",
    "The recording could not be understood.": "API error detail returned to NestJS, not a turn reply",
}

# Placeholder -> a representative value, for instantiating f-strings.
_INSTRUCTION = "Fill in your account number."
_PLACEHOLDERS = (
    (r"\{display_name\([^}]*\)\}", "deposit"),
    (r"\{(current_name|requested_name|current|requested|workflow_name)\}", "deposit"),
    (r"\{(instruction|current_instruction|next_instruction|response)\}", _INSTRUCTION),
    (r"\{(step_number)\}", "2"),
    (r"\{len\(steps\)\}", "3"),
    (r"\{(opener|status_message|message|answer)\}", ""),   # other sentences / LLM text
)


def source_sentences():
    """Every sentence-shaped literal the reply code can return, f-strings instantiated."""
    found = {}
    for rel in ("app/dialogue/manager.py", "app/dialogue/workflow_conflict.py", "service/engine.py"):
        tree = ast.parse(io.open(ROOT / rel, encoding="utf-8").read())
        docs = {id(n.body[0].value) for n in ast.walk(tree)
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module))
                and n.body and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant)}
        for node in ast.walk(tree):
            if id(node) in docs:
                continue
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                text = node.value
            elif isinstance(node, ast.JoinedStr):
                text = "".join(v.value if isinstance(v, ast.Constant) else "{" + ast.unparse(v.value) + "}"
                               for v in node.values)
            else:
                continue
            text = text.strip()
            if "\n" in text or not re.match(r"^[A-Z{].*[.?!]$", text) or " " not in text:
                continue
            for pattern, value in _PLACEHOLDERS:
                text = re.sub(pattern, value, text)
            text = " ".join(text.split())
            if text and "{" not in text:
                found.setdefault(text, f"{rel}:{node.lineno}")
    return found


def test_every_source_sentence_renders():
    sentences = source_sentences()
    check(f"{len(sentences)} sentences found in the reply code", len(sentences) >= 50)
    from app.dialogue.llm.dialogue_understanding import QUESTION_UNAVAILABLE_MESSAGE
    sentences[QUESTION_UNAVAILABLE_MESSAGE] = "dialogue_understanding.QUESTION_UNAVAILABLE_MESSAGE"

    missing = []
    for text, where in sorted(sentences.items()):
        if text in NOT_RENDERED_HERE:
            continue
        for language in LANGUAGES:
            _, status = localize_detailed(text, language)
            if status != TRANSLATED:
                missing.append(f"{where} [{language}] {text!r}")
    check("every fixed sentence in the reply code renders completely in kn and hi",
          not missing, "\n        ".join([""] + missing))


def test_conflict_questions_render_for_every_pair():
    missing = []
    for current in INTENTS:
        for requested in INTENTS:
            if current == requested:
                continue
            for paused in (False, True):
                text = conflict_question(WorkflowConflict(current, requested), paused=paused)
                for language in LANGUAGES:
                    if localize_detailed(text, language)[1] != TRANSLATED:
                        missing.append(f"{current}->{requested} paused={paused} [{language}]")
    check("the conflict question renders for every pair of services, active or paused",
          not missing, "; ".join(missing))


# =========================================================
# 2  SCRIPT
# =========================================================

def test_catalog_scripts():
    entries = [(t, r) for t, r in SENTENCES] + list(INSTRUCTIONS.items())
    bad = []
    for english, renderings in entries:
        kn, hi = renderings.get("kn", ""), renderings.get("hi", "")
        if not kn or not kannada(kn) or devanagari(kn) or latin(kn):
            bad.append(f"kn {english!r}: {kn!r}")
        if not hi or not devanagari(hi) or kannada(hi) or latin(hi):
            bad.append(f"hi {english!r}: {hi!r}")
        slots = set(re.findall(r"\{\w+\}", english))
        for language, text in (("kn", kn), ("hi", hi)):
            if set(re.findall(r"\{\w+\}", text)) != slots:
                bad.append(f"{language} {english!r}: slots differ")
    for name, renderings in WORKFLOW_NAMES.items():
        if not kannada(renderings["kn"]) or latin(renderings["kn"]):
            bad.append(f"kn name {name!r}")
        if not devanagari(renderings["hi"]) or latin(renderings["hi"]):
            bad.append(f"hi name {name!r}")
    check("Kannada renderings are Kannada script, Hindi are Devanagari, no Latin, same slots",
          not bad, "; ".join(bad))


def test_review_status_is_honest():
    check("the catalog does not claim native-speaker review", REVIEW_STATUS == "unreviewed")


# =========================================================
# 3  THE FALLBACK POLICY
# =========================================================

def test_fallback_policy():
    unknown = "Continuing. Please insert your card into the ATM."
    for language in LANGUAGES:
        rendered, status = localize_detailed(unknown, language)
        check(f"[{language}] unknown fixed text is marked, not silently English",
              status == FALLBACK and UNTRANSLATED_MARKER[language] in rendered, rendered)
        check(f"[{language}] the known part is still rendered",
              rendered.startswith(localize("Continuing.", language)[0]), rendered)
        check(f"[{language}] localize() reports translated=False for it", localize(unknown, language)[1] is False)

    generated = GeneratedText("A cheque book is a booklet of cheques.")
    for language in LANGUAGES:
        rendered, status = localize_detailed(generated, language)
        check(f"[{language}] LLM text passes through unchanged", status == GENERATED and rendered == generated)

    mixed = compose(generated, "Sign the withdrawal slip.")
    check("compose() keeps the parts", isinstance(mixed, ComposedReply) and len(mixed.parts) == 2)
    check("compose() of fixed parts is a plain str", type(compose("Okay.", _INSTRUCTION)) is str)
    rendered, status = localize_detailed(mixed, "kn")
    check("a composed reply renders its fixed part and keeps the LLM part",
          status == MIXED and rendered.startswith(str(generated))
          and rendered.endswith(INSTRUCTIONS["Sign the withdrawal slip."]["kn"]), rendered)

    check("English is unchanged", localize(unknown, "en") == (unknown, True))
    check("an unsupported language is unchanged, as before",
          localize_detailed("Okay.", "fr") == ("Okay.", UNSUPPORTED_LANGUAGE)
          and localize("Okay.", "fr") == ("Okay.", False))


def test_marked_text_still_behaves_as_text():
    g = GeneratedText("answer")
    check("GeneratedText equals its string", g == "answer" and isinstance(g, str))
    check("GeneratedText serialises as a string", json.dumps({"m": g}) == '{"m": "answer"}')


# =========================================================
# 4  BEHAVIOUR THROUGH THE REAL TURN
# =========================================================

class ScriptedDetector:
    """Banking intents by utterance; abstains on anything else."""

    INTENTS = {"deposit please": "deposit money", "withdraw please": "withdraw money"}

    def detect_intent(self, text):
        intent = self.INTENTS.get(text.strip().lower())
        return {"intent": intent or "deposit money", "confidence": 0.9,
                "category": "BANKING_INTENT" if intent else "KNOWLEDGE_QUESTION",
                "is_banking_intent": bool(intent), "margin": 0.2 if intent else -0.2,
                "evidence": [intent] if intent else []}


def run_script(language, script):
    from debugging.test_service_turn import FakeUnderstanding, make_runtime, fresh_conversation

    fake = FakeUnderstanding()
    runtime = make_runtime(ScriptedDetector(), fake)
    conversation = fresh_conversation(language)
    localizer = ResponseLocalizer(language)
    replies, states = [], []

    for text, understanding in script:
        if understanding:
            fake.set(*understanding[:2], step_completed=understanding[2])
        result = runtime.run_turn(conversation, text, localizer)
        replies.append(result)
        states.append((conversation.workflow_state, conversation.current_workflow,
                       conversation.current_step, dict(conversation.entities)))
    return conversation, replies, states


DEPOSIT_SCRIPT = [
    ("deposit please", None),
    ("done", ("workflow_action", "complete", True)),
    ("done", ("workflow_action", "complete", True)),
    ("pause", None),
    ("resume", None),
    ("repeat", None),
    ("done", ("workflow_action", "complete", True)),
    ("done", ("workflow_action", "complete", True)),
]


def test_progression_is_identical_in_every_language():
    runs = {lang: run_script(lang, DEPOSIT_SCRIPT) for lang in ("en", "kn", "hi")}
    en_conv, en_replies, en_states = runs["en"]

    check("the English run completes the deposit", en_states[-1][0] == WorkflowState.COMPLETED,
          str(en_states[-1]))
    # The last completion moves current_step one past the final step (5 of
    # 4) and completes the workflow -- the engine's own behaviour, unchanged.
    check("the English run advanced one step per completion",
          [s[2] for s in en_states] == [1, 2, 3, 3, 3, 3, 4, 5], str([s[2] for s in en_states]))

    for language in ("kn", "hi"):
        conv, replies, states = runs[language]
        check(f"[{language}] workflow state, step and entities match English after every turn",
              states == en_states, f"{states} vs {en_states}")
        check(f"[{language}] history is the same canonical English",
              conv.history == en_conv.history)
        check(f"[{language}] every canonical reply equals the English reply",
              [r.canonical_reply for r in replies] == [r.reply for r in en_replies])
        script_ok = kannada if language == "kn" else devanagari
        wrong = [r.reply for r in replies if not script_ok(r.reply) or latin(r.reply)]
        check(f"[{language}] every reply is in its script with no English left", not wrong, f"{wrong}")


def test_language_switch_with_repeat_and_conflict():
    from debugging.test_service_turn import FakeUnderstanding, make_runtime, fresh_conversation

    fake = FakeUnderstanding()
    runtime = make_runtime(ScriptedDetector(), fake)
    conversation = fresh_conversation("en")
    localizer = ResponseLocalizer("en")

    started = runtime.run_turn(conversation, "deposit please", localizer)
    check("English start", started.reply == "Please take a deposit slip.", started.reply)

    localizer.set_language("kn")          # what the M2 registry does on a switch
    repeated = runtime.run_turn(conversation, "ಮತ್ತೆ ಹೇಳಿ", localizer)
    check("repeat after the switch replays in Kannada",
          repeated.reply == INSTRUCTIONS["Please take a deposit slip."]["kn"], repeated.reply)
    check("the step did not move", conversation.current_step == 1)

    question = runtime.run_turn(conversation, "withdraw please", localizer)
    check("the conflict question is asked in Kannada",
          kannada(question.reply) and not latin(question.reply), question.reply)
    check("history keeps the English conflict question", question.canonical_reply.startswith("You currently have"))

    localizer.set_language("hi")
    again = runtime.run_turn(conversation, "फिर से बताइए", localizer)
    check("repeat after a second switch re-asks in Hindi",
          devanagari(again.reply) and again.canonical_reply == question.canonical_reply, again.reply)

    answer = runtime.run_turn(conversation, "विराम देकर", localizer)
    check("answering with the word the question used pauses the deposit",
          conversation.current_workflow == "withdraw money"
          and getattr(conversation, "paused_workflow", None) is not None, answer.canonical_reply)
    check("the reply is in Hindi", devanagari(answer.reply) and not latin(answer.reply), answer.reply)


def test_conflict_answers_use_the_words_in_the_question():
    for language, words in (
        ("kn", {"ರದ್ದು ಮಾಡಿ": "cancel", "ವಿರಾಮಗೊಳಿಸಿ": "pause", "ವಿರಾಮದಲ್ಲೇ ಇಟ್ಟು": "pause",
                "ಮುಂದುವರಿಸಬೇಕು": "continue"}),
        ("hi", {"रद्द करके": "cancel", "विराम देकर": "pause", "विराम में रखकर": "pause",
                "जारी रखना": "continue"}),
    ):
        active = localize(conflict_question(WorkflowConflict("deposit money", "withdraw money")), language)[0]
        paused = localize(conflict_question(WorkflowConflict("deposit money", "withdraw money"),
                                            paused=True), language)[0]
        for phrase, choice in words.items():
            stem = phrase.split()[0][:4]
            check(f"[{language}] the question offers {phrase!r}", stem in active or stem in paused)
            check(f"[{language}] answering {phrase!r} selects {choice}",
                  resolve_conflict_answer(phrase) == choice, str(resolve_conflict_answer(phrase)))


def test_resume_hint_uses_a_recognised_word():
    for language, word in (("kn", "ಮುಂದುವರಿಸಿ"), ("hi", "जारी रखो")):
        hint = localize("Say resume when you'd like to continue.", language)[0]
        check(f"[{language}] the resume hint quotes {word!r}", f"'{word}'" in hint, hint)
        check(f"[{language}] {word!r} is a resume command", classify_turn(word) == "resume")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]

    print()
    print("=" * 60)
    print("M6 LOCALISATION TESTS")
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
