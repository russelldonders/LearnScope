import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import GrowthRing from '../components/GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { listMyPeerRatings, listSentInvites, getProfileNames } from '../lib/connections'

export default function Connections() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ratings, setRatings] = useState([])
  const [invites, setInvites] = useState([])
  const [names, setNames] = useState({})
  const [copiedId, setCopiedId] = useState(null)

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
      const ownerIds = ratingsData
        .filter((r) => r.rater_id === user.id)
        .map((r) => r.skill_owner_id)
      setNames(await getProfileNames(ownerIds))
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
      const otherName = gaveRating ? names[otherId] || 'Someone' : r.rater_name || r.rater_email || 'Someone'

      if (!map.has(otherId)) map.set(otherId, { id: otherId, name: otherName, events: [] })
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
  }, [ratings, names, user.id])

  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites])

  function handleCopy(invite) {
    navigator.clipboard.writeText(invite.url)
    setCopiedId(invite.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-hairline bg-card">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/dashboard" className="font-display text-2xl text-ink">
            LearnScope
          </Link>
          <Link
            to="/dashboard"
            className="text-sm text-secondary hover:text-ink border border-hairline rounded-md px-3 py-1.5"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

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
                  className="font-display text-lg text-ink mb-3 inline-block hover:text-moss hover:underline"
                >
                  {c.name}
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
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(invite)}
                    className="shrink-0 rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                  >
                    {copiedId === invite.id ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
