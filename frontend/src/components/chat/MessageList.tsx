import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { Spinner } from '@/components/ui/Spinner';
import type { ConversationMessage } from '@/types/assistant';

interface MessageListProps {
  messages: ConversationMessage[];
  isSending: boolean;
}

export function MessageList({ messages, isSending }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view. jsdom has no layout, so the guard
  // stops tests failing on a method that does not exist there.
  useEffect(() => {
    const node = endRef.current;

    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isSending]);

  return (
    <div
      // min-h-0 lets this shrink inside its flex parent; without it the
      // list grows instead of scrolling and pushes the composer away.
      className="min-h-0 flex-1 overflow-y-auto"
      // A log announces additions without stealing focus, which is what
      // a conversation needs: the customer stays in the text box while
      // replies are read out.
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
    >
      <ul className="flex flex-col gap-3 pb-2">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {isSending && (
          <li className="flex items-center gap-2 text-ink-500" aria-label="Assistant is replying">
            <span className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-ink-200 bg-white px-4 py-3 shadow-sm">
              <Spinner className="size-4 text-brand-600" label={null} />
              <span className="text-base">Thinking</span>
            </span>
          </li>
        )}
      </ul>

      <div ref={endRef} />
    </div>
  );
}
