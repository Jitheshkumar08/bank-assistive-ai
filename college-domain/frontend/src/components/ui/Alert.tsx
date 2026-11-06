import { CircleAlert, Info } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

type AlertProps = Omit<ComponentProps<'div'>, 'title'> & {
  tone?: 'error' | 'info'
  title?: string
  children: ReactNode
}

/** Inline message. Errors use role="alert" so screen readers announce them immediately. */
export default function Alert({ tone = 'info', title, children, className, ...props }: AlertProps) {
  const Icon = tone === 'error' ? CircleAlert : Info
  return (
    <div {...props} role={tone === 'error' ? 'alert' : 'status'} className={['alert', `alert--${tone}`, className].filter(Boolean).join(' ')}>
      <Icon className="alert__icon" aria-hidden="true" size={18} />
      <div className="alert__body">
        {title && <p className="alert__title">{title}</p>}
        <div className="alert__text">{children}</div>
      </div>
    </div>
  )
}
