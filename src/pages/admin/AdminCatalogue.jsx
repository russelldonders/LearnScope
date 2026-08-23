import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import AdminLayout from './AdminLayout'
import {
  listAllCatalogueCourses,
  createPlatformCourse,
  approveCatalogueCourse,
  rejectCatalogueCourse,
  setCatalogueCourseStatus,
} from '../../lib/admin/catalogue'
import { listOrganisations } from '../../lib/admin/organisations'

const STATUS_FILTERS = ['all', 'draft', 'pending_approval', 'approved', 'rejected', 'inactive']

const EMPTY_FORM = { name: '', provider: '', courseType: '', duration: '', synopsis: '', organisationId: '' }

export default function AdminCatalogue() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [actioningId, setActioningId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [courseData, orgData] = await Promise.all([listAllCatalogueCourses(), listOrganisations()])
      setCourses(courseData)
      setOrganisations(orgData)
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

  async function handleApprove(course) {
    setActioningId(course.id)
    setError(null)
    try {
      await approveCatalogueCourse(course.id, user.id)
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

  async function handleSetStatus(course, status) {
    setActioningId(course.id)
    setError(null)
    try {
      await setCatalogueCourseStatus(course.id, status)
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
      await createPlatformCourse(user.id, form)
      setForm(EMPTY_FORM)
      setShowForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
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
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
          >
            {showForm ? 'Cancel' : '+ New platform course'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="bg-card border border-hairline rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="courseName">
                  Name
                </label>
                <input
                  id="courseName"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="courseProvider">
                  Provider (free text)
                </label>
                <input
                  id="courseProvider"
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="courseType">
                  Course type
                </label>
                <input
                  id="courseType"
                  value={form.courseType}
                  onChange={(e) => setForm((f) => ({ ...f, courseType: e.target.value }))}
                  placeholder="Online, In-person, Workshop…"
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="courseDuration">
                  Duration
                </label>
                <input
                  id="courseDuration"
                  value={form.duration}
                  onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-secondary mb-1" htmlFor="courseOrg">
                  Owning organisation (optional — leave blank for a platform-curated entry)
                </label>
                <select
                  id="courseOrg"
                  value={form.organisationId}
                  onChange={(e) => setForm((f) => ({ ...f, organisationId: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="">Platform-curated (no organisation)</option>
                  {organisations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-secondary mb-1" htmlFor="courseSynopsis">
                  Synopsis
                </label>
                <textarea
                  id="courseSynopsis"
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
              {creating ? 'Creating…' : 'Create & publish'}
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No courses match this filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((course) => (
              <div key={course.id} className="bg-card border border-hairline rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-ink font-medium">{course.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mt-0.5">
                      {[course.provider, course.organisations?.name, course.status.replace('_', ' ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {course.rejection_reason && (
                      <p className="text-xs text-red-700 mt-1">Rejected: {course.rejection_reason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {(course.status === 'pending_approval' || course.status === 'draft') && (
                      <>
                        <button
                          type="button"
                          disabled={actioningId === course.id}
                          onClick={() => handleApprove(course)}
                          className="rounded-md bg-moss text-paper py-1 px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actioningId === course.id}
                          onClick={() => setRejectingId(course.id)}
                          className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {course.status === 'approved' && (
                      <button
                        type="button"
                        disabled={actioningId === course.id}
                        onClick={() => handleSetStatus(course, 'inactive')}
                        className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
                      >
                        Deactivate
                      </button>
                    )}
                    {(course.status === 'inactive' || course.status === 'rejected') && (
                      <button
                        type="button"
                        disabled={actioningId === course.id}
                        onClick={() => handleApprove(course)}
                        className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
                      >
                        Reactivate (approve)
                      </button>
                    )}
                  </div>
                </div>
                {rejectingId === course.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-xs text-secondary mb-1">Rejection reason (optional)</label>
                      <input
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReject(course)}
                      className="rounded-md bg-red-700 text-white py-1.5 px-3 text-sm font-medium hover:bg-red-800"
                    >
                      Confirm reject
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null)
                        setRejectionReason('')
                      }}
                      className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
