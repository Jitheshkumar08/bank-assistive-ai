import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'

type CheckboxProps = Omit<ComponentProps<'input'>, 'type' | 'id'> & { id: string; label: string }

/** Native checkbox (keyboard and form behaviour intact) with a custom visual box. */
export default function Checkbox({ id, label, className, ...inputProps }: CheckboxProps) {
  return (
    <label className={['checkbox', className].filter(Boolean).join(' ')} htmlFor={id}>
      <input id={id} type="checkbox" className="checkbox__input" {...inputProps} />
      <span className="checkbox__box" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
      <span className="checkbox__label">{label}</span>
    </label>
  )
}
