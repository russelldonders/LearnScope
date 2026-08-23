import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getPendingInviteCode } from '../lib/connections'

const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  // null = not yet known, true/false = known. Only re-checked when the
  // signed-in user actually changes, not on every token refresh.
  const [needsOnboarding, setNeedsOnboarding] = useState(null)
  // Same null-until-known pattern as needsOnboarding -- PlatformAdminRoute
  // needs to distinguish "not yet checked" from "checked, not an admin" so
  // it doesn't redirect an actual admin away before the check resolves.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(null)
  const [organisationMemberships, setOrganisationMemberships] = useState([])

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

  useEffect(() => {
    if (!userId) {
      setIsPlatformAdmin(null)
      setOrganisationMemberships([])
      return
    }
    supabase
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => setIsPlatformAdmin(!error && Boolean(data)))
    supabase
      .from('organisation_members')
      .select('organisation_id, role')
      .eq('user_id', userId)
      .then(({ data, error }) => setOrganisationMemberships(!error && data ? data : []))
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
    isPlatformAdmin,
    organisationMemberships,
    markOnboardingComplete,
    // Carries a pending rate-invite code through as a query param on the
    // confirmation-email redirect, rather than relying solely on
    // localStorage -- the confirmation link is often opened on a different
    // device/browser than the one signup was started on, where localStorage
    // wouldn't be there either. Welcome.jsx reads it from the URL first.
    signUp: (email, password, { firstName, lastName } = {}) => {
      const pendingCode = getPendingInviteCode()
      const redirectPath = pendingCode ? `/welcome?invite=${pendingCode}` : '/welcome'
      return supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectPath}`,
          data: { first_name: firstName?.trim() || null, last_name: lastName?.trim() || null },
        },
      })
    },
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
