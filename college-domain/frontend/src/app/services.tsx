/* eslint-disable react-refresh/only-export-components -- provider and its hook belong together */
import { createContext, useContext, type ReactNode } from 'react'
import { httpAdminService, type AdminService } from '../services/admin/adminService'
import { httpSuperAdminService, type SuperAdminService } from '../services/admin/superAdminService'
import { admissionService, type AdmissionService } from '../services/admission/admissionService'
import { assistantService, type AssistantService } from '../services/assistant/assistantService'
import { accountService, authService } from '../services/auth/authService'
import { httpInvitationService, type InvitationService } from '../services/auth/invitationService'
import { sessionService, type SessionService } from '../services/auth/sessionService'
import type { AccountService, AuthService } from '../services/auth/types'
import { qrContextService, type QrContextService } from '../services/qr/qrContext'

export type Services = {
  account: AccountService
  admin: AdminService
  admission: AdmissionService
  assistant: AssistantService
  auth: AuthService
  invitations: InvitationService
  qrContext: QrContextService
  session: SessionService
  superAdmin: SuperAdminService
}

// Staff services need no "not connected" variant: apiRequest itself reports BACKEND_NOT_CONNECTED without a backend URL.
export const defaultServices: Services = {
  account: accountService, admin: httpAdminService, admission: admissionService, assistant: assistantService, auth: authService,
  invitations: httpInvitationService, qrContext: qrContextService, session: sessionService, superAdmin: httpSuperAdminService,
}

const ServicesContext = createContext<Services>(defaultServices)

/** Lets tests (and future backends) swap service implementations without touching components. */
export function ServicesProvider({ services, children }: { services?: Partial<Services>; children: ReactNode }) {
  return <ServicesContext.Provider value={{ ...defaultServices, ...services }}>{children}</ServicesContext.Provider>
}

export const useServices = () => useContext(ServicesContext)
