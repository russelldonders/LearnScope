import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPendingInviteCode, clearPendingInviteCode } from '../lib/connections'
import { getPendingEnrolCourseId, clearPendingEnrolCourseId, resumePendingEnrolment } from '../lib/courseCatalogue'
import { getOrganisationBranding, orgBrandStyle } from '../lib/orgBranding'
import { getEmployerLoginContext, getMyActiveEmployerMembership } from '../lib/employerRoleProfiles'
import { supabase } from '../lib/supabaseClient'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { useLanguage } from '../context/LanguageContext'

export default function Login() {
  const { signIn, signInWithGoogle, user, loading } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orgSlug = searchParams.get('org')
  const [branding, setBranding] = useState(null)
  // null until resolved; {id, name} if orgSlug belongs to an employer's own
  // dedicated organisation, otherwise null -- see get_employer_login_context
  // (20260912090000). A plain training-provider org's ?org=slug link
  // resolves to null here and behaves exactly as before this feature.
  const [employerContext, setEmployerContext] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)

  // Arrived here via a `?org=:slug` link from that org's public page
  // (ProviderProfile.jsx) -- carries its logo/colours through to this page
  // too, so the whitelabelled look continues into account creation rather
  // than dropping back to plain LearnScope branding mid-flow. Silently
  // falls back to the default look if the slug is stale/invalid (same
  // "indistinguishable to the caller" behaviour as the public page itself).
  useEffect(() => {
    if (!orgSlug) return
    getOrganisationBranding(orgSlug).then(setBranding).catch(() => {})
    getEmployerLoginContext(orgSlug).then(setEmployerContext).catch(() => {})
  }, [orgSlug])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  // Suppressed while handleSubmit's own post-signIn checks are still running
  // (submitting stays true until it decides where to go) -- otherwise
  // AuthContext's session updating mid-check (the auth-state-change listener
  // can fire before an employer-membership rejection gets to sign back out)
  // would race this in ahead of that decision, bouncing straight to
  // /dashboard for an account handleSubmit is about to reject.
  if (user && !submitting) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    // Resolved fresh here rather than trusting the mount-time effect's
    // employerContext state to have settled yet -- a learner submitting the
    // form before that fetch resolves must still get the membership check
    // below, not slip through because the state update hadn't landed.
    const [{ data, error }, employer] = await Promise.all([
      signIn(email, password),
      orgSlug ? getEmployerLoginContext(orgSlug).catch(() => null) : Promise.resolve(null),
    ])
    if (error) {
      setSubmitting(false)
      setError(error.message)
      return
    }

    // This link belongs to a specific employer -- only that employer's own
    // members get to sign in through it (see get_employer_login_context's
    // comment). A valid LearnScope account that isn't one is turned away
    // right back out rather than landing signed-in on an unrelated area, the
    // same way the credentials themselves would be rejected if wrong.
    if (employer) {
      const membership = await getMyActiveEmployerMembership(employer.id, data.user.id).catch(() => null)
      if (!membership) {
        await supabase.auth.signOut()
        setSubmitting(false)
        setError(`This account isn't linked to ${employer.name}. Ask your employer admin for an invite, or sign in without this link.`)
        return
      }
      setSubmitting(false)
      navigate(membership.role === 'admin' ? '/employer' : `/employer/home?org=${orgSlug}`)
      return
    }

    setSubmitting(false)
    const pendingCode = getPendingInviteCode()
    if (pendingCode) {
      clearPendingInviteCode()
      navigate(`/rate/${pendingCode}`)
      return
    }
    const enrolled = await resumePendingEnrolment(data.user.id).catch(() => null)
    navigate(enrolled ? `/courses/${enrolled.id}/learn` : '/dashboard')
  }

  async function handleGoogleSignIn() {
    setError(null)
    setGoogleSubmitting(true)
    const pendingCode = getPendingInviteCode()
    const pendingEnrolId = getPendingEnrolCourseId()
    // A full-page redirect can't resume anything inline here (there's no
    // authenticated session yet), so it lands on a page that does the
    // resuming itself once Supabase's redirect completes: /rate/:code
    // handles its own accept flow, /welcome?enrol= drives
    // resumePendingEnrolment the same way it does for email confirmation.
    let redirectTo = `${window.location.origin}/dashboard`
    if (pendingCode) {
      redirectTo = `${window.location.origin}/rate/${pendingCode}`
      clearPendingInviteCode()
    } else if (pendingEnrolId) {
      redirectTo = `${window.location.origin}/welcome?enrol=${pendingEnrolId}`
      clearPendingEnrolCourseId()
    }
    const { error } = await signInWithGoogle(redirectTo)
    if (error) {
      setError(error.message)
      setGoogleSubmitting(false)
    }
    // On success the browser navigates away to Google, so there's nothing
    // further to do here -- the redirect back into the app is handled by
    // Supabase's own auth-state listener in AuthContext.
  }

  const ctaTextClass = branding?.primaryColor ? 'text-white' : 'text-paper'

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--org-background,var(--color-paper))] px-4"
      style={orgBrandStyle(branding)}
    >
      <div className="w-full max-w-sm bg-[var(--org-background,var(--color-card))] border border-hairline rounded-lg p-8">
        <Link
          to={branding?.logoUrl ? `/providers/${orgSlug}` : '/'}
          className="flex items-center gap-2 font-display text-3xl text-ink mb-1"
        >
          <img src={branding?.logoUrl || '/favicon.svg'} alt="" className="w-8 h-8 object-contain rounded" />
          {branding?.logoUrl ? branding.name : 'LearnScope'}
        </Link>
        <p className="text-secondary text-sm mb-6">{t('auth.login.tagline')}</p>

        {employerContext && (
          <p className="text-xs font-medium text-secondary mb-4">
            For {employerContext.name} team members only.
          </p>
        )}

        {/* Google sign-in is a full-page redirect with no session to check
            membership against beforehand (see handleGoogleSignIn's own
            comment), so there's no point in the flow to apply the
            employer-membership gate below to it -- left out entirely here
            rather than let it bypass that gate. */}
        {!employerContext && (
          <>
            <GoogleSignInButton onClick={handleGoogleSignIn} disabled={googleSubmitting} />

            <div className="flex items-center gap-3 my-5">
              <span className="flex-1 h-px bg-hairline" />
              <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">or</span>
              <span className="flex-1 h-px bg-hairline" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="email">
              {t('auth.email')}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-secondary" htmlFor="password">
                {t('auth.password')}
              </label>
              <Link to="/forgot-password" className="text-sm text-[var(--org-primary,var(--color-moss))] font-medium">
                {t('auth.login.forgotPassword')}
              </Link>
            </div>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className={`w-full rounded-md bg-[var(--org-primary,var(--color-moss))] hover:bg-[var(--org-hover,var(--org-primary,var(--color-moss)))] ${ctaTextClass} py-2 font-medium hover:opacity-90 disabled:opacity-60`}
          >
            {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </button>
        </form>

        {/* Self-signup can't ever grant employer membership -- it's provisioned
            by that employer's own admin -- so this offers no useful path for
            an employer-gated link and is left out rather than send someone
            into a dead end where they'd sign up but still be rejected here. */}
        {!employerContext && (
          <p className="text-sm text-secondary mt-6 text-center">
            {t('auth.login.noAccount')}{' '}
            <Link to={orgSlug ? `/signup?org=${orgSlug}` : '/signup'} className="text-[var(--org-primary,var(--color-moss))] font-medium">
              {t('auth.login.signUp')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
