import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { admissionProcessSteps, stepText } from '../../content/admissionProcess'
import { useI18n } from '../../i18n/I18nProvider'

/** Screen 6 numbered vertical timeline. Each step expands to its explanatory text. */
export default function AdmissionTimeline() {
  const [open, setOpen] = useState<string | null>(null)
  const { t } = useI18n()
  return (
    <ol className="timeline">
      {admissionProcessSteps.map((step, index) => {
        const expanded = open === step.id
        const text = stepText(step.id)
        return (
          <li key={step.id} className="timeline__step">
            <span className="timeline__number" aria-hidden="true">{index + 1}</span>
            <div className="timeline__body">
              <button type="button" className="timeline__toggle" aria-expanded={expanded} aria-controls={`step-${step.id}`} onClick={() => setOpen(expanded ? null : step.id)}>
                <span className="timeline__title"><span className="visually-hidden">{t('process.step', { n: index + 1 })}</span>{t(text.title)}</span>
                <span className="timeline__subtitle">{t(text.subtitle)}</span>
                <ChevronDown className="timeline__chevron" size={16} aria-hidden="true" />
              </button>
              {expanded && (
                <div className="timeline__details" id={`step-${step.id}`}>
                  <p>{t(text.details)}</p>
                  <span className="badge badge--amber">{step.provenance === 'official' ? t('process.official') : t('process.general')}</span>
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
