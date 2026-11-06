import { Bell, ChevronDown, LogIn, LogOut, Menu, Search, UserRound, CircleHelp } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { announcements } from '../../content/announcements'
import { searchContent } from '../../content/search'
import { displayNameOf, useSession } from '../../app/session'
import { useI18n } from '../../i18n/I18nProvider'
import LanguageSelector from '../../i18n/LanguageSelector'
import { useDisclosure } from '../../lib/useDisclosure'
import CampusGuideLogo from './CampusGuideLogo'
import IconTile from './IconTile'

function SearchBox({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const listId = useId()
  const results = searchContent(query, t)
  const go = (path: string) => { setQuery(''); onDone?.(); navigate(path) }
  return (
    <div className="search" role="search">
      <Search className="search__icon" size={17} aria-hidden="true" />
      <input
        className="search__input"
        type="search"
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        value={query}
        autoFocus={autoFocus}
        onChange={(event) => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
          if (event.key === 'Enter' && results[active]) go(results[active].path)
          if (event.key === 'Escape') setQuery('')
        }}
        role="combobox"
        aria-expanded={query.trim().length > 0}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
        autoComplete="off"
      />
      {query.trim() && (
        <ul className="search__results" id={listId} role="listbox" aria-label={t('search.results')}>
          {results.length ? results.map((result, index) => (
            // Options are not focusable: the input keeps focus and announces the active option.
            <li key={result.id} id={`${listId}-${result.id}`} role="option" aria-selected={index === active}
              className={`search__option${index === active ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()} onClick={() => go(result.path)}>
              <strong>{result.title}</strong> <span>{result.context}</span>
            </li>
          )) : <li className="search__empty" role="option" aria-selected={false} aria-disabled="true">{t('search.none')}</li>}
        </ul>
      )}
    </div>
  )
}

function Notifications() {
  const { t } = useI18n()
  const { open, toggle, containerRef, triggerRef } = useDisclosure()
  return (
    <div className="topbar__menu" ref={containerRef}>
      <button ref={triggerRef} type="button" className="topbar__icon-button" aria-label={t('notifications.label')} aria-expanded={open} aria-haspopup="true" onClick={toggle}>
        <Bell size={20} strokeWidth={1.9} />
      </button>
      {open && (
        <div className="dropdown dropdown--wide" role="region" aria-label={t('notifications.label')}>
          <p className="dropdown__heading">{t('notifications.label')}</p>
          <p className="dropdown__note">{t('notifications.none')}</p>
          <ul className="dropdown__list">
            {announcements.map((item) => (
              <li key={item.id} className="dropdown__notice">
                <IconTile icon={item.icon} tone={item.tone} size="sm" />
                <span><strong>{t(item.title)}</strong>{t(item.text)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ProfileMenu() {
  const { t } = useI18n()
  const { open, toggle, close, containerRef, triggerRef } = useDisclosure()
  const { session, logout } = useSession()
  const navigate = useNavigate()
  const name = displayNameOf(session) ?? t('common.student')
  const status = session.status === 'signed-in' ? session.user.email
    : session.status === 'unavailable' ? t('profileMenu.notConnected')
    : session.status === 'loading' ? t('profileMenu.checking') : t('profileMenu.signedOut')
  return (
    <div className="topbar__menu" ref={containerRef}>
      <button ref={triggerRef} type="button" className="profile-button" aria-expanded={open} aria-haspopup="true" onClick={toggle}>
        <span className="avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
        <span className="profile-button__name">{name}</span>
        <ChevronDown className="profile-button__chevron" size={16} aria-hidden="true" />
        <span className="visually-hidden">{t('profileMenu.open')}</span>
      </button>
      {open && (
        <div className="dropdown" role="menu" aria-label={t('profileMenu.label')}>
          <div className="dropdown__identity"><strong>{name}</strong><span>{status}</span></div>
          <Link role="menuitem" className="dropdown__item" to="/profile" onClick={() => close()}><UserRound size={17} aria-hidden="true" /> {t('nav.profile')}</Link>
          <Link role="menuitem" className="dropdown__item" to="/help" onClick={() => close()}><CircleHelp size={17} aria-hidden="true" /> {t('nav.help')}</Link>
          {session.status === 'signed-in'
            ? <button role="menuitem" type="button" className="dropdown__item" onClick={async () => { close(); await logout(); navigate('/login') }}><LogOut size={17} aria-hidden="true" /> {t('common.logout')}</button>
            : <Link role="menuitem" className="dropdown__item" to="/login" onClick={() => close()}><LogIn size={17} aria-hidden="true" /> {t('common.logIn')}</Link>}
        </div>
      )}
    </div>
  )
}

/**
 * Desktop: white bar with search, language, notifications and profile (screen 1).
 * Small screens: navy header with menu button, brand, language, notifications and profile (screens 2–8).
 */
export default function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useI18n()
  const [searchOpen, setSearchOpen] = useState(false)
  const { session } = useSession()
  // Visitors browse public admission information; these links lead to the common login / student sign-up.
  const signedOut = session.status === 'signed-out' || session.status === 'unavailable' || session.status === 'error'
  return (
    <header className="topbar">
      <button type="button" className="topbar__icon-button topbar__menu-button" onClick={onOpenMenu} aria-label={t('nav.openMenu')}><Menu size={22} /></button>
      <Link to="/home" className="topbar__brand" aria-label={t('nav.homeLink')}>
        <CampusGuideLogo size={30} />
        <span><strong>CampusGuide</strong><small>{t('common.nmamitName')}</small></span>
      </Link>
      <div className="topbar__search"><SearchBox /></div>
      <div className="topbar__actions">
        <button type="button" className="topbar__icon-button topbar__search-toggle" aria-label={t('search.toggle')} aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}><Search size={20} /></button>
        <LanguageSelector className="topbar__language" />
        <Notifications />
        {signedOut && (
          <nav className="topbar__auth" aria-label={t('nav.account')}>
            <Link to="/login" className="button-outline topbar__auth-link">{t('common.logIn')}</Link>
            <Link to="/signup" className="button-primary topbar__auth-link topbar__auth-signup">{t('common.signUp')}</Link>
          </nav>
        )}
        <ProfileMenu />
      </div>
      {searchOpen && <div className="topbar__search-sheet"><SearchBox autoFocus onDone={() => setSearchOpen(false)} /></div>}
    </header>
  )
}
