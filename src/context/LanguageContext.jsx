import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'
import { DEFAULT_LANGUAGE, INTERFACE_LANGUAGES, english, getLoadedTranslations, loadTranslations } from '../lib/i18n/translations'

// Same "localStorage first, DB overrides once signed in" shape as
// ThemeContext.jsx's theme_preference -- kept as a separate context (not
// folded into ThemeProvider) since the two preferences are independent and
// this one didn't exist when that one was built.
const STORAGE_KEY = 'learnscope-language'
const LANGUAGE_VALUES = INTERFACE_LANGUAGES.map((l) => l.value)

function resolve(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary)
}

// {paramName} placeholders inside a translated string get swapped for the
// matching value in `params` -- an unmatched placeholder (missing param, or
// a plain string with no `params` passed) is left as-is rather than blanked
// out, so a caller forgetting a param is obvious in the UI instead of
// silently vanishing.
function interpolate(value, params) {
  if (typeof value !== 'string' || !params) return value
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match))
}

const LanguageContext = createContext(undefined)

export function LanguageProvider({ children }) {
  const { user, profileSettings } = useAuth()
  const userId = user?.id ?? null
  const savedPreference = profileSettings?.languagePreference
  const [language, setLanguageState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return LANGUAGE_VALUES.includes(stored) ? stored : DEFAULT_LANGUAGE
  })
  // The dictionary actually in use. Switching language keeps showing the
  // current one until the new chunk arrives, rather than flashing English.
  const [dictionary, setDictionary] = useState(() => getLoadedTranslations(language))

  useEffect(() => {
    let cancelled = false
    loadTranslations(language)
      .then((loaded) => { if (!cancelled) setDictionary(loaded) })
      .catch(() => { if (!cancelled) setDictionary((current) => current ?? english) })
    return () => { cancelled = true }
  }, [language])

  // A saved DB preference is the source of truth once signed in, same
  // reasoning as ThemeContext's own profile-preference effect.
  useEffect(() => {
    if (!LANGUAGE_VALUES.includes(savedPreference)) return
    setLanguageState(savedPreference)
    localStorage.setItem(STORAGE_KEY, savedPreference)
  }, [savedPreference])

  const setLanguage = useCallback(
    async (next) => {
      setLanguageState(next)
      localStorage.setItem(STORAGE_KEY, next)
      if (userId) {
        await supabase.from('profiles').update({ language_preference: next }).eq('id', userId)
      }
    },
    [userId]
  )

  const t = useCallback(
    (key, params) =>
      interpolate(resolve(dictionary ?? english, key) ?? resolve(english, key) ?? key, params),
    [dictionary]
  )

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  // Only on a first load in a non-English language: hold the page for the
  // one small chunk rather than rendering it in English and then swapping.
  if (!dictionary) return null

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (ctx === undefined) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
