import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import AppHeader from '../components/AppHeader'
import { LEVEL_LABELS } from '../lib/levels'
import { listIncomingRateInvites, getProfiles } from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listIncomingConnectionRequests, respondToConnectionRequest } from '../lib/skillDiscovery'
import { listMyPendingOrgInvites, decideOrgInvite } from '../lib/organisationInvites'

// Everything actually waiting on this learner to act -- the same four
// sources PendingActionsContext counts for the header badge, just rendered
// in full here instead of as a number. Deliberately separate from
// Connections.jsx, which is about the learner's network/history, not
// open requests.
export default function Actions() {
  const { user, refreshOrganisationMemberships } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [incomingRateInvites, setIncomingRateInvites] = useState([])
  const [validationRequests, setValidationRequests] = useState([])
  const [incomingRequests, setIncomingRequests] = useState([])
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInviteDecidingId, setOrgInviteDecidingId] = useState(null)
  const [orgInviteError, setOrgInviteError] = useState(null)
  const [respondingId, setRespondingId] = useState(null)
  const [respondError, setRespondError] = useState(null)
  const [profiles, setProfiles] = useState({})

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [incomingRateInvitesData, validationRequestsData, incomingRequestsData, orgInvitesData] =
        await Promise.all([
          listIncomingRateInvites(),
          listIncomingPendingValidationRequests(user.id),
          listIncomingConnectionRequests(user.id),
          listMyPendingOrgInvites(user.id),
        ])
      setIncomingRateInvites(incomingRateInvitesData)
      setValidationRequests(validationRequestsData)
      setIncomingRequests(incomingRequestsData)
      setOrgInvites(orgInvitesData)
      const requesterIds = validationRequestsData.map((r) => r.requester_id)
      const requestSenderIds = incomingRequestsData.map((r) => r.requester_id)
      setProfiles(await getProfiles([...requesterIds, ...requestSenderIds]))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleOrgInviteResponse(memberId, accept) {
    setOrgInviteError(null)
    setOrgInviteDecidingId(memberId)
    try {
      await decideOrgInvite(memberId, accept)
      setOrgInvites((prev) => prev.filter((i) => i.id !== memberId))
      refreshPendingActionCount()
      if (accept) refreshOrganisationMemberships()
    } catch (err) {
      setOrgInviteError({ id: memberId, message: err.message })
    } finally {
      setOrgInviteDecidingId(null)
    }
  }

  async function handleRequestResponse(requestId, accept) {
    setRespondError(null)
    setRespondingId(requestId)
    try {
      await respondToConnectionRequest(requestId, accept)
      setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId))
      refreshPendingActionCount()
    } catch (err) {
      setRespondError({ id: requestId, message: err.message })
    } finally {
      setRespondingId(null)
    }
  }

  const hasNothingPending =
    !loading &&
    incomingRateInvites.length === 0 &&
    incomingRequests.length === 0 &&
    orgInvites.length === 0 &&
    validationRequests.length === 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        <h1 className="font-display text-2xl text-ink">Actions</h1>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-red-700 text-sm">{error}</p>}

        {hasNothingPending && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">Nothing needs your attention right now.</p>
          </div>
        )}

        {incomingRateInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Invitations to rate</h2>
            <div className="space-y-3">
              {incomingRateInvites.map((invite) => (
                <Link
                  key={invite.id}
                  to={`/rate/${invite.share_code}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{invite.inviter_name || 'Someone'}</strong> wants your rating on their skill:{' '}
                    <strong>{invite.skill_name}</strong>
                    {invite.skill_category ? ` (${invite.skill_category})` : ''}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {incomingRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Connection requests</h2>
            <div className="space-y-3">
              {incomingRequests.map((request) => (
                <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong>
                    {request.skills?.name ? (
                      <>
                        {' '}wants to connect over <strong>{request.skills.name}</strong>
                      </>
                    ) : (
                      ' wants to connect'
                    )}
                  </p>
                  {request.message && <p className="text-sm text-secondary mt-1">{request.message}</p>}
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                  {respondError?.id === request.id && (
                    <p className="text-xs text-red-700 mt-1">{respondError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleRequestResponse(request.id, true)}
                      disabled={respondingId === request.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestResponse(request.id, false)}
                      disabled={respondingId === request.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {orgInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Provider invitations</h2>
            <div className="space-y-3">
              {orgInvites.map((invite) => (
                <div key={invite.id} className="bg-card border border-hairline rounded-lg p-4">
                  <p className="text-sm text-ink">
                    <strong>{invite.organisations?.name || 'A provider organisation'}</strong> wants to add you as{' '}
                    {invite.role === 'admin' ? 'an admin' : 'a trainer'}
                  </p>
                  <p className="font-mono text-xs text-secondary mt-1">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                  {orgInviteError?.id === invite.id && (
                    <p className="text-xs text-red-700 mt-1">{orgInviteError.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => handleOrgInviteResponse(invite.id, true)}
                      disabled={orgInviteDecidingId === invite.id}
                      className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOrgInviteResponse(invite.id, false)}
                      disabled={orgInviteDecidingId === invite.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {validationRequests.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Requests to validate</h2>
            <div className="space-y-3">
              {validationRequests.map((request) => (
                <Link
                  key={request.id}
                  to={`/validate-request/${request.id}`}
                  className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
                >
                  <p className="text-sm text-ink">
                    <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong> asked you to confirm{' '}
                    they've reached <strong>{LEVEL_LABELS[request.target_level]}</strong> on{' '}
                    <strong>{request.skills?.name}</strong>
                  </p>
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
