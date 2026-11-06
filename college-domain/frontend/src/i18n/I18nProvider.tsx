/* eslint-disable react-refresh/only-export-components -- provider and its hooks belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { errorText, isLanguage, isMessageKey, languages, translate, type Language, type MessageKey, type Vars } from './catalog'

const storageKey = 'campusguide.language'

function readSaved(): Language {
  try {
    const saved = localStorage.getItem(storageKey)
    return isLanguage(saved) ? saved : 'en'
  } catch {
    return 'en'
  }
}

type I18nValue = {
  language: Language
  setLanguage: (language: Language) => void
  /** Catalog text in the current language, with {placeholders} filled from `vars`. */
  t: (key: MessageKey, vars?: Vars) => string
  /** Translates a value that may be a catalog key (e.g. a form validation message); other text is returned as-is. */
  tv: (value: string | undefined, vars?: Vars) => string | undefined
  /** Student-facing text for an error in the current language. */
  err: (error: unknown, fallback: MessageKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function useValue(language: Language, setLanguage: (language: Language) => void): I18nValue {
  const t = useCallback((key: MessageKey, vars?: Vars) => translate(language, key, vars), [language])
  const tv = useCallback((value: string | undefined, vars?: Vars) => (value && isMessageKey(value) ? translate(language, value, vars) : value), [language])
  const err = useCallback((error: unknown, fallback: MessageKey) => errorText(language, error, fallback), [language])
  return useMemo(() => ({ language, setLanguage, t, tv, err }), [language, setLanguage, t, tv, err])
}

/**
 * The single Student Portal language preference (en / kn / hi). Persisted in this browser only (it is a display
 * preference, unrelated to sign-in, roles or permissions), so it survives refresh, login and logout.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(readSaved)
  const setLanguage = useCallback((next: Language) => {
    setState(next)
    try { localStorage.setItem(storageKey, next) } catch { /* storage unavailable: keep for this visit */ }
  }, [])
  return <I18nContext.Provider value={useValue(language, setLanguage)}>{children}</I18nContext.Provider>
}

const ignore = () => {}

/** Pins part of the tree to one language — used for the English-only College Admin and Super Admin pages. */
export function LanguageScope({ language, children }: { language: Language; children: ReactNode }) {
  return <I18nContext.Provider value={useValue(language, ignore)}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside LanguageProvider')
  return value
}

/** Keeps <html lang> in step with the visible language (screen readers, Kannada/Devanagari font selection). */
export function useDocumentLanguage() {
  const { language } = useI18n()
  useEffect(() => { document.documentElement.lang = language }, [language])
}

export { languages }
export type { Language, MessageKey }
