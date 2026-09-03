import { useState } from 'react'
import MutationFeedback from '../../components/MutationFeedback'

// Starts a verified link between the current account and another one the
// same person owns -- e.g. a personal and a work account. Purely
// presentational: `onCreateInvitation(email)` is the only side effect,
// and `creating`/`error` are owned by the caller (same "caller owns the
// async lifecycle" contract as ShareSkillsModal/RoleProfileDetailsForm
// elsewhere in this app).
export default function CreateLinkInvitationForm({ creating = false, error = null, onCreateInvitation }) {
  const [email, setEmail] = useState('')
  const trimmedEmail = email.trim()

  function handleSubmit(e) {
    e.preventDefault()
    if (!trimmedEmail) return
    onCreateInvitation?.(trimmedEmail)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-6 space-y-4">
      <h3 className="font-display text-lg text-ink">Link another account</h3>
      <p className="text-sm text-secondary">
        If you have more than one LearnScope account -- for example a personal one and one through an employer --
        you can verify that they both belong to you.
      </p>
      <p className="text-sm text-secondary">
        Verifying a link doesn't merge your profiles, move any records between the accounts, or automatically
        share employer or private information either way. Each account keeps its own separate skills, evidence
        and history -- linking only lets people you choose confirm the accounts are both yours.
      </p>

      <div>
        <label htmlFor="account-link-email" className="block text-xs text-secondary mb-1">
          Email address of the other account
        </label>
        <input
          id="account-link-email"
          type="email"
          value={email}
          disabled={creating}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          required
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <MutationFeedback status="error" message={error} />

      <button
        type="submit"
        disabled={creating || !trimmedEmail}
        className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {creating ? 'Creating invitation…' : 'Create link invitation'}
      </button>
    </form>
  )
}
