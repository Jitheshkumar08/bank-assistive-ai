import { LoaderCircle } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

type ButtonProps = ComponentProps<'button'> & {
  loading?: boolean
  /** Text shown (and announced) while loading. */
  loadingLabel?: string
  endIcon?: ReactNode
}

/** Primary action button with a built-in loading state that also blocks repeat clicks. */
export default function Button({ loading = false, loadingLabel, endIcon, children, disabled, className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={['button', className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <LoaderCircle className="button__spinner" aria-hidden="true" size={18} />}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
      {!loading && endIcon}
    </button>
  )
}
