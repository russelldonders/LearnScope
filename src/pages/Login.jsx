import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPendingInviteCode, clearPendingInviteCode } from '../lib/connections'
import { getPendingEnrolCourseId, clearPendingEnrolCourseId, resumePendingEnrolment } from '../lib/courseCatalogue'
import GoogleSignInButton from '../components/GoogleSignInButton'

export default function Login() {
  const { signIn, signInWithGoogle, user, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { data, error } = await signIn(email, password)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    const pendingCode = getPendingInviteCode()
    if (pendingCode) {
      clearPendingInviteCode()
      navigate(`/rate/${pendingCode}`)
      return
    }
    const enrolled = await resumePendingEnrolment(data.user.id).catch(() => null)
    navigate(enrolled ? `/courses/${enrolled.id}` : '/dashboard')
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm bg-card border border-hairline rounded-lg p-8">
        <Link to="/" className="flex items-center gap-2 font-display text-3xl text-ink mb-1">
          <img src="/favicon.svg" alt="" className="w-8 h-8" />
          LearnScope
        </Link>
        <p className="text-secondary text-sm mb-6">Log in to your growth log.</p>

        <GoogleSignInButton onClick={handleGoogleSignIn} disabled={googleSubmitting} />

        <div className="flex items-center gap-3 my-5">
          <span className="flex-1 h-px bg-hairline" />
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">or</span>
          <span className="flex-1 h-px bg-hairline" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="email">
              Email
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
                Password
              </label>
              <Link to="/forgot-password" className="text-sm text-moss font-medium">
                Forgot password?
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

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="text-sm text-secondary mt-6 text-center">
          No account yet?{' '}
          <Link to="/signup" className="text-moss font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
