import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import GrowthRing from '../components/GrowthRing'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'
import {
  getInvitePreview,
  acceptInviteAndRate,
  setPendingInviteCode,
  clearPendingInviteCode,
} from '../lib/connections'

export default function Rate() {
  const { code } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const navigate = useNavigate()
  const [preview, setPreview] = useState(undefined)
  const [level, setLevel] = useState(3)
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    getInvitePreview(code)
      .then((data) => setPreview(data))
      .catch(() => setPreview(null))
  }, [code])

  useEffect(() => {
    if (user) clearPendingInviteCode()
  }, [user])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await acceptInviteAndRate(code, level, comments)
      refreshPendingActionCount()
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function goToAuth(path) {
    setPendingInviteCode(code)
    navigate(path)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm bg-card border border-hairline rounded-lg p-8">
        <Link to="/" className="font-display text-3xl text-ink mb-1 block">
          LearnScope
        </Link>

        {preview === undefined || authLoading ? (
          <p className="text-sm text-secondary mt-4">Loading…</p>
        ) : preview === null ? (
          <p className="text-sm text-ink mt-4">This invite link doesn't exist.</p>
        ) : done ? (
          <>
            <p className="text-ink mt-4">
              Thanks! Your rating on "{preview.skill_name}" has been recorded.
            </p>
            <Link
              to="/dashboard"
              className="inline-block mt-6 rounded-md bg-moss text-paper py-2 px-6 font-medium hover:opacity-90"
            >
              Go to your dashboard
            </Link>
          </>
        ) : preview.status !== 'pending' ? (
          <p className="text-sm text-ink mt-4">This invite has already been used.</p>
        ) : (
          <>
            <p className="text-ink mt-4 mb-6">
              {preview.inviter_name || 'Someone'} wants your rating on their skill:{' '}
              <strong>{preview.skill_name}</strong>
              {preview.skill_category ? ` (${preview.skill_category})` : ''}.
            </p>

            {!user ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => goToAuth('/login')}
                  className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90"
                >
                  Log in to rate
                </button>
                <button
                  type="button"
                  onClick={() => goToAuth('/signup')}
                  className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper"
                >
                  Sign up to rate
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <span className="block text-sm text-secondary mb-2">Your rating</span>
                  <div className="flex items-center justify-between">
                    {LEVELS.map((l) => (
                      <button
                        type="button"
                        key={l}
                        onClick={() => setLevel(l)}
                        className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                          level === l ? 'bg-moss/10' : ''
                        }`}
                      >
                        <GrowthRing level={l} size={36} />
                        <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={3}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Why this level? (optional)"
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                />

                {error && <p className="text-sm text-red-700">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? 'Submitting…' : 'Submit rating'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
