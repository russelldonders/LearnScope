import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import BulkAssignToCatalogueDialog from '../../components/BulkAssignToCatalogueDialog'
import BulkPublishCourseDialog from '../../components/BulkPublishCourseDialog'
import CourseGeneratorDialog from '../../components/CourseGeneratorDialog'
import { assignProviderCourseToCatalogue } from '../../lib/admin/providerCatalogues'
import { useColumnPreferences, useRowSelection, useSortedPage, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { COURSE_STATUS_LABELS } from '../../lib/statusLabels'
import { COURSE_TYPES } from '../../lib/courseTypes'
import { DURATION_UNITS } from '../../lib/courseDuration'
import { BulkActionBar, ColumnCustomizer, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'
import { listOrganisationCatalogueCourses, createProviderCourse, createDraftCourseVersion, listOrganisationCatalogueApprovers, approveCatalogueCourse, rejectCatalogueCourse, deactivateCatalogueCourse, submitCatalogueCourseForApproval } from '../../lib/admin/catalogue'

import { COURSE_SORT_ACCESSORS } from '../../lib/providerTraining'
import { COURSE_COLUMNS } from './providerCourseColumns'
import CourseRow from './CourseRow'
import CourseVersionHistoryDialog from './CourseVersionHistoryDialog'
import CourseParticipantsDialog from './CourseParticipantsDialog'

const EMPTY_FORM = { name: '', provider: '', courseType: '', durationValue: '', durationUnit: 'hours', synopsis: '' }

// Exported for the same reason as ProviderCataloguesSection -- reused
// verbatim by the employer console's Training tab.
//
// searchParams/setSearchParams are the caller's own single useSearchParams()
// result (ProviderConsole.jsx's ?org=&section= pair, or EmployerConsole.jsx's
// ?employer=&section= pair) -- passed down rather than calling
// useSearchParams() again in here, since two independent useSearchParams()
// instances on the same route can fight each other. This section's own
// q/status/sort/dir/page/pageSize params land in that same URL alongside
// whatever the caller already tracks; none of those keys collide with org/
// section/employer.
export default function ProviderTrainingSection({ organisation, userId, canViewParticipants, readOnly = false, searchParams, setSearchParams, detailContext = '' }) {
  const navigate = useNavigate()
  const { isPlatformAdmin } = useAuth()
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('provider-training', COURSE_COLUMNS)
  const [courses, setCourses] = useState([])
  const [isApprover, setIsApprover] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [showGenerator, setShowGenerator] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [actioningId, setActioningId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [participantCourse, setParticipantCourse] = useState(null)
  const [historyCourse, setHistoryCourse] = useState(null)
  const [creatingDraftCourseId, setCreatingDraftCourseId] = useState(null)
  const [confirmingNewVersionCourse, setConfirmingNewVersionCourse] = useState(null)
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const [statusFilter, setStatusFilter] = useUrlParam(searchParams, setSearchParams, 'status', 'all', { resetParams: ['page'] })
  const [bulkPush, setBulkPush] = useState(null)
  const [bulkPublish, setBulkPublish] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [organisation.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [courseList, approvers] = await Promise.all([
        listOrganisationCatalogueCourses(organisation.id),
        listOrganisationCatalogueApprovers(organisation.id),
      ])
      setCourses(courseList)
      setIsApprover(approvers.some((a) => a.user_id === userId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(course) {
    setActioningId(course.id)
    setError(null)
    try {
      await approveCatalogueCourse(course.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  async function handleReject(course) {
    // The Confirm reject button is already disabled while the reason is
    // blank -- this mirrors that so a rejection can't slip through some
    // other path (e.g. the underlying reject_course_submission RPC itself
    // accepts a null reason with no server-side check).
    if (!rejectionReason.trim()) return
    setActioningId(course.id)
    setError(null)
    try {
      await rejectCatalogueCourse(course.id, rejectionReason.trim())
      setRejectingId(null)
      setRejectionReason('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  async function handleDeactivate(course) {
    setActioningId(course.id)
    setError(null)
    try {
      await deactivateCatalogueCourse(course.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const created = await createProviderCourse(userId, organisation.id, form)
      setForm(EMPTY_FORM)
      setShowForm(false)
      // Land straight in the course's own editor -- creating is just the
      // first step, the provider keeps building it out from there.
      navigate(`/organisation/training/${created.id}${detailContext ? `?${detailContext.slice(1)}` : ''}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  function handleEditCourse(course) {
    if (course.status !== 'approved') {
      navigate(`/organisation/training/${course.id}${detailContext ? `?${detailContext.slice(1)}` : ''}`)
      return
    }
    // Editing an approved course forks a new draft version rather than
    // editing it in place (approved content stays stable for anyone already
    // enrolled/relying on it) -- that's not obvious from an "Edit course"
    // label alone, so it's confirmed here rather than happening silently.
    setConfirmingNewVersionCourse(course)
  }

  async function handleConfirmCreateDraftVersion() {
    const course = confirmingNewVersionCourse
    setCreatingDraftCourseId(course.id)
    setError(null)
    try {
      const draftId = await createDraftCourseVersion(course.id)
      setConfirmingNewVersionCourse(null)
      navigate(`/organisation/training/${draftId}${detailContext ? `?${detailContext.slice(1)}` : ''}`)
    } catch (err) {
      setError(`Couldn’t create a new course version. ${err.message}`)
      setConfirmingNewVersionCourse(null)
      setCreatingDraftCourseId(null)
    }
  }

  const filteredCourses = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return courses.filter(
      (course) =>
        (statusFilter === 'all' || course.status === statusFilter) &&
        (!needle || [course.name, course.course_code, course.synopsis, course.course_type].filter(Boolean).some((value) => value.toLowerCase().includes(needle)))
    )
  }, [courses, query, statusFilter])

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredCourses, COURSE_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })
  const selection = useRowSelection(filteredCourses.map((c) => c.id))
  const filtersActive = query !== '' || statusFilter !== 'all'

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, status: null, page: null })
  }

  const coursePageIds = pageItems.map((c) => c.id)
  const coursesSelectedOnPage = coursePageIds.filter((id) => selection.selected.has(id)).length
  // Only an approved, currently-published version can be added to a
  // catalogue (assign_course_to_catalogue RPC, 20260831124500) -- the same
  // precondition the single-course "Push to catalogue" button already
  // enforces by only showing itself once a course reaches that state.
  const selectedEligibleCourses = useMemo(
    () => courses.filter((c) => selection.selected.has(c.id) && c.status === 'approved' && c.is_current_published),
    [courses, selection.selected]
  )
  const selectedIneligibleCourses = useMemo(
    () => courses.filter((c) => selection.selected.has(c.id) && !(c.status === 'approved' && c.is_current_published)),
    [courses, selection.selected]
  )
  // Mirrors CourseRow's own `editable` check -- only a draft or rejected
  // version can be submitted via submit_course_for_publication.
  const selectedPublishableCourses = useMemo(
    () => courses.filter((c) => selection.selected.has(c.id) && (c.status === 'draft' || c.status === 'rejected')),
    [courses, selection.selected]
  )
  const selectedUnpublishableCourses = useMemo(
    () => courses.filter((c) => selection.selected.has(c.id) && !(c.status === 'draft' || c.status === 'rejected')),
    [courses, selection.selected]
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-ink">Training</h3>
        <div className="flex flex-wrap items-center gap-2">
          {isPlatformAdmin && (
            <ColumnCustomizer
              idPrefix="provider-training"
              columns={columns}
              onToggle={toggleColumn}
              onMove={moveColumn}
              onReset={resetToDefault}
            />
          )}
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => { setShowGenerator(true); setShowForm(false) }}
                className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper active:translate-y-px"
              >
                Build with AI
              </button>
              <button
                type="button"
                onClick={() => setShowForm((v) => !v)}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 active:translate-y-px"
              >
                {showForm ? 'Cancel' : '+ Create training'}
              </button>
            </>
          )}
        </div>
      </div>

      {!readOnly && showForm && (
        <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 space-y-3 mb-4">
          <p className="text-xs text-secondary">
            Creates a draft you can keep building out before submitting it for approval.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseName">
                Name
              </label>
              <input
                id="providerCourseName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseType">
                Course type
              </label>
              <select
                id="providerCourseType"
                value={form.courseType}
                onChange={(e) => setForm((f) => ({ ...f, courseType: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">Choose a type…</option>
                {COURSE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseDuration">
                Duration
              </label>
              <div className="flex gap-2">
                <input
                  id="providerCourseDuration"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={form.durationValue}
                  onChange={(e) => setForm((f) => ({ ...f, durationValue: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                <label className="sr-only" htmlFor="providerCourseDurationUnit">Duration unit</label>
                <select
                  id="providerCourseDurationUnit"
                  value={form.durationUnit}
                  onChange={(e) => setForm((f) => ({ ...f, durationUnit: e.target.value }))}
                  className="shrink-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  {DURATION_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseSynopsis">
                Synopsis
              </label>
              <textarea
                id="providerCourseSynopsis"
                rows={3}
                value={form.synopsis}
                onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {showGenerator && (
        <CourseGeneratorDialog
          organisationId={organisation.id}
          onClose={() => setShowGenerator(false)}
          onCreated={(courseId) => {
            setShowGenerator(false)
            navigate(`/organisation/training/${courseId}${detailContext ? `?${detailContext.slice(1)}` : ''}`)
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4" role="search">
        <label className="sr-only" htmlFor="providerTrainingSearch">Search training</label>
        <input id="providerTrainingSearch" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search training…" className="flex-1 min-w-[220px] rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
        <label className="sr-only" htmlFor="providerTrainingStatus">Filter training by status</label>
        <select id="providerTrainingStatus" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-[200px] rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
          <option value="all">All statuses</option>
          {Object.entries(COURSE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
          >
            Reset filters
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : courses.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training created yet.</p>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training matches these filters.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          {!readOnly && (
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                actions={[
                  {
                    label: `Publish (${selectedPublishableCourses.length})`,
                    disabled: selectedPublishableCourses.length === 0,
                    title:
                      selectedPublishableCourses.length === 0
                        ? "None of the selected training is a draft or rejected version"
                        : undefined,
                    onClick: () =>
                      setBulkPublish({
                        courses: selectedPublishableCourses,
                        excludedCourses: selectedUnpublishableCourses,
                      }),
                  },
                  {
                    label: `Push to catalogue (${selectedEligibleCourses.length})`,
                    disabled: selectedEligibleCourses.length === 0,
                    title:
                      selectedEligibleCourses.length === 0
                        ? "None of the selected training is an approved, currently published version"
                        : undefined,
                    onClick: () =>
                      setBulkPush({
                        courses: selectedEligibleCourses,
                        excludedCourses: selectedIneligibleCourses,
                      }),
                  },
                ]}
              />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  {!readOnly && (
                    <SelectionTh
                      idPrefix="provider-training"
                      checked={selection.isAllSelected(coursePageIds)}
                      indeterminate={coursesSelectedOnPage > 0 && coursesSelectedOnPage < coursePageIds.length}
                      onChange={() => selection.toggleAll(coursePageIds)}
                    />
                  )}
                  {visibleColumns.map((col) =>
                    col.sortable ? (
                      <SortableTh key={col.key} label={col.label} columnKey={col.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={col.thClassName} />
                    ) : (
                      <th key={col.key} className={`px-4 py-2 font-medium ${col.thClassName || ''}`}>{col.label}</th>
                    )
                  )}
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((course) => (
                  <CourseRow
                    key={course.id}
                    course={course}
                    columns={visibleColumns}
                    selected={selection.selected.has(course.id)}
                    onToggleSelected={() => selection.toggle(course.id)}
                    canModerate={isApprover && !readOnly}
                    readOnly={readOnly}
                    actioning={actioningId === course.id}
                    rejecting={rejectingId === course.id}
                    rejectionReason={rejectionReason}
                    onRejectionReasonChange={setRejectionReason}
                    onStartReject={() => setRejectingId(course.id)}
                    onCancelReject={() => {
                      setRejectingId(null)
                      setRejectionReason('')
                    }}
                    onApprove={() => handleApprove(course)}
                    onReject={() => handleReject(course)}
                    onDeactivate={() => handleDeactivate(course)}
                    canViewParticipants={canViewParticipants}
                    onViewParticipants={() => setParticipantCourse(course)}
                    onViewHistory={() => setHistoryCourse(course)}
                    onEdit={() => handleEditCourse(course)}
                    creatingDraft={creatingDraftCourseId === course.id}
                    detailContext={detailContext}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="provider-training" />
        </div>
      )}

      {participantCourse && (
        <CourseParticipantsDialog course={participantCourse} onClose={() => setParticipantCourse(null)} />
      )}
      {historyCourse && (
        <CourseVersionHistoryDialog course={historyCourse} onClose={() => setHistoryCourse(null)} />
      )}
      {bulkPublish && (
        <BulkPublishCourseDialog
          courses={bulkPublish.courses}
          excludedCourses={bulkPublish.excludedCourses}
          onPublish={(courseId) => submitCatalogueCourseForApproval(courseId, [])}
          onClose={() => setBulkPublish(null)}
          onDone={(succeededCourseIds, hadFailures) => {
            if (hadFailures) selection.clearIds(succeededCourseIds)
            else selection.clear()
            load()
          }}
        />
      )}
      {bulkPush && (
        <BulkAssignToCatalogueDialog
          organisationId={organisation.id}
          items={bulkPush.courses}
          excludedItems={bulkPush.excludedCourses}
          excludedReason="an approved, currently published version"
          itemLabel="course"
          description={'Choose one of your own catalogues to add the selected courses to. Each becomes visible there as soon as it\'s added. To submit a course to the platform-wide Global catalogue, use its own "Submit to Global catalogue" action instead.'}
          excludeGlobal
          onAssign={(catalogueId, course) => assignProviderCourseToCatalogue(catalogueId, course.id)}
          onClose={() => setBulkPush(null)}
          onDone={(succeededCourseIds, hadFailures) => {
            // Called right after the push attempt settles, whether or not
            // it fully succeeded -- a partial failure still means some
            // courses actually got added, so this reloads and drops just
            // the ones that succeeded from the selection, leaving the
            // still-failed ones selected for an easy retry (the dialog
            // itself stays open in that case to show which failed and
            // why). A full success clears the whole selection, including
            // any ineligible rows that were never attempted, and the
            // dialog closes itself right after this callback returns.
            if (hadFailures) selection.clearIds(succeededCourseIds)
            else selection.clear()
            load()
          }}
        />
      )}

      {confirmingNewVersionCourse && (
        <ConfirmDialog
          message={`"${confirmingNewVersionCourse.name}" is approved. Editing it creates a new draft version to work on — the approved version stays exactly as-is (and published) until this new one is submitted and approved in turn.`}
          confirmLabel="Create new version"
          onConfirm={handleConfirmCreateDraftVersion}
          onCancel={() => setConfirmingNewVersionCourse(null)}
          confirming={creatingDraftCourseId === confirmingNewVersionCourse.id}
        />
      )}
    </div>
  )
}
