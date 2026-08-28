import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import TrackingReasonPicker from '../components/TrackingReasonPicker'
import {
  getInvitePreview,
  acceptInviteAndRecommend,
  declineInvite,
  setPendingInviteCode,
  clearPendingInviteCode,
} from '../lib/connections'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'

// Mirrors Rate.jsx (accepting an invite-to-rate) but for accepting a skill
// recommendation -- same share_code/preview mechanism, different outcome on
// accept: this creates a new skill on the invitee's own profile instead of
// a rating on the inviter's.
export default function Recommend() {
  const { code } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const navigate = useNavigate()
  const [preview, setPreview] = useState(undefined)
  const [trackingReason, setTrackingReason] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [newSkillId, setNewSkillId] = useState(null)
  const [declining, setDeclining] = useState(false)
  const [declined, setDeclined] = useState(false)

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
    if (!trackingReason) {
      setError('Please choose why you\'d be tracking this.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const skillId = await acceptInviteAndRecommend(code, trackingReason)
      refreshPendingActionCount()
      setNewSkillId(skillId)
    } catch (err) {
      setError(isDuplicateSkillNameError(err) ? duplicateSkillMessage(preview.skill_name) : err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function goToAuth(path) {
    setPendingInviteCode(code)
    navigate(path)
  }

  // Mainly matters when accepting isn't possible for this invitee (e.g. the
  // duplicate-skill-name error above) -- without this, an invite that can
  // never be accepted would otherwise sit in their pending actions forever
  // with no way to clear it (only the inviter could revoke it before).
  async function handleDecline() {
    setError(null)
    setDeclining(true)
    try {
      await declineInvite(code)
      refreshPendingActionCount()
      setDeclined(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeclining(false)
    }
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
        ) : preview.invite_type !== 'recommend' ? (
          <p className="text-sm text-ink mt-4">This link isn't a skill recommendation.</p>
        ) : newSkillId ? (
          <>
            <p className="text-ink mt-4">
              "{preview.skill_name}" has been added to your profile. Time to start your own journey with it.
            </p>
            <Link
              to={`/skills/${newSkillId}`}
              className="inline-block mt-6 rounded-md bg-moss text-paper py-2 px-6 font-medium hover:opacity-90"
            >
              Go to your skill
            </Link>
          </>
        ) : declined ? (
          <p className="text-ink mt-4">You've dismissed this recommendation.</p>
        ) : preview.status !== 'pending' ? (
          <p className="text-sm text-ink mt-4">This invite has already been used.</p>
        ) : (
          <>
            <p className="text-ink mt-4 mb-6">
              {preview.inviter_name || 'Someone'} recommends you start tracking:{' '}
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
                  Log in to add it
                </button>
                <button
                  type="button"
                  onClick={() => goToAuth('/signup')}
                  className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper"
                >
                  Sign up to add it
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <TrackingReasonPicker value={trackingReason} onChange={setTrackingReason} required />

                {error && <p className="text-sm text-red-700">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting || declining}
                  className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? 'Adding…' : 'Add to my profile'}
                </button>
                <button
                  type="button"
                  onClick={handleDecline}
                  disabled={submitting || declining}
                  className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
                >
                  {declining ? 'Dismissing…' : 'Not for me'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  disabled={submitting || declining}
                  className="w-full text-secondary text-sm py-1 hover:text-ink disabled:opacity-60"
                >
                  Cancel
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
