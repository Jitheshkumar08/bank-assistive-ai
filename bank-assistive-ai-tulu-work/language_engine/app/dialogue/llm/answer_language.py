"""The answer-language instruction for knowledge answers (M7).

Knowledge answers are written by the LLM. Before M7 the answer prompt never
said which language to answer in, so a Kannada customer got whichever
language the model chose. This module builds the instruction that says it.

WHAT AN OFFLINE TEST CAN AND CANNOT SHOW

Tests check that the instruction is built correctly and reaches the prompt.
They cannot show the model obeys it: that needs the live LLM, and nothing in
this project's offline suites calls it. Compliance must be measured live.

THE INSTRUCTION

  - names the language AND the script (Kannada script, Devanagari), because
    a model asked for "Kannada" can still answer in Latin transliteration;
  - lets digits, amounts, account numbers and the banking terms the customer
    used stay as written, which is also what the fixed replies do (M6);
  - says the "I do not have that information" answer must be in the same
    language, so the safe fallback is not the one thing left in English.
"""

#: language code -> (language name, script name)
ANSWER_LANGUAGES = {
    "en": ("English", "the Latin alphabet"),
    "kn": ("Kannada", "Kannada script"),
    "hi": ("Hindi", "Devanagari script"),
}

DEFAULT_ANSWER_LANGUAGE = "en"


def answer_language(language):
    """The code to answer in: the session language when supported, else English."""
    code = (language or DEFAULT_ANSWER_LANGUAGE).strip().lower().split("-")[0]
    return code if code in ANSWER_LANGUAGES else DEFAULT_ANSWER_LANGUAGE


def answer_language_rules(language):
    """The prompt rules for answering in `language` (a session language code)."""
    code = answer_language(language)
    name, script = ANSWER_LANGUAGES[code]

    if code == "en":
        return (
            "ANSWER LANGUAGE\n\n"
            "Answer in English."
        )

    return (
        "ANSWER LANGUAGE\n\n"
        f"Answer in {name}, written in {script}. The customer reads and hears this answer in "
        f"{name}: do not answer in English or in any other language, and do not write {name} "
        "in the Latin alphabet.\n"
        "Digits, amounts, account numbers and the banking terms the customer used (for example "
        "'deposit slip' or 'cheque book') may stay as written.\n"
        f"If you do not have the information, say so in {name}."
    )


def answer_language_system_note(language):
    """One sentence for the system message, repeating the language."""
    name, script = ANSWER_LANGUAGES[answer_language(language)]
    return f"Always answer in {name} ({script})."
