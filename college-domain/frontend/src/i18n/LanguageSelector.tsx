import { Languages } from 'lucide-react'
import { useId } from 'react'
import { languages, useI18n } from './I18nProvider'
import './language.css'

/** The one Student Portal language selector (top bar, auth pages). Names are shown in their own script. */
export default function LanguageSelector({ className }: { className?: string }) {
  const { language, setLanguage, t } = useI18n()
  const id = useId()
  return (
    <div className={['language-select', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="visually-hidden">{t('language.label')}</label>
      <Languages size={16} aria-hidden="true" className="language-select__icon" />
      <select id={id} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
        {languages.map((option) => <option key={option.code} value={option.code} lang={option.code}>{option.name}</option>)}
      </select>
    </div>
  )
}
