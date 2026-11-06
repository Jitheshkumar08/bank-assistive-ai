import {
  CalendarDays, ChevronDown, FileUp, GraduationCap, History, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, QrCode, ScrollText, Search,
  Settings, UserRound, UsersRound, type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { roleLabel } from '../../app/roles'
import { useSession } from '../../app/session'
import { LanguageScope } from '../../i18n/I18nProvider'
import { useDisclosure } from '../../lib/useDisclosure'
import './admin.css'

type NavItem = { label: string; to: string; icon: LucideIcon; end?: boolean }

const portals = {
  college: {
    subtitle: 'College Admin',
    home: '/admin/dashboard',
    nav: [
      { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
      { label: 'Student Records', to: '/admin/students', icon: UserRound },
      { label: 'Import Admissions', to: '/admin/imports/new', icon: FileUp },
      { label: 'Admission Years', to: '/admin/admission-years', icon: CalendarDays },
      { label: 'Import History', to: '/admin/imports', icon: History, end: true },
      { label: 'QR Codes', to: '/admin/qr-codes', icon: QrCode },
      { label: 'Settings & Profile', to: '/admin/profile', icon: Settings },
    ],
  },
  super: {
    subtitle: 'Super Admin',
    home: '/super-admin/dashboard',
    nav: [
      { label: 'Dashboard', to: '/super-admin/dashboard', icon: LayoutDashboard },
      { label: 'College Admins', to: '/super-admin/college-admins', icon: UsersRound },
      { label: 'QR Management', to: '/super-admin/qr-codes', icon: QrCode },
      { label: 'Audit Log', to: '/super-admin/audit-log', icon: ScrollText },
      { label: 'Settings & Profile', to: '/super-admin/profile', icon: Settings },
    ],
  },
} satisfies Record<string, { subtitle: string; home: string; nav: NavItem[] }>

const collapseKey = 'campusguide.admin.sidebarCollapsed'
const readCollapsed = () => { try { return localStorage.getItem(collapseKey) === '1' } catch { return false } }

/** Staff portals are English-only: the Student Portal language never applies here. */
export default function AdminShell({ portal }: { portal: keyof typeof portals }) {
  useEffect(() => { document.documentElement.lang = 'en' }, [])
  return <LanguageScope language="en"><AdminShellLayout portal={portal} /></LanguageScope>
}

/** Layout shared by the College Admin and Super Admin portals (navy sidebar, top bar, page outlet). */
function AdminShellLayout({ portal }: { portal: keyof typeof portals }) {
  const config = portals[portal]
  const { session, logout } = useSession()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const toggleCollapsed = () => setCollapsed((value) => {
    try { localStorage.setItem(collapseKey, value ? '0' : '1') } catch { /* preference only */ }
    return !value
  })
  const signOut = async () => { setDrawerOpen(false); await logout(); navigate('/login', { replace: true }) }

  const user = session.status === 'signed-in' ? session.user : null
  const name = user?.displayName ?? user?.email ?? 'Admin'

  return (
    <div className={['adm', collapsed ? 'adm--collapsed' : '', drawerOpen ? 'is-drawer-open' : ''].filter(Boolean).join(' ')}>
      <a className="skip-link" href="#adm-main">Skip to content</a>
      {drawerOpen && <div className="adm-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}
      <aside className="adm-sidebar" aria-label="Admin navigation">
        <Link to={config.home} className="adm-sidebar__brand" aria-label={`CampusGuide ${config.subtitle} home`}>
          <GraduationCap size={30} strokeWidth={2} aria-hidden="true" />
          <span><strong>CampusGuide</strong><small>{config.subtitle}</small></span>
        </Link>
        <nav aria-label="Main">
          <ul className="adm-nav">
            {config.nav.map((item: NavItem) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} onClick={() => setDrawerOpen(false)} className={({ isActive }) => `adm-nav__link${isActive ? ' is-active' : ''}`} title={collapsed ? item.label : undefined}>
                  <item.icon size={18} strokeWidth={1.9} aria-hidden="true" />
                  <span className="adm-nav__label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="adm-sidebar__footer">
          <button type="button" className="adm-nav__link" onClick={signOut} title={collapsed ? 'Logout' : undefined}>
            <LogOut size={18} aria-hidden="true" /><span className="adm-nav__label">Logout</span>
          </button>
          <button type="button" className="adm-nav__link adm-sidebar__collapse" onClick={toggleCollapsed} aria-pressed={collapsed} title={collapsed ? 'Expand sidebar' : undefined}>
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            <span className="adm-nav__label">{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>

      <div className="adm-main">
        <header className="adm-topbar">
          <button type="button" className="adm-icon-btn adm-topbar__menu" onClick={() => setDrawerOpen((open) => !open)} aria-label="Open menu" aria-expanded={drawerOpen}>
            <Menu size={20} />
          </button>
          {portal === 'college' ? <RecordSearch /> : <span className="adm-topbar__spacer" style={{ marginLeft: 'auto' }} />}
          <ProfileMenu name={name} role={user ? roleLabel[user.role] : ''} email={user?.email ?? ''} profilePath={portal === 'college' ? '/admin/profile' : '/super-admin/profile'} onLogout={signOut} />
        </header>
        <main id="adm-main" className="adm-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Top-bar search: jumps to Student Records filtered by name or NUCAT reference. */
function RecordSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    navigate(value ? `/admin/students?search=${encodeURIComponent(value)}` : '/admin/students')
  }
  return (
    <form className="adm-search" role="search" onSubmit={submit}>
      <Search size={16} aria-hidden="true" />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search student records..." aria-label="Search student records by name or NUCAT reference" maxLength={80} />
    </form>
  )
}

function ProfileMenu({ name, role, email, profilePath, onLogout }: { name: string; role: string; email: string; profilePath: string; onLogout: () => void }) {
  const { open, toggle, close, containerRef, triggerRef } = useDisclosure()
  return (
    <div className="adm-profile" ref={containerRef}>
      <button ref={triggerRef} type="button" className="adm-profile__button" aria-expanded={open} aria-haspopup="true" onClick={toggle}>
        <span className="adm-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
        <span className="adm-profile__text"><span className="adm-profile__name">{name}</span><span className="adm-profile__role">{role}</span></span>
        <ChevronDown size={15} aria-hidden="true" />
        <span className="visually-hidden">: open profile menu</span>
      </button>
      {open && (
        <div className="adm-menu" role="menu" aria-label="Profile">
          <div className="adm-menu__identity"><strong>{name}</strong><span>{email}</span></div>
          <Link role="menuitem" className="adm-menu__item" to={profilePath} onClick={() => close()}><Settings size={16} aria-hidden="true" /> Settings & Profile</Link>
          <button role="menuitem" type="button" className="adm-menu__item" onClick={() => { close(); onLogout() }}><LogOut size={16} aria-hidden="true" /> Logout</button>
        </div>
      )}
    </div>
  )
}
