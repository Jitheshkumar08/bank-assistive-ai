import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
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
      // overscroll-contain keeps a fling at the end of the conversation
      // from dragging the whole page on a phone.
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      // A log announces additions without stealing focus, which is what
      // a conversation needs: the customer stays in the text box while
      // replies are read out.
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
    >
      <ul className="flex flex-col py-3">
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            // Runs of messages from the same side sit close together, and
            // only the last one of a run gets the pointed corner.
            startsGroup={messages[index - 1]?.author !== message.author}
            endsGroup={messages[index + 1]?.author !== message.author}
          />
        ))}

        {isSending && (
          <li
            className={messages.length > 0 ? 'mt-4 flex' : 'flex'}
            aria-label="Assistant is replying"
          >
            <span className="flex items-center gap-1.5 rounded-[1.25rem] rounded-bl-md bg-white px-4 py-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70">
              {[0, 160, 320].map((delay) => (
                <span
                  key={delay}
                  aria-hidden="true"
                  className="size-1.5 animate-typing rounded-full bg-ink-400"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          </li>
        )}
      </ul>

      <div ref={endRef} />
    </div>
  );
}
