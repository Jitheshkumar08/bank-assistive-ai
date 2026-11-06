import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

export type TextFieldProps = Omit<ComponentProps<'input'>, 'id'> & {
  id: string
  label: string
  icon?: LucideIcon
  error?: string
  /** Optional control rendered inside the input on the right, e.g. a show/hide button. */
  endAdornment?: ReactNode
}

/** Labelled input with an optional leading icon and an inline, announced error message. */
export default function TextField({ id, label, icon: Icon, error, endAdornment, className, ...inputProps }: TextFieldProps) {
  const errorId = `${id}-error`
  return (
    <div className={['field', error ? 'field--invalid' : '', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="field__control">
        {Icon && <Icon className="field__icon" aria-hidden="true" size={18} strokeWidth={1.8} />}
        <input
          id={id}
          className="field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        />
        {endAdornment}
      </div>
      {error && <p className="field__error" id={errorId}>{error}</p>}
    </div>
  )
}
