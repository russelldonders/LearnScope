import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'
import { translations, INTERFACE_LANGUAGES } from '../lib/i18n/translations'

// Same "localStorage first, DB overrides once signed in" shape as
// ThemeContext.jsx's theme_preference -- kept as a separate context (not
// folded into ThemeProvider) since the two preferences are independent and
// this one didn't exist when that one was built.
const STORAGE_KEY = 'learnscope-language'
const LANGUAGE_VALUES = INTERFACE_LANGUAGES.map((l) => l.value)
const DEFAULT_LANGUAGE = 'en'

function resolve(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary)
}

const LanguageContext = createContext(undefined)

export function LanguageProvider({ children }) {
  const { user } = useAuth()
  const [language, setLanguageState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return LANGUAGE_VALUES.includes(stored) ? stored : DEFAULT_LANGUAGE
  })

  // A saved DB preference is the source of truth once signed in, same
  // reasoning as ThemeContext's own profile-preference effect.
  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('language_preference')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!error && LANGUAGE_VALUES.includes(data?.language_preference)) {
          setLanguageState(data.language_preference)
          localStorage.setItem(STORAGE_KEY, data.language_preference)
        }
      })
  }, [user])

  const setLanguage = useCallback(
    async (next) => {
      setLanguageState(next)
      localStorage.setItem(STORAGE_KEY, next)
      if (user) {
        await supabase.from('profiles').update({ language_preference: next }).eq('id', user.id)
      }
    },
    [user]
  )

  const t = useCallback(
    (key) => resolve(translations[language], key) ?? resolve(translations[DEFAULT_LANGUAGE], key) ?? key,
    [language]
  )

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (ctx === undefined) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
