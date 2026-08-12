import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { listMyPeerRatings, listSentInvites, getProfiles, sendInviteEmail } from '../lib/connections'

export default function Connections() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ratings, setRatings] = useState([])
  const [invites, setInvites] = useState([])
  const [profiles, setProfiles] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [resendingId, setResendingId] = useState(null)
  const [resentId, setResentId] = useState(null)
  const [resendError, setResendError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ratingsData, invitesData] = await Promise.all([listMyPeerRatings(), listSentInvites()])
      setRatings(ratingsData)
      setInvites(invitesData)
      const otherIds = ratingsData.map((r) => (r.rater_id === user.id ? r.skill_owner_id : r.rater_id))
      setProfiles(await getProfiles([...otherIds, user.id]))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const connections = useMemo(() => {
    const map = new Map()

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
    list.sort((a, b) => new Date(b.events[0].date) - new Date(a.events[0].date))
    return list
  }, [ratings, profiles, user.id])

  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites])

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

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-10">
        <div>
          <h2 className="font-display text-xl text-ink mb-6">Your connections</h2>

          {loading && <p className="text-secondary">Loading…</p>}
          {error && <p className="text-red-700 text-sm">{error}</p>}

          {!loading && connections.length === 0 && (
            <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
              <p className="text-secondary">
                No connections yet. Invite someone to rate a skill from that skill's detail view.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {connections.map((c) => (
              <div key={c.id} className="bg-card border border-hairline rounded-lg p-4">
                <Link
                  to={`/skills-profile/${c.id}`}
                  className="flex items-center gap-2 mb-3 group w-fit"
                >
                  <ConnectionAvatar name={c.name} avatarUrl={c.avatarUrl} />
                  <span className="font-display text-lg text-ink group-hover:text-moss group-hover:underline">
                    {c.name}
                  </span>
                </Link>
                <div className="space-y-3">
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

        {pendingInvites.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-ink mb-6">Pending invites</h2>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="bg-card border border-hairline rounded-lg p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      <strong>{invite.skills?.name}</strong>
                      {invite.invitee_email ? ` — sent to ${invite.invitee_email}` : ' — share link'}
                    </p>
                    <p className="font-mono text-xs text-secondary">
                      {new Date(invite.created_at).toLocaleDateString()}
                    </p>
                    {resendError?.id === invite.id && (
                      <p className="text-xs text-red-700 mt-1">{resendError.message}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {invite.invitee_email && (
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
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopy(invite)}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                    >
                      {copiedId === invite.id ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
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
