import { BadgeIndianRupee, CircleHelp, FilePlus2, FileText, House, Lock, LogOut, MessageSquareText, ScanSearch, UserRound, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router'
import { useCollegeContext } from '../../app/collegeContext'
import { useSession } from '../../app/session'
import { useI18n, type MessageKey } from '../../i18n/I18nProvider'
import CampusGuideLogo from './CampusGuideLogo'

type NavItem = { label: MessageKey; path: string; icon: LucideIcon; requiresQr?: boolean }

const primary: NavItem[] = [
  { label: 'nav.home', path: '/home', icon: House },
  { label: 'nav.documents', path: '/documents', icon: FileText },
  { label: 'nav.process', path: '/admission-process', icon: FilePlus2 },
  { label: 'nav.fees', path: '/fees', icon: BadgeIndianRupee },
  { label: 'nav.result', path: '/result', icon: ScanSearch, requiresQr: true },
  { label: 'nav.assistant', path: '/assistant', icon: MessageSquareText, requiresQr: true },
]
const secondary: NavItem[] = [
  { label: 'nav.profile', path: '/profile', icon: UserRound },
  { label: 'nav.help', path: '/help', icon: CircleHelp },
]

/** Persistent navy navigation. Items needing the NMAMIT QR context stay reachable but show a lock until scanned. */
export default function Sidebar({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const { context } = useCollegeContext()
  const { logout } = useSession()
  const { t } = useI18n()
  const navigate = useNavigate()

  const link = (item: NavItem) => {
    const locked = item.requiresQr && !context
    return (
      <li key={item.path}>
        <NavLink to={item.path} onClick={onNavigate} className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}>
          <item.icon className="sidebar__icon" size={19} strokeWidth={1.9} aria-hidden="true" />
          <span className="sidebar__label">{t(item.label)}</span>
          {locked && <Lock className="sidebar__lock" size={15} strokeWidth={2.2} aria-label={t('nav.requiresQr')} />}
        </NavLink>
      </li>
    )
  }

  return (
    <nav className="sidebar" aria-label={t('nav.main')}>
      <div className="sidebar__brand">
        <CampusGuideLogo size={36} className="sidebar__logo" />
        <div>
          <p className="sidebar__name">CampusGuide</p>
          <p className="sidebar__college">{t('common.nmamitName')}</p>
        </div>
        {onClose && <button type="button" className="sidebar__close" onClick={onClose} aria-label={t('nav.closeMenu')}><X size={20} /></button>}
      </div>
      <ul className="sidebar__list">{primary.map(link)}</ul>
      <hr className="sidebar__divider" />
      <ul className="sidebar__list">{secondary.map(link)}</ul>
      <hr className="sidebar__divider" />
      <ul className="sidebar__list">
        <li>
          <button type="button" className="sidebar__link" onClick={async () => { onNavigate?.(); await logout(); navigate('/login') }}>
            <LogOut className="sidebar__icon" size={19} strokeWidth={1.9} aria-hidden="true" />
            <span className="sidebar__label">{t('common.logout')}</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
