import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPendingInviteCode, clearPendingInviteCode } from '../lib/connections'

export default function Welcome() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    if (!user) return
    // The ?invite= query param (see signUp in AuthContext) survives the
    // confirmation link being opened on a different device/browser than
    // signup was started on; the stored code is just a same-browser
    // fallback for other entry points into this page.
    const pendingCode = searchParams.get('invite') || getPendingInviteCode()
    if (pendingCode) {
      clearPendingInviteCode()
      navigate(`/rate/${pendingCode}`)
    }
  }, [user, navigate, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm bg-card border border-hairline rounded-lg p-8 text-center">
        <span className="font-display text-3xl text-ink mb-1 block">LearnScope</span>

        {loading ? (
          <p className="text-sm text-secondary mt-4">Confirming your email…</p>
        ) : user ? (
          <>
            <p className="text-ink mt-4">Your email is confirmed. Welcome to LearnScope.</p>
            <Link
              to="/dashboard"
              className="inline-block mt-6 rounded-md bg-moss text-paper py-2 px-6 font-medium hover:opacity-90"
            >
              Go to your dashboard
            </Link>
          </>
        ) : (
          <>
            <p className="text-ink mt-4">
              We couldn't confirm this link automatically — it may have expired.
            </p>
            <Link to="/login" className="inline-block mt-6 text-moss font-medium">
              Log in instead
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
