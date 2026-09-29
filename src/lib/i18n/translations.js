// First-pass translation coverage: the always-visible chrome (AppHeader) and
// the unauthenticated entry pages (Login/Signup/ForgotPassword) -- the
// highest-traffic, lowest-domain-jargon-risk surface, proving the language
// switch genuinely changes rendered text end to end. The rest of the app's
// strings (skills, courses, admin consoles, etc.) aren't wired up yet; see
// BACKLOG.md. English is the fallback for any key a language doesn't have,
// so adding a new language can start from a partial file without breaking
// anything.
// Named distinctly from lib/languages.js's LANGUAGES (a free-text "what
// language(s) do you speak" profile field, unrelated to which language the
// app's own UI is shown in) -- this is only ever the fixed, small set this
// codebase has actual translations for.
export const INTERFACE_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'zh', label: '中文' },
]

import en from './en.js'

// Each language is its own chunk: a visitor downloads English (the fallback
// every lookup can drop back to) plus only the language they actually use,
// rather than every translation the app has.
export const DEFAULT_LANGUAGE = 'en'
export const english = en

const LOADERS = {
  es: () => import('./es.js'),
  fr: () => import('./fr.js'),
  de: () => import('./de.js'),
  it: () => import('./it.js'),
  nl: () => import('./nl.js'),
  zh: () => import('./zh.js'),
}

const loaded = { en }

// Synchronous read of a language that has already been loaded (or English),
// for callers that can't wait -- e.g. ErrorBoundary's fallback screen.
export function getLoadedTranslations(language) {
  return loaded[language] ?? null
}

export async function loadTranslations(language) {
  if (loaded[language]) return loaded[language]
  const load = LOADERS[language]
  if (!load) return en
  loaded[language] = (await load()).default
  return loaded[language]
}
