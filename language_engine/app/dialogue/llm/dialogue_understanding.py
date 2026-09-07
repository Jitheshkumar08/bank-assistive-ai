import os
import json
from groq import Groq
from app.knowledge.retriever import KnowledgeRetriever


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
                "entities"
            ],
            "additionalProperties": False
        }
    }
}


def fallback_understanding():
    """
    Neutral classification used when the LLM result is unusable.
    """

    return {
        "type": "unknown",
        "action": "none",
        "entities": dict(EMPTY_ENTITIES)
    }



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
                temperature=0
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

        if not result.get("type"):
            result["type"] = "unknown"

        if not result.get("action"):
            result["action"] = "none"

        return result

    # =====================================================
    # 2. ANSWER USER QUESTION
    # =====================================================

    def answer_question(
        self,
        question,
        workflow_context,
        current_instruction
    ):

        # -------------------------------------------------
        # Retrieve relevant banking knowledge
        # -------------------------------------------------

        try:

            results = self.knowledge_retriever.search(
                question,
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

        prompt = f"""
You are a conversational banking assistant.

CURRENT WORKFLOW:
{workflow_context}

CURRENT STEP:
{current_instruction}

USER QUESTION:
{question}

RETRIEVED BANKING KNOWLEDGE:
{knowledge_context}

Answer the user's question naturally.

Rules:

1. Use the retrieved banking knowledge as the primary source.

2. Use the current workflow context when relevant.

3. Do not invent, infer, assume, or add banking rules,
   fees, limits, documents, procedures, branch policies,
   locations, counters, or other facts.

4. Every factual claim in your answer must be directly
   supported by the retrieved banking knowledge or the
   current workflow.

5. If the requested information is not explicitly available,
   say that you do not have enough information.

6. If the retrieved information does not contain the answer,
   clearly say that you do not have enough information.

7. Keep the answer short and suitable for voice output.

8. Do not advance or modify the workflow.

9. Do not mention the retrieval system, prompt, or AI model.

10. If the user's question is general knowledge and not
    related to banking (for example "What is ChatGPT?" or
    "What is artificial intelligence?"), you may answer it
    directly using your own general knowledge, clearly and
    concisely -- rules 1-6 apply only to banking-specific
    claims, not to unrelated general knowledge.

11. Regardless of the topic, never state banking-specific
    facts, rules, fees, limits, documents, procedures, or
    branch policies unless they are explicitly supported by
    the retrieved banking knowledge or the current workflow.

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
                temperature=0
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