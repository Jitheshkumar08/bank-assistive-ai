import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'
import { LanguageProvider } from '../i18n/I18nProvider'
import type { CollegeContext } from '../services/qr/qrContext'
import { CollegeContextProvider } from './collegeContext'
import { ServicesProvider, type Services } from './services'
import { SessionProvider } from './session'

/** App-wide state: injectable services, server session, QR college context; motion respects reduced-motion. */
export default function AppProviders({ children, services, initialCollegeContext }: {
  children: ReactNode
  services?: Partial<Services>
  initialCollegeContext?: CollegeContext | null
}) {
  return (
    <LanguageProvider>
    <MotionConfig reducedMotion="user">
      <ServicesProvider services={services}>
        <SessionProvider>
          <CollegeContextProvider initial={initialCollegeContext}>{children}</CollegeContextProvider>
        </SessionProvider>
      </ServicesProvider>
    </MotionConfig>
    </LanguageProvider>
  )
}
