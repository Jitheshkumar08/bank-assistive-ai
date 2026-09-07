import { useContext } from 'react';
import { ConversationContext, type ConversationState } from './ConversationContext';

export function useConversation(): ConversationState {
  const context = useContext(ConversationContext);

  if (!context) {
    throw new Error('useConversation must be used inside a ConversationProvider.');
  }

  return context;
}
