import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useLocation, useOutlet } from 'react-router'
import { useDocumentLanguage, useI18n } from '../../i18n/I18nProvider'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import './app-layout.css'

/** Shared shell for every student screen: navy sidebar (drawer on small screens), top bar and animated content. */
export default function AppLayout() {
  const location = useLocation()
  const outlet = useOutlet()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { t } = useI18n()
  useDocumentLanguage()

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [drawerOpen])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#app-main">{t('nav.skip')}</a>
      <aside className="app-shell__sidebar"><Sidebar /></aside>
      <AnimatePresence>
        {drawerOpen && (
          <motion.div className="drawer" role="dialog" aria-modal="true" aria-label={t('nav.menu')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" className="drawer__scrim" aria-label={t('nav.closeMenu')} tabIndex={-1} onClick={() => setDrawerOpen(false)} />
            <motion.div className="drawer__panel" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'tween', duration: 0.22 }}>
              <Sidebar onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="app-shell__body">
        <Topbar onOpenMenu={() => setDrawerOpen(true)} />
        <main id="app-main" className="app-shell__main" tabIndex={-1}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={location.pathname} className="page-transition" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
