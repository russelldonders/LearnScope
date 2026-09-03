import { formatAbsoluteDate } from '../../../lib/dates'

// Employer-facing list of this organisation's generic role profiles --
// deliberately name/description/summary-counts only here; a role profile's
// required skills, training and linked employees are edited on its own
// panel once selected (see RoleProfileSkillsPanel etc.), not inline here.
// Skill/training counts are derived from the profile's own requiredSkills/
// training arrays rather than a separate count field, so there's one
// source of truth for "how many" instead of a number that could drift from
// the actual list; linkedEmployeeCount stays a summary-only field since the
// full per-employee list is only ever fetched for the selected profile.
export default function RoleProfileList({
  roleProfiles,
  selectedId = null,
  loading = false,
  error = null,
  onSelect,
  onCreate,
}) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg text-ink">Role profiles</h2>
        <button
          type="button"
          onClick={() => onCreate?.()}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 whitespace-nowrap"
        >
          New role profile
        </button>
      </div>

      {loading && <p className="text-sm text-secondary">Loading…</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700 mb-2">
          {error}
        </p>
      )}

      {!loading && roleProfiles.length === 0 && (
        <p className="text-sm text-secondary py-2">
          No role profiles yet. Create one to define required skills and training for a role.
        </p>
      )}

      {!loading && roleProfiles.length > 0 && (
        <ul className="divide-y divide-hairline">
          {roleProfiles.map((profile) => {
            const isSelected = profile.id === selectedId
            return (
              <li key={profile.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(profile.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`w-full text-left py-3 px-2 -mx-2 rounded-md hover:bg-paper ${
                    isSelected ? 'bg-paper' : ''
                  }`}
                >
                  <p className="text-sm font-medium text-ink">{profile.name}</p>
                  {profile.description && <p className="text-sm text-secondary mt-0.5">{profile.description}</p>}
                  <p className="text-xs text-secondary mt-1">
                    {profile.requiredSkills.length} skill{profile.requiredSkills.length === 1 ? '' : 's'} ·{' '}
                    {profile.training.length} training item{profile.training.length === 1 ? '' : 's'} ·{' '}
                    {profile.linkedEmployeeCount} employee{profile.linkedEmployeeCount === 1 ? '' : 's'} linked
                    {profile.updatedAt && <> · updated {formatAbsoluteDate(profile.updatedAt)}</>}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
