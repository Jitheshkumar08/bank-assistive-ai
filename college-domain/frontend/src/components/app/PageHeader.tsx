import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useI18n } from '../../i18n/I18nProvider'

/** "← Title" row used at the top of screens 4–8. Back goes to the previous page, or Home when opened directly. */
export default function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  const navigate = useNavigate()
  const { t } = useI18n()
  return (
    <div className="page-header">
      <button
        type="button"
        className="page-header__back"
        aria-label={t('common.goBack')}
        onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/home'))}
      >
        <ArrowLeft size={20} strokeWidth={2.2} />
      </button>
      <h1 className="page-header__title">{title}</h1>
      {action && <div className="page-header__action">{action}</div>}
    </div>
  )
}
