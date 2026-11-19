import { cn } from '@/lib/cn';
import {
  datePresets,
  fromDateInputValue,
  shiftDays,
  toDateInputValue,
} from '@/lib/simulatedDate';

interface SimulatedDateControlProps {
  /** Null means the real present. */
  at: string | null;
  onChange: (at: string | null) => void;
  disabled?: boolean;
}

/**
 * The date the detectors are asked about.
 *
 * Nothing is set anywhere by using this: the value travels as one query
 * parameter on a read-only admin request. The customer's own welcome
 * screen takes no such parameter and always reads the real clock, so a
 * date chosen here can never reach a real visit.
 *
 * Whether a date is being simulated at all is said out loud, because
 * every verdict on the screen depends on it and a date box that merely
 * shows today looks the same either way.
 */
export function SimulatedDateControl({
  at,
  onChange,
  disabled = false,
}: SimulatedDateControlProps) {
  const presets = datePresets();
  const effective = at ?? new Date().toISOString();
  const simulating = at !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.12em] text-ink-500 uppercase">
            Simulated date
            {simulating && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-px text-[0.625rem] font-semibold tracking-normal text-amber-900 normal-case">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
                Simulating
              </span>
            )}
          </span>
          <input
            type="date"
            value={toDateInputValue(effective)}
            disabled={disabled}
            onChange={(event) => {
              const iso = fromDateInputValue(event.target.value);
              if (iso) onChange(iso);
            }}
            className={cn(
              'min-h-touch rounded-xl bg-white px-3 text-[0.9375rem] tabular-nums text-ink-900',
              'shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-inset focus:ring-2 focus:ring-brand-500/50 focus-visible:outline-none',
              'disabled:text-ink-400',
              simulating ? 'ring-amber-300' : 'ring-ink-200',
            )}
          />
        </label>

        {/* One control, stepped in either direction: joined so it reads
            as a pair rather than two unrelated buttons. */}
        <div className="inline-flex min-h-touch overflow-hidden rounded-xl bg-white ring-1 ring-ink-200 ring-inset">
          <StepButton
            label="Previous day"
            symbol="−1 day"
            disabled={disabled}
            onClick={() => onChange(shiftDays(effective, -1))}
          />
          <span aria-hidden="true" className="my-2 w-px bg-ink-200" />
          <StepButton
            label="Next day"
            symbol="+1 day"
            disabled={disabled}
            onClick={() => onChange(shiftDays(effective, 1))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="text-[0.6875rem] font-semibold tracking-[0.12em] text-ink-500 uppercase">
          Jump to
        </span>

        <div role="group" aria-label="Date presets" className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const active = preset.iso === null ? at === null : at === preset.iso;

            return (
              <button
                key={preset.key}
                type="button"
                disabled={disabled}
                title={preset.hint}
                aria-pressed={active}
                onClick={() => onChange(preset.iso)}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
                  active
                    ? 'bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]'
                    : 'bg-white text-ink-700 ring-1 ring-ink-200 ring-inset hover:bg-ink-50 hover:ring-ink-300',
                  disabled && 'opacity-50',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepButton({
  label,
  symbol,
  onClick,
  disabled,
}: {
  label: string;
  symbol: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center px-3 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50 hover:text-ink-900 active:bg-ink-100 disabled:opacity-50"
    >
      {symbol}
    </button>
  );
}
