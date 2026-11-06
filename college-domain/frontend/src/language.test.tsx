import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { catalogs, translate } from './i18n/catalog'
import { en } from './i18n/en'
import type { AssistantService } from './services/assistant/assistantService'
import { AuthError, type AuthService } from './services/auth/types'
import { dashboard, mockAdmin, sessionFor, users } from './test/adminFixtures'
import { nmamitContext, renderWithRouter } from './test/renderWithRouter'

/** Picks a language in the (single) selector, whatever language its label is currently in. */
const choose = async (user: ReturnType<typeof userEvent.setup>, language: 'en' | 'kn' | 'hi') => {
  const label = new RegExp(['en', 'kn', 'hi'].map((code) => translate(code as 'en', 'language.label')).join('|'))
  await user.selectOptions(await screen.findByRole('combobox', { name: label }), language)
}

describe('Student Portal language selection', () => {
  it('starts in English and offers English, ಕನ್ನಡ and हिन्दी on the public home page without login', async () => {
    renderWithRouter({ path: '/home', services: { session: sessionFor(null) } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back, Student!' })).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: 'Language' })
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['English', 'ಕನ್ನಡ', 'हिन्दी'])
  })

  it('switches the whole public portal to Kannada, keeps it across pages and after a refresh', async () => {
    const user = userEvent.setup()
    const first = renderWithRouter({ path: '/home', services: { session: sessionFor(null) } })
    await choose(user, 'kn')
    expect(await screen.findByRole('heading', { level: 1, name: 'ಮತ್ತೆ ಸ್ವಾಗತ, ವಿದ್ಯಾರ್ಥಿ!' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'ಮುಖ್ಯ ನ್ಯಾವಿಗೇಶನ್' })
    expect(within(screen.getByRole('navigation', { name: 'ಖಾತೆ' })).getByRole('link', { name: 'ಲಾಗಿನ್' })).toHaveAttribute('href', '/login')
    expect(document.documentElement.lang).toBe('kn')
    await user.click(within(nav).getByRole('link', { name: 'ಅಗತ್ಯ ದಾಖಲೆಗಳು' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'ಅಗತ್ಯ ದಾಖಲೆಗಳು' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'ಶೈಕ್ಷಣಿಕ' })).toBeInTheDocument()
    expect(screen.getByText('ಗುರುತಿನ ಪುರಾವೆ')).toBeInTheDocument()
    expect(screen.queryByText('Identity proof')).not.toBeInTheDocument()
    first.unmount()

    // A fresh render = browser refresh: the saved choice is restored.
    renderWithRouter({ path: '/fees', services: { session: sessionFor(null) } })
    expect(await screen.findByRole('heading', { level: 1, name: 'ಶುಲ್ಕ ವಿವರ' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /PDF ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ/ })).toHaveAttribute('href', 'https://nitte.edu.in/fee/BTECH.pdf')
  })

  it('shows Required Documents and Fee Structure in Hindi', async () => {
    localStorage.setItem('campusguide.language', 'hi')
    const docs = renderWithRouter({ path: '/documents', services: { session: sessionFor(null) } })
    expect(await screen.findByRole('heading', { level: 1, name: 'आवश्यक दस्तावेज़' })).toBeInTheDocument()
    expect(screen.getByText(/6 में से 0 तैयार चिह्नित/)).toBeInTheDocument()
    docs.unmount()
    renderWithRouter({ path: '/fees', services: { session: sessionFor(null) } })
    expect(await screen.findByRole('heading', { level: 1, name: 'शुल्क संरचना' })).toBeInTheDocument()
    expect(screen.getByText('अतिरिक्त जानकारी')).toBeInTheDocument()
  })

  it('translates form labels, validation and server errors on the login page', async () => {
    localStorage.setItem('campusguide.language', 'hi')
    const user = userEvent.setup()
    const auth: AuthService = { login: vi.fn().mockRejectedValue(new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect.')) }
    renderWithRouter({ path: '/login', services: { auth, session: sessionFor(null) } })
    await user.click(await screen.findByRole('button', { name: 'लॉग इन' }))
    expect(await screen.findByText('अपना ईमेल पता दर्ज करें।')).toBeInTheDocument()
    expect(screen.getByText('अपना पासवर्ड दर्ज करें।')).toBeInTheDocument()
    await user.type(screen.getByLabelText('ईमेल पता'), 'student@example.com')
    await user.type(screen.getByLabelText('पासवर्ड'), 'a long passphrase{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ईमेल या पासवर्ड गलत है।')
    expect(alert).not.toHaveTextContent('incorrect')
  })

  it('keeps the chosen language through login and on the protected page it returns to', async () => {
    localStorage.setItem('campusguide.language', 'kn')
    const user = userEvent.setup()
    const auth: AuthService = { login: vi.fn().mockResolvedValue({ user: { id: users.student.id, email: users.student.email, role: 'STUDENT' } }) }
    const { router } = renderWithRouter({ path: '/profile', services: { auth, session: sessionFor(null) } })
    await user.type(await screen.findByLabelText('ಇಮೇಲ್ ವಿಳಾಸ'), users.student.email)
    await user.type(screen.getByLabelText('ಪಾಸ್‌ವರ್ಡ್'), 'a long passphrase{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(await screen.findByRole('heading', { level: 1, name: 'ನನ್ನ ಪ್ರೊಫೈಲ್' })).toBeInTheDocument()
    expect(localStorage.getItem('campusguide.language')).toBe('kn')
  })

  it('keeps the language when a session is restored, and changing it keeps the student signed in', async () => {
    localStorage.setItem('campusguide.language', 'hi')
    const user = userEvent.setup()
    const session = sessionFor(users.student)
    renderWithRouter({ path: '/profile', services: { session } })
    expect(await screen.findByRole('heading', { level: 1, name: 'मेरी प्रोफ़ाइल' })).toBeInTheDocument()
    await choose(user, 'en')
    expect(await screen.findByRole('heading', { level: 1, name: 'My Profile' })).toBeInTheDocument()
    expect(screen.getByText('student@example.com', { selector: 'dd' })).toBeInTheDocument()
    expect(session.logout).not.toHaveBeenCalled()
    expect(session.getSession).toHaveBeenCalledTimes(1)
  })

  it('sends the selected language with assistant questions and reports voice honestly', async () => {
    localStorage.setItem('campusguide.language', 'kn')
    const user = userEvent.setup()
    const assistant: AssistantService = { send: vi.fn().mockResolvedValue({ text: 'ಉತ್ತರ' }) }
    renderWithRouter({ path: '/assistant', collegeContext: nmamitContext, services: { session: sessionFor(users.student), assistant } })
    expect(await screen.findByText('ಭಾಷೆ: ಕನ್ನಡ')).toBeInTheDocument()
    expect(screen.getByText(/ಧ್ವನಿ ಇನ್‌ಪುಟ್/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ನನಗೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು?' }))
    expect(assistant.send).toHaveBeenCalledWith(expect.objectContaining({ message: 'ನನಗೆ ಯಾವ ದಾಖಲೆಗಳು ಬೇಕು?', language: 'kn', inputMode: 'text' }))
  })

  it('leaves the College Admin portal in English whatever the student language is', async () => {
    localStorage.setItem('campusguide.language', 'kn')
    renderWithRouter({ path: '/admin/dashboard', services: { session: sessionFor(users.collegeAdmin), admin: mockAdmin({ dashboard: vi.fn().mockResolvedValue(dashboard) }) } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /Language|ಭಾಷೆ/ })).not.toBeInTheDocument()
    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
  })
})

describe('translation catalogs', () => {
  const keys = Object.keys(en).sort()
  it.each(['kn', 'hi'] as const)('%s has every key, no empty text and the same placeholders as English', (language) => {
    const catalog = catalogs[language]
    expect(Object.keys(catalog).sort()).toEqual(keys)
    for (const key of keys as (keyof typeof en)[]) {
      expect(catalog[key].trim(), key).not.toBe('')
      const vars = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
      expect(vars(catalog[key]), key).toEqual(vars(en[key]))
    }
  })

  it.each(['kn', 'hi'] as const)('%s text is actually translated (not copied English) except proper nouns', (language) => {
    const allowedSame = new Set(['common.pageTitle', 'chat.botSaid'])
    const copied = (Object.keys(en) as (keyof typeof en)[]).filter((key) => !allowedSame.has(key) && catalogs[language][key] === en[key])
    expect(copied).toEqual([])
  })
})
