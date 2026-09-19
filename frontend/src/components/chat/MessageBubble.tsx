import { cn } from '@/lib/cn';
import type { ConversationMessage } from '@/types/assistant';

interface MessageBubbleProps {
  message: ConversationMessage;
  /** First of a run from the same side, so it is set apart from the last. */
  startsGroup?: boolean;
  /** Last of a run, so it carries the pointed corner. */
  endsGroup?: boolean;
}

export function MessageBubble({ message, startsGroup = true, endsGroup = true }: MessageBubbleProps) {
  const isUser = message.author === 'user';
  const hasFailed = message.status === 'failed';

  return (
    <li
      className={cn(
        'flex w-full flex-col',
        isUser ? 'items-end' : 'items-start',
        startsGroup ? 'mt-4 first:mt-0' : 'mt-1',
      )}
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
          'relative max-w-[85%] rounded-[1.25rem] px-4 py-2.5 text-base leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere] sm:max-w-[75%]',
          isUser
            ? cn('bg-brand-600 text-white', endsGroup && 'rounded-br-md')
            : cn(
                'bg-white text-ink-900 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70',
                endsGroup && 'rounded-bl-md',
              ),
          hasFailed && 'opacity-60',
        )}
      >
        <span className="sr-only">{isUser ? 'You said: ' : 'Assistant said: '}</span>
        {message.content}
      </div>

      {hasFailed && (
        <p className="mt-1 flex items-center gap-1 px-1 text-[0.8125rem] font-medium text-danger-600">
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
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
