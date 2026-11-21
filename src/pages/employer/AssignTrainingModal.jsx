import { useEffect, useMemo, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'
import { SortableTh, TablePagination } from '../../components/TableControls'
import { listEmployerCatalogueCourses, assignCourseToEmployerMembers, listEmployerCourseAssignments } from '../../lib/admin/employers'
import { ASSIGNMENT_SORT_ACCESSORS, ASSIGNMENT_STATUS_LABELS } from '../../lib/employerLearnerTables'
import { useSortedPage, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'

// Course picker for the "Assign training" bulk action on the Users tab's
// learner roster (EmployerLearnersPanel) -- used to be its own top-level
// tab with its own copy of the learner picker; folded into a modal opened
// from a selection made on that one roster instead, so there's a single
// place to pick "who" (see EmployerLearnersPanel) and this only has to ask
// "which course". Course choices are scoped to courses actually published
// in this employer's enabled catalogues (listEmployerCatalogueCourses --
// the RPC re-validates this server-side regardless, this is only the
// picker's convenience list). Assigning never enrols anyone by itself --
// assign_course_to_employer_members only creates a course_assignments row;
// the learner still has to click "Start" on their own /actions page
// (respondToCourseAssignment) to create the real enrolment.
export default function AssignTrainingModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [historyParams, setHistoryParams] = useState(() => new URLSearchParams())
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listEmployerCatalogueCourses(employer.id)
      .then(setCourses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [employer.id])

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedCourseId) return
    setAssigning(true)
    setError(null)
    try {
      const requestedIds = members.map((m) => m.user_id)
      const inserted = await assignCourseToEmployerMembers(employer.id, selectedCourseId, requestedIds)
      const insertedIds = new Set(inserted.map((row) => row.assigned_to))
      // Everyone passed in here already cleared the roster's own "active"
      // filter -- the only reason the RPC would still skip one is an
      // existing live assignment for this course (on conflict do nothing).
      const skippedEmails = requestedIds
        .filter((id) => !insertedIds.has(id))
        .map((id) => members.find((m) => m.user_id === id)?.email || id)
      onAssigned({ kind: 'training', count: inserted.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-training-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-3xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-training-dialog-title" className="font-display text-xl text-ink mb-1">Assign training</h2>
      <p className="text-sm text-secondary mb-4">
        Push a course from {employer.name}'s own catalogue to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and choose whether to start it — this doesn't enrol anyone
        automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading courses…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-secondary">
          No enabled courses yet. Publish courses in your main provider’s catalogues or approve a provider sharing connection.
        </p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignCourse">
              Course
            </label>
            <select
              id="employerAssignCourse"
              required
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedCourseId || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Assign to ${members.length}`}
            </button>
          </div>
        </form>
      )}
      <section aria-labelledby="employer-training-history-heading" className="mt-6 border-t border-hairline pt-6">
        <EmployerTrainingAssignmentsHistory
          employer={employer}
          members={members}
          searchParams={historyParams}
          setSearchParams={setHistoryParams}
        />
      </section>
    </AccessibleDialog>
  )
}

// Assignment history for the selected users in the matching assignment dialog.

function EmployerTrainingAssignmentsHistory({ employer, members, searchParams, setSearchParams }) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [employer.id, members])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const rows = await listEmployerCourseAssignments(employer.id)
      const selectedUserIds = new Set(members.map((member) => member.user_id))
      setAssignments(rows.filter((row) => selectedUserIds.has(row.assigned_to)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const emailByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.email || m.user_id])), [members])
  const assignmentsWithEmail = useMemo(
    () => assignments.map((a) => ({ ...a, learnerEmail: emailByUserId.get(a.assigned_to) })),
    [assignments, emailByUserId]
  )
  const [assignmentQuery, setAssignmentQuery] = useUrlParam(searchParams, setSearchParams, 'aq', '', { resetParams: ['aPage'] })
  const aq = assignmentQuery.trim().toLowerCase()
  const filteredAssignments = useMemo(
    () =>
      aq
        ? assignmentsWithEmail.filter(
            (a) => a.course_catalogue?.name?.toLowerCase().includes(aq) || (a.learnerEmail || '').toLowerCase().includes(aq)
          )
        : assignmentsWithEmail,
    [assignmentsWithEmail, aq]
  )
  const assignmentFiltersActive = assignmentQuery !== ''

  function resetAssignmentFilters() {
    writeUrlParams(searchParams, setSearchParams, { aq: null, aPage: null })
  }

  const {
    sortKey: aSortKey,
    sortDir: aSortDir,
    toggleSort: aToggleSort,
    page: aPage,
    setPage: aSetPage,
    pageSize: aPageSize,
    setPageSize: aSetPageSize,
    pageItems: aPageItems,
    totalItems: aTotalItems,
  } = useSortedPage(filteredAssignments, ASSIGNMENT_SORT_ACCESSORS, {
    defaultSortKey: 'created_at',
    defaultSortDir: 'desc',
    urlSync: { searchParams, setSearchParams, paramNames: { sort: 'aSort', dir: 'aDir', page: 'aPage', pageSize: 'aPageSize' } },
  })

  return (
    <div>
      <h3 id="employer-training-history-heading" className="font-display text-base text-ink mb-3">Training assigned so far</h3>
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      {loading ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : assignments.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training assigned to the selected users yet.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <input
              aria-label="Search assignments"
              type="text"
              value={assignmentQuery}
              onChange={(e) => setAssignmentQuery(e.target.value)}
              placeholder="Search by course or learner…"
              className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            {assignmentFiltersActive && (
              <button
                type="button"
                onClick={resetAssignmentFilters}
                className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
          </div>
          {filteredAssignments.length === 0 ? (
            <p className="text-center text-xs text-secondary py-8">No assignments match your search.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SortableTh label="Course" columnKey="course" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} />
                      <SortableTh label="Learner" columnKey="learner" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} />
                      <SortableTh label="Status" columnKey="status" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} className="whitespace-nowrap" />
                      <SortableTh label="Assigned" columnKey="created_at" sortKey={aSortKey} sortDir={aSortDir} onSort={aToggleSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {aPageItems.map((a) => (
                      <tr key={a.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{a.course_catalogue?.name || 'Deleted course'}</td>
                        <td className="px-4 py-2 text-secondary text-xs truncate max-w-[220px]">{a.learnerEmail || a.assigned_to}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <StatusBadge label={ASSIGNMENT_STATUS_LABELS[a.status] || a.status} tone={a.status === 'dismissed' ? 'danger' : 'neutral'} />
                        </td>
                        <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination page={aPage} setPage={aSetPage} pageSize={aPageSize} setPageSize={aSetPageSize} totalItems={aTotalItems} idPrefix={`employer-assignments-${employer.id}`} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
