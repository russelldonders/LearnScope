import { useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVELS, LEVEL_LABELS } from '../../../lib/levels'

// Employer-side editor for a role profile's required skills -- each entry
// is a skill plus the target proficiency level a linked employee is
// expected to reach, not the employee's actual level (that comparison is
// the learner-facing alignment view's job, see
// src/pages/roles/employer-link/RoleAlignmentSummary.jsx).
export default function RoleProfileSkillsPanel({
  requiredSkills,
  availableSkills = [],
  saving = false,
  error = null,
  onAddSkill,
  onUpdateTargetLevel,
  onRemoveSkill,
}) {
  const requiredSkillIds = new Set(requiredSkills.map((s) => s.skillId))
  const addableSkills = availableSkills.filter((s) => !requiredSkillIds.has(s.id))
  const [pendingSkillId, setPendingSkillId] = useState('')
  const [pendingLevel, setPendingLevel] = useState(3)

  function handleAdd(e) {
    e.preventDefault()
    if (!pendingSkillId) return
    onAddSkill?.({ skillId: pendingSkillId, targetLevel: Number(pendingLevel) })
    setPendingSkillId('')
    setPendingLevel(3)
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Required skills</h3>
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
              <button
                type="button"
                onClick={() => onRemoveSkill?.(skill.skillId)}
                disabled={saving}
                className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <MutationFeedback status="error" message={error} className="mb-3" />

      {addableSkills.length > 0 ? (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
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
              <option value="">Choose a skill…</option>
              {addableSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}{skill.isComposite ? ` · Composite (${skill.componentCount})` : ''}
                </option>
              ))}
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
        </form>
      ) : (
        availableSkills.length > 0 && (
          <p className="text-xs text-secondary">Every available skill is already required.</p>
        )
      )}
    </div>
  )
}
