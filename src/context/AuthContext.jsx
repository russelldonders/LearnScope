import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  // null = not yet known, true/false = known. Only re-checked when the
  // signed-in user actually changes, not on every token refresh.
  const [needsOnboarding, setNeedsOnboarding] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) {
      setNeedsOnboarding(null)
      return
    }
    supabase
      .from('profiles')
      .select('onboarding_completed_at')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        setNeedsOnboarding(!error && data ? !data.onboarding_completed_at : false)
      })
  }, [userId])

  async function markOnboardingComplete() {
    if (!userId) return { error: null }
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('id', userId)
    if (!error) setNeedsOnboarding(false)
    return { error }
  }

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    needsOnboarding,
    markOnboardingComplete,
    signUp: (email, password, { firstName, lastName } = {}) =>
      supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/welcome`,
          data: { first_name: firstName?.trim() || null, last_name: lastName?.trim() || null },
        },
      }),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    // Also doubles as signup -- Supabase creates the account on first Google
    // login automatically, already-verified since Google owns the email.
    signInWithGoogle: (redirectTo) =>
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo ?? `${window.location.origin}/dashboard` },
      }),
    signOut: () => supabase.auth.signOut(),
    resetPasswordForEmail: (email) =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      }),
    updatePassword: (password) => supabase.auth.updateUser({ password }),
    updateEmail: (email) =>
      supabase.auth.updateUser(
        { email },
        { emailRedirectTo: `${window.location.origin}/profile` }
      ),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
