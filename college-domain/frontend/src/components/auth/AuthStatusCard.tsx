import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import Alert from '../ui/Alert'
import './LoginForm.css'

type AuthStatusCardProps = {
  icon: LucideIcon
  title: string
  description: string
  tone?: 'info' | 'error'
  noticeTitle?: string
  notice?: ReactNode
  children?: ReactNode
}

/** Outcome card for account flows (email sent, verified, link expired…), in the same layout as the placeholder pages. */
export default function AuthStatusCard({ icon: Icon, title, description, tone = 'info', noticeTitle, notice, children }: AuthStatusCardProps) {
  return (
    <section className="page-card" aria-labelledby="page-card-title">
      <span className="page-card__icon" aria-hidden="true"><Icon size={26} strokeWidth={1.8} /></span>
      <h1 id="page-card-title" className="page-card__title">{title}</h1>
      <p className="page-card__text">{description}</p>
      {notice && <Alert tone={tone} title={noticeTitle}>{notice}</Alert>}
      {children}
    </section>
  )
}
