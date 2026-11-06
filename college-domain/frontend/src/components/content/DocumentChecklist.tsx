import { Check, ChevronRight } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation } from 'react-router'
import { documentCategories, documentText, requiredDocuments, type DocumentCategory } from '../../content/documents'
import { useI18n } from '../../i18n/I18nProvider'
import IconTile from '../app/IconTile'

type Filter = DocumentCategory | 'all'

/**
 * Screen 5 checklist with category tabs. Progress lives in this page only: there is no signed-in account to save
 * it to yet, and it is never written to browser storage.
 */
export default function DocumentChecklist() {
  const location = useLocation()
  const { t } = useI18n()
  const hashId = location.hash.slice(1)
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(() => requiredDocuments.some((doc) => doc.id === hashId) ? hashId : null)
  const [ready, setReady] = useState<Set<string>>(() => new Set())
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const baseId = useId()
  const visible = requiredDocuments.filter((doc) => filter === 'all' || doc.category === filter)

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = documentCategories.length - 1
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
    if (next === null) return
    event.preventDefault()
    setFilter(documentCategories[next].id)
    tabRefs.current[next]?.focus()
  }

  const toggleReady = (id: string) => setReady((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="checklist">
      <div className="checklist__tabs" role="tablist" aria-label={t('documents.tabs')}>
        {documentCategories.map((category, index) => (
          <button
            key={category.id}
            ref={(node) => { tabRefs.current[index] = node }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${category.id}`}
            aria-selected={filter === category.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={filter === category.id ? 0 : -1}
            className="checklist__tab"
            onClick={() => setFilter(category.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            {t(category.label)}
          </button>
        ))}
      </div>

      <p className="checklist__progress" aria-live="polite">
        {t('documents.progress', { ready: ready.size, total: requiredDocuments.length })} <span>{t('documents.progressNote')}</span>
      </p>

      <ul className="checklist__list" id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${filter}`}>
        {visible.map((doc) => {
          const open = openId === doc.id
          const isReady = ready.has(doc.id)
          const text = documentText(doc.id)
          return (
            <li key={doc.id} id={doc.id} className={`checklist__item${open ? ' is-open' : ''}`}>
              <button type="button" className="checklist__row" aria-expanded={open} aria-controls={`${baseId}-${doc.id}`} onClick={() => setOpenId(open ? null : doc.id)}>
                <IconTile icon={doc.icon} tone={doc.tone} />
                <span className="checklist__text">
                  <span className="checklist__title">{t(text.title)}</span>{' '}
                  <span className="checklist__summary">{t(text.summary)}</span>
                </span>
                {isReady && <span className="badge badge--green checklist__ready"><Check size={12} aria-hidden="true" /> {t('documents.ready')}</span>}
                <ChevronRight className="checklist__chevron" size={18} aria-hidden="true" />
              </button>
              {open && (
                <div className="checklist__details" id={`${baseId}-${doc.id}`}>
                  <p>{t(text.details)}</p>
                  <div className="checklist__tags">
                    <span className="badge badge--amber">{t('documents.provisional')}</span>
                    {doc.conditional && <span className="badge badge--blue">{t('documents.conditional')}</span>}
                  </div>
                  <label className="checklist__check">
                    <input type="checkbox" checked={isReady} onChange={() => toggleReady(doc.id)} />
                    {t('documents.haveIt')}
                  </label>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
