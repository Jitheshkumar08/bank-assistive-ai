import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpAdmissionService } from './services/admission/admissionService'
import type { SessionService } from './services/auth/sessionService'
import { nmamitContext, renderWithRouter } from './test/renderWithRouter'

vi.mock('./config', () => ({ config: { apiBaseUrl: 'http://api.test/api', campusImageUrl: undefined } }))

afterEach(() => vi.unstubAllGlobals())

describe('expired session', () => {
  it('signs the student out when the backend rejects the session, and shows the result to nobody', async () => {
    // The browser still thinks it is signed in, but the server has expired or revoked the session.
    const session: SessionService = { getSession: vi.fn().mockResolvedValue({ id: 'student-1', email: 'student@example.com', displayName: null, role: 'STUDENT' }), logout: vi.fn() }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Sign in to continue.', requestId: 'r-1' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )))
    const { router } = renderWithRouter({ path: '/result', collegeContext: nmamitContext, services: { session, admission: httpAdmissionService } })
    // Generous timeouts: the redirect waits on several chained async renders, which is slow on a loaded test machine.
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'), { timeout: 5000 })
    expect(await screen.findByText('Your session ended. Log in again to continue.', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText('Verified Record')).not.toBeInTheDocument()
  })
})
