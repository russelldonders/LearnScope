import { useEffect, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import { COURSE_STATUS_LABELS } from '../../lib/statusLabels'
import { listCourseVersionHistory } from '../../lib/admin/catalogue'

import { formatParticipantDate } from '../../lib/providerTraining'

export default function CourseVersionHistoryDialog({ course, onClose }) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listCourseVersionHistory(course.id)
      .then(setVersions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [course.id])

  return (
    <AccessibleDialog
      labelledBy="course-version-history-title"
      onClose={onClose}
      panelClassName="w-full max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain rounded-lg border border-hairline bg-card p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="course-version-history-title" className="font-display text-xl text-ink">{course.name} version history</h2>
          <p className="mt-1 font-mono text-xs text-secondary">Course code: {course.course_code || 'Not set'}</p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-sm text-secondary hover:text-ink">Close</button>
      </div>

      {loading && <p role="status" className="mt-6 text-sm text-secondary">Loading version history…</p>}
      {error && <p role="alert" className="mt-6 text-sm text-red-700">Couldn’t load version history: {error}</p>}
      {!loading && !error && versions.length === 0 && (
        <p className="mt-6 rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-secondary">
          No versions found for this course.
        </p>
      )}
      {!loading && !error && versions.length > 0 && (
        <ol className="mt-5 divide-y divide-hairline border-y border-hairline">
          {versions.map((version) => (
            <li key={version.id} className="py-4">
              <div className="grid gap-3 sm:grid-cols-[90px_1fr_1fr] sm:items-center">
                <div>
                  <p className="font-medium text-ink">Version {version.version_number}</p>
                  <p className="mt-0.5 text-xs text-secondary">{COURSE_STATUS_LABELS[version.status] ?? version.status}</p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Published</p>
                  <p className="mt-0.5 text-sm text-ink">
                    {version.approved_at ? formatParticipantDate(version.approved_at) : 'Not published'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Created by</p>
                  <p className="mt-0.5 text-sm text-ink">{version.creator?.full_name || 'Unknown user'}</p>
                </div>
              </div>
              {version.status === 'rejected' && (
                <p className="mt-2 text-xs text-red-700">
                  Rejected: {version.rejection_reason || 'No reason was given.'}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </AccessibleDialog>
  )
}
