from app.dialogue.llm.dialogue_understanding import DialogueUnderstanding


understanding = DialogueUnderstanding()


tests = [
    "yes i took the slip",
    "i have filled my account number",
    "I entered 20000 and I am done",
    "why do I need to sign this",
    "can you say that again",
    "I don't want to continue",
    "what should I do now?"
]


for text in tests:

    print("\n-----------------------------")
    print("User:", text)

    result = understanding.understand(
        user_text=text,
        current_workflow="withdraw",
        current_step=3,
        current_instruction="Enter the withdrawal amount."
    )

    print("AI Understanding:")
    print(result)