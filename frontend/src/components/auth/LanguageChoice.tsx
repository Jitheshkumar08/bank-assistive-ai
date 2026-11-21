import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * The languages the assistant can actually speak.
 *
 * Each is written in its own script. Someone who reads only Kannada has
 * to be able to recognise their own option -- a list that says
 * "Kannada" in English is useless to exactly the person who needs it.
 *
 * This list is deliberately the engine's: `app/speech/tts.py` maps these
 * three codes to voices, and offering a fourth here would produce an
 * account whose language has nothing to say it.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'tcy', name: 'Tulu', native: 'ತಳು' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

interface LanguageChoiceProps {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  disabled?: boolean;
}

function CheckIcon() {
  return (
    <svg
      className="size-2.5"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  );
}

/**
 * Three visible choices, not a dropdown.
 *
 * A `select` hides the options behind a tap and renders as a native
 * picker that is hard to read and harder to explain to someone being
 * helped at a counter. Each language is one short word, so the three sit
 * side by side and read as a single decision.
 *
 * The radios are real inputs, visually hidden inside their cards: the
 * group still announces "1 of 3", the arrow keys still move between
 * choices, and a card shows focus whenever the radio inside it has it.
 */
export function LanguageChoice({ value, onChange, disabled }: LanguageChoiceProps) {
  const groupId = useId();
  const labelId = `${groupId}-label`;
  const hintId = `${groupId}-hint`;

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium text-ink-800">
        Language
        <span className="ml-1 text-danger-600" aria-hidden="true">
          *
        </span>
        <span id={hintId} className="ml-1 font-normal text-ink-500">
          — spoken replies
        </span>
      </span>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className="mt-0.5 grid grid-cols-3 gap-2"
      >
        {LANGUAGES.map((language) => {
          const selected = language.code === value;

          return (
            <label
              key={language.code}
              className={cn(
                'relative flex min-h-touch cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-2.5 text-center',
                'transition-[border-color,background-color,box-shadow] duration-150',
                'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-500/25',
                selected
                  ? 'border-brand-600 bg-brand-50 shadow-[0_1px_2px_rgb(15_95_90/0.12)]'
                  : 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={`${groupId}-language`}
                value={language.code}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(language.code)}
                className="sr-only"
              />

              <span lang={language.code} className="block text-base font-semibold text-ink-900">
                {language.native}
              </span>

              {/* The English name is a second line, not a replacement:
                  branch staff helping someone read the screen may not
                  read the script themselves. */}
              {language.native !== language.name && (
                <span className="mt-0.5 block text-xs text-ink-600">{language.name}</span>
              )}

              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-brand-600 text-white"
                >
                  <CheckIcon />
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
