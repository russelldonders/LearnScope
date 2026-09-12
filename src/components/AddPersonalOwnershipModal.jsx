import { useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import { useAuth } from '../context/AuthContext'
import { claimPersonalAccountOwnership } from '../lib/accountOwnership'

// Walks the learner through taking personal control of an employer-
// provisioned account: a personal email (with Supabase's own confirmation-
// link step, same as any other email change) and a fresh password -- even
// though a working password already exists from the original invite, this
// is a deliberate "take control" step, not just a convenience edit.
// claimPersonalAccountOwnership() is only called once both updates succeed,
// so the account never gets marked as personally owned on a half-finished
// attempt.
export default function AddPersonalOwnershipModal({ onClose, onClaimed }) {
  const { updateEmail, updatePassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    try {
      const { error: emailError } = await updateEmail(email.trim())
      if (emailError) throw emailError
      const { error: passwordError } = await updatePassword(password)
      if (passwordError) throw passwordError
      await claimPersonalAccountOwnership()
      onClaimed?.()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="add-personal-ownership-title"
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="add-personal-ownership-title" className="font-display text-xl text-ink mb-1">Add personal ownership</h2>
      <p className="text-sm text-secondary mb-4">
        Set a personal email and a new password so you keep access to this account no matter what
        happens with your employer relationship.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="personal-ownership-email">
            Personal email
          </label>
          <input
            id="personal-ownership-email"
            type="email"
            required
            value={email}
            disabled={saving}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <p className="text-xs text-secondary mt-1">We'll send a confirmation link to this address.</p>
        </div>
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="personal-ownership-password">
            New password
          </label>
          <input
            id="personal-ownership-password"
            type="password"
            required
            minLength={8}
            value={password}
            disabled={saving}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="personal-ownership-confirm-password">
            Confirm password
          </label>
          <input
            id="personal-ownership-confirm-password"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            disabled={saving}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            required
            checked={acknowledged}
            disabled={saving}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 rounded border-hairline accent-moss"
          />
          <span>I understand this becomes my personal login for this account.</span>
        </label>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !acknowledged}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
