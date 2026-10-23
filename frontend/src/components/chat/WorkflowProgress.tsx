import { cn } from '@/lib/cn';
import type { WorkflowSnapshot } from '@/types/assistant';

interface WorkflowProgressProps {
  workflow: WorkflowSnapshot | null;
  className?: string;
}

/** "deposit money" -> "Deposit money". The engine names workflows in lower case. */
function taskName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Where the current banking task stands, above the conversation.
 *
 * Shows only what the engine reported, never an estimate: no total when
 * the engine sent none, no step when there is no step. Nothing at all is
 * shown when there is no task, so an ordinary question-and-answer
 * conversation looks exactly as it did before workflows were wired up.
 *
 * Not a live region. Each step's instruction already arrives as an
 * announced message, and announcing the counter too would read every
 * step out twice.
 */
export function WorkflowProgress({ workflow, className }: WorkflowProgressProps) {
  if (!workflow || workflow.state === 'none' || !workflow.name) return null;

  const total = workflow.totalSteps && workflow.totalSteps > 0 ? workflow.totalSteps : null;
  // The engine moves one past the last step to finish; never show "5 of 4".
  const step = workflow.step !== null && total !== null ? Math.min(workflow.step, total) : workflow.step;

  let status: string;
  let done: number | null = null;

  switch (workflow.state) {
    case 'completed':
      status = 'Completed';
      done = total;
      break;
    case 'cancelled':
      status = 'Cancelled';
      break;
    case 'suspended':
      status = step !== null && total !== null ? `Paused at step ${step} of ${total}` : 'Paused';
      break;
    default:
      status =
        step !== null && total !== null
          ? `Step ${step} of ${total}`
          : step !== null
            ? `Step ${step}`
            : 'In progress';
      // A step is in progress, not done, until the next one starts.
      done = step !== null && total !== null ? step - 1 : null;
  }

  const bar =
    total !== null && done !== null && workflow.state !== 'cancelled' ? { done, total } : null;

  return (
    <section
      aria-label="Current task"
      className={cn(
        'mb-2 rounded-2xl bg-white px-4 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)] ring-1 ring-ink-200/70',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[0.9375rem] font-semibold text-ink-900">
          {taskName(workflow.name)}
        </p>
        <p
          className={cn(
            'shrink-0 text-sm font-medium',
            workflow.state === 'completed' && 'text-success-600',
            workflow.state === 'cancelled' && 'text-ink-500',
            workflow.state === 'suspended' && 'text-ink-600',
            workflow.state === 'active' && 'text-brand-600',
          )}
        >
          {status}
        </p>
      </div>

      {bar && (
        <div
          role="progressbar"
          aria-label={`${taskName(workflow.name)} progress`}
          aria-valuemin={0}
          aria-valuemax={bar.total}
          aria-valuenow={bar.done}
          aria-valuetext={status}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300',
              workflow.state === 'completed' ? 'bg-success-600' : 'bg-brand-500',
            )}
            style={{ width: `${(bar.done / bar.total) * 100}%` }}
          />
        </div>
      )}
    </section>
  );
}
