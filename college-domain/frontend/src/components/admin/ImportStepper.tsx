import { Check } from 'lucide-react'

const steps = ['Upload File', 'Validate', 'Review', 'Import'] as const

/** Reference stepper: 1 Upload File → 2 Validate → 3 Review → 4 Import. `current` is 1-based; 5 = all done. */
export default function ImportStepper({ current }: { current: number }) {
  return (
    <ol className="adm-steps" aria-label="Import steps">
      {steps.map((label, index) => {
        const number = index + 1
        const state = number < current ? 'is-done' : number === current ? 'is-current' : ''
        return (
          <li key={label} className={state} aria-current={number === current ? 'step' : undefined}>
            <span className="adm-steps__dot" aria-hidden="true">{number < current ? <Check size={15} strokeWidth={3} /> : number}</span>
            <span>{label}<span className="visually-hidden">{number < current ? ' (completed)' : number === current ? ' (current step)' : ''}</span></span>
          </li>
        )
      })}
    </ol>
  )
}
