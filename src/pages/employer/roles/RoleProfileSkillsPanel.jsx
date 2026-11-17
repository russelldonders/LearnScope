import { useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVELS, LEVEL_LABELS } from '../../../lib/levels'
import RoleProfileAddSkills from './RoleProfileAddSkills'

// Employer-side editor for a role profile's required skills -- each entry
// is a skill plus the target proficiency level a linked employee is
// expected to reach, not the employee's actual level (that comparison is
// the learner-facing alignment view's job, see
// src/pages/roles/employer-link/RoleAlignmentSummary.jsx). Adding -- by
// search, by creating a new skill, or from AI suggestions -- lives in
// RoleProfileAddSkills.
export default function RoleProfileSkillsPanel({
  roleName = '',
  requiredSkills,
  availableSkills = [],
  saving = false,
  error = null,
  onAddSkill,
  onRequestSuggestions,
  onUpdateTargetLevel,
  onRemoveSkill,
}) {
  const [confirmingRemoveId, setConfirmingRemoveId] = useState(null)

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

      <RoleProfileAddSkills
        roleName={roleName}
        requiredSkills={requiredSkills}
        availableSkills={availableSkills}
        saving={saving}
        onAddSkill={onAddSkill}
        onRequestSuggestions={onRequestSuggestions}
      />
    </div>
  )
}
