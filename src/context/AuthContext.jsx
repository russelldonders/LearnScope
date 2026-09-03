import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getPendingInviteCode } from '../lib/connections'
import { getPendingEnrolCourseId } from '../lib/courseCatalogue'
import { chooseActiveWorkspace, listAvailableWorkspaces } from '../lib/workspaces'

const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  // null = not yet known, true/false = known. Only re-checked when the
  // signed-in user actually changes, not on every token refresh.
  const [needsOnboarding, setNeedsOnboarding] = useState(null)
  // Same null-until-known pattern -- catches the one gap left by making
  // Signup.jsx's name fields required: an account created through an
  // admin/provider invite never goes through Signup at all, so first_name/
  // last_name can still land null (see api/admin/actions.js's inviteUser/
  // inviteOrgStaff, which call inviteUserByEmail with no name metadata).
  const [needsName, setNeedsName] = useState(null)
  // Same null-until-known pattern as needsOnboarding -- PlatformAdminRoute
  // needs to distinguish "not yet checked" from "checked, not an admin" so
  // it doesn't redirect an actual admin away before the check resolves.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(null)
  // Same null-until-known pattern as isPlatformAdmin -- ProviderAdminRoute
  // needs to tell "not yet checked" apart from "checked, no memberships",
  // since an empty array would otherwise look identical to both.
  const [organisationMemberships, setOrganisationMemberships] = useState(null)
  // Same null-until-known pattern, for EmployerAdminRoute -- employer_members
  // (20260902090000) is a separate membership concept from
  // organisation_members: it's an employer's own managed-learner roster, not
  // provider staff, so it's tracked independently rather than folded into
  // organisationMemberships above.
  const [employerMemberships, setEmployerMemberships] = useState(null)
  // Workspaces are an additive context layer. Existing learner pages continue
  // to use user.id until their domains are migrated deliberately; exposing the
  // resolved personal workspace here lets new UI integrate without changing
  // the ownership of any existing record.
  const [workspaces, setWorkspaces] = useState(null)
  const [activeWorkspace, setActiveWorkspace] = useState(null)
  const [workspaceError, setWorkspaceError] = useState(null)

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
      setNeedsName(null)
      return
    }
    supabase
      .from('profiles')
      .select('onboarding_completed_at, first_name, last_name')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        setNeedsOnboarding(!error && data ? !data.onboarding_completed_at : false)
        setNeedsName(!error && data ? !data.first_name?.trim() || !data.last_name?.trim() : false)
      })
  }, [userId])

  // Called by Profile.jsx after a successful save -- without this, fixing a
  // blank name wouldn't clear needsName until the next full page load/re-
  // auth, so ProtectedRoute would keep redirecting back to /profile even
  // though the account no longer needs it.
  const refreshNeedsName = useCallback(() => {
    if (!userId) return
    supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        setNeedsName(!error && data ? !data.first_name?.trim() || !data.last_name?.trim() : false)
      })
  }, [userId])

  const refreshOrganisationMemberships = useCallback(() => {
    if (!userId) return
    supabase
      .from('organisation_members')
      .select('organisation_id, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .then(({ data, error }) => setOrganisationMemberships(!error && data ? data : []))
  }, [userId])

  const refreshEmployerMemberships = useCallback(() => {
    if (!userId) return
    supabase
      .from('employer_members')
      .select('employer_id, role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .then(({ data, error }) => setEmployerMemberships(!error && data ? data : []))
  }, [userId])

  const refreshWorkspaces = useCallback(async () => {
    if (!userId) return []
    try {
      const available = await listAvailableWorkspaces()
      setWorkspaces(available)
      setWorkspaceError(null)
      setActiveWorkspace((current) => chooseActiveWorkspace(available, current?.id))
      return available
    } catch (error) {
      setWorkspaces([])
      setActiveWorkspace(null)
      setWorkspaceError(error)
      return []
    }
  }, [userId])

  const selectWorkspace = useCallback((workspaceId) => {
    const selected = chooseActiveWorkspace(workspaces, workspaceId)
    if (!selected || selected.id !== workspaceId) return false
    setActiveWorkspace(selected)
    return true
  }, [workspaces])

  useEffect(() => {
    if (!userId) {
      setIsPlatformAdmin(null)
      setOrganisationMemberships(null)
      setEmployerMemberships(null)
      setWorkspaces(null)
      setActiveWorkspace(null)
      setWorkspaceError(null)
      return
    }
    supabase
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => setIsPlatformAdmin(!error && Boolean(data)))
    refreshOrganisationMemberships()
    refreshEmployerMemberships()
    refreshWorkspaces()
  }, [userId, refreshOrganisationMemberships, refreshEmployerMemberships, refreshWorkspaces])

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
    needsName,
    isPlatformAdmin,
    organisationMemberships,
    refreshOrganisationMemberships,
    employerMemberships,
    refreshEmployerMemberships,
    workspaces,
    activeWorkspace,
    workspaceError,
    refreshWorkspaces,
    selectWorkspace,
    refreshNeedsName,
    markOnboardingComplete,
    // Carries a pending rate-invite code (and/or a pending course
    // enrolment) through as a query param on the confirmation-email
    // redirect, rather than relying solely on localStorage -- the
    // confirmation link is often opened on a different device/browser than
    // the one signup was started on, where localStorage wouldn't be there
    // either. Welcome.jsx reads these from the URL first.
    signUp: (email, password, { firstName, lastName } = {}) => {
      const pendingCode = getPendingInviteCode()
      const pendingEnrolId = getPendingEnrolCourseId()
      const params = new URLSearchParams()
      if (pendingCode) params.set('invite', pendingCode)
      if (pendingEnrolId) params.set('enrol', pendingEnrolId)
      const redirectPath = params.toString() ? `/welcome?${params.toString()}` : '/welcome'
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
