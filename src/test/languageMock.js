import { vi } from 'vitest'
import { english } from '../lib/i18n/translations'

// English useLanguage() for tests that render translated components without
// a LanguageProvider: vi.mock('<path>/context/LanguageContext', () => import('<path>/test/languageMock'))
function t(key, params) {
  const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return params && typeof value === 'string'
    ? value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match))
    : value
}

export function useLanguage() {
  return { language: 'en', setLanguage: vi.fn(), t }
}

// Pass-through, so a test that also wraps renders in LanguageProvider keeps
// working when it mocks the context with this module.
export function LanguageProvider({ children }) {
  return children
}
