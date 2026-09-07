import { cn } from '@/lib/cn';
import type { ConversationMessage } from '@/types/assistant';

interface MessageBubbleProps {
  message: ConversationMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.author === 'user';
  const hasFailed = message.status === 'failed';

  return (
    <li
      className={cn('flex w-full flex-col', isUser ? 'items-end' : 'items-start')}
      // Alignment and colour carry the speaker visually. Neither reaches
      // a screen reader, so the label below says it in words.
      aria-label={isUser ? 'You said' : 'Assistant said'}
    >
      <div
        className={cn(
          // `relative` is load-bearing: the sr-only label below is
          // absolutely positioned, and without a positioned ancestor its
          // containing block becomes the document. It then escapes the
          // conversation's scroll container and stretches the page,
          // which lets the fixed header and composer be scrolled away.
          'relative max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed',
          isUser
            ? 'rounded-br-sm bg-brand-600 text-white'
            : 'rounded-bl-sm border border-ink-200 bg-white text-ink-900 shadow-sm',
          hasFailed && 'opacity-60',
        )}
      >
        <span className="sr-only">{isUser ? 'You said: ' : 'Assistant said: '}</span>
        {message.content}
      </div>

      {hasFailed && (
        <p className="mt-1 flex items-center gap-1 text-sm font-medium text-danger-600">
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6M12 16.5v.5" strokeLinecap="round" />
          </svg>
          Not delivered
        </p>
      )}
    </li>
  );
}
