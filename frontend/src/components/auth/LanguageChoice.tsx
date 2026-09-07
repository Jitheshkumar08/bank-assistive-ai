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
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

interface LanguageChoiceProps {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  disabled?: boolean;
}

/**
 * Radio buttons, not a dropdown.
 *
 * A `select` hides the options behind a tap and renders as a native
 * picker that is hard to read and harder to explain to someone being
 * helped at a counter. Three visible targets, each big enough to hit
 * without aiming, cost one extra inch of screen and remove the whole
 * interaction.
 */
export function LanguageChoice({ value, onChange, disabled }: LanguageChoiceProps) {
  const groupId = useId();
  const labelId = `${groupId}-label`;

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-semibold text-ink-800">
        Language
        <span className="ml-1 text-danger-600" aria-hidden="true">
          *
        </span>
      </span>

      <p className="text-sm text-ink-500">The assistant will speak and reply in this language.</p>

      {/* A radiogroup rather than three loose radios, so a screen reader
          announces "1 of 3" and the arrow keys move between them. */}
      <div role="radiogroup" aria-labelledby={labelId} className="mt-1 flex flex-col gap-2">
        {LANGUAGES.map((language) => {
          const selected = language.code === value;

          return (
            <label
              key={language.code}
              className={cn(
                'flex min-h-touch cursor-pointer items-center gap-3 rounded-xl border px-4 py-3',
                'text-base transition-colors',
                selected
                  ? 'border-brand-600 bg-brand-50 text-ink-900'
                  : 'border-ink-300 bg-white text-ink-800 hover:bg-ink-50',
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
                className="size-5 accent-brand-600"
              />

              <span>
                <span className="block font-semibold">{language.native}</span>
                {/* The English name is a second line, not a replacement:
                    branch staff helping someone read the screen may not
                    read the script themselves. */}
                {language.native !== language.name && (
                  <span className="block text-sm text-ink-500">{language.name}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
