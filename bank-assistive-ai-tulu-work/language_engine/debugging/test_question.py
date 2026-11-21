from app.dialogue.llm.dialogue_understanding import DialogueUnderstanding


understanding = DialogueUnderstanding()


workflow_context = """
Step 1: Please take a deposit slip.
Step 2: Fill in your account number.
Step 3: Enter the amount to deposit.
Step 4: Submit the slip along with the cash.
"""


questions = [
    "where should I submit this?",
    "why do I need to fill this form?",
    "what should I do now?",
    "what is the next step?",
]


for question in questions:

    print("\n-----------------------------")
    print("User:", question)

    response = understanding.answer_question(
        question=question,
        workflow_context=workflow_context,
        current_instruction="Submit the slip along with the cash."
    )

    print("Assistant:", response)