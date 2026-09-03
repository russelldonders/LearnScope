import { useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'

const REQUIREMENT_LABELS = {
  required: 'Required',
  recommended: 'Recommended',
}

// Employer-side editor for a role profile's training -- each entry
// references an existing course from this employer's catalogue (see
// ProviderConsole/ProviderTrainingSection) plus whether it's required or
// only recommended for a linked employee. Doesn't create or edit courses
// themselves -- only which of the existing ones apply to this role.
export default function RoleProfileTrainingPanel({
  training,
  availableCourses = [],
  saving = false,
  error = null,
  onAddTraining,
  onUpdateRequirement,
  onRemoveTraining,
}) {
  const assignedCourseIds = new Set(training.map((t) => t.courseId))
  const addableCourses = availableCourses.filter((c) => !assignedCourseIds.has(c.id))
  const [pendingCourseId, setPendingCourseId] = useState('')
  const [pendingRequirement, setPendingRequirement] = useState('required')

  function handleAdd(e) {
    e.preventDefault()
    if (!pendingCourseId) return
    onAddTraining?.({ courseId: pendingCourseId, requirement: pendingRequirement })
    setPendingCourseId('')
    setPendingRequirement('required')
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Training</h3>
      <p className="text-sm text-secondary mb-4">
        Courses a linked employee is required to complete, or that are recommended for this role.
      </p>

      {training.length === 0 ? (
        <p className="text-sm text-secondary py-2">No training assigned yet.</p>
      ) : (
        <ul className="divide-y divide-hairline mb-4">
          {training.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-sm text-ink flex-1 min-w-[8rem] truncate" title={item.title}>
                {item.title}
              </span>
              <select
                aria-label={`Requirement for ${item.title}`}
                value={item.requirement}
                disabled={saving}
                onChange={(e) => onUpdateRequirement?.(item.id, e.target.value)}
                className="rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
              >
                {Object.entries(REQUIREMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onRemoveTraining?.(item.id)}
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

      {addableCourses.length > 0 ? (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[10rem]">
            <label htmlFor="role-profile-add-course" className="block text-xs text-secondary mb-1">
              Add training
            </label>
            <select
              id="role-profile-add-course"
              value={pendingCourseId}
              disabled={saving}
              onChange={(e) => setPendingCourseId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Choose a course…</option>
              {addableCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="role-profile-add-course-requirement" className="block text-xs text-secondary mb-1">
              Requirement
            </label>
            <select
              id="role-profile-add-course-requirement"
              value={pendingRequirement}
              disabled={saving}
              onChange={(e) => setPendingRequirement(e.target.value)}
              className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
            >
              {Object.entries(REQUIREMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={saving || !pendingCourseId}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Add
          </button>
        </form>
      ) : (
        availableCourses.length > 0 && (
          <p className="text-xs text-secondary">Every available course is already assigned.</p>
        )
      )}
    </div>
  )
}
