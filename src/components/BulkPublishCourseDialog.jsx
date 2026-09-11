import { useState } from 'react'
import AccessibleDialog from './AccessibleDialog'

// Bulk sibling of ProviderCourseEditor's (now catalogue-free) Publish action
// -- publishing and catalogue submission are deliberately two separate
// steps, so this only ever calls submit_course_for_publication with an empty
// catalogue list (immediate, org-local publish). Adding published courses to
// a catalogue afterwards is the existing separate "Push to catalogue" bulk
// action; submitting to the platform-wide Global catalogue is a distinct
// per-course action on the course's own page, not offered in bulk here.
export default function BulkPublishCourseDialog({ courses, excludedCourses = [], onPublish, onClose, onDone }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit() {
    if (courses.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const results = await Promise.allSettled(courses.map((course) => onPublish(course.id)))
      const succeeded = courses.filter((_, index) => results[index].status === 'fulfilled')
      const failures = results
        .map((result, index) => ({ result, course: courses[index] }))
        .filter(({ result }) => result.status === 'rejected')
      onDone(succeeded.map((course) => course.id), failures.length > 0)
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${courses.length} course${failures.length === 1 ? "" : "s"} couldn't be published: ` +
            failures.map(({ course, result }) => `"${course.name}" (${result.reason?.message ?? 'unknown error'})`).join('; ')
        )
        return
      }
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="bulk-publish-course-title"
      describedBy="bulk-publish-course-description"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg rounded-xl bg-card border border-hairline p-5 shadow-xl"
    >
      <h2 id="bulk-publish-course-title" className="font-display text-lg text-ink">
        Publish {courses.length} course{courses.length === 1 ? '' : 's'}
      </h2>
      <p id="bulk-publish-course-description" className="text-sm text-secondary mt-1 mb-3">
        Makes each course its organisation's live version. Add them to a catalogue afterwards with the "Push to
        catalogue" action, once they're published.
      </p>

      {excludedCourses.length > 0 && (
        <p className="text-xs text-amber-700 mb-3">
          {excludedCourses.length} of the selected course{excludedCourses.length === 1 ? " isn't" : "s aren't"} a
          draft or rejected version, so {excludedCourses.length === 1 ? "it won't" : "they won't"} be included:{' '}
          {excludedCourses.map((course) => `"${course.name}"`).join(', ')}.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}

      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || courses.length === 0}
          className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </AccessibleDialog>
  )
}
