from app.conversation.manager import ConversationManager
from app.dialogue.manager import DialogueManager


conversation = ConversationManager()

conversation.start_conversation()

conversation.set_intent("withdraw money")

conversation.load_workflow("withdraw")

dialogue = DialogueManager()

response = dialogue.generate_response(conversation, "start")
print("\nAssistant Response:\n",response)

response2 = dialogue.generate_response(conversation, "continue")
print("\nNext Step:\n", response2)

response3 = dialogue.generate_response(conversation, "repeat")
print("\nRepeat:\n", response3)
