import { ArrowLeft, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useI18n } from '../../i18n/I18nProvider'
import Alert from '../ui/Alert'
import '../auth/LoginForm.css'

type PlaceholderCardProps = { icon: LucideIcon; title: string; description: string; noticeTitle?: string; children?: ReactNode }

/** Clearly-marked placeholder for flows that are planned but not built yet. */
export default function PlaceholderCard({ icon: Icon, title, description, noticeTitle, children }: PlaceholderCardProps) {
  const { t } = useI18n()
  return (
    <section className="page-card" aria-labelledby="page-card-title">
      <span className="page-card__icon" aria-hidden="true"><Icon size={26} strokeWidth={1.8} /></span>
      <h1 id="page-card-title" className="page-card__title">{title}</h1>
      <p className="page-card__text">{description}</p>
      <Alert tone="info" title={noticeTitle}>{children}</Alert>
      <Link className="page-card__back" to="/login"><ArrowLeft aria-hidden="true" size={18} /> {t('common.backToLogin')}</Link>
    </section>
  )
}
