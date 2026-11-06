import { Link } from 'react-router'
import { bannerShortcuts } from '../../content/destinations'
import { useI18n } from '../../i18n/I18nProvider'
import CampusImage from './CampusImage'
import IconTile from './IconTile'

/** Screen 1 hero: greeting, campus picture and four shortcut pills. */
export default function WelcomeBanner({ name }: { name: string }) {
  const { t } = useI18n()
  const [before, after = ''] = t('home.welcome', { name: '\u0000' }).split('\u0000')
  return (
    <section className="welcome-banner" aria-labelledby="welcome-title">
      <CampusImage className="welcome-banner__image" />
      <div className="welcome-banner__content">
        <h1 id="welcome-title" className="welcome-banner__title">{before}<span>{name}</span>{after}</h1>
        <p className="welcome-banner__subtitle">{t('home.subtitle')}</p>
      </div>
      <nav className="welcome-banner__shortcuts" aria-label={t('home.shortcuts')}>
        {bannerShortcuts.map((item) => (
          <Link key={item.id} to={item.path} className="shortcut">
            <IconTile icon={item.icon} tone={item.tone} size="sm" />
            <span>{t(item.title)}</span>
          </Link>
        ))}
      </nav>
    </section>
  )
}
