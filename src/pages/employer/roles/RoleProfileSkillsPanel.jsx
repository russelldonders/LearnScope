import { useMemo, useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVELS, LEVEL_LABELS } from '../../../lib/levels'

// Cap on how many matches the "add" picker renders at once -- the global
// skill library can hold hundreds of entries, and a native <select> that
// long is unusable. The search box narrows it instead.
const MAX_PICKER_OPTIONS = 100

// Employer-side editor for a role profile's required skills -- each entry
// is a skill plus the target proficiency level a linked employee is
// expected to reach, not the employee's actual level (that comparison is
// the learner-facing alignment view's job, see
// src/pages/roles/employer-link/RoleAlignmentSummary.jsx).
//
// availableSkills may mix the employer's own offered skills (flagged
// fromOrganisation) with the global skill library; the picker groups them
// so the organisation's own roster stays easy to find.
export default function RoleProfileSkillsPanel({
  requiredSkills,
  availableSkills = [],
  saving = false,
  error = null,
  onAddSkill,
  onUpdateTargetLevel,
  onRemoveSkill,
}) {
  const [pendingSkillId, setPendingSkillId] = useState('')
  const [pendingLevel, setPendingLevel] = useState(3)
  const [query, setQuery] = useState('')
  const [confirmingRemoveId, setConfirmingRemoveId] = useState(null)

  const addableSkills = useMemo(() => {
    const requiredSkillIds = new Set(requiredSkills.map((s) => s.skillId))
    return availableSkills.filter((s) => !requiredSkillIds.has(s.id))
  }, [requiredSkills, availableSkills])

  const matchingSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return addableSkills
    return addableSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q)
    )
  }, [addableSkills, query])

  // Keep the current choice visible even if the search no longer matches it,
  // so the picker never silently shows a different skill than will be added.
  const shownSkills = useMemo(() => {
    const limited = matchingSkills.slice(0, MAX_PICKER_OPTIONS)
    const selected = addableSkills.find((s) => s.id === pendingSkillId)
    if (selected && !limited.some((s) => s.id === selected.id)) return [selected, ...limited]
    return limited
  }, [matchingSkills, addableSkills, pendingSkillId])

  const organisationOptions = shownSkills.filter((s) => s.fromOrganisation)
  const libraryOptions = shownSkills.filter((s) => !s.fromOrganisation)
  const hasBothGroups = organisationOptions.length > 0 && libraryOptions.length > 0

  function handleAdd(e) {
    e.preventDefault()
    if (!pendingSkillId) return
    onAddSkill?.({ skillId: pendingSkillId, targetLevel: Number(pendingLevel) })
    setPendingSkillId('')
    setPendingLevel(3)
    setQuery('')
  }

  function renderOption(skill) {
    return (
      <option key={skill.id} value={skill.id}>
        {skill.name}{skill.isComposite ? ` · Composite (${skill.componentCount})` : ''}
      </option>
    )
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">
        Required skills{requiredSkills.length > 0 ? ` (${requiredSkills.length})` : ''}
      </h3>
      <p className="text-sm text-secondary mb-4">
        Skills an employee linked to this role profile is expected to reach, and at what level.
      </p>

      {requiredSkills.length === 0 ? (
        <p className="text-sm text-secondary py-2">No required skills yet.</p>
      ) : (
        <ul className="divide-y divide-hairline mb-4">
          {requiredSkills.map((skill) => (
            <li key={skill.skillId} className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-sm text-ink flex-1 min-w-[8rem]" title={skill.name}>
                <span className="block truncate">{skill.name}</span>
                {skill.isComposite && (
                  <span className="mt-0.5 block text-xs text-secondary">
                    Composite skill · {skill.componentCount} published component{skill.componentCount === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              <select
                aria-label={`Target level for ${skill.name}`}
                value={skill.targetLevel}
                disabled={saving}
                onChange={(e) => onUpdateTargetLevel?.(skill.skillId, Number(e.target.value))}
                className="rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
              {confirmingRemoveId === skill.skillId ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-secondary">Remove from this role?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingRemoveId(null)
                      onRemoveSkill?.(skill.skillId)
                    }}
                    disabled={saving}
                    aria-label={`Confirm removing ${skill.name}`}
                    className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
                  >
                    Yes, remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRemoveId(null)}
                    className="text-xs font-medium text-secondary hover:underline"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingRemoveId(skill.skillId)}
                  disabled={saving}
                  className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <MutationFeedback status="error" message={error} className="mb-3" />

      <div className="border-t border-hairline pt-4">
        <h4 className="text-sm font-medium text-ink mb-2">Add a required skill</h4>
        {addableSkills.length > 0 ? (
          <form onSubmit={handleAdd} className="space-y-2">
            <div>
              <label htmlFor="role-profile-skill-search" className="block text-xs text-secondary mb-1">
                Search skills
              </label>
              <input
                id="role-profile-skill-search"
                type="search"
                value={query}
                disabled={saving}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to filter by name or category"
                className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[10rem]">
                <label htmlFor="role-profile-add-skill" className="block text-xs text-secondary mb-1">
                  Add a skill
                </label>
                <select
                  id="role-profile-add-skill"
                  value={pendingSkillId}
                  disabled={saving}
                  onChange={(e) => setPendingSkillId(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">
                    {matchingSkills.length === 0 ? 'No matching skills' : 'Choose a skill…'}
                  </option>
                  {hasBothGroups ? (
                    <>
                      <optgroup label="Your organisation's skills">{organisationOptions.map(renderOption)}</optgroup>
                      <optgroup label="Skill library">{libraryOptions.map(renderOption)}</optgroup>
                    </>
                  ) : (
                    shownSkills.map(renderOption)
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="role-profile-add-skill-level" className="block text-xs text-secondary mb-1">
                  Target level
                </label>
                <select
                  id="role-profile-add-skill-level"
                  value={pendingLevel}
                  disabled={saving}
                  onChange={(e) => setPendingLevel(e.target.value)}
                  className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {LEVEL_LABELS[level]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={saving || !pendingSkillId}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Add
              </button>
            </div>
            {matchingSkills.length > MAX_PICKER_OPTIONS && (
              <p className="text-xs text-secondary" aria-live="polite">
                Showing the first {MAX_PICKER_OPTIONS} of {matchingSkills.length} matching skills — search to narrow the list.
              </p>
            )}
          </form>
        ) : (
          <p className="text-xs text-secondary">
            {availableSkills.length > 0
              ? 'Every available skill is already required.'
              : 'No skills are available to add yet.'}
          </p>
        )}
      </div>
    </div>
  )
}
