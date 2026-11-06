import type { AccountRole } from '../services/auth/sessionService'

/** Where each role lands after signing in. The backend still authorises every request; this is navigation only. */
export const homeFor = (role: AccountRole) =>
  role === 'COLLEGE_ADMIN' ? '/admin/dashboard' : role === 'SUPER_ADMIN' ? '/super-admin/dashboard' : '/home'

export const roleLabel: Record<AccountRole, string> = {
  STUDENT: 'Student',
  COLLEGE_ADMIN: 'College Administrator',
  SUPER_ADMIN: 'Super Administrator',
}

/** Paths each role may be sent back to after login (anything else falls back to the role's home). */
export function allowedReturnPath(role: AccountRole, path: string) {
  if (path.startsWith('/super-admin')) return role === 'SUPER_ADMIN'
  if (path.startsWith('/admin')) return role === 'COLLEGE_ADMIN'
  if (path === '/result' || path === '/profile') return role === 'STUDENT'
  return role === 'STUDENT'
}
