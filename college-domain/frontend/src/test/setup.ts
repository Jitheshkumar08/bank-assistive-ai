import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// The Student Portal language is saved in localStorage; start every test in the default language.
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.lang = 'en' })

// jsdom has no matchMedia; report "no match" so layouts render their small-screen, non-WebGL path.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}
