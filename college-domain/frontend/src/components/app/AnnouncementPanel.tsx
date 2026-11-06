import { ChevronRight, ExternalLink, Megaphone } from 'lucide-react'
import { Link } from 'react-router'
import { announcements } from '../../content/announcements'
import { useI18n } from '../../i18n/I18nProvider'
import IconTile from './IconTile'

/** Right-hand announcements card. Shows CampusGuide tips until official announcements come from the backend. */
export default function AnnouncementPanel() {
  const { t } = useI18n()
  return (
    <section className="panel announcements" aria-labelledby="announcements-title">
      <div className="panel__heading">
        <h2 id="announcements-title">{t('announcements.title')}</h2>
        <Megaphone size={18} className="panel__heading-icon" aria-hidden="true" />
      </div>
      <p className="announcements__note">{t('announcements.note')}</p>
      <ul className="announcements__list">
        {announcements.map((item) => {
          const body = (
            <>
              <IconTile icon={item.icon} tone={item.tone} size="sm" />
              <span className="announcements__text"><strong>{t(item.title)}</strong><span>{t(item.text)}</span></span>
              {item.external ? <ExternalLink size={15} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </>
          )
          return (
            <li key={item.id}>
              {item.external
                ? <a className="announcements__item" href={item.external} target="_blank" rel="noopener noreferrer">{body}<span className="visually-hidden"> {t('announcements.opensNitte')}</span></a>
                : <Link className="announcements__item" to={item.path ?? '/home'}>{body}</Link>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
