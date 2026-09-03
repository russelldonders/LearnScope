import { LEVEL_LABELS } from '../../../lib/levels'

// Read-only summary of potential conflicts between two verified accounts'
// profiles -- informational only, nothing here can be resolved, merged or
// edited from this view. Each category has its own empty state so "no
// conflicts found" reads distinctly from an actual list.
export default function TransferConflictsSummary({ conflicts }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Potential conflicts</h3>
      <p className="text-sm text-secondary mb-4">
        Things worth reviewing before choosing a durable profile -- shown for awareness only. Nothing here is
        changed, resolved, or merged by viewing it.
      </p>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-ink mb-1">Same-name skills ({conflicts.duplicateSkills.length})</p>
          {conflicts.duplicateSkills.length === 0 ? (
            <p className="text-sm text-secondary">No same-name skills between these accounts.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {conflicts.duplicateSkills.map((skill) => (
                <li key={skill.name}>
                  {skill.name} -- {LEVEL_LABELS[skill.levelA] ?? skill.levelA} on one account,{' '}
                  {LEVEL_LABELS[skill.levelB] ?? skill.levelB} on the other
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">
            Overlapping courses ({conflicts.overlappingCourses.length})
          </p>
          {conflicts.overlappingCourses.length === 0 ? (
            <p className="text-sm text-secondary">No overlapping courses between these accounts.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {conflicts.overlappingCourses.map((course) => (
                <li key={course.title}>{course.title}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">
            Possible duplicate experience ({conflicts.possibleDuplicateExperience.length})
          </p>
          {conflicts.possibleDuplicateExperience.length === 0 ? (
            <p className="text-sm text-secondary">No likely duplicate experience entries found.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {conflicts.possibleDuplicateExperience.map((pair, index) => (
                <li key={index}>
                  {pair.titleA} at {pair.organizationA} -- may be the same as {pair.titleB} at{' '}
                  {pair.organizationB}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
