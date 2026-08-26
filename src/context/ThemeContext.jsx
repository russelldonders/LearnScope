import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'

// Shared with index.html's pre-paint inline script, which reads this same
// key synchronously before React mounts (so there's no flash of the wrong
// theme on load) -- keep the two in sync if this ever changes.
const STORAGE_KEY = 'learnscope-theme'
const THEME_VALUES = ['light', 'dark', 'system']

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(preference) {
  const isDark = preference === 'dark' || (preference === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', isDark)
}

const ThemeContext = createContext(undefined)

export function ThemeProvider({ children }) {
  const { user } = useAuth()
  const [preference, setPreferenceState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return THEME_VALUES.includes(stored) ? stored : 'system'
  })

  useEffect(() => {
    applyTheme(preference)
    if (preference !== 'system') return
    // Keep an already-open tab in sync if the OS theme changes while
    // "system" is selected, rather than only re-checking on next load.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => applyTheme('system')
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [preference])

  // A saved DB preference is the source of truth once signed in -- it
  // overrides whatever this particular browser had locally, so the setting
  // follows the learner's account across devices rather than staying
  // per-browser.
  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('theme_preference')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!error && THEME_VALUES.includes(data?.theme_preference)) {
          setPreferenceState(data.theme_preference)
          localStorage.setItem(STORAGE_KEY, data.theme_preference)
        }
      })
  }, [user])

  const setPreference = useCallback(
    async (next) => {
      setPreferenceState(next)
      localStorage.setItem(STORAGE_KEY, next)
      if (user) {
        await supabase.from('profiles').update({ theme_preference: next }).eq('id', user.id)
      }
    },
    [user]
  )

  return <ThemeContext.Provider value={{ preference, setPreference }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (ctx === undefined) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
