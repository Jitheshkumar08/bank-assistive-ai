from app.conversation.manager import ConversationManager

manager = ConversationManager()

manager.start_conversation()

manager.set_intent("withdraw money")

manager.load_workflow("withdraw workflow")

manager.add_history(
    "User",
    "I want to withdraw twenty thousand rupees."
)

print("\nCurrent Conversation Context\n")

print(manager.get_context())