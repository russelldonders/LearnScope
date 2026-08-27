import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import GrowthRing from './GrowthRing'
import PersonAvatar from './PersonAvatar'
import { LEVEL_LABELS } from '../lib/levels'
import { listSkillMatches, sendConnectionRequest, isDuplicatePendingRequestError } from '../lib/skillDiscovery'
import AccessibleDialog from './AccessibleDialog'

const SEARCH_THRESHOLD = 10

export default function PeopleWithSkillModal({ librarySkillId, skillName, skillId, onClose }) {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [openRequestFor, setOpenRequestFor] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    listSkillMatches(librarySkillId)
      .then(setMatches)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [librarySkillId])

  const visible =
    search.trim() && matches.length > SEARCH_THRESHOLD
      ? matches.filter((m) => (m.full_name || '').toLowerCase().includes(search.trim().toLowerCase()))
      : matches

  function handleRequested(userId) {
    setMatches((prev) => prev.map((m) => (m.user_id === userId ? { ...m, has_pending_request: true } : m)))
    setOpenRequestFor(null)
  }

  return (
    <AccessibleDialog
      labelledBy="people-with-skill-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-1">
          <h2 id="people-with-skill-dialog-title" className="font-display text-2xl text-ink">People with {skillName}</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm shrink-0">
            Close
          </button>
        </div>
        <p className="text-xs text-secondary mb-4">
          Only shows people who've chosen to appear in skill searches.
        </p>

        {matches.length > SEARCH_THRESHOLD && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-moss"
          />
        )}

        {loading && <p className="text-sm text-secondary">Loading…</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-secondary">
            {matches.length === 0 ? 'No one else is currently discoverable for this skill.' : 'No matches.'}
          </p>
        )}

        <ul className="space-y-2">
          {visible.map((m) => (
            <li key={m.user_id} className="rounded-md border border-hairline p-3">
              <div className="flex items-center gap-3">
                {m.profile_viewable ? (
                  <Link
                    to={`/skills-profile/${m.user_id}`}
                    className="flex items-center gap-3 min-w-0 group flex-1"
                  >
                    <PersonAvatar name={m.full_name} avatarUrl={m.avatar_url} />
                    <span className="text-sm text-ink font-medium truncate group-hover:text-moss group-hover:underline">
                      {m.full_name || 'Someone'}
                    </span>
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <PersonAvatar name={m.full_name} avatarUrl={m.avatar_url} />
                    <span className="text-sm text-ink font-medium truncate">{m.full_name || 'Someone'}</span>
                  </div>
                )}
                <GrowthRing level={m.level} size={24} labels={LEVEL_LABELS} />
                {m.is_connection ? (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 shrink-0">
                    Connected
                  </span>
                ) : m.has_pending_request ? (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 shrink-0">
                    Requested
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenRequestFor(openRequestFor === m.user_id ? null : m.user_id)}
                    className="rounded-full border border-hairline px-3 py-1 text-xs font-medium text-ink hover:border-moss hover:text-moss shrink-0"
                  >
                    Connect
                  </button>
                )}
              </div>
              {openRequestFor === m.user_id && (
                <ConnectRequestForm
                  recipientId={m.user_id}
                  recipientName={m.full_name || 'this person'}
                  skillId={skillId}
                  onSent={() => handleRequested(m.user_id)}
                  onCancel={() => setOpenRequestFor(null)}
                />
              )}
            </li>
          ))}
        </ul>
    </AccessibleDialog>
  )
}

function ConnectRequestForm({ recipientId, recipientName, skillId, onSent, onCancel }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      await sendConnectionRequest({ recipientId, skillId, message })
      onSent()
    } catch (err) {
      if (isDuplicatePendingRequestError(err)) {
        setError('You already have a pending request with this person.')
      } else {
        setError(err.message)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-hairline">
      <textarea
        rows={2}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={`Why do you want to connect with ${recipientName}? (optional)`}
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-xs focus:outline-none focus:ring-2 focus:ring-moss"
      />
      {error && <p role="alert" className="text-xs text-red-700 mt-1">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-xs font-medium hover:opacity-90 disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send request'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-xs font-medium hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
