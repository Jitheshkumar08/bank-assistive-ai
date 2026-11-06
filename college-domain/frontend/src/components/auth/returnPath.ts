import { allowedReturnPath, homeFor } from '../../app/roles'
import type { AccountRole } from '../../services/auth/sessionService'

/**
 * Post-login destination: a same-app path the role may use (no protocol-relative or external URLs), otherwise the
 * role's own dashboard. Without a role (legacy callers) only student paths are accepted.
 */
export function safeReturnPath(value: unknown, role: AccountRole = 'STUDENT') {
  const isLocal = typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login')
  return isLocal && allowedReturnPath(role, value) ? value : homeFor(role)
}
