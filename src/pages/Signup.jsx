import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPendingInviteCode, clearPendingInviteCode } from '../lib/connections'
import { getPendingEnrolCourseId, clearPendingEnrolCourseId, resumePendingEnrolment } from '../lib/courseCatalogue'
import GoogleSignInButton from '../components/GoogleSignInButton'

export default function Signup() {
  const { signUp, signInWithGoogle, user, loading } = useAuth()
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)
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
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name.')
      return
    }
    setError(null)
    setSubmitting(true)
    const { data, error } = await signUp(email, password, { firstName, lastName })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    if (data.session) {
      const pendingCode = getPendingInviteCode()
      if (pendingCode) {
        clearPendingInviteCode()
        navigate(`/rate/${pendingCode}`)
        return
      }
      const enrolled = await resumePendingEnrolment(data.user.id).catch(() => null)
      navigate(enrolled ? `/courses/${enrolled.id}` : '/dashboard')
    } else {
      setConfirmationSent(true)
    }
  }

  async function handleGoogleSignIn() {
    setError(null)
    setGoogleSubmitting(true)
    const pendingCode = getPendingInviteCode()
    const pendingEnrolId = getPendingEnrolCourseId()
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
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm bg-card border border-hairline rounded-lg p-8">
        <Link to="/" className="flex items-center gap-2 font-display text-3xl text-ink mb-1">
          <img src="/favicon.svg" alt="" className="w-8 h-8" />
          LearnScope
        </Link>
        <p className="text-secondary text-sm mb-6">Start tracking the skills you're growing.</p>

        {!confirmationSent && (
          <>
            <GoogleSignInButton
              onClick={handleGoogleSignIn}
              disabled={googleSubmitting}
              label="Sign up with Google"
            />
            <div className="flex items-center gap-3 my-5">
              <span className="flex-1 h-px bg-hairline" />
              <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">or</span>
              <span className="flex-1 h-px bg-hairline" />
            </div>
          </>
        )}

        {confirmationSent ? (
          <p className="text-sm text-ink">
            Check your email to confirm your account, then log in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="firstName">
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="lastName">
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
            </div>
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
              <label className="block text-sm text-secondary mb-1" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
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
              {submitting ? 'Creating account…' : 'Sign up'}
            </button>
          </form>
        )}

        {!confirmationSent && (
          <p className="text-sm text-secondary mt-6 text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-moss font-medium">
              Log in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
