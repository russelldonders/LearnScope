import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { listMyCourseAssignmentsForEmployer } from '../../lib/courseCatalogue'
import StatusBadge from '../../components/StatusBadge'

// Training this employer has pushed directly to the learner (course_
// assignments, EmployerConsole.jsx's "Assign training" bulk action) --
// distinct from a role profile's own required training (LearnerRoleAlignment
// Container/RoleAlignmentSummary), which has never tracked completion at
// all. Nowhere else shows this learner's own assignments past the moment
// they act on one from /actions (that inbox drops a row the instant it's
// no longer 'assigned') -- this is the first place "what did my employer
// give me, and how far along am I" exists in one list.
export default function EmployerAssignedTrainingPanel({ employerId }) {
  const { user } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [completedIds, setCompletedIds] = useState(new Set())
  const [enrolledIds, setEnrolledIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listMyCourseAssignmentsForEmployer(user.id, employerId)
      .then(async (rows) => {
        if (cancelled) return
        setAssignments(rows)
        const catalogueIds = rows.map((r) => r.catalogue_course_id)
        if (catalogueIds.length === 0) return
        const { data, error: coursesError } = await supabase
          .from('courses')
          .select('catalogue_course_id, completed_date')
          .eq('user_id', user.id)
          .in('catalogue_course_id', catalogueIds)
        if (coursesError) throw coursesError
        if (cancelled) return
        setEnrolledIds(new Set((data ?? []).map((c) => c.catalogue_course_id)))
        setCompletedIds(new Set((data ?? []).filter((c) => c.completed_date).map((c) => c.catalogue_course_id)))
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user.id, employerId])

  function statusFor(assignment) {
    if (completedIds.has(assignment.catalogue_course_id)) return { label: 'Completed', tone: 'success' }
    if (assignment.status === 'enrolled' || enrolledIds.has(assignment.catalogue_course_id)) return { label: 'In progress', tone: 'warning' }
    return { label: 'Not started', tone: 'neutral' }
  }

  if (loading) return null

  return (
    <section aria-labelledby="employer-assigned-training-heading" className="mb-6">
      <h2 id="employer-assigned-training-heading" className="font-display text-lg text-ink mb-3">Assigned training</h2>
      {error && <p className="text-sm text-red-700 mb-2">{error}</p>}
      {assignments.length === 0 ? (
        <p className="text-sm text-secondary">No training assigned yet.</p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => {
            const status = statusFor(a)
            return (
              <li key={a.id} className="bg-card border border-hairline rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink">{a.course_catalogue.name}</p>
                  <p className="text-xs text-secondary">
                    {[a.course_catalogue.course_type, a.course_catalogue.duration].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <StatusBadge label={status.label} tone={status.tone} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
