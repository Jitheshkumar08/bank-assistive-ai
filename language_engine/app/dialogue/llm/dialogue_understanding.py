import os
import json
from groq import Groq
from app.knowledge.retriever import KnowledgeRetriever
from app.dialogue.side_question_context import (
    format_recent_context,
    retrieval_query,
)


# =========================================================
# SAFE FALLBACKS
#
# Whenever Groq cannot be reached, or replies with something
# that cannot be trusted, the assistant must degrade instead of
# crashing the session. type "unknown" + action "none" is the
# combination DialogueManager already treats as "leave the
# workflow exactly where it is and re-state the current
# instruction", so an LLM failure can never advance, complete or
# cancel a workflow.
# =========================================================

EMPTY_ENTITIES = {
    "amount": None,
    "account_number": None,
    "name": None,
    "phone_number": None,
    "step_number": None
}


QUESTION_UNAVAILABLE_MESSAGE = (
    "Sorry, I'm having trouble looking that up right now. "
    "Please try asking again in a moment."
)


UNDERSTANDING_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "dialogue_understanding",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "workflow_action",
                        "acknowledgement",
                        "help",
                        "question",
                        "information",
                        "control",
                        "unknown"
                    ]
                },
                "action": {
                    "type": "string",
                    "enum": [
                        "next_step",
                        "complete",
                        "repeat",
                        "cancel",
                        "explain",
                        "provide_information",
                        "none"
                    ]
                },
                "step_completed": {
                    "type": "boolean"
                },
                # The workflow the customer NAMED, when they named
                # one other than the current request ("step 4 of
                # the deposit process"). Null whenever they named
                # none, which is the overwhelmingly common case.
                #
                # Top-level rather than inside `entities` on
                # purpose: entities are values the CUSTOMER
                # supplied about themselves and are persisted by
                # ConversationManager.add_entities(). A reference
                # target is neither, and must never be stored as
                # if the customer had provided it.
                "target_workflow": {
                    "type": ["string", "null"]
                },
                "entities": {
                    "type": "object",
                    "properties": {
                        "amount": {
                            "type": ["number", "null"]
                        },
                        "account_number": {
                            "type": ["string", "null"]
                        },
                        "name": {
                            "type": ["string", "null"]
                        },
                        "phone_number": {
                            "type": ["string", "null"]
                        },
                        "step_number": {
                            "type": ["integer", "null"]
                        }
                    },
                    "required": [
                        "amount",
                        "account_number",
                        "name",
                        "phone_number",
                        "step_number"
                    ],
                    "additionalProperties": False
                }
            },
            "required": [
                "type",
                "action",
                "step_completed",
                "target_workflow",
                "entities"
            ],
            "additionalProperties": False
        }
    }
}


#: Completion budget for the understanding call. See the call site for why.
#: The JSON reply is a handful of short fields; the budget exists so the
#: reasoning that precedes it cannot truncate the document.
UNDERSTANDING_MAX_COMPLETION_TOKENS = 2048

#: Completion budget for spoken answers: reasoning headroom plus a few
#: sentences, since this reply is read aloud.
ANSWER_MAX_COMPLETION_TOKENS = 1024


def fallback_understanding():
    """
    Neutral classification used when the LLM result is unusable.

    `understanding_failed` marks this as "the model did not answer", as
    distinct from "the model answered and the meaning was unclear". The two
    look identical in `type` but must be handled differently: a genuine
    unknown may be carried on the current step, while a FAILURE must not be
    allowed to drive any workflow action at all. Phase 3.2B-13 added the flag
    after a live turn where understanding 400'd and the previous deposit
    workflow simply carried on as though the customer had said nothing.

    It is internal only: never sent to the model, never part of the response
    schema, and absent from every successful classification.
    """

    return {
        "type": "unknown",
        "action": "none",
        "step_completed": False,
        "target_workflow": None,
        "entities": dict(EMPTY_ENTITIES),
        "understanding_failed": True
    }


# =========================================================
# SAFE step_number COERCION
#
# entities["step_number"] chooses WHICH banking instruction is
# read back to the customer, so the value is compared against
# the workflow length with `1 <= step_number <= len(steps)`.
# That comparison assumes an int. The schema asks for
# ["integer", "null"], but the schema is a request, not a
# guarantee: a model that ignores it -- or an older/partial
# reply, or an injected fake in a test -- can return "3", 3.0,
# True, or an empty string, and every one of those either
# raises TypeError inside the comparison (killing the turn) or,
# in the case of True, silently reads back step 1 because bool
# is a subclass of int.
#
# This coerces to a real int or None. It deliberately does NOT
# range-check: whether a step exists is a property of the loaded
# workflow, so that check stays at the use site in
# DialogueManager, which already reports "That step is not
# available in the current workflow."
#
# Anything unrecognisable becomes None, which the manager reads
# as "no specific step requested" and answers by repeating the
# CURRENT step. That is the safe direction -- the customer hears
# the instruction they are actually on rather than an arbitrary
# one, and never a crash.
# =========================================================

def coerce_step_number(value):
    """
    Coerces an LLM-supplied step_number into an int, or None.
    """

    if value is None:
        return None

    # bool before int: True/False are ints in Python, and a
    # boolean is never a step number.
    if isinstance(value, bool):
        return None

    if isinstance(value, int):
        return value

    if isinstance(value, str):

        text = value.strip()

        if not text:
            return None

        try:
            value = float(text)
        except (TypeError, ValueError):
            return None

    if isinstance(value, float):

        # Rejects NaN and infinity as well as 3.5 -- is_integer()
        # is False for all three.
        if value.is_integer():
            return int(value)

        return None

    return None



class DialogueUnderstanding:

    def __init__(self):

        api_key = os.getenv("GROQ_API_KEY")

        if not api_key:
            raise RuntimeError(
                "GROQ_API_KEY environment variable is not set."
            )
        api_key = api_key.strip()
        
        self.client = Groq(api_key=api_key)
        self.knowledge_retriever = KnowledgeRetriever()

        print("Dialogue Understanding Model Ready ✅")

    # =====================================================
    # 1. UNDERSTAND USER MESSAGE
    # =====================================================

    def understand(
        self,
        user_text,
        current_workflow=None,
        current_step=None,
        current_instruction=None
    ):

        prompt = f"""
You are the dialogue understanding component of a banking voice assistant.

Understand the customer's latest message using the current workflow context.

CURRENT WORKFLOW:
{current_workflow}

CURRENT STEP:
{current_step}

CURRENT INSTRUCTION:
{current_instruction}

CUSTOMER MESSAGE:
{user_text}

Classify the customer's message.

TYPE must be exactly one of:

workflow_action
acknowledgement
help
question
information
control
unknown

ACTION must be exactly one of:

next_step
complete
repeat
cancel
explain
provide_information
none

Rules:

1. Understand meaning rather than matching exact words.
2. The customer may use natural language.
3. The customer may make grammar mistakes.
4. The customer may combine information and an action.

4a. LANGUAGE. The customer may speak English, Kannada or
    Hindi, and speech-to-text supplies no punctuation and no
    capitalisation. Classify by MEANING in whatever language
    the text is written in. Never classify a request as
    acknowledgement or control merely because it is not in
    English. Always reply with the same JSON schema and the
    same English field values.

    Kannada / Hindi examples:

      "ನನಗೆ ಹಣ ತೆಗೆಯಬೇಕು" (I need to withdraw money)
        -> type = workflow_action, a request to withdraw.
           It is NOT an acknowledgement.

      "मुझे पैसे जमा करने हैं" (I need to deposit money)
        -> type = workflow_action, a request to deposit.

      "ನಾನು ಐದು ಸಾವಿರ ರೂಪಾಯಿ ಜಮಾ ಮಾಡಬೇಕು"
        -> a deposit request carrying amount = 5000.
           "ಐದು ಸಾವಿರ" is five thousand; "ಎರಡು ಲಕ್ಷ" is
           200000; Hindi "पाँच हज़ार" is 5000.

      "ನಿಲ್ಲಿಸು" / "ಸಾಕು" / "रुको"  -> type = control.
      "ಧನ್ಯವಾದಗಳು" / "धन्यवाद"      -> acknowledgement.
      "ಮತ್ತೆ ಹೇಳಿ" / "फिर से बताइए" -> control, repeat.
      "ನಾನು ಹಣ ಹಾಕಿದ್ದೇನೆ" (I have deposited the money)
        -> completion of the current step, not a new request.

5. "yes I took the slip" means complete if the current
   instruction was to take the slip.

6. "I have filled my account number" means complete if
   the current step asks for the account number.

7. "I entered 20000 and I am done" means complete and
   should extract amount = 20000.

8. "Why do I need to sign this?" is a help request,
   NOT a cancellation.

9. "Can you say that again?" means repeat.

10. "I don't want to continue" means cancel.

11. "What should I do now?" means next_step when a
    workflow is active.

12. Questions asking WHERE, WHY, HOW, WHO, WHEN, or other
    banking/process information are general questions unless
    they explicitly ask what the next workflow step is.

13. "Where should I submit this?" is a question/help request,
    NOT next_step.

14. "Where do I give the slip?" is a question/help request,
    NOT next_step.

15. "Why do I need to sign this?" is a question/help request.

16. "What is the next step?" means next_step.

17. "What should I do now?" means next_step.

18. "What do I do next?" means next_step.

19. Extract information explicitly provided by the customer.

20. Never invent information.

21. If there is no meaningful workflow action, use action = none.

22. Short acknowledgements such as "ok", "okay", "alright",
    "hmm", "right", or similar responses without meaningful
    completion information should be classified as
    acknowledgement.

23. "ok", "okay", "hmm", and "alright" must NOT be classified
    as complete or next_step by themselves.

24. A response such as "yes" may be classified as complete only
    when the current instruction makes it clear that the customer
    has completed that instruction.

25. Do not advance the workflow merely because the customer
    acknowledges the assistant.

26. If the customer asks for information about a banking service,
    such as "tell me about education loans", classify it as
    question or help, NOT information.

27. Customer-provided information is different from a request
    for information.

28. Examples:

    "My account number is 12345" → information.

    "I entered 20000" → information or workflow_action
    depending on the current instruction.

    "Tell me about education loans" → question.

    "What documents are needed?" → question.

    "Where should I submit this?" → question.

    "Why is this required?" → help.

29. If the user's message is ambiguous, do not assume that the
    workflow step is complete. Use action = none.

30. The user may respond with very short, incomplete, unclear,
    or conversational expressions. Interpret them using the
    current instruction and workflow context rather than relying
    only on keywords.

31. The user may interrupt the expected workflow response with
    an unrelated banking question or request. Handle the
    question without losing the current workflow state.

32. After answering a question or providing help, the workflow
    must remain at the same current step unless the user's
    message explicitly indicates completion of that step.

33. The CURRENT INSTRUCTION determines what type of
    information the customer is expected to provide.

34. If the current instruction asks for an account number
    and the customer provides a number, treat that number
    as account_number.

35. If the current instruction asks for a deposit amount
    or withdrawal amount and the customer provides a number,
    treat that number as amount.

36. When the customer provides the information requested by
    the current instruction, action should normally be complete.

37. If the customer provides an entity that clearly satisfies
    the current instruction, do not classify it as merely
    next_step.

38. A short acknowledgement such as "ok", "hmm", "yes",
    "done", or "okay" does not automatically mean the
    current step is complete. Use the current instruction
    and conversation context.

39. The customer's response can occur at any point in the
    workflow and is not limited to expected answers.

40. Never assume that the customer responds immediately
    after the assistant's previous instruction.

41. If the customer changes topic or asks an unrelated
    banking question, handle it without losing the current
    workflow state.
42. If the customer explicitly refers to a workflow step number,
    extract that number as step_number.

43. "repeat step 3" means action = repeat and step_number = 3.

44. "say step 3 again" means action = repeat and step_number = 3.

45. "can you repeat step 2?" means action = repeat
    and step_number = 2.

46. "no, the step 3" means action = repeat and
    step_number = 3 when the customer is correcting
    which step they want repeated.

47. If the customer asks to repeat something but does not
    specify a step number, use action = repeat and
    step_number = null.

48. Never invent or guess a step number.

49. Distinguish an INTENTION to act from a COMPLETED action.
    This distinction decides whether a required banking step is
    marked done, so it must never be guessed.

50. A message saying the customer is about to do, is currently
    doing, or intends to do the current instruction is
    type = acknowledgement with action = none. It must NEVER be
    classified as complete.

51. Intention examples, all acknowledgement + none:

    "I need to fill this."
    "I'll fill it."
    "Let me fill this."
    "I am filling it."
    "I'll do it."
    "Okay, I'll fill it."
    "I will take the slip."

52. Completion examples, all action = complete:

    "I filled it."
    "I completed it."
    "I entered it."
    "I have filled the account number."
    "I submitted it."
    "Yes, I entered it."

53. The difference is whether the customer reports the action as
    already carried out, not which particular words they use.
    Future or in-progress means acknowledgement. Reported as
    finished means complete.

54. A statement of intention that refers to the CURRENT
    INSTRUCTION is an acknowledgement, not unknown. Do not
    classify it as unknown merely because it does not repeat the
    banking term used in the instruction. While the current
    instruction is "Fill in your account number.", the message
    "I need to fill this" refers to that step and is an
    acknowledgement.

55. "next", "what's next", "what should I do next" and "what is
    the next step" are requests for direction: action =
    next_step. They are never evidence that the current step has
    been completed.

56. "yes, next", "okay next", "okay, continue" and similar
    messages are requests to proceed or acknowledgements. Use
    next_step or acknowledgement. Never use complete for them,
    because the customer has not said the current instruction was
    carried out.

57. Use complete only when the customer's own message reports
    that the current instruction has been carried out, or
    supplies, as the customer's own answer, the information the
    current instruction asked for. A value that appears only
    inside a question is NOT supplied information.

58. When you are unsure whether a message means intention or
    completion, choose acknowledgement with action = none. Never
    guess complete.

SPELLING, WORDING AND PRONUNCIATION REQUESTS

59. A request to spell something, write it out, say it letter by
    letter, pronounce it, read it aloud, or confirm its wording is
    a request for help with language. It is type = question or
    type = help with action = none. It is NEVER complete.

60. Spelling and wording examples, all question or help with
    action = none:

    "Can you spell 20000 rupees?"
    "Can you say the exact spelling?"
    "Spell it like T-W-E-N-T-Y-T-H-O-U-S-A-N-D-R-U-P-E-E-S."
    "How do I write twenty thousand?"
    "How do you pronounce this?"
    "What is the word for 20000?"
    "How do I say this amount in words?"

61. Mentioning a value inside such a request is NOT providing that
    value. "Can you spell 20000 rupees?" does not mean the
    customer entered 20000. Do not treat a number as supplied
    information, and do not mark the step complete, when the
    number appears only inside a question about how to write, say
    or spell it.

62. Rules 35, 36 and 37 apply only when the customer is SUPPLYING
    the requested information as their own answer. They do not
    apply when the value appears inside a question about spelling,
    wording or pronunciation.

63. The customer can still complete the amount step normally.
    "I entered 20000", "I have written the amount", "I filled in
    the amount" and "Yes, I entered the amount" are still
    complete, because the customer is reporting what they did
    rather than asking how to write it.

STEP_COMPLETED -- THE COMPLETION SIGNAL

64. step_completed is a separate true/false signal, independent of
    type and action. It answers exactly one question:

      Has the customer stated that they carried out the CURRENT
      INSTRUCTION?

65. Set step_completed = true ONLY when the customer's own message
    reports the current instruction as already done. Examples:

    "I filled it."
    "I completed it."
    "I entered the amount."
    "I signed the withdrawal slip."
    "I submitted the form."
    "Yes, I have written my account number."

66. Set step_completed = false in every other case, including:

    - intentions: "I need to fill this", "I'll do it", "let me
      fill it", "I am filling it"
    - direction requests: "what should I do next?", "next",
      "yes, next", "okay continue"
    - acknowledgements: "ok", "okay", "hmm", "alright"
    - any question, including one that mentions a value
    - spelling, wording and pronunciation requests (rules 59-63)
    - anything you are unsure about

67. Merely mentioning an entity or a value NEVER sets
    step_completed = true on its own. The customer must say they
    did the thing.

68. A question NEVER sets step_completed = true, even when the
    question contains a number or refers to the current step.
    "Can you spell 20000 rupees?" is step_completed = false.

69. "What should I do next?" on its own is step_completed = false.
    It is a request for direction, not a report of work done.

COMPOUND MESSAGES

70. A single message may carry BOTH a completion report AND a
    separate request. step_completed exists so neither signal is
    lost. Set step_completed = true for the completion, and use
    type and action for the rest of the message.

71. Compound examples:

    "Yes, I completed by filling my account number. Next what
    should I do?"
        step_completed = true
        type = workflow_action
        action = next_step

    "I signed the withdrawal slip. Where should I submit the
    slip?"
        step_completed = true
        type = question
        action = none

    "I entered 20000. Why is this required?"
        step_completed = true
        type = help
        action = none
        entities.amount = 20000

72. When a message is ONLY a completion report, set
    step_completed = true and action = complete.

73. Report the completion once. step_completed refers to the
    CURRENT INSTRUCTION only, never to a step already finished
    and never to a step not yet reached.

TARGET_WORKFLOW -- WHICH PROCESS A STEP BELONGS TO

74. target_workflow is the name of a banking process the customer
    NAMED, when it is not the request they are currently in. Use
    null whenever they named none. Null is the normal answer.

75. Set it to the name exactly as the customer said it. Do not
    translate it, do not correct it, and do not invent a name.

76. Examples, while the CURRENT WORKFLOW is "withdraw money":

    "Tell me step 4."
        target_workflow = null
        (they mean the withdrawal they are in)

    "Tell me step 4 of the deposit process."
        target_workflow = "deposit"
        action = repeat, step_number = 4

    "Step 4 of loan application."
        target_workflow = "loan application"
        action = repeat, step_number = 4

    "What is step 2?"
        target_workflow = null

77. Naming another process is INFORMATIONAL. It is never a
    request to start, switch to, resume or cancel anything. Do
    not set action = complete, cancel or next_step because
    another process was mentioned, and never set
    step_completed = true.

78. "I want to deposit money" is a request to START a workflow,
    not a step reference: target_workflow = null, step_number =
    null. Only set target_workflow when the customer is asking
    ABOUT a named process, not asking to begin one.

Return only the structured result required by the schema.
"""

        try:

            response = self.client.chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a strict banking dialogue "
                            "understanding system. Follow the "
                            "supplied schema exactly."
                        )
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                response_format=UNDERSTANDING_RESPONSE_FORMAT,
                temperature=0,
                # WHY THIS IS SET (Phase 3.2B-13)
                #
                # A live Kannada turn failed with a 400 whose
                # failed_generation read "max completion tokens
                # reached before generating a valid document".
                # openai/gpt-oss-20b is a reasoning model: it
                # spends completion tokens thinking BEFORE it
                # emits the JSON, and with the provider default
                # budget a long prompt could exhaust the budget
                # mid-document. Structured output then fails as a
                # whole -- there is no partial JSON to salvage.
                #
                # The reply itself is tiny (five short fields), so
                # this budget is not about output size; it is
                # headroom for the reasoning that precedes it.
                # Nothing about the schema or the semantics
                # changes, and a well-behaved turn uses far less.
                max_completion_tokens=UNDERSTANDING_MAX_COMPLETION_TOKENS
            )

        except Exception as error:

            # Network failure, timeout, rate limit, auth problem.
            # The conversation and its workflow are left untouched
            # and the caller receives a neutral classification.

            print(
                f"[LLM] Understanding request failed "
                f"({type(error).__name__}): {error}"
            )

            return fallback_understanding()

        return self._parse_understanding(response)

    # =====================================================
    # RESPONSE HANDLING HELPERS
    # =====================================================

    @staticmethod
    def _extract_content(response):
        """
        Pulls message content out of a Groq response, tolerating
        a truncated or short-circuited response object.

        Returns None when there is nothing usable -- notably when
        the provider returns content=None, which would otherwise
        reach json.loads() and raise TypeError.
        """

        try:

            choices = response.choices

            if not choices:
                return None

            return choices[0].message.content

        except (AttributeError, IndexError, TypeError):

            return None

    def _parse_understanding(self, response):
        """
        Converts a Groq response into the structured dict
        DialogueManager expects, or a safe fallback.
        """

        content = self._extract_content(response)

        if content is None or not str(content).strip():

            print(
                "[LLM] Understanding response was empty; "
                "using safe fallback."
            )

            return fallback_understanding()

        try:

            result = json.loads(content)

        except (json.JSONDecodeError, TypeError, ValueError) as error:

            print(
                f"[LLM] Understanding response was not valid JSON "
                f"({type(error).__name__}); using safe fallback."
            )

            return fallback_understanding()

        if not isinstance(result, dict):

            print(
                "[LLM] Understanding response was not a JSON "
                "object; using safe fallback."
            )

            return fallback_understanding()

        entities = result.get("entities")

        if not isinstance(entities, dict):
            entities = {}

        # Normalize accidental string "null" values
        for key, value in list(entities.items()):

            if (
                isinstance(value, str)
                and value.lower() == "null"
            ):
                entities[key] = None

        # Guarantee the complete entity set the schema promises,
        # so callers may read entities["step_number"] safely even
        # on a partial reply.
        result["entities"] = {**EMPTY_ENTITIES, **entities}

        # step_number is coerced to a real int (or None) here, so
        # every caller reads a value it can compare against the
        # workflow length without a type check of its own. See
        # coerce_step_number() for why a raw schema value cannot
        # be trusted.
        result["entities"]["step_number"] = coerce_step_number(
            result["entities"].get("step_number")
        )

        if not result.get("type"):
            result["type"] = "unknown"

        if not result.get("action"):
            result["action"] = "none"

        # Completion is the one signal that can advance a banking
        # step, so it is coerced to a real bool here and defaults
        # to False. A missing, null or unparseable value therefore
        # means "not completed" -- the safe direction, since the
        # worst outcome of a false negative is repeating a step,
        # while a false positive silently skips one.

        result["step_completed"] = (
            result.get("step_completed") is True
        )

        # target_workflow is a NAME the customer spoke, not an
        # identity. It is normalized to a non-empty string or
        # None here; resolving it to a workflow that actually
        # exists is WorkflowLoader.resolve_workflow_name()'s job,
        # and a name that resolves to nothing produces a safe
        # reply rather than a guess.
        target_workflow = result.get("target_workflow")

        if isinstance(target_workflow, str):

            target_workflow = target_workflow.strip()

            if not target_workflow or target_workflow.lower() == "null":
                target_workflow = None

        else:
            target_workflow = None

        result["target_workflow"] = target_workflow

        return result

    # =====================================================
    # 2. ANSWER USER QUESTION
    # =====================================================

    def answer_question(
        self,
        question,
        workflow_context,
        current_instruction,
        recent_context=None
    ):

        """
        `recent_context` is an optional RecentSideQuestion holding
        AT MOST ONE preceding side-question exchange, used only to
        resolve a simple reference ("spell IT letter by letter").

        It defaults to None, so every existing caller keeps
        working unchanged and behaves exactly as before.
        """

        # -------------------------------------------------
        # Retrieve relevant banking knowledge
        #
        # RAG is neither replaced nor bypassed -- it is given the
        # referent it would otherwise be missing. "Spell it letter
        # by letter" retrieves nothing useful as a query on its
        # own. retrieval_query() returns the question UNCHANGED
        # whenever there is no reference to resolve or no subject
        # to resolve it to, so retrieval behaviour is untouched in
        # every other case.
        # -------------------------------------------------

        search_query = retrieval_query(question, recent_context)

        try:

            results = self.knowledge_retriever.search(
                search_query,
                top_k=2
            )

        except Exception as error:

            # Retrieval failure must not end the session; answer
            # without grounding context and let the prompt's own
            # rules force an honest "not enough information".

            print(
                f"[RAG] Knowledge retrieval failed "
                f"({type(error).__name__}): {error}"
            )

            results = []

        knowledge_context = "\n\n".join(
            [
                f"Source: {result['source']}\n"
                f"{result['content']}"
                for result in results
            ]
        )

        # -------------------------------------------------
        # Question answering prompt
        # -------------------------------------------------

        # The bounded context block. Empty string when there is
        # nothing remembered, so the prompt is byte-identical to
        # the previous phase's for every non-referential question.
        recent_block = format_recent_context(recent_context)

        recent_section = (
            f"""
IMMEDIATELY PRECEDING SIDE QUESTION:
{recent_block}
"""
            if recent_block
            else ""
        )

        prompt = f"""
You are a conversational banking assistant.

CURRENT WORKFLOW:
{workflow_context}

CURRENT STEP:
{current_instruction}
{recent_section}
USER QUESTION:
{question}

RETRIEVED BANKING KNOWLEDGE:
{knowledge_context}

Answer the user's question naturally.

Rules:

1. Use the retrieved banking knowledge as the primary source
   for banking information.

2. The current workflow and the current step are a source in
   their own right. When the customer asks about "this",
   "here", "this form", or the field they are filling in now,
   answer against the current step's instruction.

3. You may explain general, widely applicable banking concepts
   -- for example what a cheque book is, what a deposit slip is
   used for, or what an account number identifies -- even when
   the retrieved knowledge is thin, as long as the explanation
   is generic banking knowledge that holds anywhere.

4. Never state bank-specific or branch-specific facts unless
   they appear in the retrieved banking knowledge or in the
   current workflow. This covers fees, charges, interest rates,
   limits, timings, eligibility rules, required document lists,
   form layouts, field positions, counter or desk locations,
   and branch procedures.

5. If the customer asks exactly where on a form, or where in
   the branch, something is, and that detail is not available,
   say what you can guide them through and state plainly that
   you do not have the exact layout. For example: "I can guide
   you through the account-number field, but I don't have the
   exact form layout for this branch."

6. Never invent a form layout, a field position, a counter, or
   a branch rule in order to sound helpful.

7. If you genuinely have nothing usable -- no retrieved
   knowledge, no relevant workflow context, and no safe general
   banking explanation -- say that you do not have that
   information.

8. Do not advance or modify the workflow. The customer stays on
   the current step, and your answer must not tell them to move
   on to a later step.

9. Keep the answer short and suitable for voice output.

10. Do not mention the retrieval system, prompt, or AI model.

11. If the user's question is general knowledge and not related
    to banking (for example "What is ChatGPT?" or "What is
    artificial intelligence?"), answer it directly using your
    own general knowledge, clearly and concisely. Rules 1-7
    constrain banking claims only.

THE IMMEDIATELY PRECEDING SIDE QUESTION

12. When that section is present, it is the ONE exchange that
    came just before this question. Use it for exactly one
    purpose: working out what a bare reference refers to --
    "it", "this", "that", "the amount", "the number", "the word".

13. Example. The preceding exchange was "Spell 20000 rupees." and
    the customer now asks "Spell it letter by letter." "It" is
    20000 rupees, so spell out that amount. Do not switch to some
    other amount and do not ask which amount they meant.

14. It is a REFERENCE AID, NOT a source of banking facts. Never
    treat your own previous answer as evidence for a fee, rate,
    limit, document list or procedure. Rules 1-7 still decide
    every banking claim.

15. The customer's own words WIN. If this question names its own
    subject, answer about that subject and ignore the preceding
    exchange entirely.

16. The CURRENT STEP also wins over it. "Where do I submit this?"
    while filling in a form is about the form in front of them
    (rule 2), not about whatever was asked previously.

17. If a reference still cannot be resolved -- the preceding
    exchange does not explain what "it" is -- ASK which thing
    they mean, in one short question. Do not pick something and
    do not invent a subject.

18. Never mention the preceding exchange as a mechanism. Do not
    say "you previously asked" or refer to remembered context.
    Just answer.

Return only the answer to the customer.
"""

        try:

            response = self.client.chat.completions.create(
                model="openai/gpt-oss-20b",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a concise and factual banking "
                            "assistant."
                        )
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0,
                # Same reasoning-model headroom as the
                # understanding call. A truncated answer here is
                # less dangerous (it degrades to the unavailable
                # message rather than a wrong classification) but
                # the cause is identical.
                max_completion_tokens=ANSWER_MAX_COMPLETION_TOKENS
            )

        except Exception as error:

            print(
                f"[LLM] Question answering request failed "
                f"({type(error).__name__}): {error}"
            )

            return QUESTION_UNAVAILABLE_MESSAGE

        content = self._extract_content(response)

        if content is None or not str(content).strip():

            print(
                "[LLM] Question answering response was empty."
            )

            return QUESTION_UNAVAILABLE_MESSAGE

        return content.strip()