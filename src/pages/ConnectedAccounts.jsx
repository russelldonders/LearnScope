import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import StravaConnectButton from '../components/StravaConnectButton'
import StravaIcon from '../components/StravaIcon'
import StravaActivityReviewModal from '../components/StravaActivityReviewModal'
import { buildStravaAuthorizeUrl, connectStrava, disconnectStrava, getMyExternalConnections, syncStrava } from '../lib/strava'
import { formatRelativeDate } from '../lib/dates'

const OAUTH_STATE_KEY = 'stravaOAuthState'

export default function ConnectedAccounts() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [connection, setConnection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [reviewActivities, setReviewActivities] = useState(null)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  useEffect(() => {
    handleOAuthReturn()
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const rows = await getMyExternalConnections()
      setConnection(rows.find((r) => r.provider === 'strava') ?? null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Strava redirects back here with ?code&state (success) or ?error=
  // access_denied (learner declined). state is checked against what was
  // stashed in sessionStorage before the redirect -- the callback is an
  // unauthenticated GET from Strava's own domain, so this is the CSRF check
  // that ties the return back to the request this browser actually made.
  async function handleOAuthReturn() {
    const code = searchParams.get('code')
    const returnedState = searchParams.get('state')
    const scope = searchParams.get('scope')
    const deniedError = searchParams.get('error')
    if (!code && !deniedError) return

    // Clear the query string either way -- a refresh must not replay the
    // exchange, since an authorization code is single-use.
    navigate('/profile/connected-accounts', { replace: true })

    if (deniedError) {
      setError('Strava connection was cancelled.')
      return
    }

    const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY)
    sessionStorage.removeItem(OAUTH_STATE_KEY)
    if (!returnedState || returnedState !== expectedState) {
      setError('Could not verify the Strava connection request — please try again.')
      return
    }

    setConnecting(true)
    try {
      await connectStrava({ code, scope })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setConnecting(false)
    }
  }

  function handleConnectClick() {
    const state = crypto.randomUUID()
    sessionStorage.setItem(OAUTH_STATE_KEY, state)
    window.location.href = buildStravaAuthorizeUrl({
      redirectUri: `${window.location.origin}/profile/connected-accounts`,
      state,
    })
  }

  async function handleSync() {
    setError(null)
    setSuccessMessage(null)
    setSyncing(true)
    try {
      const activities = await syncStrava()
      if (activities.length === 0) {
        setSuccessMessage('Synced — no new activities since your last sync.')
      } else {
        setReviewActivities(activities)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      // Refreshed even on failure -- a reauth-required error has already
      // flipped the connection's status server-side, and the UI needs that
      // reflected (switching the action to "Reconnect Strava") rather than
      // still offering a "Sync now" that will just fail the same way again.
      await load()
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    setSuccessMessage(null)
    setDisconnecting(true)
    try {
      await disconnectStrava()
      setConfirmingDisconnect(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="font-display text-2xl text-ink">Connected apps</h1>
          <p className="text-secondary mt-1 text-sm">
            Bring in activity from other services so it can count as skill evidence, without typing it in by
            hand. You choose what gets imported and which skill it counts toward — nothing is added
            automatically.
          </p>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {successMessage && <p className="text-sm text-moss">{successMessage}</p>}

        <div className="bg-card border border-hairline rounded-lg p-6">
          <h3 className="flex items-center gap-2 font-display text-lg text-ink mb-1">
            <StravaIcon size={20} />
            Strava
          </h3>
          {loading || connecting ? (
            <p className="text-sm text-secondary">{connecting ? 'Connecting…' : 'Loading…'}</p>
          ) : connection ? (
            <div className="space-y-3">
              <p className="text-sm text-secondary">
                Connected
                {connection.last_synced_at
                  ? ` · last synced ${formatRelativeDate(connection.last_synced_at)}`
                  : ' · not yet synced'}
                {connection.status === 'error' ? ' · needs to be reconnected' : ''}
              </p>
              <div className="flex items-center gap-2">
                {connection.status === 'error' ? (
                  <StravaConnectButton onClick={handleConnectClick} label="Reconnect Strava" />
                ) : (
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncing}
                    className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmingDisconnect(true)}
                  className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-xs">
              <p className="text-sm text-secondary mb-3">
                Bring in your runs, rides, and other logged activity as skill evidence.
              </p>
              <StravaConnectButton onClick={handleConnectClick} />
            </div>
          )}
        </div>

        {confirmingDisconnect && (
          <ConfirmDialog
            message="Disconnect Strava? Activity you've already imported stays in your log — only the connection itself is removed."
            confirmLabel="Disconnect"
            onConfirm={handleDisconnect}
            onCancel={() => setConfirmingDisconnect(false)}
            confirming={disconnecting}
          />
        )}

        {reviewActivities && (
          <StravaActivityReviewModal
            activities={reviewActivities}
            onClose={() => setReviewActivities(null)}
            onImported={(count) => {
              setReviewActivities(null)
              setSuccessMessage(`Imported ${count} ${count === 1 ? 'activity' : 'activities'}.`)
            }}
          />
        )}
      </main>
    </div>
  )
}
