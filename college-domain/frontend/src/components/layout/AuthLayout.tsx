import type { ReactNode } from 'react'
import { useDocumentLanguage, useI18n } from '../../i18n/I18nProvider'
import LanguageSelector from '../../i18n/LanguageSelector'
import BrandPanel from './BrandPanel'
import './AuthLayout.css'

/** Two-column shell for sign-in style pages: brand panel beside a centred card; stacked on small screens. */
export default function AuthLayout({ children, languageSelector = true }: { children: ReactNode; languageSelector?: boolean }) {
  const { t } = useI18n()
  useDocumentLanguage()
  return (
    <div className="auth-layout">
      <BrandPanel />
      <main className="auth-layout__main" id="main-content">
        {languageSelector && <LanguageSelector className="auth-layout__language" />}
        <div className="auth-layout__card">{children}</div>
        <footer className="auth-layout__footer">
          <span>© {new Date().getFullYear()} CampusGuide</span>
          <span aria-hidden="true">·</span>
          <span>{t('auth.footer')}</span>
        </footer>
      </main>
    </div>
  )
}
