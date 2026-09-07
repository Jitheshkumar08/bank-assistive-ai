import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/Button';

interface ComposerProps {
  onSend: (content: string) => void;
  isSending: boolean;
}

export function Composer({ onSend, isSending }: ComposerProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wasSending = useRef(false);

  const canSend = draft.trim().length > 0 && !isSending;

  /**
   * Return focus to the text box once a reply lands.
   *
   * Only when focus is nowhere useful -- on the body, or on the Send
   * button that has just gone quiet. If the customer has deliberately
   * tabbed somewhere else, moving them would be worse than leaving them.
   */
  useEffect(() => {
    const finishedSending = wasSending.current && !isSending;
    wasSending.current = isSending;

    if (!finishedSending) return;

    const active = document.activeElement;
    const focusIsIdle = active === null || active === document.body || active?.tagName === 'BUTTON';

    if (focusIsIdle) inputRef.current?.focus();
  }, [isSending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!canSend) return;

    onSend(draft);
    setDraft('');
  }

  return (
    <form
      className="flex items-end gap-2 border-t border-ink-200 bg-ink-50 pt-4"
      onSubmit={handleSubmit}
    >
      <label htmlFor="assistant-message" className="sr-only">
        Type your message to the assistant
      </label>

      <input
        ref={inputRef}
        id="assistant-message"
        name="message"
        type="text"
        // Off, because banking questions are not worth autocompleting
        // from a shared device's history.
        autoComplete="off"
        placeholder="Type your message"
        className="min-h-touch flex-1 rounded-xl border border-ink-300 bg-white px-4 text-base text-ink-900 placeholder:text-ink-400"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        // Deliberately NOT disabled while a reply is in flight. Disabling
        // an element blurs it, so the customer would lose their place in
        // the form after every message. Submission is gated by canSend
        // instead, which keeps the draft safe without moving focus.
      />

      <Button
        type="submit"
        fullWidth={false}
        disabled={!canSend}
        loading={isSending}
        className="px-4"
      >
        Send
      </Button>
    </form>
  );
}
