import { useEffect, useMemo, useState } from 'react'
import AdminLayout from './AdminLayout'
import {
  listAllCatalogueCourses,
  approveCatalogueCourse,
  rejectCatalogueCourse,
  deactivateCatalogueCourse,
} from '../../lib/admin/catalogue'
import { useSortedPage } from '../../lib/useSortedPage'
import { SortableTh, TablePagination } from '../../components/TableControls'

const STATUS_FILTERS = ['all', 'draft', 'pending_approval', 'approved', 'rejected', 'inactive']

const CATALOGUE_SORT_ACCESSORS = {
  name: (c) => c.name?.toLowerCase() ?? '',
  provider: (c) => c.organisations?.name?.toLowerCase() ?? c.provider?.toLowerCase() ?? '',
  version: (c) => c.version_number ?? 0,
  status: (c) => c.status ?? '',
}

export default function AdminCatalogue() {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [actioningId, setActioningId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setCourses(await listAllCatalogueCourses())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(
    () => (statusFilter === 'all' ? courses : courses.filter((c) => c.status === statusFilter)),
    [courses, statusFilter]
  )

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filtered, CATALOGUE_SORT_ACCESSORS)

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

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`text-xs rounded-full px-3 py-1 border ${
                  statusFilter === s ? 'border-moss text-ink font-medium bg-moss/10' : 'border-hairline text-secondary hover:text-ink'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No courses match this filter.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SortableTh label="Course" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Provider" columnKey="provider" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Version" columnKey="version" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((course) => (
                    <CatalogueRow
                      key={course.id}
                      course={course}
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
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="admin-catalogue" />
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function CatalogueRow({
  course,
  actioning,
  rejecting,
  rejectionReason,
  onRejectionReasonChange,
  onStartReject,
  onCancelReject,
  onApprove,
  onReject,
  onDeactivate,
}) {
  const destinations = (course.course_catalogue_publications ?? [])
    .map((publication) => publication.catalogues?.name)
    .filter(Boolean)
  return (
    <tr className="border-b border-hairline last:border-0 align-top">
      <td className="px-4 py-3">
        <p className="text-ink font-medium">{course.name}</p>
        <p className="font-mono text-xs text-secondary mt-0.5">{course.course_code || 'Not set'}</p>
        {destinations.length > 0 && (
          <p className="text-xs text-secondary mt-1">Destinations: {destinations.join(', ')}</p>
        )}
      </td>
      <td className="px-4 py-3 text-secondary whitespace-nowrap">{course.organisations?.name || course.provider || '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{course.version_number}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{course.status.replace('_', ' ')}</span>
        {course.rejection_reason && <p className="text-xs text-red-700 mt-1">Rejected: {course.rejection_reason}</p>}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {(course.status === 'pending_approval' || course.status === 'draft') && (
            <>
              <button
                type="button"
                disabled={actioning}
                onClick={onApprove}
                className="rounded-md bg-moss text-paper py-1 px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={actioning}
                onClick={onStartReject}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
              >
                Reject
              </button>
            </>
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
          {(course.status === 'inactive' || course.status === 'rejected') && (
            <button
              type="button"
              disabled={actioning}
              onClick={onApprove}
              className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
            >
              Reactivate (approve)
            </button>
          )}
        </div>
        {rejecting && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-secondary mb-1">Rejection reason (optional)</label>
              <input
                value={rejectionReason}
                onChange={(e) => onRejectionReasonChange(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <button
              type="button"
              onClick={onReject}
              className="rounded-md bg-red-700 text-white py-1.5 px-3 text-sm font-medium hover:bg-red-800"
            >
              Confirm reject
            </button>
            <button type="button" onClick={onCancelReject} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper">
              Cancel
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
