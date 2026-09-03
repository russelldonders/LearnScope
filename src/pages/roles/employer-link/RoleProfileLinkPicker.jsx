import { useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'

// Lets the learner link their current role to one of their employer's
// generic role profiles -- purely additive: picking one never edits
// CurrentRoleCard's data or hands the employer anything beyond the
// alignment view RoleAlignmentSummary shows once linked.
export default function RoleProfileLinkPicker({ linkableRoleProfiles, linking = false, error = null, onLink }) {
  const [selectedId, setSelectedId] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!selectedId) return
    onLink?.(selectedId)
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Link to a role profile</h3>
      <p className="text-sm text-secondary mb-4">
        See how your skills line up against one of your employer's role profiles. Linking doesn't replace or
        hand over your current role -- it just adds an alignment view you can remove at any time.
      </p>

      {linkableRoleProfiles.length === 0 ? (
        <p className="text-sm text-secondary py-2">Your employer hasn't published any role profiles yet.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            {linkableRoleProfiles.map((profile) => (
              <label
                key={profile.id}
                className="flex items-start gap-3 p-3 rounded-md border border-hairline cursor-pointer hover:bg-paper"
              >
                <input
                  type="radio"
                  name="role-profile-link-choice"
                  value={profile.id}
                  checked={selectedId === profile.id}
                  disabled={linking}
                  onChange={() => setSelectedId(profile.id)}
                  className="mt-0.5"
                />
                <span className="text-sm text-ink min-w-0">
                  <span className="block font-medium">{profile.name}</span>
                  <span className="block text-secondary">{profile.employerName}</span>
                  {profile.description && (
                    <span className="block text-secondary mt-0.5">{profile.description}</span>
                  )}
                  <span className="block text-xs text-secondary mt-1">
                    {profile.requiredSkillCount} skill{profile.requiredSkillCount === 1 ? '' : 's'} ·{' '}
                    {profile.trainingCount} training item{profile.trainingCount === 1 ? '' : 's'}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <MutationFeedback status="error" message={error} />

          <button
            type="submit"
            disabled={linking || !selectedId}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {linking ? 'Linking…' : 'Link role profile'}
          </button>
        </form>
      )}
    </div>
  )
}
