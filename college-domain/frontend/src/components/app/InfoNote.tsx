import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

/** Soft blue footnote box with an info icon (bottom of screens 5–8). */
export default function InfoNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={['info-note', className].filter(Boolean).join(' ')}>
      <Info className="info-note__icon" size={20} aria-hidden="true" />
      <p>{children}</p>
    </div>
  )
}
