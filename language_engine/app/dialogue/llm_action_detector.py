import os
from groq import Groq


class LLMActionDetector:

    def __init__(self):

        api_key = os.getenv("GROQ_API_KEY")

        if not api_key:
            raise RuntimeError(
                "GROQ_API_KEY environment variable is not set."
            )

        self.client = Groq(api_key=api_key)

        print("LLM Action Detector Ready ✅")

    def detect(self, text):

        prompt = f"""
You are the dialogue understanding component of a banking voice assistant.

The current workflow is already active.

Classify the user's latest message into exactly ONE of these actions:

next_step
complete
repeat
help
none

Important:
- Understand the meaning of the complete sentence.
- Do not rely on exact keywords.
- Consider that the user may speak naturally.
- "yes, I signed it" can mean complete.
- "I have finished filling the form" can mean complete.
- "okay, what should I do now?" can mean next_step.
- "can you say that again?" can mean repeat.
- "I don't understand what this means" can mean help.
- If the message is unrelated to these actions, return none.

User message:
{text}

Return ONLY one action name.
"""

        response = self.client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                
                    "role": "system",
                    "content": "You are a strict dialogue action classifier."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0
        )

        action = response.choices[0].message.content.strip().lower()

        allowed_actions = {
            "next_step",
            "complete",
            "repeat",
            "help",
            "none"
        }

        if action not in allowed_actions:
            return "none"

        return action