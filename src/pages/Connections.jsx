import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import ConfirmDialog from '../components/ConfirmDialog'
import { LEVEL_LABELS } from '../lib/levels'
import {
  listMyPeerRatings,
  listConnections,
  listSentInvites,
  listIncomingRateInvites,
  getProfiles,
  getSharedSkillCounts,
  sendInviteEmail,
  revokeInvite,
} from '../lib/connections'
import { listIncomingPendingValidationRequests } from '../lib/skillValidationRequests'
import { listIncomingConnectionRequests, respondToConnectionRequest } from '../lib/skillDiscovery'
import { listMyPendingOrgInvites, decideOrgInvite } from '../lib/organisationInvites'

export default function Connections() {
  const { user, refreshOrganisationMemberships } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ratings, setRatings] = useState([])
  const [allConnectionIds, setAllConnectionIds] = useState([])
  const [invites, setInvites] = useState([])
  const [incomingRateInvites, setIncomingRateInvites] = useState([])
  const [validationRequests, setValidationRequests] = useState([])
  const [incomingRequests, setIncomingRequests] = useState([])
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInviteDecidingId, setOrgInviteDecidingId] = useState(null)
  const [orgInviteError, setOrgInviteError] = useState(null)
  const [respondingId, setRespondingId] = useState(null)
  const [respondError, setRespondError] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [sharedSkillCounts, setSharedSkillCounts] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [resendingId, setResendingId] = useState(null)
  const [resentId, setResentId] = useState(null)
  const [resendError, setResendError] = useState(null)
  const [revokingId, setRevokingId] = useState(null)
  const [revokeError, setRevokeError] = useState(null)
  const [pendingRevoke, setPendingRevoke] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [
        ratingsData,
        connectionsData,
        invitesData,
        incomingRateInvitesData,
        validationRequestsData,
        incomingRequestsData,
        orgInvitesData,
      ] = await Promise.all([
        listMyPeerRatings(),
        listConnections(user.id),
        listSentInvites(),
        listIncomingRateInvites(),
        listIncomingPendingValidationRequests(user.id),
        listIncomingConnectionRequests(user.id),
        listMyPendingOrgInvites(user.id),
      ])
      setRatings(ratingsData)
      setAllConnectionIds(connectionsData.map((c) => c.id))
      setInvites(invitesData)
      setIncomingRateInvites(incomingRateInvitesData)
      setValidationRequests(validationRequestsData)
      setIncomingRequests(incomingRequestsData)
      setOrgInvites(orgInvitesData)
      const otherIds = ratingsData.map((r) => (r.rater_id === user.id ? r.skill_owner_id : r.rater_id))
      const requesterIds = validationRequestsData.map((r) => r.requester_id)
      const requestSenderIds = incomingRequestsData.map((r) => r.requester_id)
      const connectionIds = [...new Set([...connectionsData.map((c) => c.id), ...otherIds])]
      const [profilesData, sharedSkillCountsData] = await Promise.all([
        getProfiles([...otherIds, ...connectionsData.map((c) => c.id), ...requesterIds, ...requestSenderIds, user.id]),
        getSharedSkillCounts(user.id, connectionIds),
      ])
      setProfiles(profilesData)
      setSharedSkillCounts(sharedSkillCountsData)
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
      if (accept) await load()
    } catch (err) {
      setRespondError({ id: requestId, message: err.message })
    } finally {
      setRespondingId(null)
    }
  }

  const connections = useMemo(() => {
    const map = new Map()

    // Every connection appears at least once, even one formed purely via an
    // accepted request with no peer-rating history yet.
    for (const id of allConnectionIds) {
      map.set(id, { id, name: profiles[id]?.name || 'Someone', avatarUrl: profiles[id]?.avatarUrl || null, events: [] })
    }

    for (const r of ratings) {
      const gaveRating = r.rater_id === user.id
      const otherId = gaveRating ? r.skill_owner_id : r.rater_id
      const otherName = gaveRating
        ? profiles[otherId]?.name || 'Someone'
        : r.rater_name || r.rater_email || 'Someone'

      if (!map.has(otherId)) {
        map.set(otherId, { id: otherId, name: otherName, avatarUrl: profiles[otherId]?.avatarUrl || null, events: [] })
      }
      map.get(otherId).events.push({
        direction: gaveRating ? 'given' : 'received',
        skillName: r.skill_name,
        skillCategory: r.skill_category,
        level: r.level,
        comments: r.comments,
        date: r.rated_at,
      })
    }

    const list = Array.from(map.values())
    for (const c of list) c.events.sort((a, b) => new Date(b.date) - new Date(a.date))
    list.sort((a, b) => new Date(b.events[0]?.date ?? 0) - new Date(a.events[0]?.date ?? 0))
    return list
  }, [ratings, allConnectionIds, profiles, user.id])

  const pendingInvites = useMemo(
    () => invites.filter((i) => i.status === 'pending' && i.invitee_email),
    [invites]
  )

  function handleCopy(invite) {
    navigator.clipboard.writeText(invite.url)
    setCopiedId(invite.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function handleResend(invite) {
    setResendError(null)
    setResendingId(invite.id)
    try {
      await sendInviteEmail({
        toEmail: invite.invitee_email,
        inviterName: profiles[user.id]?.name || user.email,
        skillName: invite.skills?.name,
        shareUrl: invite.url,
      })
      setResentId(invite.id)
      setTimeout(() => setResentId(null), 2000)
    } catch (err) {
      setResendError({ id: invite.id, message: err.message })
    } finally {
      setResendingId(null)
    }
  }

  async function handleRevoke(invite) {
    setRevokeError(null)
    setRevokingId(invite.id)
    try {
      await revokeInvite(invite.id)
      setInvites((prev) => prev.filter((i) => i.id !== invite.id))
    } catch (err) {
      setRevokeError({ id: invite.id, message: err.message })
    } finally {
      setRevokingId(null)
      setPendingRevoke(null)
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
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
            <h2 className="font-display text-xl text-ink mb-6">Provider staff invitations</h2>
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

        <div>
          <h2 className="font-display text-xl text-ink mb-6">Your connections</h2>

          {loading && <p className="text-secondary">Loading…</p>}
          {error && <p className="text-red-700 text-sm">{error}</p>}

          {!loading && connections.length === 0 && (
            <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
              <p className="text-secondary">
                No connections yet. Invite someone to rate a skill, or connect with people tracking
                the same skill from that skill's detail view.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {connections.map((c) => (
              <div key={c.id} className="bg-card border border-hairline rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Link to={`/skills-profile/${c.id}`} className="flex items-center gap-2 group w-fit">
                    <ConnectionAvatar name={c.name} avatarUrl={c.avatarUrl} />
                    <span className="font-display text-lg text-ink group-hover:text-moss group-hover:underline">
                      {c.name}
                    </span>
                  </Link>
                  {sharedSkillCounts[c.id] > 0 && (
                    <span className="font-mono text-xs text-secondary border border-hairline rounded-full px-2 py-0.5">
                      {sharedSkillCounts[c.id]} shared skill{sharedSkillCounts[c.id] === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {c.events.length === 0 && <p className="text-sm text-secondary">Connected</p>}
                  {c.events.map((e, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <GrowthRing level={e.level} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink">
                          {e.direction === 'given' ? (
                            <>
                              You rated their <strong>{e.skillName}</strong>: {LEVEL_LABELS[e.level]}
                            </>
                          ) : (
                            <>
                              They rated your <strong>{e.skillName}</strong>: {LEVEL_LABELS[e.level]}
                            </>
                          )}
                        </p>
                        <p className="font-mono text-xs text-secondary">
                          {new Date(e.date).toLocaleDateString()}
                          {e.skillCategory ? ` · ${e.skillCategory}` : ''}
                        </p>
                        {e.comments && <p className="text-sm text-secondary mt-0.5">{e.comments}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

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

        {pendingInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Pending invites</h2>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="bg-card border border-hairline rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      <strong>{invite.skills?.name}</strong> — sent to {invite.invitee_email}
                    </p>
                    <p className="font-mono text-xs text-secondary">
                      {new Date(invite.created_at).toLocaleDateString()}
                    </p>
                    {resendError?.id === invite.id && (
                      <p className="text-xs text-red-700 mt-1">{resendError.message}</p>
                    )}
                    {revokeError?.id === invite.id && (
                      <p className="text-xs text-red-700 mt-1">{revokeError.message}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <button
                      type="button"
                      onClick={() => handleResend(invite)}
                      disabled={resendingId === invite.id}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      {resendingId === invite.id
                        ? 'Sending…'
                        : resentId === invite.id
                          ? 'Sent!'
                          : 'Resend email'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(invite)}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                    >
                      {copiedId === invite.id ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRevoke(invite)}
                      disabled={revokingId === invite.id}
                      className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                    >
                      {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {pendingRevoke && (
        <ConfirmDialog
          message={`Revoke the invite to ${pendingRevoke.invitee_email}? They'll no longer be able to use this link.`}
          onConfirm={() => handleRevoke(pendingRevoke)}
          onCancel={() => setPendingRevoke(null)}
          confirming={revokingId === pendingRevoke.id}
        />
      )}
    </div>
  )
}

function ConnectionAvatar({ name, avatarUrl }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="w-8 h-8 rounded-full object-cover border border-hairline shrink-0"
      />
    )
  }
  return (
    <span className="w-8 h-8 rounded-full border border-hairline bg-paper text-secondary font-mono text-xs flex items-center justify-center shrink-0 uppercase">
      {name?.[0] || '?'}
    </span>
  )
}
