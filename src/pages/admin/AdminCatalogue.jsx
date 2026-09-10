import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import {
  listAllCatalogueCourses,
  rejectCatalogueCourse,
  deactivateCatalogueCourse,
} from '../../lib/admin/catalogue'
import { formatCoursePrice } from '../../lib/courseCatalogue'
import { COURSE_STATUS_LABELS } from '../../lib/statusLabels'
import { useColumnPreferences, useRowSelection, useSortedPage, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { BulkActionBar, ColumnCustomizer, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'
import MutationFeedback from '../../components/MutationFeedback'
import AccessibleDialog from '../../components/AccessibleDialog'
import ConfirmDialog from '../../components/ConfirmDialog'

// 'all' is this filter's default -- stable, simple values otherwise match the
// database status column directly (see useSortedPage.js's ?status= param
// below), since an upcoming Overview page will deep-link straight to e.g.
// /admin/catalogue?status=pending_approval.
const STATUS_FILTERS = ['all', 'draft', 'pending_approval', 'approved', 'rejected', 'inactive']

const CATALOGUE_SORT_ACCESSORS = {
  course_code: (c) => c.course_code?.toLowerCase() ?? '',
  name: (c) => c.name?.toLowerCase() ?? '',
  provider: (c) => c.organisations?.name?.toLowerCase() ?? c.provider?.toLowerCase() ?? '',
  version: (c) => c.version_number ?? 0,
  status: (c) => c.status ?? '',
  rejection_reason: (c) => c.rejection_reason?.toLowerCase() ?? '',
  destinations: (c) => (c.course_catalogue_publications ?? []).map((p) => p.catalogues?.name).filter(Boolean).join(', ').toLowerCase(),
  price: (c) => (c.price_amount === null || c.price_amount === undefined ? -1 : Number(c.price_amount)),
  participants: (c) => c.participantCount ?? 0,
  created_at: (c) => c.created_at ?? '',
  updated_at: (c) => c.updated_at ?? '',
}

// Customizable data columns only -- the trailing Reject/Deactivate
// actions column stays pinned outside this list (this table has no bulk
// selection, so there's no pinned checkbox column to worry about).
const CATALOGUE_COLUMNS = [
  {
    key: 'course_code',
    label: 'ID',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap',
    renderCell: (c) => c.course_code || 'Not set',
  },
  {
    key: 'name',
    label: 'Course',
    sortable: true,
    cellClassName: 'px-4 py-3 text-ink font-medium whitespace-nowrap',
    renderCell: (c) => (
      <Link to={`/admin/catalogue/${c.id}`} className="hover:text-moss hover:underline">
        {c.name}
      </Link>
    ),
  },
  {
    key: 'provider',
    label: 'Provider',
    sortable: true,
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (c) =>
      c.organisations?.name ? (
        <Link to={`/admin/providers?q=${encodeURIComponent(c.organisations.name)}`} className="text-moss font-medium hover:underline">
          {c.organisations.name}
        </Link>
      ) : (
        c.provider || '—'
      ),
  },
  {
    key: 'version',
    label: 'Version',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 whitespace-nowrap',
    renderCell: (c) => <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{c.version_number}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 whitespace-nowrap',
    renderCell: (c) => <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{COURSE_STATUS_LABELS[c.status] ?? c.status}</span>,
  },
  {
    key: 'rejection_reason',
    label: 'Rejection reason',
    sortable: true,
    cellClassName: 'px-4 py-3 text-red-700 truncate max-w-[180px]',
    renderCell: (c) => c.rejection_reason || '—',
  },
  {
    key: 'price',
    label: 'Price',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (c) => formatCoursePrice(c) ?? '—',
  },
  {
    key: 'destinations',
    label: 'Destinations',
    sortable: true,
    cellClassName: 'px-4 py-3 text-secondary truncate max-w-[180px]',
    cellProps: (c) => ({
      title: (c.course_catalogue_publications ?? []).map((p) => p.catalogues?.name).filter(Boolean).join(', '),
    }),
    renderCell: (c) => {
      const destinations = (c.course_catalogue_publications ?? []).map((p) => p.catalogues?.name).filter(Boolean)
      return destinations.length > 0 ? destinations.join(', ') : '—'
    },
  },
  {
    key: 'participants',
    label: 'Participants',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (c) => c.participantCount ?? 0,
  },
  {
    key: 'created_at',
    label: 'Created',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (c) => (c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'),
  },
  {
    key: 'updated_at',
    label: 'Last updated',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (c) => (c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'),
  },
]

export default function AdminCatalogue() {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actioningId, setActioningId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  // Search text, status filter, sort, page and pageSize all live in the URL
  // together (?q=&status=&sort=&dir=&page=&pageSize=) via useSortedPage's
  // urlSync option and useUrlParam -- refresh, browser Back/Forward, and a
  // link from elsewhere (e.g. the upcoming Overview page linking straight to
  // a status) all land on the same filtered/sorted/paged view. Mirrors
  // AdminUsers.jsx's exact param-naming convention.
  //
  // `org` is an organisations.id. AdminProviders links directly into this
  // filter, and the select below also makes the all-provider scope explicit.
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const [statusFilter, setStatusFilter] = useUrlParam(searchParams, setSearchParams, 'status', 'all', { resetParams: ['page'] })
  const [orgFilter, setOrgFilter] = useUrlParam(searchParams, setSearchParams, 'org', '', { resetParams: ['page'] })

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setCourses(await listAllCatalogueCourses())
    } catch (err) {
      setError(`Couldn't load courses: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      courses.filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false
        if (orgFilter && c.organisation_id !== orgFilter) return false
        if (q && !(c.name?.toLowerCase().includes(q) || c.course_code?.toLowerCase().includes(q))) return false
        return true
      }),
    [courses, statusFilter, orgFilter, q]
  )
  const filtersActive = query !== '' || statusFilter !== 'all' || orgFilter !== ''
  // For the "Showing courses for <org>" banner below -- looked up from the
  // unfiltered list (not `filtered`) so the name still shows even when the
  // org filter combined with the other filters yields zero rows.
  const orgFilterName = orgFilter ? courses.find((c) => c.organisation_id === orgFilter)?.organisations?.name : null
  const providers = useMemo(() => {
    const byId = new Map()
    for (const course of courses) {
      if (course.organisation_id && course.organisations?.name) {
        byId.set(course.organisation_id, course.organisations.name)
      }
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [courses])

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, status: null, org: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filtered, CATALOGUE_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('admin-catalogue', CATALOGUE_COLUMNS)
  const selection = useRowSelection(filtered.map((c) => c.id))
  const selectedCourses = useMemo(() => filtered.filter((c) => selection.selected.has(c.id)), [filtered, selection.selected])
  // Same status eligibility as each row's own Reject/Deactivate button --
  // bulk moderation shouldn't act on anything a single-row action wouldn't.
  const selectedToReject = useMemo(
    () => selectedCourses.filter((c) => c.status === 'pending_approval' || c.status === 'draft'),
    [selectedCourses]
  )
  const selectedToDeactivate = useMemo(() => selectedCourses.filter((c) => c.status === 'approved'), [selectedCourses])
  const pageIds = pageItems.map((c) => c.id)
  const selectedOnPage = pageIds.filter((id) => selection.selected.has(id)).length
  const [bulkRejectTargets, setBulkRejectTargets] = useState(null)
  const [bulkDeactivateTargets, setBulkDeactivateTargets] = useState(null)
  const [bulkActing, setBulkActing] = useState(false)

  async function runBulkAction(targets, action, describeFailure) {
    setBulkActing(true)
    setError(null)
    try {
      const results = await Promise.allSettled(targets.map(action))
      const failures = results
        .map((result, index) => ({ result, target: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets.filter((_, index) => results[index].status === 'fulfilled').map((c) => c.id)
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await load()
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${targets.length} courses couldn't be ${describeFailure}: ` +
            failures.map(({ target, result }) => `"${target.name}" (${result.reason?.message ?? 'unknown error'})`).join('; ')
        )
      }
    } catch (err) {
      setError(`Couldn't update courses: ${err.message}`)
    } finally {
      setBulkActing(false)
    }
  }

  async function handleBulkDeactivate() {
    const targets = bulkDeactivateTargets
    await runBulkAction(targets, (c) => deactivateCatalogueCourse(c.id), 'deactivated')
    setBulkDeactivateTargets(null)
  }

  async function handleBulkReject(reason) {
    const targets = bulkRejectTargets
    await runBulkAction(targets, (c) => rejectCatalogueCourse(c.id, reason), 'rejected')
    setBulkRejectTargets(null)
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
      setError(`Couldn't reject this course: ${err.message}`)
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
      setError(`Couldn't deactivate this course: ${err.message}`)
    } finally {
      setActioningId(null)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-lg text-ink">Courses</h2>
          <p className="mt-1 text-sm text-secondary">All courses across every provider.</p>
        </div>
        {orgFilter && (
          <div className="flex items-center gap-2 text-xs text-secondary bg-moss/10 border border-moss/30 rounded-md px-3 py-2">
            <span>
              Showing courses for <span className="text-ink font-medium">{orgFilterName ?? 'this organisation'}</span>.
            </span>
            <button type="button" onClick={() => setOrgFilter('')} className="text-moss font-medium hover:underline">
              Clear
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs rounded-full px-3 py-1 border ${
                  statusFilter === s ? 'border-moss text-ink font-medium bg-moss/10' : 'border-hairline text-secondary hover:text-ink'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
          <ColumnCustomizer
            idPrefix="admin-catalogue"
            columns={columns}
            onToggle={toggleColumn}
            onMove={moveColumn}
            onReset={resetToDefault}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Search courses"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by course name or code…"
            className="flex-1 min-w-[220px] rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <label className="sr-only" htmlFor="admin-course-provider-filter">Filter courses by provider</label>
          <select
            id="admin-course-provider-filter"
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="min-w-[180px] rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="">All providers</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
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

        <MutationFeedback status="error" message={error} />

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">
              {courses.length === 0 ? 'No courses yet.' : 'No courses match your search or filters.'}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                busy={bulkActing}
                actions={[
                  {
                    label: `Reject selected (${selectedToReject.length})`,
                    disabled: selectedToReject.length === 0,
                    title: selectedToReject.length === 0 ? 'None of the selected courses can be rejected' : undefined,
                    onClick: () => setBulkRejectTargets(selectedToReject),
                  },
                  {
                    label: `Deactivate selected (${selectedToDeactivate.length})`,
                    disabled: selectedToDeactivate.length === 0,
                    title: selectedToDeactivate.length === 0 ? 'None of the selected courses can be deactivated' : undefined,
                    onClick: () => setBulkDeactivateTargets(selectedToDeactivate),
                  },
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SelectionTh
                      idPrefix="admin-catalogue"
                      checked={selection.isAllSelected(pageIds)}
                      indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                      onChange={() => selection.toggleAll(pageIds)}
                    />
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
                    <CatalogueRow
                      key={course.id}
                      course={course}
                      visibleColumns={visibleColumns}
                      selected={selection.selected.has(course.id)}
                      onToggleSelected={() => selection.toggle(course.id)}
                      actioning={actioningId === course.id}
                      rejecting={rejectingId === course.id}
                      rejectionReason={rejectionReason}
                      onRejectionReasonChange={setRejectionReason}
                      onStartReject={() => setRejectingId(course.id)}
                      onCancelReject={() => {
                        setRejectingId(null)
                        setRejectionReason('')
                      }}
                      onReject={() => handleReject(course)}
                      onDeactivate={() => handleDeactivate(course)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="admin-catalogue" />
          </div>
        )}
      </div>

      {bulkDeactivateTargets && (
        <ConfirmDialog
          message={`Deactivate ${bulkDeactivateTargets.length} ${bulkDeactivateTargets.length === 1 ? 'course' : 'courses'}? Learners already enrolled keep their progress, but it stops appearing in the catalogue.`}
          confirmLabel="Deactivate"
          confirming={bulkActing}
          onConfirm={handleBulkDeactivate}
          onCancel={() => setBulkDeactivateTargets(null)}
        />
      )}

      {bulkRejectTargets && (
        <BulkRejectDialog
          targets={bulkRejectTargets}
          rejecting={bulkActing}
          onConfirm={handleBulkReject}
          onCancel={() => setBulkRejectTargets(null)}
        />
      )}
    </AdminLayout>
  )
}

// Same required-reason rule as the single-row reject flow above (Confirm
// reject stays disabled until non-empty) -- one shared reason applies to
// every course in this batch, which is the normal case for a moderation
// pass (e.g. rejecting several duplicate/policy-violating submissions at
// once) rather than a per-course rationale.
function BulkRejectDialog({ targets, rejecting, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')

  return (
    <AccessibleDialog
      labelledBy="bulk-reject-title"
      onClose={rejecting ? undefined : onCancel}
      closeOnBackdrop={!rejecting}
      overlayClassName="z-[60]"
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
    >
      <h2 id="bulk-reject-title" className="font-display text-lg text-ink mb-1">
        Reject {targets.length} {targets.length === 1 ? 'course' : 'courses'}
      </h2>
      <p className="text-sm text-secondary mb-4">
        {targets.map((c) => c.name).join(', ')}
      </p>
      <label className="block text-sm text-ink mb-1" htmlFor="bulk-reject-reason">
        Rejection reason (required, applies to all selected)
      </label>
      <input
        id="bulk-reject-reason"
        required
        aria-required="true"
        disabled={rejecting}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink mb-4 focus:outline-none focus:ring-2 focus:ring-moss"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={rejecting}
          className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim())}
          disabled={rejecting || !reason.trim()}
          className="rounded-md bg-red-700 text-white py-2 px-4 text-sm font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {rejecting ? 'Rejecting…' : 'Confirm reject'}
        </button>
      </div>
    </AccessibleDialog>
  )
}

function CatalogueRow({
  course,
  visibleColumns,
  selected,
  onToggleSelected,
  actioning,
  rejecting,
  rejectionReason,
  onRejectionReasonChange,
  onStartReject,
  onCancelReject,
  onReject,
  onDeactivate,
}) {
  return (
    <>
      <tr className="border-b border-hairline last:border-0">
        <td className="px-4 py-3">
          <label className="sr-only" htmlFor={`select-course-${course.id}`}>Select {course.name}</label>
          <input
            id={`select-course-${course.id}`}
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="rounded border-hairline accent-moss"
          />
        </td>
        {visibleColumns.map((col) => (
          <td key={col.key} className={col.cellClassName} {...(col.cellProps ? col.cellProps(course) : {})}>
            {col.renderCell(course)}
          </td>
        ))}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 justify-end whitespace-nowrap">
            {(course.status === 'pending_approval' || course.status === 'draft') && (
                <button
                  type="button"
                  disabled={actioning}
                  onClick={onStartReject}
                  className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
                >
                  Reject
                </button>
            )}
            {course.status === 'approved' && (
              <button
                type="button"
                disabled={actioning}
                onClick={onDeactivate}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
              >
                Deactivate
              </button>
            )}
          </div>
        </td>
      </tr>
      {rejecting && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={visibleColumns.length + 2} className="px-4 pb-3">
            <div className="flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-secondary mb-1" htmlFor={`reject-reason-${course.id}`}>Rejection reason (required)</label>
                <input
                  id={`reject-reason-${course.id}`}
                  required
                  aria-required="true"
                  value={rejectionReason}
                  onChange={(e) => onRejectionReasonChange(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <button
                type="button"
                onClick={onReject}
                disabled={actioning || !rejectionReason.trim()}
                className="rounded-md bg-red-700 text-white py-1.5 px-3 text-sm font-medium hover:bg-red-800 disabled:opacity-50"
              >
                Confirm reject
              </button>
              <button type="button" onClick={onCancelReject} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper">
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
