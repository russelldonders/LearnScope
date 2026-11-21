import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { clearGoogleMeetOAuthReturn, completeGoogleMeetConnection, readGoogleMeetOAuthReturn } from '../lib/googleMeet'

export default function GoogleMeetCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState(null)
  const attemptedRef = useRef(false)

  useEffect(() => {
    if (attemptedRef.current) return
    attemptedRef.current = true
    const returnTo = readGoogleMeetOAuthReturn()
    const denied = searchParams.get('error')
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (denied || !code) {
      setError(denied === 'access_denied' ? 'Google connection cancelled.' : 'Google did not return an authorization code.')
      return
    }
    completeGoogleMeetConnection({ code, state })
      .then(() => {
        clearGoogleMeetOAuthReturn()
        navigate(returnTo, { replace: true })
      })
      .catch((err) => setError(err.message))
  }, [navigate, searchParams])

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-xl px-4 py-12">
        <h1 className="font-display text-2xl text-ink">Connecting Google Meet</h1>
        {error ? (
          <div className="mt-4 space-y-3">
            <p role="alert" className="text-sm text-red-700">{error}</p>
            <button type="button" onClick={() => navigate(readGoogleMeetOAuthReturn(), { replace: true })} className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-card">
              Return to LearnScope
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-secondary">Finishing the secure connection…</p>
        )}
      </main>
    </div>
  )
}
